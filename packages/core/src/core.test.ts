import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Assembly,
  B,
  type BlockRegistry,
  M,
  VANILLA_26_3,
  assembly,
  component,
  formatBlock,
  hopperItemsPerHour,
  material,
  rotateBlock,
  rotateDir,
  rotateVec,
  runChecks,
  steps,
} from "./index.js";

const errors = (a: Assembly, registry?: BlockRegistry) =>
  runChecks(a.resolve(), registry ? { registry } : {}).filter((d) => d.severity === "error");

describe("geometry", () => {
  it("rotates clockwise: north → east → south → west", () => {
    assert.deepEqual(rotateVec([0, 0, -1], 1), [1, 0, 0]);
    assert.deepEqual(rotateVec([0, 0, -1], 2), [0, 0, 1]);
    assert.deepEqual(rotateVec([0, 0, -1], 3), [-1, 0, 0]);
    assert.equal(rotateDir("north", 1), "east");
    assert.equal(rotateDir("west", 1), "north");
    assert.equal(rotateDir("up", 3), "up");
  });

  it("steps converts relative steps", () => {
    assert.deepEqual(steps("forward", 2), [0, 0, -2]);
    assert.deepEqual(steps("right"), [1, 0, 0]);
  });
});

describe("block states", () => {
  it("repeater: facing points at the input side", () => {
    assert.equal(B.repeater().signalTowards("forward").props.facing, "south");
  });

  it("hoppers cannot output upwards", () => {
    assert.throws(() => B.hopper().outputTo("up"));
  });

  it("rotation turns facing, axis, connections and rotation", () => {
    const fence = B.fence().with({ north: true });
    assert.equal(rotateBlock(fence, 1).props.east, true);
    assert.equal(rotateBlock(fence, 1).props.north, false);
    assert.equal(rotateBlock(B.hopper().outputTo("forward"), 1).props.facing, "east");
    assert.equal(rotateBlock({ id: "minecraft:oak_log", props: { axis: "x" } }, 1).props.axis, "z");
    assert.equal(rotateBlock({ id: "minecraft:oak_sign", props: { rotation: 14 } }, 1).props.rotation, 2);
  });

  it("formatBlock sorts properties", () => {
    assert.equal(formatBlock(B.hopper()), "minecraft:hopper[enabled=true,facing=down]");
  });
});

const Source = component({ name: "Source", params: { rate: 100 } }, (c, { rate }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.output("out", h.neighbor("forward"), { item: "minecraft:stone", rate: { perHour: rate, basis: "estimate" } });
});

const Pipe = component({ name: "Pipe" }, (c) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.input("in", h);
  c.output("out", h.neighbor("forward"));
  c.passes("in", "out", 9000, "game-mechanic");
});

const Sink = component({ name: "Sink" }, (c) => {
  c.input("in", c.block(B.chest()));
  c.stores("in", 1728, "game-mechanic");
});

describe("components", () => {
  it("the first block is the anchor; relations place the rest", () => {
    const Tower = component({ name: "Tower" }, (c) => {
      const base = c.block(B.stone());
      c.block(B.sand()).above(base);
      c.block(B.glass()).above(base, 2);
    });
    const t = Tower.instantiate();
    assert.deepEqual(t.blocks.map((b) => b.pos), [[0, 0, 0], [0, 1, 0], [0, 2, 0]]);
  });

  it("the anchor is the first block needed, also when created inside a relation", () => {
    const T = component({ name: "T" }, (c) => void c.block(B.glass()).above(c.block(B.stone())));
    assert.deepEqual(T.instantiate().blocks.map((b) => [b.block.id, b.pos]), [["minecraft:stone", [0, 0, 0]], ["minecraft:glass", [0, 1, 0]]]);
  });

  it("is callable with parameters", () => {
    assert.deepEqual(Source({ rate: 5 }).params, { rate: 5 });
    assert.equal(Source.componentName, "Source");
    assert.equal(Source.instantiate({ rate: 5 }).rates[0]!.type, "produces");
  });

  it("line and fill place many blocks", () => {
    const T = component({ name: "T" }, (c) => {
      c.line((i) => (i === 2 ? B.glass() : B.stone()), [0, 0, 0], "forward", 3);
      c.fill(B.sand(), [1, 0, 0], [2, 1, 0]);
    });
    const blocks = T.instantiate().blocks;
    assert.equal(blocks.length, 7);
    assert.ok(blocks.some((b) => b.block.id === "minecraft:glass" && b.pos[2] === -2));
  });

  it("reports cells occupied twice", () => {
    const Bad = component({ name: "Bad" }, (c) => {
      const a = c.block(B.stone());
      c.block(B.glass()).above(a);
      c.block(B.sand()).above(a);
    });
    assert.throws(() => Bad.instantiate(), /occupied twice/);
  });

  it("a rate on an output needs an item", () => {
    const Bad = component({ name: "Bad" }, (c) => c.output("out", c.block(B.stone()).up, { rate: { perHour: 1, basis: "estimate" } }));
    assert.throws(() => Bad.instantiate(), /needs an item/);
  });
});

describe("assembly", () => {
  it("to() docks the only output onto the only input, left to right", () => {
    const a = assembly("t", (f) => {
      f.add(Source).at([10, 0, 10]).rotated(1).to(Pipe).to(Sink);
    });
    const r = a.resolve();
    assert.deepEqual(r.instances.get("Pipe#1")!.origin, [11, 0, 10]);
    assert.deepEqual(r.instances.get("Sink#1")!.origin, [12, 0, 10]);
    assert.equal(r.connections.length, 2);
    assert.deepEqual(errors(a), []);
  });

  it("to() explains ambiguous ports", () => {
    const Two = component({ name: "Two" }, (c) => {
      const s = c.block(B.stone());
      c.output("a", s.up);
      c.output("b", s.down);
    });
    assert.throws(() => assembly("t", (f) => void f.add(Two).to(Sink)), /exactly one output.*a, b/);
  });

  it("detects misaligned connections", () => {
    const a = new Assembly("t");
    const src = a.add(Source).at([0, 0, 0]);
    const sink = a.add(Sink).at([5, 0, 0]);
    a.connect(src.port("out"), sink.port("in"));
    assert.ok(errors(a).some((d) => d.code === "port-misaligned"));
  });

  it("detects overlap between instances", () => {
    const a = new Assembly("t");
    a.add(Sink).at([0, 0, 0]);
    a.add(Sink).at([0, 0, 0]);
    assert.ok(errors(a).some((d) => d.code === "overlap"));
  });

  it("keepClear: shared free cells are fine, blocks in them are not", () => {
    const Keep = component({ name: "Keep" }, (c) => c.keepClear([0, 0, 0]));
    const ok = assembly("t", (f) => {
      f.add(Keep).at([0, 0, 0]);
      f.add(Keep).at([0, 0, 0]);
    });
    assert.deepEqual(errors(ok), []);
    const bad = assembly("t", (f) => {
      f.add(Keep).at([0, 0, 0]);
      f.add(Sink).at([0, 0, 0]);
    });
    assert.ok(errors(bad).some((d) => d.code === "reserved-cell"));
  });

  it("row follows the rotation of the first instance", () => {
    const a = new Assembly("t");
    const row = a.row(Sink, 3, steps("forward", 2));
    row[0]!.at([0, 0, 0]).rotated(1);
    assert.deepEqual(a.resolve().instances.get("Sink#3")!.origin, [4, 0, 0]);
  });
});

describe("composition", () => {
  // A composite: source → pipe inside, with the pipe's output exposed
  const Feeder = component({ name: "Feeder" }, (c) => {
    const pipe = c.add(Source).to(Pipe);
    c.expose("out", pipe.port("out"));
  });

  it("exposed ports dock like own ports, at any depth, and resolve to the owner", () => {
    const a = assembly("t", (f) => {
      f.add(Feeder).at([0, 0, 0]).rotated(2).to(Sink);
    });
    const r = a.resolve();
    assert.ok(r.instances.has("Feeder#1/Pipe#1"));
    assert.deepEqual(r.instances.get("Sink#1")!.origin, [0, 0, 2]);
    assert.ok(r.connections.some((c) => c.from.instanceId === "Feeder#1/Pipe#1" && c.to.instanceId === "Sink#1"));
    assert.deepEqual(errors(a), []);
  });

  it("composites nest", () => {
    const Twice = component({ name: "Twice" }, (c) => {
      const f = c.add(Feeder);
      c.expose("out", f.port("out"));
    });
    const r = assembly("t", (f) => void f.add(Twice).to(Sink)).resolve();
    assert.ok(r.connections.some((c) => c.from.instanceId === "Twice#1/Feeder#1/Pipe#1"));
  });

  it("open ports of the root are not reported as unconnected", () => {
    const r = assembly("t", (f) => {
      const feeder = f.add(Feeder);
      f.expose("out", feeder.port("out"));
    }).resolve();
    assert.ok(!runChecks(r).some((d) => d.code === "unconnected-port"));
  });
});

describe("materials and environment", () => {
  const Wall = component({ name: "Wall" }, (c) => {
    c.line(B.of(c.material(M.solid)), [0, 0, 0], "up", 2);
  });
  const registry: BlockRegistry = {
    id: "fake",
    withTag: (tag) => (tag === "#redstack:solid" ? ["minecraft:stone", "minecraft:cobblestone"] : []),
    info: (id) =>
      ["minecraft:stone", "minecraft:cobblestone", "minecraft:sand"].includes(id)
        ? { id, kind: id, tags: [], properties: {}, defaultState: {}, fullCube: true, hasBlockEntity: false, color: [0, 0, 0] }
        : undefined,
  };

  it("uses the slot default unless the assembly overrides the role", () => {
    const def = assembly("t", (f) => void f.add(Wall)).resolve();
    assert.ok([...def.blocks.values()].every((b) => b.block.id === "minecraft:stone"));
    const cheap = assembly("t", (f) => void f.add(Wall), { materials: { solid: "minecraft:cobblestone" } }).resolve();
    assert.ok([...cheap.blocks.values()].every((b) => b.block.id === "minecraft:cobblestone"));
  });

  it("reports overrides outside the slot's tag and invalid block states", () => {
    const bad = assembly("t", (f) => void f.add(Wall), { materials: { solid: "minecraft:sand" } });
    assert.ok(errors(bad, registry).some((d) => d.code === "material-not-accepted"));
    const unknown = assembly("t", (f) => void f.add(component({ name: "X" }, (c) => void c.block(B.of("minecraft:nope")))));
    assert.ok(errors(unknown, registry).some((d) => d.code === "invalid-block-state"));
  });

  it("explicit material lists work without a registry tag", () => {
    const slot = material("frame", ["minecraft:stone"], "stone");
    assert.equal(slot.default, "minecraft:stone");
  });

  it("rates follow the environment", () => {
    assert.equal(hopperItemsPerHour(VANILLA_26_3), 9000);
    assert.equal(hopperItemsPerHour({ ...VANILLA_26_3, hopperTransferTicks: 4, hopperAmount: 2 }), 36_000);
  });
});
