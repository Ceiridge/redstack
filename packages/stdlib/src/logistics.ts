import { B, defineComponent } from "@redstack/core";

/**
 * Hopper-Kette. Alle Hopper nehmen Items von oben an (Sammelband);
 * die Items laufen nach vorne und verlassen den letzten Hopper
 * nach vorne oder nach unten.
 */
export const HopperLine = defineComponent({
  name: "HopperLine",
  description: "Hopper-Kette als Sammelband. Eingang: Oberseite aller Hopper. Ausgang: vor oder unter dem letzten Hopper.",
  status: "unverified",
  defaults: { length: 8, exit: "forward" as "forward" | "down" },
  build(c, { length, exit }) {
    if (length < 1) throw new Error("HopperLine: length muss >= 1 sein.");
    const hoppers = [c.origin(B.hopper().outputTo(length === 1 ? exit : "forward"))];
    for (let i = 1; i < length; i++) {
      const isLast = i === length - 1;
      hoppers.push(c.place(B.hopper().outputTo(isLast ? exit : "forward")).inFrontOf(hoppers[i - 1]!));
    }
    const last = hoppers[hoppers.length - 1]!;
    c.input("in", "items", hoppers, { description: "Items von oben in jeden Hopper" });
    c.output("out", "items", last.neighbor(exit));
    c.passes("in", "out", 9000, "game-mechanic", "1 Item pro 8 Game-Ticks = 2,5/s; Kette ist so schnell wie ein Hopper");
  },
});

/** Einfache Truhe als Lager. */
export const Chest = defineComponent({
  name: "Chest",
  description: "Einzelne Truhe als Lager (27 Slots).",
  status: "unverified",
  defaults: { stackSize: 64 },
  build(c, { stackSize }) {
    const chest = c.origin(B.chest());
    c.input("in", "items", chest);
    c.stores("in", 27 * stackSize, "game-mechanic", `27 Slots × ${stackSize}`);
  },
});
