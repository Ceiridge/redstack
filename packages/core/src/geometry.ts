/**
 * Geometry: positions, directions, rotations.
 *
 * Convention: every component has a local frame. At rotation 0, "forward"
 * points north (-z) and "right" points east (+x). A rotation is a number of
 * clockwise quarter turns, seen from above.
 */

export type Vec3 = readonly [number, number, number];

export type HorizontalDir = "north" | "east" | "south" | "west";
export type Dir = HorizontalDir | "up" | "down";

/** Directions relative to the component; translated to absolute directions on placement. */
export type RelDir = "forward" | "back" | "left" | "right" | "up" | "down";

/** Number of clockwise quarter turns: 0, 1, 2, 3 */
export type Rotation = 0 | 1 | 2 | 3;

export const DIR_VECTORS: Readonly<Record<Dir, Vec3>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const HORIZONTAL_CW: readonly HorizontalDir[] = ["north", "east", "south", "west"];

export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};

/** Relative direction → local compass direction (before the component is rotated) */
const REL_TO_LOCAL: Readonly<Record<RelDir, Dir>> = {
  forward: "north",
  back: "south",
  right: "east",
  left: "west",
  up: "up",
  down: "down",
};

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function eq(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function key(v: Vec3): string {
  return `${v[0]},${v[1]},${v[2]}`;
}

export function normalizeRotation(r: number): Rotation {
  return (((r % 4) + 4) % 4) as Rotation;
}

/** Rotates a vector around the y axis, clockwise seen from above. */
export function rotateVec(v: Vec3, rot: Rotation): Vec3 {
  let [x, y, z] = v;
  for (let i = 0; i < rot; i++) {
    // north (0,0,-1) -> east (1,0,0): (x, z) -> (-z, x)
    const nx = -z;
    const nz = x;
    x = nx;
    z = nz;
  }
  // avoid -0 so that keys stay stable
  return [x + 0, y, z + 0];
}

export function rotateDir(d: Dir, rot: Rotation): Dir {
  if (d === "up" || d === "down") return d;
  const i = HORIZONTAL_CW.indexOf(d);
  return HORIZONTAL_CW[(i + rot) % 4]!;
}

/** Relative direction → local compass direction (before the component is rotated). */
export function relToLocal(r: RelDir): Dir {
  return REL_TO_LOCAL[r];
}

/** Offset of n steps along a relative direction, e.g. steps("forward", 2). */
export function steps(dir: RelDir, n = 1): Vec3 {
  return scale(DIR_VECTORS[relToLocal(dir)], n);
}

export function isRelDir(s: string): s is RelDir {
  return s in REL_TO_LOCAL;
}

export function isDir(s: string): s is Dir {
  return s in DIR_VECTORS;
}
