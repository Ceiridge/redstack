/**
 * In-game test scenarios for the standard library and the examples.
 * Run with: pnpm test:game [name...]
 */

import { B, assembly } from "@redstack/core";
import { Chest, HopperLine, SupplyChest } from "@redstack/stdlib";
import { type Scenario, scenario } from "@redstack/testing";
import { cactusFarm, cactusRingFarm } from "./cactus-farm.js";
import { kelpFarm } from "./kelp-farm.js";

const CROPS = ["items", "block-updates", "random-ticks", "fake-player"] as const;

/** HopperLine throughput: a full supply chest drains through 8 hoppers into a chest. */
export function hopperLineThroughput(): Scenario {
  const r = assembly("hopper-line-throughput", (f) => {
    f.add(SupplyChest).at([0, 1, 0]).to(HopperLine({ length: 8 })).to(Chest);
  }).resolve();
  return scenario(r, {
    durationTicks: 2400,
    warmupTicks: 200,
    sampleEveryTicks: 400,
    actions: [{ type: "insert", at: [0, 1, 0], item: "minecraft:cobblestone", count: 27 * 64 }],
    expectations: [{ type: "matches-flow-model", tolerance: 0.03 }, { type: "no-ground-items" }],
  });
}

/**
 * Router check: three supply chests at different heights, merged into one
 * chest by a solved hopper tree. A wall is in the way, and a decoy chest full
 * of dirt sits where a naive route would pass under it and drain it.
 */
export function hopperCollector(): Scenario {
  const r = assembly("hopper-collector", (f) => {
    const a = f.add(SupplyChest).at([0, 4, 0]);
    const b = f.add(SupplyChest).at([0, 3, 6]);
    const c = f.add(SupplyChest).at([5, 5, 8]);
    const store = f.add(Chest).at([9, 0, 3]);
    f.fill(B.stone(), [4, 0, 1], [4, 3, 5]);
    f.block(B.chest()).at([6, 2, 3]);
    f.collect([a.port("out"), b.port("out"), c.port("out")], store.port("in"));
  }).resolve();
  return scenario(r, {
    durationTicks: 2400,
    warmupTicks: 400,
    sampleEveryTicks: 400,
    actions: [
      { type: "insert", at: [0, 4, 0], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [0, 3, 6], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [5, 5, 8], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [6, 2, 3], item: "minecraft:dirt", count: 27 * 64 },
    ],
    measure: { items: ["minecraft:cobblestone", "minecraft:dirt"] },
    expectations: [
      { type: "matches-flow-model", tolerance: 0.03 },
      { type: "rate-at-most", item: "minecraft:dirt", perHour: 0 },
      { type: "no-ground-items" },
    ],
  });
}

/**
 * The rebuilt kelp farm with router-placed supply hoppers, against its flow
 * model. Placed strictly: block-by-block placement with updates sets off the
 * observer clock several times over, and the extra pulses make the piston
 * delete the water the kelp grows into (true for the original design too).
 */
export function kelpFarmScenario(): Scenario {
  const r = kelpFarm(2).resolve();
  const containers = [...r.blocks.values()]
    .filter((b) => ["minecraft:chest", "minecraft:hopper", "minecraft:dispenser"].includes(b.block.id))
    .map((b) => b.pos);
  return scenario(r, {
    requires: ["items", "block-updates", "redstone", "fake-player"],
    world: { terrain: "flat", groundY: 0, afkSpot: [1, 1, 5] },
    durationTicks: 6_000,
    warmupTicks: 400,
    sampleEveryTicks: 600,
    placement: "strict",
    actions: [
      { type: "insert", at: [-1, 3, 1], item: "minecraft:bone_meal", count: 27 * 64 },
      { type: "insert", at: [3, 3, 3], item: "minecraft:bone_meal", count: 27 * 64 },
      { type: "use", at: [2, 3, 4] },
    ],
    measure: { player: true, containers, items: ["minecraft:kelp", "minecraft:bone_meal"] },
    expectations: [{ type: "matches-flow-model", tolerance: 0.1 }],
  });
}

/** Survival measurement: 24 cactus columns, 4 in-game hours, 3 runs. */
function cactusSurvival(design: "row" | "ring", breaker: "fence" | "glass"): Scenario {
  const farm = design === "row" ? cactusFarm(24, breaker) : cactusRingFarm(24, breaker);
  return scenario(farm.resolve(), {
    name: `cactus-${design}-${breaker}`,
    requires: CROPS,
    durationTicks: 72_000 * 4,
    sampleEveryTicks: 24_000,
    repeats: 3,
    expectations: [{ type: "no-ground-items" }, { type: "no-stuck-hoppers" }],
  });
}

/** The default example farm against its own flow model. */
export function cactusFarm16(): Scenario {
  return scenario(cactusFarm(16).resolve(), {
    requires: CROPS,
    durationTicks: 72_000 * 4,
    sampleEveryTicks: 24_000,
    expectations: [{ type: "matches-flow-model", tolerance: 0.15 }, { type: "no-ground-items" }, { type: "no-stuck-hoppers" }],
  });
}

export const scenarios: Record<string, () => Scenario> = {
  "hopper-line-throughput": hopperLineThroughput,
  "hopper-collector": hopperCollector,
  "kelp-farm": kelpFarmScenario,
  "cactus-row-fence": () => cactusSurvival("row", "fence"),
  "cactus-row-glass": () => cactusSurvival("row", "glass"),
  "cactus-ring-fence": () => cactusSurvival("ring", "fence"),
  "cactus-farm-16": cactusFarm16,
};
