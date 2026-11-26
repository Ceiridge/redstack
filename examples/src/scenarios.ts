/**
 * In-game test scenarios for the standard library and the examples.
 * Run with: pnpm test:game [name...]
 */

import { B, assembly } from "@redstack/core";
import {
  Chest,
  Crafter,
  DoubleChest,
  FastShulkerLoader,
  HopperLine,
  ItemFilter,
  ShulkerLoader,
  ShulkerUnloader,
  SmelterArray,
  SupplyChest,
  filledShulker,
} from "@redstack/stdlib";
import { type Scenario, scenario } from "@redstack/testing";
import { cactusFarm, cactusRingFarm } from "./cactus-farm.js";
import { kelpFarm } from "./kelp-farm.js";
import { kelpTwin } from "./kelp-twin.js";

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
export function kelpFarmScenario(mirror = false): Scenario {
  const r = kelpFarm(2, mirror).resolve();
  const m = (v: readonly [number, number, number]): [number, number, number] => (mirror ? [-v[0], v[1], v[2]] : [v[0], v[1], v[2]]);
  const containers = [...r.blocks.values()]
    .filter((b) => ["minecraft:chest", "minecraft:hopper", "minecraft:dispenser"].includes(b.block.id))
    .map((b) => b.pos);
  return scenario(r, {
    requires: ["items", "block-updates", "redstone", "fake-player"],
    world: { terrain: "flat", groundY: 0, afkSpot: m([1, 1, 5]) },
    durationTicks: 6_000,
    warmupTicks: 400,
    sampleEveryTicks: 600,
    placement: "strict",
    actions: [
      { type: "insert", at: m([-1, 3, 1]), item: "minecraft:bone_meal", count: 27 * 64 },
      { type: "insert", at: m([3, 3, 3]), item: "minecraft:bone_meal", count: 27 * 64 },
      { type: "use", at: m([2, 3, 4]) },
    ],
    measure: { player: true, containers, items: ["minecraft:kelp", "minecraft:bone_meal"] },
    expectations: [{ type: "matches-flow-model", tolerance: 0.1 }],
  });
}

/**
 * Two kelp cores and their supply chests placed by the layout search, one
 * player for both. Levers and chests are found in the solved layout.
 */
export function kelpTwinScenario(): Scenario {
  const r = kelpTwin().resolve();
  const blocks = [...r.blocks.values()];
  const of = (id: string) => blocks.filter((b) => b.block.id === id).map((b) => b.pos);
  const player = r.instances.get("PlayerPickup#1")!.origin;
  return scenario(r, {
    requires: ["items", "block-updates", "redstone", "fake-player"],
    world: { terrain: "flat", groundY: 0, afkSpot: player },
    durationTicks: 6_000,
    warmupTicks: 400,
    sampleEveryTicks: 600,
    placement: "strict",
    actions: [
      ...[...r.instances.values()]
        .filter((i) => i.template.typeName === "SupplyChest")
        .map((i) => ({ type: "insert" as const, at: i.origin, item: "minecraft:bone_meal", count: 27 * 64 })),
      ...of("minecraft:lever").map((at) => ({ type: "use" as const, at })),
    ],
    measure: {
      player: true,
      containers: [...of("minecraft:chest"), ...of("minecraft:hopper"), ...of("minecraft:dispenser")],
      items: ["minecraft:kelp", "minecraft:bone_meal"],
    },
    expectations: [{ type: "matches-flow-model", tolerance: 0.1 }],
  });
}

/**
 * Shulker loader: three chests of cobblestone feed a hopper line into the
 * loader; full boxes go into a chest. Counted: cobblestone inside the boxes.
 */
export function shulkerLoaderScenario(): Scenario {
  const r = assembly("shulker-loader", (f) => {
    const loader = f.add(ShulkerLoader).at([0, 0, 0]);
    const line = f.add(HopperLine({ length: 3, exit: "down" }));
    line.attach("out", loader.port("in"));
    for (let i = 0; i < 3; i++) f.connect(f.add(SupplyChest).offsetFrom(line, [0, 1, -i]).port("out"), line.port("in"));
    f.connect(loader.port("out"), f.add(Chest).at([0, -2, 2]).port("in"));
  }).resolve();
  const supplies = [...r.instances.values()].filter((i) => i.template.typeName === "SupplyChest").map((i) => i.origin);
  return scenario(r, {
    durationTicks: 3 * 14_000,
    sampleEveryTicks: 2_000,
    actions: [
      ...supplies.map((at) => ({ type: "insert" as const, at, item: "minecraft:cobblestone", count: 27 * 64 })),
      { type: "insert", at: [0, 2, 0], item: "minecraft:shulker_box", count: 4, stack: 1 },
    ],
    measure: { items: ["minecraft:cobblestone", "minecraft:shulker_box"] },
    expectations: [{ type: "matches-flow-model", tolerance: 0.05 }, { type: "no-ground-items" }],
  });
}

/** Fast shulker loader: a supply chest above each filling hopper, two boxes. */
export function fastShulkerLoaderScenario(): Scenario {
  const r = assembly("fast-shulker-loader", (f) => {
    const loader = f.add(FastShulkerLoader).at([0, 0, 0]);
    for (const at of [[-1, 1, 0], [0, 1, 1]] as const) f.connect(f.add(SupplyChest).at(at).port("out"), loader.port("in"));
    loader.to(Chest);
  }).resolve();
  const chest = r.instances.get("Chest#1")!.origin;
  return scenario(r, {
    // Two chests hold exactly two boxes; end shortly after the second is full
    durationTicks: 14_200,
    sampleEveryTicks: 200,
    actions: [
      { type: "insert", at: [-1, 1, 0], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [0, 1, 1], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [0, 1, -1], item: "minecraft:shulker_box", count: 4, stack: 1 },
    ],
    // The box being filled and the chest of full boxes
    measure: { containers: [[0, 0, 0], chest], items: ["minecraft:cobblestone", "minecraft:shulker_box"] },
    expectations: [{ type: "rate-at-least", item: "minecraft:cobblestone", perHour: 17_000 }, { type: "no-ground-items" }],
  });
}

/** Shulker unloader: two full boxes in, items (and empty boxes) out into a double chest. */
export function shulkerUnloaderScenario(): Scenario {
  const r = assembly("shulker-unloader", (f) => {
    const unloader = f.add(ShulkerUnloader).at([0, 0, 0]);
    unloader.to(DoubleChest);
  }).resolve();
  const chest = r.instances.get("DoubleChest#1")!;
  return scenario(r, {
    durationTicks: 2 * 14_000,
    sampleEveryTicks: 2_000,
    actions: [
      { type: "insert", at: [0, 2, 0], item: filledShulker("minecraft:cobblestone"), count: 2, stack: 1 },
      // Let the hopper hand the boxes to the dispenser, then start it
      { type: "wait", ticks: 40 },
      { type: "use", at: [-1, 1, -1] },
    ],
    measure: { items: ["minecraft:cobblestone", "minecraft:shulker_box"], containers: chest.ports.get("in")!.absCells },
    expectations: [{ type: "rate-at-least", item: "minecraft:cobblestone", perHour: 8_500 }, { type: "no-ground-items" }],
  });
}

/**
 * Item filter: a chest of cobblestone then coal runs along a hopper line;
 * the filter under the line's second hopper must take all coal and nothing else.
 */
export function itemFilterScenario(): Scenario {
  const r = assembly("item-filter", (f) => {
    const supply = f.add(SupplyChest).at([0, 2, 0]);
    const line = f.add(HopperLine({ length: 4 })).rotated(1).at([0, 1, 0]);
    f.connect(supply.port("out"), line.port("in"));
    line.to(Chest);
    // The filter pulls from the line hopper above it (no port connection: it is a branch of the line)
    const filter = f.add(ItemFilter({ item: "minecraft:coal" })).at([1, 0, 0]);
    filter.to(Chest);
  }).resolve();
  const target = r.instances.get("Chest#2")!.origin;
  return scenario(r, {
    durationTicks: 6_000,
    sampleEveryTicks: 1_000,
    actions: [
      {
        type: "insert",
        at: [0, 2, 0],
        item: "minecraft:cobblestone",
        count: 6 * 64,
      },
      { type: "insert", at: [0, 2, 0], item: "minecraft:coal", count: 3 * 64 },
    ],
    measure: { containers: [target], items: ["minecraft:coal", "minecraft:cobblestone"] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:coal", perHour: 1 },
      { type: "rate-at-most", item: "minecraft:cobblestone", perHour: 0 },
      { type: "no-ground-items" },
    ],
  });
}

/**
 * Four furnaces smelting cobblestone with coal: 4 × 360 stone/h. The lines
 * hand items down with priority to the first furnaces (a lower hopper pulls
 * whatever its upper one gets), so a furnace only gets input once the
 * buffers before it are full (~384 items each): long warm-up.
 */
export function smelterScenario(): Scenario {
  const r = assembly("smelter", (f) => {
    const s = f.add(SmelterArray({ count: 4 })).at([0, 0, 0]);
    for (const x of [0, 2]) f.connect(f.add(SupplyChest).at([x, 3, 0]).port("out"), s.port("in"));
    f.connect(f.add(SupplyChest({ item: "minecraft:coal" })).at([0, 2, 1]).port("out"), s.port("fuel"));
    s.to(Chest);
  }).resolve();
  return scenario(r, {
    durationTicks: 40_000,
    warmupTicks: 16_000,
    sampleEveryTicks: 4_000,
    actions: [
      { type: "insert", at: [0, 3, 0], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [2, 3, 0], item: "minecraft:cobblestone", count: 27 * 64 },
      { type: "insert", at: [0, 2, 1], item: "minecraft:coal", count: 27 * 64 },
    ],
    measure: { items: ["minecraft:stone"] },
    expectations: [{ type: "matches-flow-model", tolerance: 0.05 }, { type: "no-ground-items" }],
  });
}

/** Crafter: planks into chests – and never buttons, plates, sticks or crafting tables. */
export function crafterScenario(): Scenario {
  const r = assembly("crafter-chest", (f) => {
    const crafter = f.add(Crafter).at([0, 0, 0]);
    f.connect(f.add(SupplyChest({ item: "minecraft:oak_planks" })).at([0, 2, 0]).port("out"), crafter.port("in"));
    crafter.to(Chest);
  }).resolve();
  const wrong = ["minecraft:oak_button", "minecraft:oak_pressure_plate", "minecraft:stick", "minecraft:crafting_table", "minecraft:oak_slab"];
  return scenario(r, {
    durationTicks: 12_000,
    warmupTicks: 400,
    sampleEveryTicks: 1_200,
    actions: [{ type: "insert", at: [0, 2, 0], item: "minecraft:oak_planks", count: 27 * 64 }],
    measure: { items: ["minecraft:chest", ...wrong] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:chest", perHour: 900 },
      ...wrong.map((item) => ({ type: "rate-at-most" as const, item, perHour: 0 })),
      { type: "no-ground-items" },
    ],
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
  "shulker-loader": shulkerLoaderScenario,
  "shulker-unloader": shulkerUnloaderScenario,
  "fast-shulker-loader": fastShulkerLoaderScenario,
  "item-filter": itemFilterScenario,
  smelter: smelterScenario,
  "crafter-chest": crafterScenario,
  "kelp-farm": () => kelpFarmScenario(),
  "kelp-farm-mirrored": () => kelpFarmScenario(true),
  "kelp-twin": kelpTwinScenario,
  "cactus-row-fence": () => cactusSurvival("row", "fence"),
  "cactus-row-glass": () => cactusSurvival("row", "glass"),
  "cactus-ring-fence": () => cactusSurvival("ring", "fence"),
  "cactus-farm-16": cactusFarm16,
};
