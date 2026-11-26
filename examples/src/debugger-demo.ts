/**
 * A deliberately broken farm, to show what the checks and the viewer find:
 *  1. a stray block touches a cactus, which would break it (error: reserved-cell)
 *  2. a hopper facing up – a block state that does not exist (error: invalid-block-state)
 *  3. a chest connected to a belt end it is not at (error: port-misaligned)
 *  4. a supply chest feeding more than a hopper can move (warning: bottleneck)
 *
 *   redstack render examples/dist/debugger-demo.js -o out/debugger-demo.html
 */

import { B, assembly, component } from "@redstack/core";
import { CactusRow, Chest, HopperLine, SupplyChest } from "@redstack/stdlib";

const Stray = component({ name: "Stray", params: { block: "minecraft:stone" } }, (c, { block }) => void c.block(B.of(block)));
const UpHopper = component({ name: "UpHopper" }, (c) => void c.block(B.of("minecraft:hopper", { facing: "up", enabled: true })));

export default assembly("debugger-demo", (f) => {
  const row = f.add(CactusRow({ cells: 6 }));
  const belt = row.to(HopperLine({ length: 4 }));
  belt.to(Chest);

  f.add(Stray).offsetFrom(row, [-1, 2, -5]); // 1: next to the third cactus
  f.add(UpHopper).offsetFrom(row, [3, 1, -3]); // 2
  f.connect(belt.port("out"), f.add(Chest).offsetFrom(row, [4, 0, -14]).port("in")); // 3: chest in the wrong place
  f.add(SupplyChest({ perHour: 12_000 })).attach("out", belt.port("in"), 2); // 4
});
