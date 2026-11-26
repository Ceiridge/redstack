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
import { B, type ComponentType, type Vec3, assembly, component, hopperItemsPerHour } from "@redstack/core";
import { Chest, ShulkerLoader } from "@redstack/stdlib";
import { schematicComponent } from "@redstack/nucleation";
import { type Scenario, scenario } from "@redstack/testing";

const DIR = process.env["REDSTACK_BENCHMARKS"] ?? resolve(import.meta.dirname, "../benchmarks");

function load(
  file: string,
  name: string,
  setup?: Parameters<typeof schematicComponent>[0]["setup"],
  exclude?: Parameters<typeof schematicComponent>[0]["exclude"],
): ComponentType {
  const path = resolve(DIR, file);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`Benchmark schematic missing: ${path} (see examples/src/benchmarks.ts).`);
  }
  return schematicComponent({ name, bytes, format: "litematic", ...(setup ? { setup } : {}), ...(exclude ? { exclude } : {}) });
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

/** A hopper under a water stream, passing what lands in it straight down. */
const StreamTap = component({ name: "StreamTap", status: "game-tested", params: {} }, (c) => {
  const h = c.block(B.hopper().outputTo("down")).at([0, 0, 0]);
  c.input("in", h, { description: "items in the water above" });
  c.output("out", h.down);
  c.passes("in", "out", hopperItemsPerHour(c.env), "game-mechanic");
});

/** Stream cells of the TNT farm (y=2 under the water at y=3, z=9), x=18 is packed ice under the sign */
const STREAM_X = [12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24];

/**
 * The TNT duper cobblestone farm with its storage hall replaced: hoppers
 * under the item stream (taps) feed shulker loaders whose position and
 * rotation the layout search chooses, with hopper routes from the router.
 * Each loader moves 9,000 items/h – the farm makes ~208,000/h, so the flow
 * model reports the taps as the bottleneck; the test measures what the
 * loaders actually pack.
 */
export function tntCobbleShulkerFarm(loaders = 4, maxNodes = 2_000, levels = 1) {
  const taps = STREAM_X.filter((_, i) => i % Math.ceil(STREAM_X.length / loaders) === 0).slice(0, loaders);
  const Farm = load("tnt-duper-cobblestone-farm.litematic", "TntDuperCobblestoneFarm", (c) => {
    c.output("stream", taps.map((x) => [x, 2, 9] as Vec3), {
      item: "minecraft:cobblestone",
      rate: { perHour: 208_000, basis: "measured", note: "benchmark of the original, 2 runs (docs/experiments/donut-benchmarks.md)" },
    });
  }, (pos, block) => pos[1] <= 2 && pos[0] >= 12 && /^minecraft:(chest|hopper)\b/.test(block));
  return assembly("tnt-cobble-shulker", (f) => {
    f.layout({ maxNodes, weights: { volume: 1, hoppers: 10 }, routeRadius: 4 + 6 * (levels - 1) });
    const farm = f.add(Farm).at([0, 0, 0]);
    for (const x of STREAM_X) {
      if (taps.includes(x)) {
        const tap = f.add(StreamTap).at([x, 2, 9]);
        f.connect(farm.port("stream"), tap.port("in"));
        const loader = f.add(ShulkerLoader).free({ within: { min: [4, -3 - 6 * (levels - 1), -2], max: [32, -3, 20] } });
        loader.to(Chest);
        f.route(tap.port("out"), loader.port("in"));
      } else {
        // Closed stream bed, or the water would pour down
        f.block(B.of("minecraft:glass")).at([x, 2, 9]);
      }
    }
  });
}

export function tntCobbleShulkerScenario(count = 4, maxNodes = 2_000, levels = 1): Scenario {
  const r = tntCobbleShulkerFarm(count, maxNodes, levels).resolve();
  const ours = [...r.blocks.values()].filter((b) => !b.instanceId.startsWith("TntDuperCobblestoneFarm"));
  const loaders = [...r.instances.values()].filter((i) => i.template.typeName === "ShulkerLoader");
  return scenario(r, {
    name: `tnt-cobble-shulker-${count}`,
    requires: ["items", "block-updates", "redstone", "fake-player"],
    durationTicks: 12_000,
    warmupTicks: 2_000,
    sampleEveryTicks: 2_000,
    placement: { strict: (id) => id.startsWith("TntDuperCobblestoneFarm") },
    actions: [
      ...loaders.map((l) => ({ type: "insert" as const, at: l.ports.get("boxes")!.absCells[0]!, item: "minecraft:shulker_box", count: 4, stack: 1 })),
      { type: "use", at: [0, 8, 8] },
    ],
    // Only what is packed: the boxes being filled and the chests of full boxes.
    // (Counting the hoppers too would add their filling-up as a rate.)
    measure: {
      containers: ours.filter((b) => /^minecraft:(chest|shulker_box)$/.test(b.block.id)).map((b) => b.pos),
      items: ["minecraft:cobblestone"],
    },
    expectations: [{ type: "rate-at-least", item: "minecraft:cobblestone", perHour: loaders.length * 8_500 }],
  });
}

scenarios["tnt-cobble-shulker-4"] = () => tntCobbleShulkerScenario(4);
scenarios["tnt-cobble-shulker-12"] = () => tntCobbleShulkerScenario(12, 4_000, 2);
