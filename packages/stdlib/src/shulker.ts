import { B, M, component, hopperItemsPerHour } from "@redstack/core";

const SHULKER_SLOTS = 27;

/**
 * Comparator signal of a container (vanilla `getRedstoneSignalFromContainer`):
 * fullness = Σ count / maxStack over the slots / slot count;
 * signal = floor(fullness × 14) + (fullness > 0 ? 1 : 0).
 */
export function containerSignal(itemsByMaxStack: ReadonlyArray<readonly [count: number, maxStack: number]>, slots: number): number {
  const fullness = itemsByMaxStack.reduce((s, [n, max]) => s + n / max, 0) / slots;
  return Math.floor(fullness * 14) + (fullness > 0 ? 1 : 0);
}

/** Items (of a 64-stack kind) in a container of `slots` slots that give exactly `signal`, with the most margin. */
export function itemsForSignal(signal: number, slots: number): number {
  for (let n = slots * 64; n >= 0; n--) if (containerSignal([[n, 64]], slots) === signal) return n;
  throw new Error(`No item count gives signal ${signal} in ${slots} slots.`);
}

/**
 * Shulker box loader: a dispenser places an empty shulker box, a hopper fills
 * it, and when it is completely full a piston breaks it; the full box drops
 * into the output hoppers and the dispenser places the next empty one.
 *
 * Full detection: a comparator reads the box (15 only when every slot is
 * full) in subtract mode against 14 from a second comparator that reads a
 * reference dropper – so it fires on exactly "full", never on "almost full".
 * The dispenser is fed 12 game ticks later through repeaters, after the
 * piston has retracted.
 *
 * Inputs: `in` (items, into the top of the filling hopper), `boxes` (empty
 * shulker boxes, into the top of the dispenser's hopper). Output: `out`,
 * full boxes. Speed: one hopper, 9,000 items/h (one box every 11.5 min).
 * Keep the dispenser stocked: once it runs dry the loader waits for a box
 * that nobody places (place one by hand to restart it).
 *
 * Measured (Fabric, 26.3): three boxes of 1,728 cobblestone in 42,000 ticks,
 * no items lost – 8,900/h including the box changes.
 */
export const ShulkerLoader = component(
  {
    name: "ShulkerLoader",
    description: "Fills empty shulker boxes from a hopper and outputs them when full. Inputs: in (items), boxes (empty shulker boxes). Output: out (full boxes).",
    status: "game-tested",
    params: { box: "minecraft:shulker_box", reference: "minecraft:cobblestone" },
  },
  (c, { box, reference }) => {
    const solid = () => B.of(c.material(M.solid));
    const slab = () => B.of("minecraft:smooth_stone_slab", { type: "top", waterlogged: false });
    // The box being filled, the dispenser that places it, the hopper that feeds the dispenser
    const S = c.block(B.of(box, { facing: "up" })).at([0, 0, 0]);
    c.block(B.of("minecraft:dispenser", { facing: "down", triggered: false })).at([0, 1, 0]);
    const boxHopper = c.block(B.hopper().outputTo("down")).at([0, 2, 0]);
    // Filling hopper (from the west) and the breaking piston (from the north)
    const fill = c.block(B.hopper().outputTo("east")).at([-1, 0, 0]);
    c.block(B.piston().pushing("south")).at([0, 0, -1]);
    // Where the broken box can land: pushed south onto Q, or dropped straight down to Q2
    c.keepClear([0, 0, 1], [0, -1, 0]);
    const q = c.block(B.hopper().outputTo("down")).at([0, -1, 1]);
    c.block(B.hopper().outputTo("south")).at([0, -2, 0]);
    const out = c.block(B.hopper().outputTo("south")).at([0, -2, 1]);
    void q;

    // Full detection: S − 14 > 0 only when S is full (15)
    c.block(B.comparator("subtract").signalTowards("east")).at([1, 0, 0]);
    c.block(solid()).at([1, -1, 0]);
    c.block(B.comparator("compare").signalTowards("north")).at([1, 0, 1]);
    c.block(solid()).at([1, -1, 1]);
    const refItems = itemsForSignal(14, 9);
    c.block(B.of("minecraft:dropper", { facing: "up", triggered: false }).containing([reference, refItems])).at([1, 0, 2]);

    // Comparator → repeater → dust → repeater into the piston (dust next to the
    // comparator would bend towards it instead of pointing at the piston)
    c.block(B.repeater(1).signalTowards("east")).at([2, 0, 0]);
    c.block(solid()).at([2, -1, 0]);
    for (const p of [[3, 0, 0], [3, 0, -1], [2, 0, -1]] as const) {
      c.block(B.of("minecraft:redstone_wire", {})).at(p);
      c.block(solid()).at([p[0], -1, p[2]]);
    }
    c.block(B.repeater(1).signalTowards("west")).at([1, 0, -1]);
    c.block(solid()).at([1, -1, -1]);
    // … and, 12 game ticks later, to the dispenser (through the block above the push cell)
    c.block(B.repeater(4).signalTowards("south")).at([3, 0, 1]);
    c.block(solid()).at([3, -1, 1]);
    for (const p of [[3, 0, 2], [3, 0, 3]] as const) {
      c.block(B.of("minecraft:redstone_wire", {})).at(p);
      c.block(solid()).at([p[0], -1, p[2]]);
    }
    for (const p of [[2, 1, 3], [1, 1, 3], [0, 1, 3]] as const) {
      c.block(B.of("minecraft:redstone_wire", {})).at(p);
      c.block(slab()).at([p[0], 0, p[2]]);
    }
    c.block(B.repeater(1).signalTowards("north")).at([0, 1, 2]);
    c.block(solid()).at([0, 0, 2]);
    c.block(solid()).at([0, 1, 1]);

    c.input("in", fill, { description: "items into the top of the filling hopper" });
    c.input("boxes", boxHopper, { item: box, description: "empty shulker boxes" });
    c.output("out", out.neighbor("south"), { description: "full shulker boxes" });
    c.passes("in", "out", hopperItemsPerHour(c.env), "game-mechanic", "one filling hopper; the output counts items inside boxes");
    c.note(`The reference dropper holds ${refItems} × ${reference} (signal 14). Keep the dispenser stocked with empty boxes.`);
    void S;
    void SHULKER_SLOTS;
  },
);
