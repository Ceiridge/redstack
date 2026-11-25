/**
 * Example: a cactus farm built from standard library components.
 * Cells in a row, a hopper belt under their exits, a chest at the end.
 */

import { Assembly, steps } from "@redstack/core";
import { CactusCell, Chest, HopperLine } from "@redstack/stdlib";

/** Cells are 3 wide (hopper ring), so they repeat every 3 blocks. */
const CELL_PITCH = 3;

export function cactusFarm(cells = 16, cell: Parameters<typeof CactusCell.instantiate>[0] = {}): Assembly {
  const farm = new Assembly(`cactus-farm-${cells}`);
  const row = farm.row(CactusCell, cells, steps("forward", CELL_PITCH), cell);

  // Belt under the exit hoppers; hopper 0 docks below the first cell's exit
  const belt = farm.add(HopperLine, { length: CELL_PITCH * (cells - 1) + 1, exit: "forward" }).attach("in", row[0]!.port("drops"));
  for (const c of row.slice(1)) farm.connect(c.port("drops"), belt.port("in"));

  farm.add(Chest).attach("in", belt.port("out"));
  return farm;
}

export default cactusFarm();
