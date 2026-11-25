import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Assembly,
  B,
  defineComponent,
  formatBlock,
  rotateBlock,
  rotateDir,
  rotateVec,
  runChecks,
  steps,
} from "./index.js";

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
    const fence = B.oakFence().with({ north: true });
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

const Source = defineComponent({
  name: "Source",
  description: "test",
  status: "draft",
  defaults: { rate: 100 },
  build(c, { rate }) {
    const h = c.origin(B.hopper().outputTo("forward"));
    c.output("out", "items", h.neighbor("forward"));
    c.produces("out", "minecraft:stone", rate, "estimate");
  },
});

const Sink = defineComponent({
  name: "Sink",
  description: "test",
  status: "draft",
  defaults: {},
  build(c) {
    const chest = c.origin(B.chest());
    c.input("in", "items", chest);
    c.stores("in", 1728, "game-mechanic");
  },
});

describe("components", () => {
  it("reports unplaced blocks", () => {
    const Bad = defineComponent({
      name: "Bad",
      description: "",
      status: "draft",
      defaults: {},
      build(c) {
        c.origin(B.stone());
        c.place(B.glass());
      },
    });
    assert.throws(() => Bad.instantiate(), /without position/);
  });

  it("reports cells occupied twice", () => {
    const Bad = defineComponent({
      name: "Bad",
      description: "",
      status: "draft",
      defaults: {},
      build(c) {
        const a = c.origin(B.stone());
        c.place(B.glass()).above(a);
        c.place(B.sand()).above(a);
      },
    });
    assert.throws(() => Bad.instantiate(), /occupied twice/);
  });
});

describe("Assembly", () => {
  it("attach lines up ports, also when rotated", () => {
    const a = new Assembly("t");
    const src = a.add(Source).at([10, 0, 10]).rotated(1);
    a.add(Sink).attach("in", src.port("out"));
    const r = a.resolve();
    const sink = r.instances.get("Sink#1")!;
    assert.deepEqual(sink.origin, [11, 0, 10]); // output points east
    assert.deepEqual(runChecks(r).filter((d) => d.severity !== "info"), []);
  });

  it("detects misaligned connections", () => {
    const a = new Assembly("t");
    const src = a.add(Source).at([0, 0, 0]);
    const sink = a.add(Sink).at([5, 0, 0]);
    a.connect(src.port("out"), sink.port("in"));
    const codes = runChecks(a.resolve()).map((d) => d.code);
    assert.ok(codes.includes("port-misaligned"));
  });

  it("detects overlap between instances", () => {
    const a = new Assembly("t");
    a.add(Sink).at([0, 0, 0]);
    a.add(Sink).at([0, 0, 0]);
    assert.ok(runChecks(a.resolve()).some((d) => d.code === "overlap"));
  });

  it("two components may reserve the same free cell", () => {
    const Keep = defineComponent({
      name: "Keep",
      description: "",
      status: "draft",
      defaults: {},
      build(c) {
        c.origin(B.air());
      },
    });
    const a = new Assembly("t");
    a.add(Keep).at([0, 0, 0]);
    a.add(Keep).at([0, 0, 0]);
    assert.deepEqual(runChecks(a.resolve()).filter((d) => d.severity === "error"), []);
  });

  it("reports a block placed into a reserved cell", () => {
    const a = new Assembly("t");
    const Keep = defineComponent({ name: "Keep", description: "", status: "draft", defaults: {}, build: (c) => void c.origin(B.air()) });
    a.add(Keep).at([0, 0, 0]);
    a.add(Sink).at([0, 0, 0]);
    assert.ok(runChecks(a.resolve()).some((d) => d.code === "reserved-cell"));
  });

  it("row follows the rotation of the first instance", () => {
    const a = new Assembly("t");
    const row = a.row(Sink, 3, steps("forward", 2));
    row[0]!.at([0, 0, 0]).rotated(1);
    const r = a.resolve();
    assert.deepEqual(r.instances.get("Sink#3")!.origin, [4, 0, 0]);
  });
});
