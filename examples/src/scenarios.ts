/**
 * In-game test scenarios for the standard library and the examples.
 * Run with: pnpm test:game [name...]
 */

import { B, type Vec3, assembly } from "@redstack/core";
import {
  Chest,
  Crafter,
  DoubleChest,
  FastShulkerLoader,
  HopperLine,
  ItemFilter,
  PatternCrafter,
  CrafterRow,
  PulseCounter,
  EdgeDetector,
  TorchClock,
  torchClockPeriod,
  type Recipe,
  ShulkerLoader,
  ShulkerUnloader,
  SmelterArray,
  SupplyChest,
  filledShulker,
  patternCrafterFeeds,
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

/** The PatternCrafter's switch: the lever on its clock (saved off) */
const CRAFTER_ON = { type: "use" as const, at: [-4, 0, -6] as Vec3 };

/** TorchClock: pulses counted by a dropper into a chest; pulses/h must match the period. */
export function torchClockScenario(period: number): Scenario {
  const r = assembly(`torch-clock-${period}`, (f) => {
    const clock = f.add(TorchClock({ period })).at([0, 0, 0]);
    f.connect(clock.port("out"), f.add(PulseCounter).at([3, 0, 0]).port("in"));
  }).resolve();
  const actual = torchClockPeriod(period);
  const perHour = 72_000 / actual;
  return scenario(r, {
    durationTicks: Math.min(4_000, actual * 400),
    warmupTicks: 200,
    sampleEveryTicks: 200,
    actions: [{ type: "use", at: [0, 1, 0] }],
    measure: { containers: [[4, 0, 0]], items: ["minecraft:cobblestone"] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:cobblestone", perHour: perHour * 0.98 },
      { type: "rate-at-most", item: "minecraft:cobblestone", perHour: perHour * 1.02 },
    ],
  });
}

/**
 * Wire router: a TorchClock wired to a pulse counter two blocks up and to the
 * side, over a wall, past a hopper line it must not lock.
 */
export function wireScenario(): Scenario {
  const r = assembly("wire-clock-counter", (f) => {
    const clock = f.add(TorchClock({ period: 20 })).at([0, 0, 0]);
    const counter = f.add(PulseCounter).at([12, 2, 5]);
    for (let z = -2; z <= 8; z++) for (const y of [0, 1]) f.block(B.of("minecraft:stone")).at([7, y, z]);
    f.wire(clock.port("out"), counter.port("in"));
    // A hopper line beside the wire's way
    f.add(SupplyChest).at([4, 2, 2]).to(HopperLine({ length: 4 })).to(Chest);
  }).resolve();
  const lineChest = [...r.instances.values()].find((i) => i.id === "Chest#1")!.origin;
  return scenario(r, {
    durationTicks: 4_000,
    warmupTicks: 400,
    sampleEveryTicks: 400,
    actions: [{ type: "use", at: [0, 1, 0] }, { type: "insert", at: [4, 2, 2], item: "minecraft:stone", count: 27 * 64 }],
    measure: { containers: [[13, 2, 5], lineChest], items: ["minecraft:cobblestone", "minecraft:stone"] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:cobblestone", perHour: 3_528 },
      { type: "rate-at-most", item: "minecraft:cobblestone", perHour: 3_672 },
      { type: "rate-at-least", item: "minecraft:stone", perHour: 8_800 },
    ],
  });
}

/** CrafterRow: four crafters, a chest of planks above each, a chest below each. */
export function crafterRowScenario(): Scenario {
  const r = assembly("crafter-row", (f) => {
    f.add(CrafterRow({ crafters: 4 })).at([0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      f.block(B.chest()).at([2 * i, 2, 0]);
      f.block(B.chest()).at([2 * i, -3, 0]);
    }
  }).resolve();
  const wrong = ["minecraft:oak_button", "minecraft:oak_pressure_plate", "minecraft:stick", "minecraft:crafting_table", "minecraft:oak_slab"];
  return scenario(r, {
    durationTicks: 12_000,
    warmupTicks: 5_000,
    sampleEveryTicks: 1_000,
    actions: [
      ...[0, 2, 4, 6].map((x) => ({ type: "insert" as const, at: [x, 2, 0] as Vec3, item: "minecraft:oak_planks", count: 27 * 64 })),
      { type: "use", at: [-4, 2, -1] },
    ],
    measure: { containers: [0, 2, 4, 6].map((x) => [x, -3, 0] as Vec3), items: ["minecraft:chest", ...wrong] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:chest", perHour: 3_800 },
      ...wrong.map((item) => ({ type: "rate-at-most" as const, item, perHour: 0 })),
      { type: "no-ground-items" },
    ],
  });
}

/** EdgeDetector behind a TorchClock: a pulse on both edges, so twice the clock's rate. */
export function edgeDetectorScenario(): Scenario {
  const r = assembly("edge-detector", (f) => {
    const clock = f.add(TorchClock({ period: 40 })).at([0, 0, 0]);
    const edges = f.add(EdgeDetector).at([3, 0, 0]);
    f.connect(clock.port("out"), edges.port("in"));
    f.connect(edges.port("out"), f.add(PulseCounter).at([5, 0, 0]).port("in"));
  }).resolve();
  return scenario(r, {
    durationTicks: 4_000,
    warmupTicks: 200,
    sampleEveryTicks: 200,
    actions: [{ type: "use", at: [0, 1, 0] }],
    measure: { containers: [[6, 0, 0]], items: ["minecraft:cobblestone"] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:cobblestone", perHour: 3_528 },
      { type: "rate-at-most", item: "minecraft:cobblestone", perHour: 3_672 },
    ],
  });
}

/**
 * PatternCrafter: pistons from four supply chests (planks, cobblestone, iron,
 * redstone). Runs until the cobblestone runs out: the crafter must stop
 * cleanly, and the chest may hold nothing but pistons.
 */
export function patternCrafterScenario(resume = false, recipe: Recipe = PatternCrafter.defaults.recipe): Scenario {
  const supplies: Record<string, Vec3> = { west: [-7, 1, 0], north: [3, 1, -7], east: [7, 1, 0], south: [0, 1, 7] };
  let feeds: Record<string, string> = {};
  const r = assembly("pattern-crafter", (f) => {
    const crafter = f.add(PatternCrafter({ recipe })).at([0, 0, 0]);
    for (const feed of patternCrafterFeeds(recipe)) {
      feeds = { ...feeds, [feed.face]: feed.item };
      f.route(f.add(SupplyChest({ item: feed.item })).at(supplies[feed.face]!).port("out"), crafter.port(feed.face));
    }
    crafter.to(Chest);
  }).resolve();
  const chest = r.instances.get("Chest#1")!.origin;
  if (recipe.result === "minecraft:chest") {
    const wrongPlanks = ["minecraft:oak_button", "minecraft:oak_pressure_plate", "minecraft:stick", "minecraft:crafting_table", "minecraft:oak_slab"];
    return scenario(r, {
      name: "pattern-crafter-chest",
      durationTicks: 12_000,
      warmupTicks: 1_500,
      sampleEveryTicks: 500,
      actions: [
        ...Object.keys(feeds).map((face) => ({ type: "insert" as const, at: supplies[face]!, item: "minecraft:oak_planks", count: 27 * 64 })),
        CRAFTER_ON,
      ],
      measure: { containers: [chest], items: ["minecraft:chest", ...wrongPlanks] },
      expectations: [
        { type: "rate-at-least", item: "minecraft:chest", perHour: 3_200 },
        ...wrongPlanks.map((item) => ({ type: "rate-at-most" as const, item, perHour: 0 })),
        { type: "no-ground-items" },
      ],
    });
  }
  const wrong = ["minecraft:furnace", "minecraft:dispenser", "minecraft:dropper", "minecraft:lever", "minecraft:stone_pressure_plate", "minecraft:oak_slab", "minecraft:cobblestone_slab"];
  const fill = Object.entries(feeds).map(([face, item]) => ({
    type: "insert" as const,
    at: supplies[face]!,
    item,
    count: resume && item === "minecraft:cobblestone" ? 600 : 27 * 64,
  }));
  // Resume: little cobblestone, run until it is gone, then refill and measure
  const refill = { ...fill.find((a) => a.item === "minecraft:cobblestone")!, count: 27 * 64 };
  return scenario(r, {
    ...(resume ? { name: "pattern-crafter-resume" } : {}),
    durationTicks: resume ? 9_000 : 18_000,
    warmupTicks: resume ? 2_000 : 3_000,
    sampleEveryTicks: 500,
    actions: resume ? [...fill, CRAFTER_ON, { type: "wait", ticks: 12_000 }, refill] : [...fill, CRAFTER_ON],
    measure: { containers: [chest], items: ["minecraft:piston", ...wrong] },
    expectations: [
      { type: "rate-at-least", item: "minecraft:piston", perHour: 1_500 },
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
  "torch-clock-12": () => torchClockScenario(12),
  "torch-clock-20": () => torchClockScenario(20),
  "torch-clock-36": () => torchClockScenario(36),
  "torch-clock-100": () => torchClockScenario(100),
  "edge-detector": edgeDetectorScenario,
  wire: wireScenario,
  "crafter-row": crafterRowScenario,
  "pattern-crafter": () => patternCrafterScenario(),
  "pattern-crafter-resume": () => patternCrafterScenario(true),
  "pattern-crafter-chest": () =>
    patternCrafterScenario(false, { pattern: ["PPP", "P.P", "PPP"], key: { P: "minecraft:oak_planks" }, result: "minecraft:chest" }),
  "kelp-farm": () => kelpFarmScenario(),
  "kelp-farm-mirrored": () => kelpFarmScenario(true),
  "kelp-twin": kelpTwinScenario,
  "cactus-row-fence": () => cactusSurvival("row", "fence"),
  "cactus-row-glass": () => cactusSurvival("row", "glass"),
  "cactus-ring-fence": () => cactusSurvival("ring", "fence"),
  "cactus-farm-16": cactusFarm16,
};
