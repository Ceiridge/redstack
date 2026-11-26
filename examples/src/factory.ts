/**
 * Showcase: logs → planks → chests → packed into shulker boxes, taken out
 * at one chest. Two PatternCrafters in a row and a FastShulkerLoader; every
 * hopper between them is laid by the router. Rendered for the README; the
 * parts are game-tested one by one, this chain as a whole is not.
 */

import { assembly } from "@redstack/core";
import { Chest, FastShulkerLoader, PatternCrafter, SupplyChest } from "@redstack/stdlib";

const planks = PatternCrafter({
  recipe: { pattern: ["L..", "...", "..."], key: { L: "minecraft:oak_log" }, result: "minecraft:oak_planks", count: 4 },
  faces: 1,
});
const chests = PatternCrafter({
  recipe: { pattern: ["PPP", "P.P", "PPP"], key: { P: "minecraft:oak_planks" }, result: "minecraft:chest" },
  faces: 1,
});

export function factory() {
  return assembly("factory", (f) => {
    const a = f.add(planks).at([0, 0, 0]);
    const b = f.add(chests).at([11, -4, 0]);
    const loader = f.add(FastShulkerLoader).at([20, -10, 2]);
    f.route(f.add(SupplyChest({ item: "minecraft:oak_log" })).at([-6, 1, 0]).port("out"), a.port("west"));
    f.route(a.port("out"), b.port("west"));
    f.route(b.port("out"), loader.port("in"));
    f.route(f.add(SupplyChest({ item: "minecraft:shulker_box" })).at([20, -7, -1]).port("out"), loader.port("boxes"));
    loader.to(Chest);
  });
}

export default factory();
