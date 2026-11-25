/**
 * A deliberately broken cactus farm, to show what the checks and the viewer find:
 *  1. one cell is shifted sideways, so its drops miss the belt (error: port-misaligned)
 *  2. a stray block touches a cactus, which would break it (error: reserved-cell)
 *  3. a supply chest feeds more into the belt than a hopper can move (warning: bottleneck)
 *
 *   redstack render examples/dist/debugger-demo.js -o out/debugger-demo.html
 */

import { Assembly, B, defineComponent, steps } from "@redstack/core";
import { CactusCell, Chest, HopperLine, SupplyChest } from "@redstack/stdlib";

const StrayBlock = defineComponent({
  name: "StrayBlock",
  description: "A single block placed somewhere it should not be.",
  status: "draft",
  defaults: {},
  build: (c) => void c.origin(B.stone()),
});

export function debuggerDemo(): Assembly {
  const cells = 6;
  const farm = new Assembly("debugger-demo");
  const row = farm.row(CactusCell, cells, steps("forward", 3));
  // Flaw 1: shift the fourth cell one block to the left
  row[3]!.offsetFrom(row[0]!, [-1, 0, -9]);

  const length = 3 * (cells - 1) + 4;
  const belt = farm.add(HopperLine, { length }).attach("in", row[0]!.port("drops"));
  for (const c of row.slice(1)) farm.connect(c.port("drops"), belt.port("in"));
  farm.add(Chest).attach("in", belt.port("out"));

  // Flaw 2: a block right next to the second cactus
  farm.add(StrayBlock).offsetFrom(row[1]!, [-1, 2, 0]);

  // Flaw 3: 12,000 items/h into a belt that moves 9,000/h
  farm.add(SupplyChest, { item: "minecraft:cobblestone", perHour: 12_000 }).attach("out", belt.port("in"), length - 1);
  return farm;
}

export default debuggerDemo;
