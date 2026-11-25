/**
 * Block-States mit semantischen Helfern.
 *
 * Grundregel: In Komponenten werden Richtungen immer im lokalen Rahmen der
 * Komponente angegeben (forward/back/left/right/up/down oder lokale
 * Himmelsrichtungen). Beim Platzieren wird alles mitgedreht: facing, axis,
 * Verbindungs-Properties (north/east/...) und rotation (0–15).
 *
 * Die semantischen Helfer (outputTo, signalTowards, ...) kapseln die
 * Fallstricke der Block-States, z. B. dass bei Repeatern "facing" zur
 * Eingangsseite zeigt. Jede dieser Annahmen muss durch einen Komponenten-Test
 * im echten Spiel abgesichert werden (Phase 3).
 */

import {
  type Dir,
  type RelDir,
  type Rotation,
  OPPOSITE,
  isDir,
  isRelDir,
  relToLocal,
  rotateDir,
} from "./geometry.js";

export type PropValue = string | number | boolean;

export interface BlockSpec {
  readonly id: string;
  readonly props: Readonly<Record<string, PropValue>>;
}

const DIRECTIONAL_VALUE_PROPS = new Set(["facing", "horizontal_facing"]);
const CONNECTION_PROPS: readonly string[] = ["north", "east", "south", "west"];

function ns(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** Fluent-Builder für einen Block. Unveränderlich: jede Methode liefert einen neuen Builder. */
export class Block implements BlockSpec {
  readonly id: string;
  readonly props: Readonly<Record<string, PropValue>>;

  constructor(id: string, props: Record<string, PropValue> = {}) {
    this.id = ns(id);
    this.props = props;
  }

  with(props: Record<string, PropValue>): Block {
    return new Block(this.id, { ...this.props, ...props });
  }

  /** Setzt "facing" direkt (lokale Richtung). Für Blöcke ohne Sonderlogik. */
  facing(dir: RelDir | Dir): Block {
    return this.with({ facing: toLocalDir(dir) });
  }

  /** Hopper, Dropper, Dispenser: Items gehen in diese Richtung hinaus. */
  outputTo(dir: RelDir | Dir): Block {
    const d = toLocalDir(dir);
    if (this.id === "minecraft:hopper" && d === "up") {
      throw new Error("Hopper können nicht nach oben ausgeben.");
    }
    return this.with({ facing: d });
  }

  /**
   * Repeater/Comparator: Das Signal läuft in diese Richtung.
   * Im Block-State zeigt "facing" zur Eingangsseite, also zur Gegenrichtung.
   */
  signalTowards(dir: RelDir | Dir): Block {
    const d = toLocalDir(dir);
    if (d === "up" || d === "down") throw new Error("Repeater/Comparator sind nur horizontal.");
    return this.with({ facing: OPPOSITE[d] });
  }

  /** Observer: beobachtet den Block in dieser Richtung, Ausgang auf der Rückseite. */
  watching(dir: RelDir | Dir): Block {
    return this.with({ facing: toLocalDir(dir) });
  }

  /** Piston/Sticky Piston: schiebt in diese Richtung. */
  pushing(dir: RelDir | Dir): Block {
    return this.with({ facing: toLocalDir(dir) });
  }

  toString(): string {
    return formatBlock(this);
  }
}

function toLocalDir(dir: RelDir | Dir): Dir {
  return isRelDir(dir) ? relToLocal(dir) : dir;
}

export function block(id: string, props: Record<string, PropValue> = {}): Block {
  return new Block(id, props);
}

/** Häufige Blöcke als Kurzformen. Liste wächst mit der Standardbibliothek. */
export const B = {
  air: () => block("air"),
  stone: () => block("stone"),
  glass: () => block("glass"),
  sand: () => block("sand"),
  water: () => block("water", { level: 0 }),
  hopper: () => block("hopper", { facing: "down", enabled: true }),
  chest: () => block("chest", { facing: "south", type: "single", waterlogged: false }),
  dropper: () => block("dropper", { facing: "down", triggered: false }),
  repeater: (delay: 1 | 2 | 3 | 4 = 1) =>
    block("repeater", { facing: "south", delay, locked: false, powered: false }),
  comparator: (mode: "compare" | "subtract" = "compare") =>
    block("comparator", { facing: "south", mode, powered: false }),
  observer: () => block("observer", { facing: "south", powered: false }),
  piston: (sticky = false) => block(sticky ? "sticky_piston" : "piston", { facing: "north", extended: false }),
  cactus: () => block("cactus", { age: 0 }),
  oakFence: () =>
    block("oak_fence", { north: false, east: false, south: false, west: false, waterlogged: false }),
} as const;

/** Dreht alle richtungsabhängigen Properties eines Blocks. */
export function rotateBlock(spec: BlockSpec, rot: Rotation): BlockSpec {
  if (rot === 0) return spec;
  const out: Record<string, PropValue> = {};
  // Verbindungs-Properties (Zäune, Redstone, Glasscheiben) werden permutiert
  const conn: Partial<Record<Dir, PropValue>> = {};
  for (const [k, v] of Object.entries(spec.props)) {
    if (CONNECTION_PROPS.includes(k)) {
      conn[rotateDir(k as Dir, rot)] = v;
    } else if (DIRECTIONAL_VALUE_PROPS.has(k) && typeof v === "string" && isDir(v)) {
      out[k] = rotateDir(v, rot);
    } else if (k === "axis" && (v === "x" || v === "z") && rot % 2 === 1) {
      out[k] = v === "x" ? "z" : "x";
    } else if (k === "rotation" && typeof v === "number") {
      out[k] = (v + rot * 4) % 16;
    } else {
      out[k] = v;
    }
  }
  for (const [k, v] of Object.entries(conn)) out[k] = v;
  return { id: spec.id, props: out };
}

/** Kanonische Schreibweise: minecraft:hopper[enabled=true,facing=down] (Properties sortiert). */
export function formatBlock(spec: BlockSpec): string {
  const entries = Object.entries(spec.props).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return spec.id;
  return `${spec.id}[${entries.map(([k, v]) => `${k}=${String(v)}`).join(",")}]`;
}

/** Blöcke, die Redstone-Signale erzeugen, leiten oder darauf reagieren (für die Übersprech-Prüfung). */
export const REDSTONE_RELEVANT = new Set(
  [
    "redstone_wire",
    "repeater",
    "comparator",
    "observer",
    "piston",
    "sticky_piston",
    "redstone_torch",
    "redstone_wall_torch",
    "redstone_block",
    "lever",
    "stone_button",
    "target",
    "hopper",
    "dropper",
    "dispenser",
    "crafter",
    "note_block",
    "daylight_detector",
    "tripwire_hook",
    "sculk_sensor",
    "calibrated_sculk_sensor",
    "rail",
    "powered_rail",
    "activator_rail",
    "detector_rail",
  ].map(ns),
);
