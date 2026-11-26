import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { B, assembly, component } from "@redstack/core";
import { scenario } from "@redstack/testing";
import { McTickBackend, defaultBinary, toStructureSnbt } from "./index.js";

const Supply = component({ name: "Supply" }, (c) => {
  const chest = c.block(B.chest());
  c.output("out", chest.down, { item: "minecraft:stone", external: true, rate: { perHour: 1e6, basis: "estimate" } });
});
const Store = component({ name: "Store" }, (c) => {
  c.input("in", c.block(B.chest()));
  c.stores("in", 27 * 64, "game-mechanic");
});
const farm = () =>
  assembly("route", (f) => {
    const a = f.add(Supply).at([-3, 2, 0]);
    const b = f.add(Store).at([2, 0, 1]);
    f.route(a.port("out"), b.port("in"));
  }).resolve();

describe("structure SNBT", () => {
  it("shifts the design to a non-negative frame, fills containers, adds ground", () => {
    const { snbt, offset } = toStructureSnbt(farm(), { items: [{ at: [-3, 2, 0], item: "minecraft:stone", count: 130 }], ground: -1 });
    assert.deepEqual(offset, [-4, -1, -1]);
    assert.match(snbt, /Items: \[\{Slot: 0b, id: "minecraft:stone", count: 64\}, \{Slot: 1b, id: "minecraft:stone", count: 64\}, \{Slot: 2b, id: "minecraft:stone", count: 2\}\]/);
    assert.match(snbt, /Name: "minecraft:stone"/);
    assert.ok(!/pos: \[-/.test(snbt), "no negative positions");
  });
});

describe("mc-tick backend", { skip: !existsSync(defaultBinary()) && "native tool not built (pnpm mctick:build)" }, () => {
  it("moves items through a routed hopper chain at hopper speed", async () => {
    const s = scenario(farm(), {
      durationTicks: 2400,
      warmupTicks: 200,
      sampleEveryTicks: 400,
      actions: [{ type: "insert", at: [-3, 2, 0], item: "minecraft:stone", count: 27 * 64 }],
      expectations: [{ type: "matches-flow-model", tolerance: 0.01 }, { type: "no-ground-items" }],
    });
    const r = await new McTickBackend().run(s);
    assert.ok(r.passed, JSON.stringify(r.expectations));
    assert.equal(r.summary["minecraft:stone"]?.mean, 9_000);
  });

  it("refuses blocks the engine does not model, by name", async () => {
    const Cactus = component({ name: "Cactus" }, (c) => void c.block(B.cactus()).above(c.block(B.of("minecraft:sand"))));
    const s = scenario(assembly("c", (f) => void f.add(Cactus)).resolve(), { durationTicks: 20 });
    await assert.rejects(new McTickBackend().run(s), /minecraft:cactus/);
  });
});
