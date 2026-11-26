import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { B, type Vec3, assembly, component, formatBlock, key, mirrorBlock, mirrorTemplate, mirrored, runChecks, solveLayout } from "./index.js";

const Source = component({ name: "Source" }, (c) => {
  const chest = c.block(B.chest());
  c.output("out", chest.down, { item: "minecraft:cobblestone", rate: { perHour: 9_000, basis: "estimate" } });
});
const Store = component({ name: "Store" }, (c) => {
  c.input("in", c.block(B.chest()));
  c.stores("in", 27 * 64, "game-mechanic");
});
/** 3 wide, output 2 blocks in front, keeps the cell in front clear */
const Machine = component({ name: "Machine" }, (c) => {
  c.fill(B.stone(), [0, 0, 0], [2, 1, 0]);
  c.keepClear([1, 0, 1]);
  c.output("out", [1, 0, 2], { item: "minecraft:stone", rate: { perHour: 100, basis: "estimate" } });
});
const Pad = component({ name: "Pad" }, (c) => {
  c.input("in", [[0, 0, 0]]);
  c.stores("in", 64, "estimate");
});

describe("solveLayout (pure)", () => {
  it("places a touching item exactly where the ports meet", () => {
    const sol = solveLayout({
      fixedBlocks: [[0, 0, 0]],
      fixedClear: [],
      items: [
        {
          id: "pad",
          options: [{ rotation: 0, shape: { blocks: [[0, 0, 0]], clear: [], ports: new Map([["in", [[0, 0, 0] as Vec3]]]) } }],
          min: [-5, 0, -5],
          max: [5, 0, 5],
        },
      ],
      links: [{ kind: "touch", from: { cells: [[3, 0, 0]] }, to: { item: "pad", port: "in" } }],
      evaluate: () => ({ hoppers: 0, cells: [] }),
    });
    assert.ok(sol.placements);
    assert.deepEqual(sol.placements.get("pad")?.origin, [3, 0, 0]);
    assert.ok(sol.optimal);
  });

  it("reports when nothing fits", () => {
    const sol = solveLayout({
      fixedBlocks: [[3, 0, 0]],
      fixedClear: [],
      items: [
        {
          id: "pad",
          options: [{ rotation: 0, shape: { blocks: [[0, 0, 0]], clear: [], ports: new Map([["in", [[0, 0, 0] as Vec3]]]) } }],
          min: [-5, 0, -5],
          max: [5, 0, 5],
        },
      ],
      links: [{ kind: "touch", from: { cells: [[3, 0, 0]] }, to: { item: "pad", port: "in" } }],
      evaluate: () => ({ hoppers: 0, cells: [] }),
    });
    assert.equal(sol.placements, undefined);
    assert.equal(sol.placements === undefined && sol.impossible, true);
  });
});

describe("free instances in components", () => {
  it("puts a routed source as close as the router allows", () => {
    const r = assembly("near", (f) => {
      const store = f.add(Store).at([0, 0, 0]);
      const src = f.add(Source).free({ rotations: [0] });
      f.route(src.port("out"), store.port("in"));
    }).resolve();
    const errs = runChecks(r).filter((d) => d.severity === "error");
    assert.deepEqual(errs, []);
    const hoppers = [...r.blocks.values()].filter((b) => b.block.id === "minecraft:hopper");
    assert.equal(hoppers.length, 1, "one hopper between a chest above and the store");
  });

  it("turns a machine so its output lands on the pad, without building into kept-clear space", () => {
    const r = assembly("turn", (f) => {
      const pad = f.add(Pad).at([0, 0, 0]);
      f.block(B.stone()).at([0, 1, -2]); // blocks the unrotated position
      const m = f.add(Machine).free({ within: { min: [-4, 0, -4], max: [4, 0, 4] } });
      f.connect(m.port("out"), pad.port("in"));
    }).resolve();
    const errs = runChecks(r).filter((d) => d.severity === "error");
    assert.deepEqual(errs, []);
    const m = r.instances.get("Machine#1")!;
    assert.deepEqual(m.ports.get("out")!.absCells.map(key), ["0,0,0"]);
    assert.notEqual(m.rotation, 0);
  });

  it("moves components docked onto a free one along with it (rigid group)", () => {
    const Belt = component({ name: "Belt" }, (c) => {
      const hs = c.line(B.hopper().outputTo("forward"), [0, 0, 0], "forward", 3);
      c.input("in", hs);
      c.output("out", hs[2]!.neighbor("forward"));
      c.passes("in", "out", 9_000, "game-mechanic");
    });
    const r = assembly("group", (f) => {
      const store = f.add(Store).at([0, 0, 0]);
      f.fill(B.stone(), [-3, 0, -6], [3, 3, -6]); // a wall the group must not cut through
      const src = f.add(Source).free({ within: { min: [-8, 1, -8], max: [8, 4, 8] } });
      const belt = src.to(Belt);
      f.connect(belt.port("out"), store.port("in"));
    }).resolve();
    assert.deepEqual(
      runChecks(r).filter((d) => d.severity === "error"),
      [],
    );
    const belt = r.instances.get("Belt#1")!;
    assert.deepEqual(belt.ports.get("out")!.absCells.map(key), ["0,0,0"], "the belt (docked to the free source) ends in the store");
  });

  it("explains a layout that cannot exist", () => {
    const r = assembly("impossible", (f) => {
      const pad = f.add(Pad).at([0, 0, 0]);
      const m = f.add(Machine).free({ within: { min: [10, 0, 10], max: [12, 0, 12] } });
      f.connect(m.port("out"), pad.port("in"));
    }).resolve();
    assert.ok(runChecks(r).some((d) => d.code === "layout-failed"));
  });
});

describe("mirroring", () => {
  it("mirrors block states east ↔ west, including handedness and 16-step rotation", () => {
    const m = (id: string, props: Record<string, string | number | boolean>) => mirrorBlock({ id, props }).props;
    assert.deepEqual(m("minecraft:oak_stairs", { facing: "east", shape: "inner_left", half: "bottom" }), { facing: "west", shape: "inner_right", half: "bottom" });
    assert.deepEqual(m("minecraft:chest", { facing: "north", type: "left" }), { facing: "north", type: "right" });
    assert.deepEqual(m("minecraft:oak_fence", { east: true, west: false, north: true }), { east: false, west: true, north: true });
    assert.deepEqual(m("minecraft:oak_sign", { rotation: 4 }), { rotation: 12 });
    assert.deepEqual(m("minecraft:rail", { shape: "south_east" }), { shape: "south_west" });
  });

  const Inner = component({ name: "Inner" }, (c) => {
    c.block(B.hopper().outputTo("east")).at([1, 0, 0]);
    c.block(B.of("minecraft:oak_stairs", { facing: "north", shape: "outer_left", half: "bottom", waterlogged: false })).at([2, 0, -1]);
    c.output("out", [2, 0, 0]);
  });
  const Outer = component({ name: "Outer" }, (c) => {
    c.block(B.chest()).at([0, 0, 0]);
    c.add(Inner).at([3, 1, 2]).rotated(1);
    c.add(Inner).at([-2, 0, 0]).rotated(3);
  });

  it("mirrors nested, rotated children exactly like mirroring the resolved blocks", () => {
    const plain = assembly("plain", (f) => void f.add(Outer).at([0, 0, 0])).resolve();
    const mirror = assembly("mirror", (f) => void f.add(mirrored(Outer)).at([0, 0, 0])).resolve();
    assert.equal(mirror.blocks.size, plain.blocks.size);
    for (const b of plain.blocks.values()) {
      const m = mirror.blocks.get(key([-b.pos[0], b.pos[1], b.pos[2]]));
      assert.ok(m, `missing mirror of ${key(b.pos)}`);
      assert.deepEqual(m.block, mirrorBlock(b.block));
    }
  });

  it("mirroring twice gives the original", () => {
    const once = mirrored(Outer).instantiate();
    const twice = mirrorTemplate(once);
    const orig = Outer.instantiate();
    const str = (t: typeof orig) => t.blocks.map((b) => `${key(b.pos)} ${formatBlock(b.block)}`);
    assert.deepEqual(str(twice), str(orig));
    assert.deepEqual(twice.children.map((c) => [c.origin, c.rotation]), orig.children.map((c) => [c.origin, c.rotation]));
  });
});
