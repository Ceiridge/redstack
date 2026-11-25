/**
 * Geometrie: Positionen, Richtungen, Drehungen.
 *
 * Konvention: Jede Komponente hat ein lokales Koordinatensystem.
 * "forward" zeigt bei Drehung 0 nach Norden (-z), "right" nach Osten (+x).
 * Eine Drehung ist eine Anzahl Vierteldrehungen im Uhrzeigersinn (von oben gesehen).
 */

export type Vec3 = readonly [number, number, number];

export type HorizontalDir = "north" | "east" | "south" | "west";
export type Dir = HorizontalDir | "up" | "down";

/** Richtungen relativ zur Komponente. Werden beim Platzieren in absolute Richtungen übersetzt. */
export type RelDir = "forward" | "back" | "left" | "right" | "up" | "down";

/** Anzahl Vierteldrehungen im Uhrzeigersinn: 0, 1, 2, 3 */
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

/** Lokale Richtung bei Drehung 0 → (lokal-)absolute Richtung */
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

/** Dreht einen Vektor um die y-Achse, im Uhrzeigersinn von oben gesehen. */
export function rotateVec(v: Vec3, rot: Rotation): Vec3 {
  let [x, y, z] = v;
  for (let i = 0; i < rot; i++) {
    // north (0,0,-1) -> east (1,0,0): (x, z) -> (-z, x)
    const nx = -z;
    const nz = x;
    x = nx;
    z = nz;
  }
  // -0 vermeiden, damit Schlüssel stabil bleiben
  return [x + 0, y, z + 0];
}

export function rotateDir(d: Dir, rot: Rotation): Dir {
  if (d === "up" || d === "down") return d;
  const i = HORIZONTAL_CW.indexOf(d);
  return HORIZONTAL_CW[(i + rot) % 4]!;
}

/** Relative Richtung → lokale Himmelsrichtung (vor Drehung der Komponente). */
export function relToLocal(r: RelDir): Dir {
  return REL_TO_LOCAL[r];
}

/** Versatz in Schritten entlang einer relativen Richtung, z. B. steps("forward", 2). */
export function steps(dir: RelDir, n = 1): Vec3 {
  return scale(DIR_VECTORS[relToLocal(dir)], n);
}

export function isRelDir(s: string): s is RelDir {
  return s in REL_TO_LOCAL;
}

export function isDir(s: string): s is Dir {
  return s in DIR_VECTORS;
}
