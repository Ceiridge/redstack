/**
 * In-game test scenarios for the standard library and the examples.
 * Run with: redstack test examples/dist/scenarios.js
 */

import { Assembly } from "@redstack/core";
import { Chest, HopperLine, SupplyChest } from "@redstack/stdlib";
import { type Scenario, scenario } from "@redstack/testing";
import { cactusFarm } from "./cactus-farm.js";

/** HopperLine throughput: a full supply chest drains through 8 hoppers into a chest. */
export function hopperLineThroughput(): Scenario {
  const a = new Assembly("hopper-line-throughput");
  const supply = a.add(SupplyChest, { item: "minecraft:cobblestone" });
  const line = a.add(HopperLine, { length: 8 }).attach("in", supply.port("out"));
  a.add(Chest).attach("in", line.port("out"));
  const resolved = a.resolve();
  const supplyPos = resolved.instances.get(supply.id)!.origin;
  return scenario(resolved, {
    durationTicks: 2400,
    warmupTicks: 200,
    sampleEveryTicks: 400,
    actions: [{ type: "insert", at: supplyPos, item: "minecraft:cobblestone", count: 27 * 64 }],
    expectations: [{ type: "matches-flow-model", tolerance: 0.03 }, { type: "no-ground-items" }],
  });
}

/** Breaker comparison: 24 cells for 4 in-game hours, so the survival share can be estimated. */
function cactusBreaker(breaker: "fence" | "glass"): Scenario {
  return scenario(cactusFarm(24, { breaker }).resolve(), {
    name: `cactus-breaker-${breaker}`,
    repeats: 3,
    requires: ["items", "block-updates", "random-ticks", "fake-player"],
    durationTicks: 72_000 * 4,
    sampleEveryTicks: 24_000,
    expectations: [{ type: "no-ground-items" }, { type: "no-stuck-hoppers" }],
  });
}

/** The default example farm against its own flow model. */
export function cactusFarm16(): Scenario {
  return scenario(cactusFarm(16).resolve(), {
    requires: ["items", "block-updates", "random-ticks", "fake-player"],
    durationTicks: 72_000 * 4,
    sampleEveryTicks: 24_000,
    expectations: [{ type: "matches-flow-model", tolerance: 0.15 }, { type: "no-ground-items" }, { type: "no-stuck-hoppers" }],
  });
}

export const scenarios: Record<string, () => Scenario> = {
  "hopper-line-throughput": hopperLineThroughput,
  "cactus-breaker-fence": () => cactusBreaker("fence"),
  "cactus-breaker-glass": () => cactusBreaker("glass"),
  "cactus-farm-16": cactusFarm16,
};
