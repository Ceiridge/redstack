import { B, defineComponent } from "@redstack/core";

/**
 * Hopper chain. Every hopper accepts items from above (collection belt);
 * items move forward and leave the last hopper forwards or downwards.
 * In-game: 9,000 items/h measured, exactly the modelled rate.
 */
export const HopperLine = defineComponent({
  name: "HopperLine",
  description: "Hopper chain as a collection belt. Input: top of every hopper. Output: in front of or below the last hopper.",
  status: "game-tested",
  defaults: { length: 8, exit: "forward" as "forward" | "down" },
  build(c, { length, exit }) {
    if (length < 1) throw new Error("HopperLine: length must be >= 1.");
    const hoppers = [c.origin(B.hopper().outputTo(length === 1 ? exit : "forward"))];
    for (let i = 1; i < length; i++) {
      const isLast = i === length - 1;
      hoppers.push(c.place(B.hopper().outputTo(isLast ? exit : "forward")).inFrontOf(hoppers[i - 1]!));
    }
    const last = hoppers[hoppers.length - 1]!;
    c.input("in", "items", hoppers, { description: "items from above into any hopper" });
    c.output("out", "items", last.neighbor(exit));
    c.passes("in", "out", 9000, "game-mechanic", "1 item per 8 game ticks = 2.5/s; a chain is as fast as one hopper");
  },
});

/**
 * Test fixture: a chest that hoppers below it can pull from.
 * The modelled rate is whatever the test fills in; it exists so flow models
 * of test setups have a source.
 */
export const SupplyChest = defineComponent({
  name: "SupplyChest",
  description: "Chest feeding the block below it (hoppers pull from containers above). Test fixture.",
  status: "game-tested",
  defaults: { item: "minecraft:cobblestone", perHour: 1_000_000 },
  build(c, { item, perHour }) {
    const chest = c.origin(B.chest());
    c.output("out", "items", chest.neighbor("down"), { item });
    c.produces("out", item, perHour, "estimate", "test supply, limited by whatever pulls from it");
  },
});

/** Single chest as storage. */
export const Chest = defineComponent({
  name: "Chest",
  description: "Single chest as storage (27 slots).",
  status: "game-tested",
  defaults: { stackSize: 64 },
  build(c, { stackSize }) {
    const chest = c.origin(B.chest());
    c.input("in", "items", chest);
    c.stores("in", 27 * stackSize, "game-mechanic", `27 slots × ${stackSize}`);
  },
});
