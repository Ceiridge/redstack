import { B, defineComponent } from "@redstack/core";

/**
 * Kaktus-Zelle: Kaktus auf Sand, ein Zaun bricht den nachwachsenden Block ab.
 * Die Items sollen seitlich (rechts) nach unten in einen Sammler fallen.
 *
 * STATUS: unverified. Die Geometrie ist eine Skizze, nicht im Spiel getestet.
 * Bekanntes Risiko: Kaktus zerstört Items, die ihn berühren; wie viele Items
 * den Sammler erreichen, muss gemessen werden.
 *
 * Ratenmodell: Ein Kaktus wächst nach 16 Random Ticks um einen Block.
 * Bei randomTickSpeed=3 bekommt ein Block im Schnitt alle 4096/3 Ticks einen
 * Random Tick → 16 × 4096/3 ≈ 21.845 Ticks ≈ 18,2 min → ~3,3 Blöcke/h.
 * Server können Wachstum umstellen (z. B. Spigot/Paper growth modifier).
 */
export const CactusCell = defineComponent({
  name: "CactusCell",
  description: "Ein Kaktus mit Zaun-Brecher; Items fallen rechts in einen Sammler darunter.",
  status: "unverified",
  defaults: { randomTickSpeed: 3, growthModifier: 1 },
  build(c, { randomTickSpeed, growthModifier }) {
    const base = c.origin(B.stone());
    const sand = c.place(B.sand()).above(base);
    const cactus = c.place(B.cactus()).above(sand);
    const growth = c.place(B.air()).above(cactus); // freihalten: hier wächst der Kaktus hinein
    c.place(B.oakFence()).inFrontOf(growth); // Brecher

    // Fallweg rechts neben dem Kaktus freihalten
    const fall1 = c.place(B.air()).rightOf(sand);
    c.place(B.air()).rightOf(cactus);
    c.place(B.air()).rightOf(growth);

    c.output("drops", "items", fall1.neighbor("down"), {
      item: "minecraft:cactus",
      description: "Zelle unter dem Fallweg; dort muss ein Sammler stehen",
    });

    const ticksPerGrowth = (16 * 4096) / randomTickSpeed / growthModifier;
    const perHour = (20 * 3600) / ticksPerGrowth;
    c.produces("drops", "minecraft:cactus", perHour, "estimate", "Wachstum aus Spielmechanik; Verluste durch Kaktus-Schaden unbekannt");
  },
});
