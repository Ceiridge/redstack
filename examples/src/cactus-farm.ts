/**
 * Example: cactus farms from standard library components.
 *
 *   redstack all examples/dist/cactus-farm.js -o out/cactus-farm.litematic
 */

import { type AssemblyOptions, assembly } from "@redstack/core";
import { CactusCell, CactusRow, Chest, HopperLine } from "@redstack/stdlib";

/** The current design: a row of slices with a shared belt, into a chest. */
export function cactusFarm(cells = 16, breaker: "fence" | "glass" = "fence", options: AssemblyOptions = {}) {
  return assembly(`cactus-farm-${cells}`, (f) => {
    f.add(CactusRow({ cells, breaker })).to(Chest);
  }, options);
}

/** The first design, kept for comparison: cells with their own hopper ring over a belt. */
export function cactusRingFarm(cells = 16, breaker: "fence" | "glass" = "fence") {
  return assembly(`cactus-ring-farm-${cells}`, (f) => {
    const row = f.row(CactusCell({ breaker }), cells, [0, 0, -3]);
    const belt = f.add(HopperLine({ length: 3 * (cells - 1) + 1 })).attach("in", row[0]!.port("drops"));
    for (const c of row.slice(1)) f.connect(c.port("drops"), belt.port("in"));
    belt.to(Chest);
  });
}

export default cactusFarm(16);
