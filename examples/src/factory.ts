/**
 * Showcase for the README: three CrafterRows of eight crafters stacked into
 * one wall – a chest of ingredients above each crafter, a chest of results
 * below it. Each row is game-tested (examples/src/scenarios.ts,
 * crafter-row); the stack is rendered, not measured as a whole.
 */

import { B, assembly } from "@redstack/core";
import { CrafterRow, type Recipe } from "@redstack/stdlib";

const ROWS: Array<{ recipe: Recipe }> = [
  { recipe: { pattern: ["PPP", "P.P", "PPP"], key: { P: "minecraft:oak_planks" }, result: "minecraft:chest" } },
  { recipe: { pattern: ["CCC", "C.C", "CCC"], key: { C: "minecraft:cobblestone" }, result: "minecraft:furnace" } },
  { recipe: { pattern: ["SSS", "...", "..."], key: { S: "minecraft:stone" }, result: "minecraft:stone_slab", count: 6 } },
];

export function factory(crafters = 8) {
  return assembly("crafter-wall", (f) => {
    ROWS.forEach((row, level) => {
      const y = 7 * level;
      f.add(CrafterRow({ recipe: row.recipe, crafters })).at([0, y, 0]);
      for (let i = 0; i < crafters; i++) {
        f.block(B.chest()).at([2 * i, y + 2, 0]);
        f.block(B.chest()).at([2 * i, y - 3, 0]);
      }
    });
  });
}

export default factory();
