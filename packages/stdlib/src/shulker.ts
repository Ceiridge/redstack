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

/** An item string for a shulker box filled with `count` of `item` (64 per slot), e.g. for test inserts. */
export function filledShulker(item: string, count = SHULKER_SLOTS * 64, box = "minecraft:shulker_box"): string {
  const slots: string[] = [];
  for (let i = 0, left = count; left > 0; i++, left -= 64) slots.push(`{slot:${i},item:{id:"${item}",count:${Math.min(64, left)}}}`);
  return `${box}[container=[${slots.join(",")}]]`;
}

/**
 * Shulker box unloader: a dispenser places a full box, a hopper below empties
 * it, and when it is empty a piston breaks it; the empty box drops into the
 * same output as the items. Then the dispenser places the next full box.
 *
 * Empty detection without a false start: an observer watches the comparator
 * that reads the box; its pulse reaches the piston only through a repeater
 * that this comparator locks while the box still holds items. So "box just
 * became empty" fires, "new full box placed" does not.
 *
 * Inputs: `boxes` (full shulker boxes, into the top of the dispenser's
 * hopper). Output: `out` – the items, and the empty boxes. Start it once with
 * the button. Speed: one hopper, 9,000 items/h.
 *
 * Measured (Fabric, 26.3): two boxes emptied back to back, 8,700 items/h,
 * both empty boxes in the output, nothing lost.
 */
export const ShulkerUnloader = component(
  {
    name: "ShulkerUnloader",
    description: "Empties full shulker boxes into a hopper and breaks the empty box. Input: boxes. Output: out (items and empty boxes).",
    status: "game-tested",
    params: {},
  },
  (c) => {
    const solid = () => B.of(c.material(M.solid));
    const wire = () => B.of("minecraft:redstone_wire", {});
    c.keepClear([0, 0, 0], [0, 0, -1]);
    const dispenser = c.block(B.of("minecraft:dispenser", { facing: "down", triggered: false })).at([0, 1, 0]);
    const boxHopper = c.block(B.hopper().outputTo("down")).at([0, 2, 0]);
    // Unloading hopper below the box, collector below the push target
    c.block(B.hopper().outputTo("north")).at([0, -1, 0]);
    const q = c.block(B.hopper().outputTo("down")).at([0, -1, -1]);
    // Piston south of the box, pushing north
    c.block(B.piston().pushing("north")).at([0, 0, 1]);

    // Comparator reads the box and locks the repeater beside it while the box has items
    c.block(B.comparator("compare").signalTowards("east")).at([1, 0, 0]);
    c.block(solid()).at([1, -1, 0]);
    c.block(B.repeater(1).signalTowards("south")).at([2, 0, 0]);
    c.block(solid()).at([2, -1, 0]);
    // Observer watches the comparator; its pulse runs round to the repeater's input
    c.block(B.observer().watching("south")).at([1, 0, -1]);
    for (const p of [[1, 0, -2], [2, 0, -2], [2, 0, -1]] as const) {
      c.block(wire()).at(p);
      c.block(solid()).at([p[0], -1, p[2]]);
    }
    // Repeater → dust → repeater into the piston
    c.block(wire()).at([2, 0, 1]);
    c.block(solid()).at([2, -1, 1]);
    c.block(B.repeater(1).signalTowards("west")).at([1, 0, 1]);
    c.block(solid()).at([1, -1, 1]);
    // The observer's pulse also re-arms the dispenser, 8 game ticks later
    c.block(wire()).at([1, 0, -3]);
    c.block(solid()).at([1, -1, -3]);
    c.block(wire()).at([0, 1, -3]);
    c.block(solid()).at([0, 0, -3]);
    c.block(B.repeater(4).signalTowards("south")).at([0, 1, -2]);
    c.block(solid()).at([0, 0, -2]);
    c.block(solid()).at([0, 1, -1]);
    // Start button on that block: powering the dispenser itself would also
    // power the piston (quasi-connectivity through the dispenser) and break the first box
    c.block(B.of("minecraft:stone_button", { face: "wall", facing: "west", powered: false })).at([-1, 1, -1]);

    c.input("boxes", boxHopper, { description: "full shulker boxes" });
    c.output("out", q.down, { description: "the items, and the empty boxes" });
    c.passes("boxes", "out", hopperItemsPerHour(c.env), "game-mechanic", "one unloading hopper; counts the items inside the boxes");
    c.note("Press the button once to place the first box.");
    void dispenser;
  },
);

/**
 * Shulker loader with two filling hoppers: 18,000 items/h.
 *
 * The piston sits on top and pushes the full box down; it breaks and drops
 * through a gap onto the collecting hopper. The dispenser places boxes from
 * the north, so west and south are free for two filling hoppers. Full
 * detection as in ShulkerLoader (box − 14 from a reference dropper).
 * Game-tested on Fabric 26.3: 250 items per 1,000 ticks (18,000/h), the box
 * swap costs under 10 ticks.
 *
 * Inputs: `in` (two hoppers, from above), `boxes` (empty boxes, into the top
 * of the dispenser's hopper). Output: `out`, full boxes.
 */
export const FastShulkerLoader = component(
  {
    name: "FastShulkerLoader",
    description: "Shulker loader with two filling hoppers (18,000 items/h). Inputs: in, boxes. Output: out.",
    status: "game-tested",
    params: { box: "minecraft:shulker_box", reference: "minecraft:cobblestone" },
  },
  (c, { box, reference }) => {
    const solid = () => B.of(c.material(M.solid));
    const wire = () => B.of("minecraft:redstone_wire", {});
    c.block(B.of(box, { facing: "up" })).at([0, 0, 0]);
    c.keepClear([0, -1, 0]);
    // Piston above, dispenser north (fed from above), two filling hoppers west and south
    c.block(B.piston().pushing("down")).at([0, 1, 0]);
    c.block(B.of("minecraft:dispenser", { facing: "south", triggered: false })).at([0, 0, -1]);
    const boxHopper = c.block(B.hopper().outputTo("down")).at([0, 1, -1]);
    const west = c.block(B.hopper().outputTo("east")).at([-1, 0, 0]);
    const south = c.block(B.hopper().outputTo("north")).at([0, 0, 1]);
    // The broken box falls through the gap onto the collector
    c.block(B.hopper().outputTo("south")).at([0, -2, 0]);
    const out = c.block(B.hopper().outputTo("south")).at([0, -2, 1]);

    // Full detection: box − reference(14)
    c.block(B.comparator("subtract").signalTowards("east")).at([1, 0, 0]);
    c.block(solid()).at([1, -1, 0]);
    c.block(B.comparator("compare").signalTowards("south")).at([1, 0, -1]);
    c.block(solid()).at([1, -1, -1]);
    c.block(B.of("minecraft:dropper", { facing: "up", triggered: false }).containing([reference, itemsForSignal(14, 9)])).at([1, 0, -2]);
    c.block(B.repeater(1).signalTowards("east")).at([2, 0, 0]);
    c.block(solid()).at([2, -1, 0]);

    // Up to the piston: dust stairs to a repeater that powers the block above the piston
    c.block(wire()).at([3, 0, 0]);
    c.block(solid()).at([3, -1, 0]);
    c.block(solid()).at([3, 0, 1]);
    c.block(wire()).at([3, 1, 1]);
    c.block(solid()).at([2, 1, 1]);
    c.block(wire()).at([2, 2, 1]);
    c.block(solid()).at([2, 1, 0]);
    c.block(wire()).at([2, 2, 0]);
    c.block(solid()).at([1, 1, 0]);
    c.block(B.repeater(1).signalTowards("west")).at([1, 2, 0]);
    c.block(solid()).at([0, 2, 0]);

    // Re-arm the dispenser 8 game ticks later, through the block below it
    c.block(B.repeater(4).signalTowards("north")).at([3, 0, -1]);
    c.block(solid()).at([3, -1, -1]);
    for (const p of [[3, 0, -2], [3, 0, -3]] as const) {
      c.block(wire()).at(p);
      c.block(solid()).at([p[0], -1, p[2]]);
    }
    for (const p of [[2, -1, -3], [1, -1, -3], [0, -1, -3]] as const) {
      c.block(wire()).at(p);
      c.block(solid()).at([p[0], -2, p[2]]);
    }
    c.block(B.repeater(1).signalTowards("south")).at([0, -1, -2]);
    c.block(solid()).at([0, -2, -2]);
    c.block(solid()).at([0, -1, -1]);

    c.input("in", [west, south], { description: "items into the top of either filling hopper" });
    c.input("boxes", boxHopper, { item: box, description: "empty shulker boxes" });
    c.output("out", out.neighbor("south"), { description: "full shulker boxes" });
    c.passes("in", "out", 2 * hopperItemsPerHour(c.env), "game-mechanic", "two filling hoppers; the output counts items inside boxes");
    c.note("Keep the dispenser stocked with empty boxes.");
  },
);
