import { B, type RelDir, component, hopperItemsPerHour } from "@redstack/core";

/**
 * Hopper chain. Every hopper accepts items from above (collection belt);
 * items move forward and leave the last hopper forwards or downwards.
 * In-game (26.3): 9,000 items/h measured, exactly the modelled rate.
 */
export const HopperLine = component(
  {
    name: "HopperLine",
    description: "Hopper chain as a collection belt. Input: the top of every hopper. Output: in front of or below the last one.",
    status: "game-tested",
    params: { length: 8, exit: "forward" as Extract<RelDir, "forward" | "down"> },
  },
  (c, { length, exit }) => {
    if (length < 1) throw new Error("HopperLine: length must be >= 1.");
    const hoppers = c.line((i) => B.hopper().outputTo(i === length - 1 ? exit : "forward"), [0, 0, 0], "forward", length);
    c.input("in", hoppers, { description: "items from above into any hopper" });
    c.output("out", hoppers[length - 1]!.neighbor(exit));
    c.passes("in", "out", hopperItemsPerHour(c.env), "game-mechanic", "a chain is as fast as one hopper");
  },
);

/** Single chest as storage. */
export const Chest = component(
  { name: "Chest", description: "Single chest as storage (27 slots).", status: "game-tested", params: { stackSize: 64 } },
  (c, { stackSize }) => {
    c.input("in", c.block(B.chest()));
    c.stores("in", 27 * stackSize, "game-mechanic", `27 slots × ${stackSize}`);
  },
);

/** Double chest as storage (54 slots); input into either half. */
export const DoubleChest = component(
  { name: "DoubleChest", description: "Double chest as storage (54 slots).", status: "game-tested", params: { stackSize: 64 } },
  (c, { stackSize }) => {
    // facing south: the left half (seen from the front) is the east one
    const a = c.block(B.chest().with({ facing: "south", type: "right" })).at([0, 0, 0]);
    const b = c.block(B.chest().with({ facing: "south", type: "left" })).at([1, 0, 0]);
    c.input("in", [a, b]);
    c.stores("in", 54 * stackSize, "game-mechanic", `54 slots × ${stackSize}`);
  },
);

/**
 * A chest that hoppers below it can pull from, refilled from outside the farm
 * (by a player, or by a test). Its rate is the most it can deliver; the
 * economy counts what the farm actually uses of it as a purchased input.
 */
export const SupplyChest = component(
  {
    name: "SupplyChest",
    description: "Chest refilled from outside, feeding the block below it (hoppers pull from containers above).",
    status: "game-tested",
    params: { item: "minecraft:cobblestone", perHour: 1_000_000 },
  },
  (c, { item, perHour }) => {
    const chest = c.block(B.chest());
    c.output("out", chest.down, {
      item,
      external: true,
      rate: { perHour, basis: "estimate", note: "refilled from outside; limited by what pulls from it" },
    });
  },
);
