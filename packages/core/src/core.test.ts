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

describe("Geometrie", () => {
  it("dreht im Uhrzeigersinn: Norden → Osten → Süden → Westen", () => {
    assert.deepEqual(rotateVec([0, 0, -1], 1), [1, 0, 0]);
    assert.deepEqual(rotateVec([0, 0, -1], 2), [0, 0, 1]);
    assert.deepEqual(rotateVec([0, 0, -1], 3), [-1, 0, 0]);
    assert.equal(rotateDir("north", 1), "east");
    assert.equal(rotateDir("west", 1), "north");
    assert.equal(rotateDir("up", 3), "up");
  });

  it("steps rechnet relative Schritte um", () => {
    assert.deepEqual(steps("forward", 2), [0, 0, -2]);
    assert.deepEqual(steps("right"), [1, 0, 0]);
  });
});

describe("Block-States", () => {
  it("Repeater: facing zeigt zur Eingangsseite", () => {
    assert.equal(B.repeater().signalTowards("forward").props.facing, "south");
  });

  it("Hopper kann nicht nach oben ausgeben", () => {
    assert.throws(() => B.hopper().outputTo("up"));
  });

  it("Drehung dreht facing, axis, Verbindungen und rotation", () => {
    const fence = B.oakFence().with({ north: true });
    assert.equal(rotateBlock(fence, 1).props.east, true);
    assert.equal(rotateBlock(fence, 1).props.north, false);
    assert.equal(rotateBlock(B.hopper().outputTo("forward"), 1).props.facing, "east");
    assert.equal(rotateBlock({ id: "minecraft:oak_log", props: { axis: "x" } }, 1).props.axis, "z");
    assert.equal(rotateBlock({ id: "minecraft:oak_sign", props: { rotation: 14 } }, 1).props.rotation, 2);
  });

  it("formatBlock sortiert Properties", () => {
    assert.equal(formatBlock(B.hopper()), "minecraft:hopper[enabled=true,facing=down]");
  });
});

const Source = defineComponent({
  name: "Source",
  description: "Test",
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
  description: "Test",
  status: "draft",
  defaults: {},
  build(c) {
    const chest = c.origin(B.chest());
    c.input("in", "items", chest);
    c.stores("in", 1728, "game-mechanic");
  },
});

describe("Komponenten", () => {
  it("meldet unplatzierte Blöcke", () => {
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
    assert.throws(() => Bad.instantiate(), /ohne Position/);
  });

  it("meldet doppelt belegte Zellen", () => {
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
    assert.throws(() => Bad.instantiate(), /doppelt/);
  });
});

describe("Assembly", () => {
  it("attach legt Ports übereinander, auch gedreht", () => {
    const a = new Assembly("t");
    const src = a.add(Source).at([10, 0, 10]).rotated(1);
    a.add(Sink).attach("in", src.port("out"));
    const r = a.resolve();
    const sink = r.instances.get("Sink#1")!;
    assert.deepEqual(sink.origin, [11, 0, 10]); // Ausgang zeigt nach Osten
    assert.deepEqual(runChecks(r).filter((d) => d.severity !== "info"), []);
  });

  it("erkennt falsch ausgerichtete Verbindungen", () => {
    const a = new Assembly("t");
    const src = a.add(Source).at([0, 0, 0]);
    const sink = a.add(Sink).at([5, 0, 0]);
    a.connect(src.port("out"), sink.port("in"));
    const codes = runChecks(a.resolve()).map((d) => d.code);
    assert.ok(codes.includes("port-misaligned"));
  });

  it("erkennt Überlappung zwischen Instanzen", () => {
    const a = new Assembly("t");
    a.add(Sink).at([0, 0, 0]);
    a.add(Sink).at([0, 0, 0]);
    assert.ok(runChecks(a.resolve()).some((d) => d.code === "overlap"));
  });

  it("row platziert relativ zur Drehung der ersten Instanz", () => {
    const a = new Assembly("t");
    const row = a.row(Sink, 3, steps("forward", 2));
    row[0]!.at([0, 0, 0]).rotated(1);
    const r = a.resolve();
    assert.deepEqual(r.instances.get("Sink#3")!.origin, [4, 0, 0]);
  });
});
