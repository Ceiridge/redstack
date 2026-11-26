import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { B, M, assembly, billOfMaterials, component, formatBlock, runChecks } from "@redstack/core";
import {
  blockEntityFields,
  defaultResourcePackPath,
  meshGlb,
  nucleationReader,
  nucleationWriter,
  registry,
  schematicComponent,
  toNucleationSchematic,
} from "./index.js";

const Probe = component({ name: "Probe" }, (c) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.block(B.comparator("subtract").signalTowards("right")).below(h);
  c.keepClear(h.up);
  c.block(B.fence(c.material(M.cactusBreaker))).rightOf(h);
});

describe("schematic export", () => {
  for (const rotation of [0, 1, 2, 3]) {
    it(`litematic round trip keeps all block states (rotation ${rotation})`, () => {
      const r = assembly("probe", (f) => void f.add(Probe).at([3, 5, 7]).rotated(rotation)).resolve();
      const { bytes } = nucleationWriter.write(r, { format: "litematic" });
      const got = nucleationReader.read(bytes, "litematic").map((b) => `${b.pos.join(",")}=${b.block}`).sort();
      const expected = [...r.blocks.values()].map((b) => `${b.pos.join(",")}=${formatBlock(b.block)}`).sort();
      assert.deepEqual(got, expected);
    });
  }

  it("imports a schematic as a component, with ports on found blocks", () => {
    const r = assembly("probe", (f) => void f.add(Probe)).resolve();
    const { bytes } = nucleationWriter.write(r, { format: "litematic" });
    const Imported = schematicComponent({
      name: "Imported",
      bytes,
      format: "litematic",
      setup: (c, find) => c.input("in", find("minecraft:hopper")),
    });
    const t = Imported.instantiate();
    assert.equal(t.blocks.length, 3);
    assert.ok(t.blocks.every((b) => b.pos.every((n) => n >= 0)));
    assert.equal(t.ports.get("in")!.cells.length, 1);
  });
});

describe("block registry", () => {
  it("knows blocks, states and tags", () => {
    const fence = registry.info("minecraft:oak_fence")!;
    assert.equal(fence.kind, "minecraft:fence");
    assert.deepEqual(fence.properties["east"], ["false", "true"]);
    assert.ok(registry.withTag("#minecraft:fences").includes("minecraft:spruce_fence"));
    assert.equal(registry.info("minecraft:not_a_block"), undefined);
  });

  it("defines #redstack:solid without sand, glass, slime or containers", () => {
    const solid = registry.withTag("#redstack:solid");
    for (const id of ["minecraft:stone", "minecraft:cobblestone", "minecraft:oak_planks", "minecraft:oak_log"]) assert.ok(solid.includes(id), id);
    for (const id of ["minecraft:sand", "minecraft:glass", "minecraft:slime_block", "minecraft:chest", "minecraft:redstone_block"]) assert.ok(!solid.includes(id), id);
    assert.ok(registry.withTag("#redstack:glass").includes("minecraft:tinted_glass"));
  });

  it("validates block states and materials of a design", () => {
    const ok = assembly("ok", (f) => void f.add(Probe)).resolve();
    assert.deepEqual(runChecks(ok, { registry }).filter((d) => d.severity === "error"), []);
    const wrongMaterial = assembly("x", (f) => void f.add(Probe), { materials: { cactusBreaker: "minecraft:stone" } }).resolve();
    assert.ok(runChecks(wrongMaterial, { registry }).some((d) => d.code === "material-not-accepted"));
    const badState = assembly("x", (f) => void f.add(component({ name: "X" }, (c) => void c.block(B.of("hopper", { facing: "up" }))))).resolve();
    assert.ok(runChecks(badState, { registry }).some((d) => d.code === "invalid-block-state"));
  });

  it("bill of materials counts blocks by id", () => {
    const bom = billOfMaterials(assembly("p", (f) => void f.add(Probe)).resolve());
    assert.deepEqual(bom.map((b) => b.id).sort(), ["minecraft:comparator", "minecraft:hopper", "minecraft:oak_fence"]);
  });
});

describe("3D mesh", { skip: !existsSync(defaultResourcePackPath()) && "resource pack missing (pnpm assets)" }, () => {
  it("produces a binary glTF", () => {
    const glb = meshGlb(assembly("p", (f) => void f.add(Probe)).resolve());
    assert.equal(Buffer.from(glb.subarray(0, 4)).toString("ascii"), "glTF");
  });
});

describe("container contents", () => {
  it("are written into the schematic as block-entity NBT", () => {
    const a = assembly("filter", (f) => void f.block(B.hopper().containing(["minecraft:stone", 18], ["minecraft:stick", 4])).at([0, 0, 0])).resolve();
    const s = toNucleationSchematic(a);
    try {
      const be = JSON.parse(s.getAllBlockEntitiesSnbtJson()) as Array<{ snbt: string }>;
      assert.match(be[0]!.snbt, /Slot:0B,count:18,id:"minecraft:stone"/);
      assert.match(be[0]!.snbt, /Slot:1B,count:4,id:"minecraft:stick"/);
    } finally {
      s.clearContents();
    }
  });
});

describe("block entities on import", () => {
  it("come back as contents and fields after a litematic round trip", () => {
    const a = assembly("be", (f) => {
      f.block(B.hopper().containing(["minecraft:stone", 18], ["minecraft:stick", 4])).at([0, 0, 0]);
      f.block(B.of("minecraft:crafter", { orientation: "south_up", triggered: false, crafting: false }).withData({ disabled_slots: "[I;3,4,5,6,7,8]" })).at([2, 0, 0]);
    }).resolve();
    const { bytes } = nucleationWriter.write(a, { format: "litematic" });
    const Imported = schematicComponent({ name: "Imported", bytes, format: "litematic" });
    const r = assembly("re", (f) => void f.add(Imported).at([0, 0, 0])).resolve();
    const blocks = [...r.blocks.values()];
    const hopper = blocks.find((b) => b.block.id === "minecraft:hopper")!;
    assert.deepEqual(
      hopper.block.items?.map((i) => [i.slot, i.id, i.count]),
      [
        [0, "minecraft:stone", 18],
        [1, "minecraft:stick", 4],
      ],
    );
    const crafter = blocks.find((b) => b.block.id === "minecraft:crafter")!;
    assert.equal(crafter.block.data?.["disabled_slots"]?.replace(/\s/g, ""), "[I;3,4,5,6,7,8]");
  });

  it("parses SNBT: plain lists of slots become int arrays, transient state is dropped, items with components stay raw", () => {
    const f = blockEntityFields('{components:{},disabled_slots:[3,4,5],triggered:0,x:1,y:2,z:3,TransferCooldown:0}');
    assert.deepEqual(f, { items: [], data: { disabled_slots: "[I;3,4,5]" } });
    const g = blockEntityFields('{Items:[{Slot:0b,id:"minecraft:shulker_box",count:1,components:{"minecraft:container":[{slot:0,item:{id:"minecraft:stone",count:64}}]}}],Lock:{}}');
    assert.equal(g.items.length, 0);
    assert.match(g.data["Items"]!, /minecraft:container/);
    const h = blockEntityFields('{Items:[{Slot:2b,id:"minecraft:kelp",count:30}],CustomName:"a, b"}');
    assert.deepEqual(h.items, [{ slot: 2, id: "minecraft:kelp", count: 30 }]);
    assert.equal(h.data["CustomName"], '"a, b"');
  });
});
