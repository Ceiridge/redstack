/**
 * Kelp farm: the bone meal core from the stdlib, supplied by two chests whose
 * hoppers are placed by the router. One hopper pulls 9,000 items/h from a
 * chest and each dispenser fires 9,000 times per hour, so each dispenser gets
 * its own chest. With one chest for both (`supplies: 1`) the flow model shows
 * the supply line as the bottleneck: half the kelp.
 */

import { assembly } from "@redstack/core";
import { KelpBonemealCore, PlayerPickup, SupplyChest } from "@redstack/stdlib";

const BONE_MEAL = "minecraft:bone_meal";

export function kelpFarm(supplies: 1 | 2 = 2) {
  return assembly(supplies === 2 ? "kelp-farm" : "kelp-farm-one-supply", (f) => {
    const core = f.add(KelpBonemealCore).at([0, 0, 0]);
    const player = f.add(PlayerPickup).at([1, 1, 5]);
    f.connect(core.port("kelp"), player.port("in"));
    // Refilled by hand; a hopper pulls at most 9,000 items/h out of it
    const supply = { item: BONE_MEAL, perHour: 9_000 };
    const a = f.add(SupplyChest, supply).at([-1, 3, 1]);
    if (supplies === 2) {
      const b = f.add(SupplyChest, supply).at([3, 3, 3]);
      f.route(a.port("out"), core.port("bonemealWest"));
      f.route(b.port("out"), core.port("bonemealEast"));
    } else {
      f.distribute(a.port("out"), [core.port("bonemealWest"), core.port("bonemealEast")]);
    }
  });
}

export default kelpFarm();
