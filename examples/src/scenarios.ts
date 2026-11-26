/**
 * In-game test scenarios for the standard library and the examples.
 * Run with: pnpm test:game [name...]
 */

import { assembly } from "@redstack/core";
import { Chest, HopperLine, SupplyChest } from "@redstack/stdlib";
import { type Scenario, scenario } from "@redstack/testing";
import { cactusFarm, cactusRingFarm } from "./cactus-farm.js";

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
  "cactus-row-fence": () => cactusSurvival("row", "fence"),
  "cactus-row-glass": () => cactusSurvival("row", "glass"),
  "cactus-ring-fence": () => cactusSurvival("ring", "fence"),
  "cactus-farm-16": cactusFarm16,
};
