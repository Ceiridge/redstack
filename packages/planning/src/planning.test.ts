import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { B, assembly, component } from "@redstack/core";
import { evaluatePlan } from "@redstack/economy";
import { breakEvenRatio, itemForBlock, processFromAssembly } from "./index.js";

const Converter = component({ name: "Converter" }, (c) => {
  c.input("in", c.block(B.of("minecraft:dispenser", { facing: "up", triggered: false })), { item: "minecraft:bone_meal" });
  c.output("out", [0, 2, 0], { item: "minecraft:kelp" });
  c.converts("in", "out", { input: "minecraft:bone_meal", output: "minecraft:kelp", outputPerInput: 0.9, maxPerHour: 1_000 }, "estimate");
});
const Supply = component({ name: "Supply" }, (c) => {
  const chest = c.block(B.chest());
  c.output("out", chest.down, { item: "minecraft:bone_meal", external: true, rate: { perHour: 600, basis: "estimate" } });
});
const Sink = component({ name: "Sink" }, (c) => {
  c.input("in", [[0, 0, 0]]);
  c.stores("in", 1_000, "estimate");
});

const farm = () =>
  assembly("conv", (f) => {
    const conv = f.add(Converter).at([0, 0, 0]);
    const sup = f.add(Supply).at([0, 2, 3]);
    f.connect(sup.port("out"), conv.port("in"));
    f.connect(conv.port("out"), f.add(Sink).at([0, 2, 0]).port("in"));
  }).resolve();

describe("processFromAssembly", () => {
  it("counts what converters use from supply chests as inputs, stored products as outputs", () => {
    const p = processFromAssembly(farm());
    assert.deepEqual(p.inputsPerHour, { "minecraft:bone_meal": 600 });
    assert.deepEqual(p.outputsPerHour, { "minecraft:kelp": 540 });
    assert.equal(p.site.needsPlayerNearby, true);
  });

  it("turns blocks into the items they are placed with, fluids excluded", () => {
    assert.equal(itemForBlock("minecraft:redstone_wire"), "minecraft:redstone");
    assert.equal(itemForBlock("minecraft:oak_wall_sign"), "minecraft:oak_sign");
    assert.equal(itemForBlock("minecraft:water"), undefined);
    assert.deepEqual(processFromAssembly(farm()).buildCost, { "minecraft:dispenser": 1, "minecraft:chest": 1 });
  });

  it("gives a price-independent break-even ratio and plugs into plan evaluation", () => {
    const p = processFromAssembly(farm());
    assert.ok(Math.abs(breakEvenRatio(p)!.ratio - 600 / 540) < 1e-9);
    const quotes = new Map([
      ["minecraft:kelp", { item: "minecraft:kelp", sellPrice: 2, channel: "test", asOf: new Date(0), source: "test" }],
      ["minecraft:bone_meal", { item: "minecraft:bone_meal", buyPrice: 1, channel: "test", asOf: new Date(0), source: "test" }],
    ]);
    const e = evaluatePlan(
      { entries: [{ processId: p.id, siteId: "base", count: 1 }] },
      { processes: new Map([[p.id, p]]), sites: new Map([["base", { id: "base", name: "Base", kind: "afk", needsAccount: true }]]), quotes, accounts: 1 },
    );
    assert.equal(e.profitPerHour, 540 * 2 - 600 * 1);
  });
});
