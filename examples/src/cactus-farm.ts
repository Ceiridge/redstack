/**
 * Beispiel: Kaktusfarm aus Standardbausteinen.
 *
 * Zeigt das Prinzip – keine geprüfte Farm. CactusCell ist "unverified".
 */

import { Assembly, steps } from "@redstack/core";
import { CactusCell, Chest, HopperLine } from "@redstack/stdlib";

export function cactusFarm(cells = 16): Assembly {
  const farm = new Assembly(`Kaktusfarm-${cells}`);

  // Zellen im Abstand 2 hintereinander (Kakteen dürfen sich nicht berühren)
  const row = farm.row(CactusCell, cells, steps("forward", 2));

  // Sammelband rechts unter den Zellen: Hopper 0 dockt am Fallweg der ersten Zelle an
  const belt = farm.add(HopperLine, { length: 2 * cells - 1, exit: "forward" }).attach("in", row[0]!.port("drops"));
  for (const cell of row.slice(1)) farm.connect(cell.port("drops"), belt.port("in"));

  // Truhe am Ende des Bands
  farm.add(Chest).attach("in", belt.port("out"));

  return farm;
}

export default cactusFarm();
