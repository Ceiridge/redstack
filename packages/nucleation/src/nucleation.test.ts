import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { B, M, assembly, billOfMaterials, component, formatBlock, runChecks } from "@redstack/core";
import { defaultResourcePackPath, meshGlb, nucleationReader, nucleationWriter, registry, schematicComponent } from "./index.js";

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
