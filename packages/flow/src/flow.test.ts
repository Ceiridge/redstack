import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { B, assembly, component } from "@redstack/core";
import { analyzeFlow } from "./index.js";

const Src = component({ name: "Src", params: { rate: 100 } }, (c, { rate }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.output("out", h.neighbor("forward"), { item: "minecraft:stone", rate: { perHour: rate, basis: "game-mechanic" } });
});

const Pipe = component({ name: "Pipe", params: { max: 50 } }, (c, { max }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.input("in", h);
  c.output("out", h.neighbor("forward"));
  c.passes("in", "out", max, "game-mechanic");
});

const Store = component({ name: "Store" }, (c) => {
  c.input("in", c.block(B.chest()));
  c.stores("in", 1000, "game-mechanic");
});

const ItemSrc = component({ name: "ItemSrc", params: { item: "minecraft:stone", rate: 100 } }, (c, { item, rate }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.output("out", h.neighbor("forward"), { item, rate: { perHour: rate, basis: "game-mechanic" } });
});

/** Two cobblestone sides, one planks side: 4 cobblestone + 3 planks per craft */
const Recipe = component({ name: "Recipe", params: { max: 1000 } }, (c, { max }) => {
  const a = c.block(B.hopper().outputTo("down")).at([0, 0, 0]);
  const b = c.block(B.hopper().outputTo("down")).at([2, 0, 0]);
  const d = c.block(B.hopper().outputTo("down")).at([4, 0, 0]);
  c.input("a", a);
  c.input("b", b);
  c.input("d", d);
  c.output("out", [6, 0, 0]);
  c.crafts(
    [
      { from: "a", item: "minecraft:cobblestone", perCraft: 2 },
      { from: "b", item: "minecraft:cobblestone", perCraft: 2 },
      { from: "d", item: "minecraft:oak_planks", perCraft: 3 },
    ],
    "out",
    { output: "minecraft:piston", maxCraftsPerHour: max },
    "game-mechanic",
  );
});

describe("flow model", () => {
  it("crafts at the pace of the scarcest ingredient, pooling sides with the same item", () => {
    const run = (cobble: number, planks: number, max = 1000) =>
      analyzeFlow(
        assembly("t", (f) => {
          const r = f.add(Recipe({ max })).at([0, 0, 0]);
          f.connect(f.add(ItemSrc({ item: "minecraft:cobblestone", rate: cobble })).at([0, 2, 0]).port("out"), r.port("a"));
          f.connect(f.add(ItemSrc({ item: "minecraft:cobblestone", rate: cobble })).at([2, 2, 0]).port("out"), r.port("b"));
          f.connect(f.add(ItemSrc({ item: "minecraft:oak_planks", rate: planks })).at([4, 2, 0]).port("out"), r.port("d"));
          f.connect(r.port("out"), f.add(Store).at([8, 0, 0]).port("in"));
        }).resolve(),
      );
    // 2 × 200 cobblestone = 100 crafts, 600 planks = 200 crafts → 100
    let f = run(200, 600);
    assert.equal(f.storedPerHour["minecraft:piston"], 100);
    assert.equal(f.convertedPerHour["minecraft:cobblestone"], 400);
    assert.equal(f.convertedPerHour["minecraft:oak_planks"], 300);
    assert.ok(!f.diagnostics.some((d) => d.code === "flow-dead-end"));
    // Planks are scarce now
    f = run(1000, 150);
    assert.equal(f.storedPerHour["minecraft:piston"], 50);
    // The crafter's own limit
    f = run(1000, 3000, 80);
    assert.equal(f.storedPerHour["minecraft:piston"], 80);
    assert.equal(f.bottlenecks.length, 1);
  });

  it("finds the bottleneck and fill time", () => {
    const f = analyzeFlow(assembly("t", (a) => void a.add(Src({ rate: 200 })).to(Pipe({ max: 50 })).to(Store)).resolve());
    assert.equal(f.bottlenecks.length, 1);
    assert.equal(f.bottlenecks[0]!.utilization, 4);
    assert.equal(f.storedPerHour["minecraft:stone"], 50);
    assert.equal(f.sinks[0]!.hoursToFull, 20);
  });

  it("reports lost items", () => {
    const f = analyzeFlow(assembly("t", (a) => void a.add(Src)).resolve());
    assert.ok(f.diagnostics.some((d) => d.code === "flow-spill"));
  });

  it("flows through nested components", () => {
    const Line = component({ name: "Line" }, (c) => {
      const last = c.add(Src({ rate: 30 })).to(Pipe).to(Pipe);
      c.expose("out", last.port("out"));
    });
    const f = analyzeFlow(assembly("t", (a) => void a.add(Line).to(Store)).resolve());
    assert.equal(f.storedPerHour["minecraft:stone"], 30);
  });
});
