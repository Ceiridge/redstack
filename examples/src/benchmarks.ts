/**
 * Benchmarks of third-party farm designs on the test server.
 *
 * The schematics are not part of this repository (their designers own them).
 * Download them yourself and put them into the directory named by
 * REDSTACK_BENCHMARKS (default: examples/benchmarks/, which is git-ignored):
 *
 *   small-fast-kelp-farm.litematic         donut.build "Small Fast Kelp Farm"
 *   tnt-duper-cobblestone-farm.litematic   donut.build "TNT Duper Cobblestone Farm"
 *
 * Run with: pnpm test:game:benchmarks [name...]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ComponentType, type Vec3, assembly } from "@redstack/core";
import { schematicComponent } from "@redstack/nucleation";
import { type Scenario, scenario } from "@redstack/testing";

const DIR = process.env["REDSTACK_BENCHMARKS"] ?? resolve(import.meta.dirname, "../benchmarks");

function load(file: string, name: string, setup?: Parameters<typeof schematicComponent>[0]["setup"]): ComponentType {
  const path = resolve(DIR, file);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`Benchmark schematic missing: ${path} (see examples/src/benchmarks.ts).`);
  }
  return schematicComponent({ name, bytes, format: "litematic", ...(setup ? { setup } : {}) });
}

/** Positions of all blocks of the given ids in a resolved assembly. */
function positionsOf(blocks: Iterable<{ pos: Vec3; block: { id: string } }>, ...ids: string[]): Vec3[] {
  return [...blocks].filter((b) => ids.includes(b.block.id)).map((b) => b.pos);
}

/**
 * Small Fast Kelp Farm: kelp bone-mealed by four dispensers on an observer
 * clock, broken by a piston; the items float up to the AFK player.
 * Input: bone meal in the top double chest. Output: kelp into the player.
 */
export function kelpBenchmark(): Scenario {
  const Kelp = load("small-fast-kelp-farm.litematic", "SmallFastKelpFarm");
  const a = assembly("small-fast-kelp-farm", (f) => void f.add(Kelp)).resolve();
  const containers = positionsOf(a.blocks.values(), "minecraft:chest", "minecraft:hopper", "minecraft:dispenser");
  return scenario(a, {
    requires: ["items", "block-updates", "redstone", "fake-player"],
    // The items surface at the top and the water current carries them out
    // through the open fence gate; they land 1–3 blocks in front of the
    // farm, where the player stands on the ground. (A player inside the water
    // at the top is pushed out by the same current.) The farm's y=0 layer is
    // dug into the ground.
    world: { terrain: "flat", groundY: 0, afkSpot: [1, 1, 5] },
    durationTicks: 6_000,
    warmupTicks: 200,
    sampleEveryTicks: 600,
    // The schematic is a snapshot of a working farm: place it as saved, then
    // flip the lever like a player (it was saved switched off)
    placement: "strict",
    actions: [
      { type: "insert", at: [2, 3, 0], item: "minecraft:bone_meal", count: 27 * 64 },
      { type: "insert", at: [3, 3, 0], item: "minecraft:bone_meal", count: 27 * 64 },
      { type: "use", at: [2, 3, 4] },
    ],
    measure: { player: true, containers, items: ["minecraft:kelp", "minecraft:bone_meal"] },
    // Measured 2026-11-26: 18,000 bone meal/h in, ~15,800 kelp/h picked up
    // (the rest is in transit or lands just out of reach)
    expectations: [{ type: "rate-at-least", item: "minecraft:kelp", perHour: 15_000 }],
  });
}

/**
 * TNT Duper Cobblestone Farm: a TNT duper blows up a ring of cobblestone
 * generators; a water funnel and an item stream feed 145 storage chests.
 */
export function tntCobbleBenchmark(): Scenario {
  const Farm = load("tnt-duper-cobblestone-farm.litematic", "TntDuperCobblestoneFarm");
  const a = assembly("tnt-duper-cobblestone-farm", (f) => void f.add(Farm)).resolve();
  return scenario(a, {
    requires: ["items", "block-updates", "redstone", "fake-player"],
    durationTicks: 24_000,
    warmupTicks: 6_000,
    sampleEveryTicks: 2_000,
    placement: "strict",
    actions: [{ type: "use", at: [0, 8, 8] }],
    measure: { containers: positionsOf(a.blocks.values(), "minecraft:chest", "minecraft:hopper"), items: ["minecraft:cobblestone"] },
    expectations: [{ type: "no-ground-items" }],
  });
}

export const scenarios: Record<string, () => Scenario> = {
  "small-fast-kelp-farm": kelpBenchmark,
  "tnt-duper-cobblestone-farm": tntCobbleBenchmark,
};
