/**
 * Block states with semantic helpers.
 *
 * Rule: inside components, directions are always given in the component's
 * local frame (forward/back/left/right/up/down, or local compass directions).
 * When a component is placed rotated, everything turns with it: facing, axis,
 * connection properties (north/east/...) and rotation (0–15).
 *
 * The semantic helpers (outputTo, signalTowards, ...) hide block-state traps,
 * e.g. that a repeater's "facing" points at its input side. Each of these
 * assumptions has to be covered by an in-game component test.
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

function namespaced(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** Fluent, immutable block builder: every method returns a new builder. */
export class Block implements BlockSpec {
  readonly id: string;
  readonly props: Readonly<Record<string, PropValue>>;

  constructor(id: string, props: Record<string, PropValue> = {}) {
    this.id = namespaced(id);
    this.props = props;
  }

  with(props: Record<string, PropValue>): Block {
    return new Block(this.id, { ...this.props, ...props });
  }

  /** Sets "facing" directly (local direction). For blocks without special semantics. */
  facing(dir: RelDir | Dir): Block {
    return this.with({ facing: toLocalDir(dir) });
  }

  /** Hopper, dropper, dispenser: items leave in this direction. */
  outputTo(dir: RelDir | Dir): Block {
    const d = toLocalDir(dir);
    if (this.id === "minecraft:hopper" && d === "up") {
      throw new Error("Hoppers cannot output upwards.");
    }
    return this.with({ facing: d });
  }

  /**
   * Repeater/comparator: the signal travels in this direction.
   * In the block state, "facing" points at the input side, i.e. the opposite.
   */
  signalTowards(dir: RelDir | Dir): Block {
    const d = toLocalDir(dir);
    if (d === "up" || d === "down") throw new Error("Repeaters and comparators are horizontal only.");
    return this.with({ facing: OPPOSITE[d] });
  }

  /** Observer: watches the block in this direction, outputs at its back. */
  watching(dir: RelDir | Dir): Block {
    return this.with({ facing: toLocalDir(dir) });
  }

  /** Piston/sticky piston: pushes in this direction. */
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

/**
 * Blocks with sensible default states. Blocks that come in variants take the
 * concrete id as an argument – usually from a material slot:
 * `B.fence(c.material(M.cactusBreaker))`. Any other block: `block("id", props)`.
 */
export const B = {
  air: () => block("air"),
  of: (id: string, props: Record<string, PropValue> = {}) => block(id, props),
  stone: () => block("stone"),
  glass: () => block("glass"),
  sand: () => block("sand"),
  water: () => block("water", { level: 0 }),
  fence: (id = "minecraft:oak_fence") => block(id, { north: false, east: false, south: false, west: false, waterlogged: false }),
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
} as const;

/** Rotates all direction-dependent properties of a block. */
export function rotateBlock(spec: BlockSpec, rot: Rotation): BlockSpec {
  if (rot === 0) return spec;
  const out: Record<string, PropValue> = {};
  // Connection properties (fences, redstone, panes) are permuted
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

/** Canonical block string: minecraft:hopper[enabled=true,facing=down] (properties sorted). */
export function formatBlock(spec: BlockSpec): string {
  const entries = Object.entries(spec.props).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return spec.id;
  return `${spec.id}[${entries.map(([k, v]) => `${k}=${String(v)}`).join(",")}]`;
}

/** Blocks that emit, carry or react to redstone signals (used by the crosstalk check). */
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
  ].map(namespaced),
);
