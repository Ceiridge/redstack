import { B, M, type Vec3, component, hopperItemsPerHour } from "@redstack/core";
import { itemsForSignal } from "./shulker.js";

const wire = () => B.of("minecraft:redstone_wire", {});

/**
 * Item filter (the classic hopper sorter): takes one item type out of a
 * hopper line above it and lets everything else pass.
 *
 * The filter hopper holds 18 of the item plus one junk item in each other
 * slot, so only that item fits in. Its comparator reads signal 1; one more
 * item makes it 2. A subtract comparator against a reference (signal 1)
 * turns that into "extra item present", which switches off the torch that
 * locks the hopper below – it takes the extra item and locks again.
 *
 * Input: `in`, the top of the filter hopper (put it under a hopper line).
 * Output: `out`, below the lower hopper. The junk item must never be in the
 * stream (default: a stick – choose something you never farm).
 *
 * Measured (Fabric, 26.3): from a line carrying cobblestone and then coal it
 * took all 192 coal and not one cobblestone.
 */
export const ItemFilter = component(
  {
    name: "ItemFilter",
    description: "Takes one item type out of the hopper line above it. Input: in (from above). Output: out (below).",
    status: "game-tested",
    params: { item: "minecraft:coal", junk: "minecraft:stick" },
  },
  (c, { item, junk }) => {
    const solid = () => B.of(c.material(M.solid));
    const filter = c.block(
      B.hopper()
        .outputTo("north")
        .withSlots([
          { slot: 0, id: item, count: 18 },
          ...[1, 2, 3, 4].map((slot) => ({ slot, id: junk, count: 1 })),
        ]),
    ).at([0, 0, 0]);
    c.block(B.of("minecraft:glass")).at([0, 0, -1]); // the filter hopper points into nothing
    const lower = c.block(B.hopper().outputTo("down")).at([0, -1, 0]);
    // Lock: a torch beside the lower hopper, on a block the extra-item signal powers
    c.block(B.of("minecraft:redstone_wall_torch", { facing: "west", lit: true })).at([1, -1, 0]);
    c.block(solid()).at([2, -1, 0]);
    // Extra item detection: filter − reference(1)
    c.block(B.comparator("subtract").signalTowards("south")).at([0, 0, 1]);
    c.block(solid()).at([0, -1, 1]);
    c.block(B.comparator("compare").signalTowards("east")).at([-1, 0, 1]);
    c.block(solid()).at([-1, -1, 1]);
    c.block(B.of("minecraft:dropper", { facing: "up", triggered: false }).containing([junk, itemsForSignal(1, 9)])).at([-2, 0, 1]);
    c.block(B.repeater(1).signalTowards("south")).at([0, 0, 2]);
    c.block(solid()).at([0, -1, 2]);
    const path: Vec3[] = [
      [0, 0, 3],
      [1, 0, 3],
      [2, 0, 3],
      [2, 0, 2],
      [2, 0, 1],
      [2, 0, 0],
    ];
    for (const p of path) {
      c.block(wire()).at(p);
      if (!(p[0] === 2 && p[2] === 0)) c.block(solid()).at([p[0], -1, p[2]]);
    }
    c.input("in", filter, { item, description: `${item} from the hopper above` });
    c.output("out", lower.down, { item });
    // One extra item per unlock cycle (~12 game ticks)
    c.passes("in", "out", 72_000 / 12, "estimate", "one item per lock cycle, about 12 game ticks");
  },
);

/** Smelting time in game ticks per item. */
const SMELT_TICKS = { furnace: 200, blast_furnace: 100, smoker: 100 } as const;

/**
 * A row of furnaces fed by hopper lines: input from above (a line whose
 * hoppers each hand items down to one furnace), fuel from the side (same
 * idea), results collected by a hopper line below.
 *
 * Inputs: `in` (anywhere on the top line), `fuel` (anywhere on the fuel
 * line). Output: `out`, at the end of the bottom line.
 *
 * The lines hand items down with priority to the first furnace: each lower
 * hopper pulls whatever its upper one gets, so furnace k only gets items
 * once the ones before it are full (64 in the furnace + 320 in the hopper).
 * Steady state is count × the furnace speed; the warm-up is long.
 * Measured (Fabric, 26.3): 4 furnaces, 1,440 stone/h after the warm-up.
 */
export const SmelterArray = component(
  {
    name: "SmelterArray",
    description: "Row of furnaces with input, fuel and output hopper lines.",
    status: "game-tested",
    params: {
      count: 4,
      kind: "furnace" as keyof typeof SMELT_TICKS,
      input: "minecraft:cobblestone",
      output: "minecraft:stone",
      fuel: "minecraft:coal",
      itemsPerFuel: 8,
    },
  },
  (c, { count, kind, input, output, fuel, itemsPerFuel }) => {
    if (count < 1) throw new Error("SmelterArray: count must be >= 1.");
    const inLine: Vec3[] = [];
    const fuelLine: Vec3[] = [];
    for (let x = 0; x < count; x++) {
      c.block(B.of(`minecraft:${kind}`, { facing: "south", lit: false })).at([x, 0, 0]);
      // Input: line at y=2 (facing east), a hopper at y=1 pulling from it and pushing down
      c.block(B.hopper().outputTo(x === count - 1 ? "down" : "east")).at([x, 2, 0]);
      c.block(B.hopper().outputTo("down")).at([x, 1, 0]);
      inLine.push([x, 2, 0]);
      // Fuel: line at y=1 on the south side, a hopper at y=0 pushing north into the furnace's side
      c.block(B.hopper().outputTo(x === count - 1 ? "down" : "east")).at([x, 1, 1]);
      c.block(B.hopper().outputTo("north")).at([x, 0, 1]);
      fuelLine.push([x, 1, 1]);
      // Output: line at y=-1 under the furnaces
      c.block(B.hopper().outputTo("east")).at([x, -1, 0]);
    }
    const perFurnace = 72_000 / SMELT_TICKS[kind];
    c.input("in", inLine, { item: input });
    c.input("fuel", fuelLine, { item: fuel });
    c.output("out", [count, -1, 0], { item: output });
    c.converts("in", "out", { input, output, maxPerHour: Math.min(count * perFurnace, hopperItemsPerHour(c.env)) }, "game-mechanic", `${count} × ${perFurnace}/h`);
    c.converts("fuel", "out", { input: fuel, output, outputPerInput: 0, maxPerHour: (count * perFurnace) / itemsPerFuel }, "game-mechanic", `${itemsPerFuel} items per ${fuel}`);
  },
);

/** A crafting recipe: rows of single-character keys, "." or " " for an empty (disabled) slot. */
export interface Recipe {
  readonly pattern: readonly [string, string, string];
  readonly key: Readonly<Record<string, string>>;
  readonly result: string;
  readonly count?: number;
}

/** Slot indices 0–8 (row-major) that hold nothing in the pattern – the crafter disables them. */
export function disabledSlots(r: Recipe): number[] {
  const out: number[] = [];
  r.pattern.forEach((row, y) => {
    for (let x = 0; x < 3; x++) if (!r.key[row[x] ?? " "]) out.push(y * 3 + x);
  });
  return out;
}

/**
 * Crafter that crafts one recipe – and only that one. A crafter crafts
 * whatever its grid matches at the moment it is powered: fired too early,
 * a chest recipe (eight planks) turns into buttons, pressure plates or
 * sticks. So it fires only when every slot is filled: its comparator reads
 * 9 only then, and a subtract comparator against 8 (a reference dropper)
 * gives the go.
 *
 * Slots without an ingredient are disabled, so the pattern's shape is fixed.
 * Ingredients come through one hopper, which puts each item into the
 * emptiest matching slot: that is exact for recipes with one ingredient
 * (any shape) and for shapeless ones. Shaped recipes with several
 * ingredients need their items in a fixed order and are refused for now.
 *
 * Input: `in` (top of the hopper above the crafter). Output: `out` (the
 * hopper the crafter ejects into, south).
 *
 * Measured (Fabric, 26.3): planks → 1,127 chests/h (one hopper: 9,000 planks/h
 * ÷ 8), and not a single button, pressure plate, stick or crafting table.
 */
export const Crafter = component(
  {
    name: "Crafter",
    description: "Crafts exactly one recipe, firing only on a full grid. Input: in. Output: out.",
    status: "game-tested",
    params: {
      recipe: { pattern: ["PPP", "P.P", "PPP"], key: { P: "minecraft:oak_planks" }, result: "minecraft:chest" } as Recipe,
      shapeless: false,
    },
  },
  (c, { recipe, shapeless }) => {
    const ingredients = new Set(Object.values(recipe.key));
    if (!shapeless && ingredients.size > 1) {
      throw new Error(`Crafter: shaped recipes with several ingredients (${[...ingredients].join(", ")}) need ordered input; not supported yet.`);
    }
    const disabled = disabledSlots(recipe);
    const perCraft = 9 - disabled.length;
    const solid = () => B.of(c.material(M.solid));
    const crafter = c.block(
      B.of("minecraft:crafter", { orientation: "south_up", triggered: false, crafting: false }).withData(
        disabled.length ? { disabled_slots: `[I;${disabled.join(",")}]` } : {},
      ),
    ).at([0, 0, 0]);
    const feed = c.block(B.hopper().outputTo("down")).at([0, 1, 0]);
    const out = c.block(B.hopper().outputTo("down")).at([0, 0, 1]);
    // Full-grid detection: crafter (9 when full) − reference (8)
    c.block(B.comparator("subtract").signalTowards("east")).at([1, 0, 0]);
    c.block(solid()).at([1, -1, 0]);
    c.block(B.comparator("compare").signalTowards("north")).at([1, 0, 1]);
    c.block(solid()).at([1, -1, 1]);
    c.block(B.of("minecraft:dropper", { facing: "up", triggered: false }).containing(["minecraft:cobblestone", itemsForSignal(8, 9)])).at([1, 0, 2]);
    // → repeater → dust → repeater into a block behind the crafter, which powers it
    c.block(B.repeater(1).signalTowards("east")).at([2, 0, 0]);
    c.block(solid()).at([2, -1, 0]);
    for (const p of [[3, 0, 0], [3, 0, -1], [2, 0, -1]] as const) {
      c.block(wire()).at(p);
      c.block(solid()).at([p[0], -1, p[2]]);
    }
    c.block(B.repeater(1).signalTowards("west")).at([1, 0, -1]);
    c.block(solid()).at([1, -1, -1]);
    c.block(solid()).at([0, 0, -1]);

    const ingredient = [...ingredients][0]!;
    c.input("in", feed, { ...(ingredients.size === 1 ? { item: ingredient } : {}), description: "ingredients from above" });
    c.output("out", out.down, { item: recipe.result });
    // One craft per grid; a grid takes perCraft items from one hopper (8 game ticks each)
    const crafts = hopperItemsPerHour(c.env) / perCraft;
    c.converts("in", "out", { input: ingredient, output: recipe.result, outputPerInput: (recipe.count ?? 1) / perCraft, maxPerHour: crafts * perCraft }, "estimate", `${perCraft} ingredients per craft`);
    void crafter;
  },
);

type Face = "west" | "north" | "east" | "south";
const FACES: readonly Face[] = ["west", "north", "east", "south"];
const CLOCKWISE: Readonly<Record<string, string>> = { north: "east", east: "south", south: "west", west: "north" };

/** Turns a position or direction by `k` quarter turns clockwise (seen from above) around the y axis. */
function turn(v: Vec3, k: number): Vec3 {
  let [x, y, z] = v;
  for (let i = 0; i < k; i++) [x, z] = [-z, x];
  return [x, y, z];
}
function turnDir<D extends string>(d: D, k: number): D {
  let out: string = d;
  for (let i = 0; i < k; i++) out = CLOCKWISE[out] ?? out;
  return out as D;
}

/** What one face of a PatternCrafter takes. */
export interface CrafterFeed {
  readonly face: Face;
  readonly item: string;
  /** Items of this kind per craft, shared by all faces that feed it */
  readonly perCraft: number;
}

/**
 * Which item goes into which face of a PatternCrafter: every ingredient gets
 * a face, the rest go to the ingredients that would otherwise be slowest.
 */
export function patternCrafterFeeds(recipe: Recipe, faces = 4): CrafterFeed[] {
  const need = new Map<string, number>();
  for (const row of recipe.pattern) for (const ch of row) if (recipe.key[ch]) need.set(recipe.key[ch]!, (need.get(recipe.key[ch]!) ?? 0) + 1);
  const items = [...need.keys()];
  if (items.length === 0) throw new Error("PatternCrafter: the recipe has no ingredients.");
  if (faces < items.length) throw new Error(`PatternCrafter: ${items.length} ingredients need ${items.length} faces, ${faces} given.`);
  if (faces > 4) throw new Error("PatternCrafter: a crafter has four faces to feed.");
  const count = new Map(items.map((i) => [i, 1]));
  for (let f = items.length; f < faces; f++) {
    const slowest = items.reduce((a, b) => (need.get(b)! / count.get(b)! > need.get(a)! / count.get(a)! ? b : a));
    count.set(slowest, count.get(slowest)! + 1);
  }
  const feeds: CrafterFeed[] = [];
  let i = 0;
  for (const item of items) for (let n = 0; n < count.get(item)!; n++) feeds.push({ face: FACES[i++]!, item, perCraft: need.get(item)! / count.get(item)! });
  return feeds;
}

/**
 * Crafter for any recipe – shaped with several ingredients too – that can
 * never craft the wrong thing, fed from up to four sides.
 *
 * The trick is a seed: the grid starts with one item in every slot of the
 * pattern. A crafter puts an incoming item into the matching slot with the
 * fewest items, so as long as no slot runs empty the pattern stays exactly
 * as seeded, whatever order items arrive in. A slot can only run empty if
 * the crafter fires while it holds one item; so it fires only when every
 * feeding hopper holds at least 23 items. A hopper fed by a hopper line only
 * fills up while the crafter behind it is full, so then every slot is full,
 * and as long as the hoppers stay that full the clock never outruns them.
 *
 * Layout: the crafter faces down into a barrel with the output hopper below
 * (a hopper directly under a crafter pulls its grid empty). The feeding hoppers
 * sit west, north, east and south (`patternCrafterFeeds` tells which takes
 * what). A comparator reads each; two dust behind it are the threshold
 * (signal ≥ 2), a torch inverts it to "not ready", a dust ring under the
 * torches collects those and locks a repeater between a torch clock and the
 * dust on top of the crafter's top block. The clock's period follows from
 * the recipe: the slowest ingredient, at 8 game ticks per item and face.
 *
 * Seed: the build places it. Built by hand: put one ingredient into each
 * pattern slot. Ingredients must stack (no buckets).
 *
 * Inputs: one per used face, named after it (into the hopper from outside).
 * Output: `out`, below the output hopper.
 *
 * Measured (Fabric, 26.3): pistons (4 ingredients, one face each) 2,000/h,
 * the clock's rate; chests from planks on four faces 3,600/h (the old
 * Crafter: 1,127/h). Nothing but the recipe's result. Out of cobblestone it
 * stopped with every slot still full and resumed at full rate once refilled.
 */
export const PatternCrafter = component(
  {
    name: "PatternCrafter",
    description: "Crafts any recipe (shaped, several ingredients) from up to four fed sides; seeded, never crafts anything else. Inputs: west, north, east, south. Output: out.",
    status: "game-tested",
    params: {
      recipe: {
        pattern: ["PPP", "CIC", "CRC"],
        key: { R: "minecraft:redstone", C: "minecraft:cobblestone", I: "minecraft:iron_ingot", P: "minecraft:oak_planks" },
        result: "minecraft:piston",
      } as Recipe,
      /** Faces to feed (1–4); at least one per ingredient */
      faces: 4,
    },
  },
  (c, { recipe, faces }) => {
    const feeds = patternCrafterFeeds(recipe, faces);
    const solid = () => B.of(c.material(M.solid));
    const dust = (p: Vec3) => {
      c.block(wire()).at(p);
      c.block(solid()).at([p[0], p[1] - 1, p[2]]);
    };
    const disabled = disabledSlots(recipe);
    const seed = recipe.pattern.flatMap((row, y) =>
      [0, 1, 2].flatMap((x) => (recipe.key[row[x] ?? " "] ? [{ slot: y * 3 + x, id: recipe.key[row[x]!]!, count: 1 }] : [])),
    );
    c.block(
      B.of("minecraft:crafter", { orientation: "down_north", triggered: false, crafting: false })
        .withSlots(seed)
        .withData(disabled.length ? { disabled_slots: `[I;${disabled.join(",")}]` } : {}),
    ).at([0, 0, 0]);
    // The crafter ejects into a barrel: a hopper right below the crafter would pull the grid empty
    c.block(B.of("minecraft:barrel", { facing: "up", open: false })).at([0, -1, 0]);
    const out = c.block(B.hopper().outputTo("down")).at([0, -2, 0]);

    // Feeding hoppers and their "not ready" torches, built for the west face and turned
    feeds.forEach((feed, i) => {
      const k = FACES.indexOf(feed.face);
      const at = (v: Vec3) => turn(v, k);
      const hopper = c.block(B.hopper().outputTo(turnDir("east", k))).at(at([-1, 0, 0]));
      c.block(B.comparator("compare").signalTowards(turnDir("north", k))).at(at([-1, 0, -1]));
      c.block(solid()).at(at([-1, -1, -1]));
      dust(at([-1, 0, -2])); // signal s
      dust(at([-2, 0, -2])); // s − 1: powers the block only for s ≥ 2
      c.block(solid()).at(at([-3, 0, -2]));
      c.block(B.of("minecraft:redstone_wall_torch", { facing: turnDir("west", k), lit: true })).at(at([-4, 0, -2]));
      c.input(feed.face, hopper, { item: feed.item, description: `${feed.item} (${i + 1} of ${feeds.length} feeds)` });
    });

    // Ring under the torches: on while any feed is not ready
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (Math.abs(x) === 4 || Math.abs(z) === 4) dust([x, -1, z]);
    // The ring locks the gate: ring → lock repeater → side of the gate
    c.block(B.repeater(1).signalTowards("north")).at([-2, -1, -5]);
    c.block(solid()).at([-2, -2, -5]);
    c.block(B.repeater(1).signalTowards("east")).at([-2, -1, -6]);
    c.block(solid()).at([-2, -2, -6]);

    // Torch clock feeding the gate. Half period: torch (2 gt) + loop repeaters
    const perItem = 8; // game ticks per item and hopper
    const need = Math.max(...feeds.map((f) => f.perCraft * perItem), (recipe.count ?? 1) * perItem, 12) * 1.1;
    const loopDelay = Math.max(2, Math.ceil((need - 4) / 4)); // repeater ticks in the loop: period = 4 + 4 × delay game ticks
    const m = Math.max(1, Math.ceil(loopDelay / 8));
    const delays = Array.from({ length: 2 * m }, (_, i) => Math.floor(loopDelay / (2 * m)) + (i < loopDelay % (2 * m) ? 1 : 0)) as Array<1 | 2 | 3 | 4>;
    const period = 4 + 4 * loopDelay;
    c.block(solid()).at([-4, -1, -6]);
    c.block(B.of("minecraft:redstone_wall_torch", { facing: "east", lit: true })).at([-3, -1, -6]);
    for (let i = 0; i < m; i++) {
      c.block(B.repeater(delays[i]!).signalTowards("north")).at([-3, -1, -7 - i]);
      c.block(solid()).at([-3, -2, -7 - i]);
      c.block(B.repeater(delays[m + i]!).signalTowards("south")).at([-4, -1, -7 - i]);
      c.block(solid()).at([-4, -2, -7 - i]);
    }
    dust([-3, -1, -7 - m]);
    dust([-4, -1, -7 - m]);

    // Gate → up a dust stair → repeaters along x = 0 → dust on the crafter's top block
    dust([-1, -1, -6]);
    dust([-1, 0, -7]);
    dust([-1, 1, -8]);
    dust([-1, 2, -9]);
    dust([0, 2, -9]);
    for (let z = -8; z <= -1; z++) {
      c.block(B.repeater(1).signalTowards("south")).at([0, 2, z]);
      c.block(solid()).at([0, 1, z]);
    }
    dust([0, 2, 0]);

    c.output("out", out.down, { item: recipe.result });
    const craftsPerHour = 72_000 / period;
    c.crafts(
      feeds.map((f) => ({ from: f.face, item: f.item, perCraft: f.perCraft })),
      "out",
      { output: recipe.result, outputPerCraft: recipe.count ?? 1, maxCraftsPerHour: craftsPerHour },
      "game-mechanic",
      `clock period ${period} game ticks`,
    );
    c.note(`Clock period ${period} game ticks: ${Math.round(craftsPerHour)} crafts/h once every feed is backed up.`);
    c.note("Starts only after the grid and the feeding hoppers fill up (about 63 items per slot plus 23 per hopper).");
  },
);
