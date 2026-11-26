/**
 * Experiments: item transport in water streams (docs/experiments/water-streams.md).
 * Run with: node --env-file=.env apps/cli/dist/main.js test examples/dist/water-experiments.js [name...]
 *
 * A channel one block wide runs along +z, glass walls left and right, items
 * spawn in its source cell. Hoppers in the floor ("taps") empty into chests
 * below; the chests are measured, what is left on the ground is reported.
 */

import { B, type Vec3, assembly } from "@redstack/core";
import { type Scenario, scenario } from "@redstack/testing";

type Floor = "minecraft:stone" | "minecraft:packed_ice" | "minecraft:blue_ice";

interface ChannelSpec {
  readonly name: string;
  /** Cells of the stream, in order: [z, y of the water]. The floor is one below */
  readonly cells: ReadonlyArray<readonly [number, number]>;
  readonly sources: readonly Vec3[];
  /** Floor cells (z) that are taps instead of floor blocks; the last cell is a tap by default */
  readonly taps?: readonly number[];
  readonly floor?: Floor;
  /** Extra blocks, e.g. a waterlogged fence in the wall */
  readonly extra?: ReadonlyArray<readonly [Vec3, string, Record<string, string | boolean>]>;
}

function channel(spec: ChannelSpec) {
  const taps = spec.taps ?? [spec.cells.at(-1)![0]];
  const chests: Vec3[] = [];
  const r = assembly(spec.name, (f) => {
    const glass = () => B.of("minecraft:glass");
    const zs = spec.cells.map((c) => c[0]);
    const first = Math.min(...zs);
    const last = Math.max(...zs);
    for (const [z, y] of spec.cells) {
      // Floor or tap, walls on both sides
      if (taps.includes(z)) {
        f.block(B.hopper().outputTo("down")).at([0, y - 1, z]);
        f.block(B.chest()).at([0, y - 2, z]);
        chests.push([0, y - 2, z]);
      } else if (!spec.extra?.some(([p]) => p[0] === 0 && p[1] === y - 1 && p[2] === z)) {
        f.block(B.of(spec.floor ?? "minecraft:stone")).at([0, y - 1, z]);
      }
      for (const x of [-1, 1]) if (!spec.extra?.some(([p]) => p[0] === x && p[1] === y && p[2] === z)) f.block(glass()).at([x, y, z]);
    }
    // Ends: walls behind the source and after the last cell
    const yFirst = spec.cells.find((c) => c[0] === first)![1];
    const yLast = spec.cells.find((c) => c[0] === last)![1];
    f.block(glass()).at([0, yFirst, first - 1]);
    f.block(glass()).at([0, yLast, last + 1]);
    for (const p of spec.sources) f.block(B.water()).at(p);
    for (const [p, id, props] of spec.extra ?? []) f.block(B.of(id, props)).at(p);
  }).resolve();
  return { r, chests };
}

/**
 * Flat stream, 8 cells (a source and 7 flowing), a steady feed. Taps at the
 * shallow end (z 7, 6, …) or in the deep part next to the source (z 1, 2, …
 * plus the end cell).
 */
function flatTaps(taps: number, perHour: number, where: "end" | "deep" = "end"): Scenario {
  const cells = Array.from({ length: 8 }, (_, z) => [z, 1] as const);
  const { r, chests } = channel({
    name: `water-taps-${where}-${taps}`,
    cells,
    sources: [[0, 1, 0]],
    taps: where === "end" ? Array.from({ length: taps }, (_, i) => 7 - i) : [...Array.from({ length: taps }, (_, i) => 1 + i), 7],
  });
  return scenario(r, {
    durationTicks: 6_000,
    warmupTicks: 1_000,
    sampleEveryTicks: 500,
    feeds: [{ at: [0, 1, 0], item: "minecraft:cobblestone", perHour }],
    measure: { containers: chests, items: ["minecraft:cobblestone"] },
  });
}

/** Burst of 64 items, sampled every 5 ticks: when do they arrive at the end of 8 cells? */
function transit(floor: Floor): Scenario {
  const cells = Array.from({ length: 8 }, (_, z) => [z, 1] as const);
  const { r, chests } = channel({ name: `water-transit-${floor.replace("minecraft:", "")}`, cells, sources: [[0, 1, 0]], floor });
  // The tap hopper counts too: it picks the stack up at once
  const taps = chests.map((c) => [c[0], c[1] + 1, c[2]] as Vec3);
  return scenario(r, {
    durationTicks: 120,
    sampleEveryTicks: 2,
    actions: [{ type: "wait", ticks: 60 }, { type: "drop", at: [0, 1, 0], item: "minecraft:cobblestone", count: 64 }],
    measure: { containers: [...chests, ...taps], items: ["minecraft:cobblestone"] },
  });
}

/** 16 cells with a one-block drop after 7: seg 1 at y=2 (z 0–6), seg 2 at y=1 (z 7–14). */
function dropJoint(): Scenario {
  const cells = [...Array.from({ length: 7 }, (_, z) => [z, 2] as const), ...Array.from({ length: 8 }, (_, i) => [7 + i, 1] as const)];
  const { r, chests } = channel({ name: "water-joint-drop", cells, sources: [[0, 2, 0]] });
  return scenario(r, {
    durationTicks: 4_000,
    warmupTicks: 400,
    sampleEveryTicks: 400,
    feeds: [{ at: [0, 2, 0], item: "minecraft:cobblestone", perHour: 6_000 }],
    measure: { containers: chests, items: ["minecraft:cobblestone"] },
  });
}

/**
 * 16 flat cells; after the first 8 a wall sign (water stops, items fly
 * through) over packed ice (they keep sliding), then a new source – the
 * joint of the TNT farm's stream.
 */
function signJoint(): Scenario {
  const cells = Array.from({ length: 16 }, (_, z) => [z, 1] as const);
  const { r, chests } = channel({
    name: "water-joint-sign",
    cells,
    sources: [[0, 1, 0], [0, 1, 9]],
    floor: "minecraft:stone",
    extra: [
      [[0, 1, 8], "minecraft:oak_wall_sign", { facing: "west", waterlogged: false }],
      [[0, 0, 8], "minecraft:packed_ice", {}],
    ],
  });
  return scenario(r, {
    durationTicks: 4_000,
    warmupTicks: 400,
    sampleEveryTicks: 400,
    feeds: [{ at: [0, 1, 0], item: "minecraft:cobblestone", perHour: 6_000 }],
    measure: { containers: chests, items: ["minecraft:cobblestone"] },
  });
}

/**
 * 16 flat cells, a second source in the wall at `at` – a waterlogged fence
 * (items cannot get into it) or a plain source block in a side pocket.
 */
function sideSource(at: number, kind: "fence" | "pocket"): Scenario {
  const cells = Array.from({ length: 16 }, (_, z) => [z, 1] as const);
  const extra: ChannelSpec["extra"] =
    kind === "fence"
      ? [[[1, 1, at], "minecraft:oak_fence", { waterlogged: true, north: false, south: false, east: false, west: false }]]
      : [
          [[1, 1, at], "minecraft:water", {}],
          [[2, 1, at], "minecraft:glass", {}],
          [[1, 1, at - 1], "minecraft:glass", {}],
          [[1, 1, at + 1], "minecraft:glass", {}],
          [[1, 0, at], "minecraft:stone", {}],
        ];
  const { r, chests } = channel({ name: `water-side-${kind}-${at}`, cells, sources: [[0, 1, 0]], extra });
  return scenario(r, {
    durationTicks: 4_000,
    warmupTicks: 400,
    sampleEveryTicks: 400,
    feeds: [{ at: [0, 1, 0], item: "minecraft:cobblestone", perHour: 6_000 }],
    measure: { containers: chests, items: ["minecraft:cobblestone"] },
  });
}

export const scenarios: Record<string, () => Scenario> = {
  "water-taps-end-1": () => flatTaps(1, 30_000),
  "water-taps-end-2": () => flatTaps(2, 30_000),
  "water-taps-end-4": () => flatTaps(4, 30_000),
  "water-taps-deep-2": () => flatTaps(2, 40_000, "deep"),
  "water-taps-deep-4": () => flatTaps(4, 60_000, "deep"),
  "water-taps-deep-6": () => flatTaps(6, 80_000, "deep"),
  "water-joint-sign": signJoint,
  "water-transit-stone": () => transit("minecraft:stone"),
  "water-transit-packed-ice": () => transit("minecraft:packed_ice"),
  "water-transit-blue-ice": () => transit("minecraft:blue_ice"),
  "water-joint-drop": dropJoint,
  "water-side-fence-7": () => sideSource(7, "fence"),
  "water-side-fence-8": () => sideSource(8, "fence"),
  "water-side-pocket-8": () => sideSource(8, "pocket"),
};
