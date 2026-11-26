/**
 * Two kelp cores, one AFK player: the layout search decides where the second
 * core goes (and which way it faces) so that both throw their kelp to the
 * same player, and where the four supply chests go so their hopper routes
 * are short. Only the first core is placed by hand.
 */

import { assembly } from "@redstack/core";
import { KelpBonemealCore, PlayerPickup, SupplyChest } from "@redstack/stdlib";

const supply = { item: "minecraft:bone_meal", perHour: 9_000 };

export function kelpTwin(maxNodes = 3_000) {
  return assembly("kelp-twin", (f) => {
    f.layout({ maxNodes, weights: { volume: 1, hoppers: 5 } });
    // The cores are dug in at ground level (y=0), the player stands on the ground (y=1)
    const ground = { min: [-10, 0, -10], max: [10, 0, 14] } as const;
    const a = f.add(KelpBonemealCore).at([0, 0, 0]);
    const b = f.add(KelpBonemealCore).free({ within: ground });
    const player = f.add(PlayerPickup).free({ rotations: [0], within: { min: [-10, 1, -10], max: [10, 1, 14] } });
    f.connect(a.port("kelp"), player.port("in"));
    f.connect(b.port("kelp"), player.port("in"));
    for (const core of [a, b]) {
      for (const side of ["West", "East"]) {
        const chest = f.add(SupplyChest, supply).free({ rotations: [0], within: { min: [-10, 2, -10], max: [12, 5, 16] } });
        f.route(chest.port("out"), core.port(`bonemeal${side}`));
      }
    }
  });
}

export default kelpTwin();
