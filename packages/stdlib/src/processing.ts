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
