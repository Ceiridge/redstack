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

/** One slot of a container's contents. */
export interface ItemSlot {
  readonly slot: number;
  readonly id: string;
  readonly count: number;
}

export interface BlockSpec {
  readonly id: string;
  readonly props: Readonly<Record<string, PropValue>>;
  /** Contents of a container block as built (filter items of a sorter, a reference dropper) */
  readonly items?: readonly ItemSlot[];
}

/** Items packed into slots of `stackSize` (default 64), from slot 0 on. */
export function fillSlots(entries: ReadonlyArray<readonly [string, number]>, stackSize = 64): ItemSlot[] {
  const out: ItemSlot[] = [];
  for (const [id, count] of entries) {
    for (let left = count; left > 0; left -= stackSize) out.push({ slot: out.length, id: namespaced(id), count: Math.min(stackSize, left) });
  }
  return out;
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
  readonly items?: readonly ItemSlot[];

  constructor(id: string, props: Record<string, PropValue> = {}, items?: readonly ItemSlot[]) {
    this.id = namespaced(id);
    this.props = props;
    if (items) this.items = items;
  }

  with(props: Record<string, PropValue>): Block {
    return new Block(this.id, { ...this.props, ...props }, this.items);
  }

  /**
   * Built with contents: `B.hopper().containing(["minecraft:cobblestone", 18], ["minecraft:stick", 4])`
   * (slots in order, 64 per stack) or explicit slots.
   */
  containing(...entries: ReadonlyArray<readonly [string, number]>): Block {
    return new Block(this.id, { ...this.props }, fillSlots(entries));
  }

  /** Built with exactly these slots */
  withSlots(slots: readonly ItemSlot[]): Block {
    return new Block(this.id, { ...this.props }, slots.map((x) => ({ ...x, id: namespaced(x.id) })));
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
  return { id: spec.id, props: out, ...(spec.items ? { items: spec.items } : {}) };
}

const MIRROR_X: Readonly<Record<string, string>> = { east: "west", west: "east" };
/** Handedness flips under a mirror */
const HANDED: Readonly<Record<string, string>> = {
  left: "right",
  right: "left",
  inner_left: "inner_right",
  inner_right: "inner_left",
  outer_left: "outer_right",
  outer_right: "outer_left",
};
const RAIL_MIRROR: Readonly<Record<string, string>> = {
  south_east: "south_west",
  south_west: "south_east",
  north_east: "north_west",
  north_west: "north_east",
  ascending_east: "ascending_west",
  ascending_west: "ascending_east",
};

/**
 * Mirrors a block across the x axis (east ↔ west): facing, connections,
 * stair shapes, door hinges, double-chest halves, rail shapes and 16-step
 * rotations (signs, banners, heads).
 */
export function mirrorBlock(spec: BlockSpec): BlockSpec {
  const out: Record<string, PropValue> = {};
  const conn: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(spec.props)) {
    if (CONNECTION_PROPS.includes(k)) conn[MIRROR_X[k] ?? k] = v;
    else if (DIRECTIONAL_VALUE_PROPS.has(k) && typeof v === "string") out[k] = MIRROR_X[v] ?? v;
    else if ((k === "shape" || k === "hinge" || k === "type") && typeof v === "string" && HANDED[v]) out[k] = HANDED[v]!;
    else if (k === "shape" && typeof v === "string" && RAIL_MIRROR[v]) out[k] = RAIL_MIRROR[v]!;
    else if (k === "rotation" && typeof v === "number") out[k] = (16 - v) % 16;
    else out[k] = v;
  }
  for (const [k, v] of Object.entries(conn)) out[k] = v;
  return { id: spec.id, props: out, ...(spec.items ? { items: spec.items } : {}) };
}

/** Container contents as SNBT, e.g. for /setblock: {Items:[{Slot:0b,id:"minecraft:stone",count:64}]} */
export function itemsSnbt(items: readonly ItemSlot[]): string {
  return `{Items:[${items.map((i) => `{Slot:${i.slot}b,id:"${i.id}",count:${i.count}}`).join(",")}]}`;
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
