/**
 * Kelp farm: the bone meal core from the stdlib, supplied by two chests whose
 * hoppers are placed by the router. One hopper pulls 9,000 items/h from a
 * chest and each dispenser fires 9,000 times per hour, so each dispenser gets
 * its own chest. With one chest for both (`supplies: 1`) the flow model shows
 * the supply line as the bottleneck: half the kelp.
 */

import { type Vec3, assembly, mirrored } from "@redstack/core";
import { KelpBonemealCore, PlayerPickup, SupplyChest } from "@redstack/stdlib";

const BONE_MEAL = "minecraft:bone_meal";

/** `mirror`: the whole farm mirrored east ↔ west (core included) */
export function kelpFarm(supplies: 1 | 2 = 2, mirror = false) {
  const at = (v: Vec3): Vec3 => (mirror ? [-v[0], v[1], v[2]] : v);
  const name = `kelp-farm${supplies === 1 ? "-one-supply" : ""}${mirror ? "-mirrored" : ""}`;
  return assembly(name, (f) => {
    const core = f.add(mirror ? mirrored(KelpBonemealCore) : KelpBonemealCore).at([0, 0, 0]);
    const player = f.add(PlayerPickup).at(at([1, 1, 5]));
    f.connect(core.port("kelp"), player.port("in"));
    // Refilled by hand; a hopper pulls at most 9,000 items/h out of it
    const supply = { item: BONE_MEAL, perHour: 9_000 };
    const a = f.add(SupplyChest, supply).at(at([-1, 3, 1]));
    if (supplies === 2) {
      const b = f.add(SupplyChest, supply).at(at([3, 3, 3]));
      f.route(a.port("out"), core.port("bonemealWest"));
      f.route(b.port("out"), core.port("bonemealEast"));
    } else {
      f.distribute(a.port("out"), [core.port("bonemealWest"), core.port("bonemealEast")]);
    }
  });
}

export default kelpFarm();
