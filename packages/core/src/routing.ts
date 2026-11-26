/**
 * Hopper routing: finds where hoppers go and which way they face, so designs
 * can say "connect this output to that input" instead of placing every hopper.
 *
 * - routeHoppers: shortest hopper chain from a start cell into a target block
 *   (A*, exact for the given cost: number of hoppers, then number of turns).
 * - hopperTree: merges several sources into one target (a Steiner tree,
 *   greedy shortest-path heuristic: good, not guaranteed minimal).
 *
 * Hopper rules encoded here:
 * - A hopper pushes into the block it faces: down or horizontal, never up.
 * - A hopper pulls from a container directly above it. So a route hopper must
 *   not sit below a foreign container (it would drain it) and not above a
 *   foreign hopper (that hopper would drain the route).
 * - A foreign hopper or dropper facing into a cell would feed foreign items
 *   into a route hopper placed there.
 * - Pull-from-above can create loops in a tree; new hoppers therefore never
 *   go directly below a hopper of the tree.
 * - A powered hopper is locked. Cells next to redstone (see poweredCells) are
 *   avoided, conservatively: a pulse-locked hopper is slow, a permanently
 *   powered one breaks the route.
 */

import { DIR_VECTORS, type Dir, type Vec3, add, eq, key, sub } from "./geometry.js";

/** Blocks a hopper interacts with (pulls from when above it, pushes into when facing it). */
const CONTAINER_IDS = new Set(
  [
    "hopper",
    "chest",
    "trapped_chest",
    "barrel",
    "dropper",
    "dispenser",
    "furnace",
    "blast_furnace",
    "smoker",
    "brewing_stand",
    "composter",
    "crafter",
    "chiseled_bookshelf",
    "decorated_pot",
    "jukebox",
  ].map((id) => `minecraft:${id}`),
);

export function isContainer(id: string): boolean {
  return CONTAINER_IDS.has(id) || /^minecraft:([a-z_]+_)?shulker_box$/.test(id);
}

/** What the router needs to know about the world around the route. */
export interface RoutingWorld {
  /** Occupied cells (blocks and cells that must stay clear) */
  readonly occupied: (p: Vec3) => boolean;
  /** Block id at a cell, if any */
  readonly blockAt: (p: Vec3) => string | undefined;
  /** For hoppers, droppers and dispensers: the cell they push into */
  readonly pushTarget: (p: Vec3) => Vec3 | undefined;
  /** Cells where a hopper would receive redstone power (and stop working) */
  readonly powered?: (p: Vec3) => boolean;
  /** Search space (inclusive) */
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface HopperCell {
  readonly pos: Vec3;
  /** Direction the hopper outputs to */
  readonly facing: Exclude<Dir, "up">;
}

export type RouteFailure =
  | { readonly reason: "upward"; readonly message: string }
  | { readonly reason: "blocked"; readonly message: string };

export type RouteResult = { readonly ok: true; readonly hoppers: readonly HopperCell[] } | ({ readonly ok: false } & RouteFailure);

const MOVES: ReadonlyArray<Exclude<Dir, "up">> = ["north", "east", "south", "west", "down"];

interface SearchOptions {
  /** Cells of the network being built (not foreign) */
  readonly own: ReadonlySet<string>;
  /** Cells whose block may be pulled from / that may feed the start cell */
  readonly allowedFeeds: ReadonlySet<string>;
  /** Cells directly below which no hopper may go (tree hoppers, to avoid loops) */
  readonly noBelow: ReadonlySet<string>;
  /** Cells directly above which no hopper may go (they would drain into a branch) */
  readonly noAbove?: ReadonlySet<string>;
  /** Among equally short paths, prefer those that go down late (room for branches below) */
  readonly preferHigh?: boolean;
}

/** Can a new hopper go into this cell without picking up or losing foreign items? */
function usable(w: RoutingWorld, p: Vec3, o: SearchOptions, isStart: boolean): boolean {
  const k = key(p);
  if (o.own.has(k)) return false;
  for (let i = 0; i < 3; i++) if (p[i]! < w.min[i]! || p[i]! > w.max[i]!) return false;
  if (w.occupied(p)) return false;
  if (w.powered?.(p)) return false;
  const above = add(p, [0, 1, 0]);
  const below = add(p, [0, -1, 0]);
  if (o.noBelow.has(key(above))) return false;
  const aboveId = w.blockAt(above);
  if (aboveId && isContainer(aboveId) && !o.allowedFeeds.has(key(above)) && !o.own.has(key(above))) return false;
  if (o.noAbove?.has(key(below))) return false;
  const belowId = w.blockAt(below);
  if (belowId === "minecraft:hopper" && !o.own.has(key(below))) return false;
  if (!isStart) {
    // A foreign hopper/dropper pushing into this cell would inject items
    for (const m of [...MOVES, "up" as const]) {
      const n = add(p, DIR_VECTORS[m]);
      const t = w.pushTarget(n);
      if (t && eq(t, p) && !o.own.has(key(n)) && !o.allowedFeeds.has(key(n))) return false;
    }
  }
  return true;
}

/**
 * Multi-goal A*: from `start` to any goal cell. `goals` maps a goal cell to
 * the direction its hopper must face to leave the route (into the target).
 */
function search(
  w: RoutingWorld,
  start: Vec3,
  goals: ReadonlyMap<string, Exclude<Dir, "up">>,
  o: SearchOptions,
): HopperCell[] | undefined {
  if (!usable(w, start, o, true)) return undefined;
  const goalCells = [...goals.keys()].map((k) => k.split(",").map(Number) as unknown as Vec3);
  const h = (p: Vec3) => Math.min(...goalCells.map((g) => Math.abs(g[0] - p[0]) + Math.abs(g[2] - p[2]) + Math.max(0, p[1] - g[1])));
  // cost = hoppers * 1000 + turns (integer, so ties break deterministically)
  type Node = { p: Vec3; g: number; f: number; dir?: Exclude<Dir, "up">; parent?: Node };
  const open: Node[] = [{ p: start, g: 1000, f: 1000 + h(start) * 1000 }];
  const best = new Map<string, number>([[key(start), 1000]]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    const ck = key(cur.p);
    if (cur.g > (best.get(ck) ?? Infinity)) continue;
    const exit = goals.get(ck);
    if (exit) {
      const cells: HopperCell[] = [{ pos: cur.p, facing: exit }];
      for (let n: Node | undefined = cur; n?.parent; n = n.parent) cells.unshift({ pos: n.parent.p, facing: n.dir! });
      return cells;
    }
    for (const m of MOVES) {
      const np = add(cur.p, DIR_VECTORS[m]);
      if (np[1] > cur.p[1]) continue;
      if (!usable(w, np, o, false)) continue;
      // y never increases along a path, so no hopper sits above an earlier one (no pull loops)
      const g = cur.g + 1000 + (cur.dir && cur.dir !== m ? 1 : 0) + (o.preferHigh ? (start[1] - np[1]) * 10 : 0);
      const nk = key(np);
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      open.push({ p: np, g, f: g + h(np) * 1000, dir: m, parent: cur });
    }
  }
  return undefined;
}

/** Goal cells for feeding into `target`: above it (facing down) or beside it (facing it). */
function goalsInto(target: Vec3): Map<string, Exclude<Dir, "up">> {
  const goals = new Map<string, Exclude<Dir, "up">>();
  goals.set(key(add(target, [0, 1, 0])), "down");
  for (const m of ["north", "east", "south", "west"] as const) {
    const from = sub(target, DIR_VECTORS[m]);
    goals.set(key(from), m);
  }
  return goals;
}

/**
 * Shortest hopper chain whose first hopper is at `start` and whose last one
 * pushes into the block at `target`.
 */
export function routeHoppers(w: RoutingWorld, start: Vec3, target: Vec3, allowedFeeds: readonly Vec3[] = []): RouteResult {
  if (start[1] < target[1]) {
    return {
      ok: false,
      reason: "upward",
      message: `Hoppers cannot move items up (from y=${start[1]} to y=${target[1]}); use a dropper elevator or a bubble column.`,
    };
  }
  const o: SearchOptions = { own: new Set(), allowedFeeds: new Set(allowedFeeds.map(key)), noBelow: new Set() };
  const path = search(w, start, goalsInto(target), o);
  if (!path) return { ok: false, reason: "blocked", message: `No hopper route from (${start.join(",")}) into (${target.join(",")}) through free space.` };
  return { ok: true, hoppers: path };
}

/**
 * Hoppers that carry items from every start cell into `target`. Branches
 * join the tree by pushing into one of its hoppers. Sources are connected
 * nearest first.
 */
export function hopperTree(w: RoutingWorld, starts: readonly Vec3[], target: Vec3, allowedFeeds: readonly Vec3[] = []): RouteResult {
  const tree = new Map<string, HopperCell>();
  const feeds = new Set(allowedFeeds.map(key));
  const dist = (p: Vec3) => Math.abs(p[0] - target[0]) + Math.abs(p[2] - target[2]) + Math.abs(p[1] - target[1]);
  const order = [...starts].sort((a, b) => dist(a) - dist(b));
  for (const start of order) {
    if (tree.has(key(start))) continue;
    if (start[1] < target[1]) {
      return { ok: false, reason: "upward", message: `Hoppers cannot move items up (source at y=${start[1]}, target at y=${target[1]}).` };
    }
    const goals = goalsInto(target);
    for (const cell of tree.values()) for (const [g, d] of goalsInto(cell.pos)) if (!goals.has(g)) goals.set(g, d);
    const own = new Set(tree.keys());
    const o: SearchOptions = { own, allowedFeeds: feeds, noBelow: own };
    const path = search(w, start, goals, o);
    if (!path) return { ok: false, reason: "blocked", message: `No hopper route from (${start.join(",")}) into the collector.` };
    for (const c of path) tree.set(key(c.pos), c);
  }
  return { ok: true, hoppers: [...tree.values()] };
}

/**
 * Hoppers that carry items from one start cell to several targets. A branch
 * starts below a hopper of the network: the lower hopper pulls from the upper
 * one while that keeps pushing forward, so items split between both ways.
 * Targets are served nearest first; branches never merge back.
 */
export function hopperSplit(w: RoutingWorld, start: Vec3, targets: readonly Vec3[], allowedFeeds: readonly Vec3[] = []): RouteResult {
  for (const t of targets) {
    if (t[1] > start[1]) return { ok: false, reason: "upward", message: `Hoppers cannot move items up (start at y=${start[1]}, target at y=${t[1]}).` };
  }
  // Which target gets the trunk matters (branches can only drop below it), so
  // small sets try every order and keep the network with the fewest hoppers
  const orders = targets.length <= 5 ? permutations(targets) : [nearestFirst(start, targets)];
  let best: HopperCell[] | undefined;
  let failure = "";
  for (const order of orders) {
    const r = splitInOrder(w, start, order, allowedFeeds);
    if (typeof r === "string") failure ||= r;
    else if (!best || r.length < best.length) best = r;
  }
  return best ? { ok: true, hoppers: best } : { ok: false, reason: "blocked", message: failure };
}

function splitInOrder(w: RoutingWorld, start: Vec3, order: readonly Vec3[], allowedFeeds: readonly Vec3[]): HopperCell[] | string {
  const net = new Map<string, HopperCell>();
  const feeds = new Set(allowedFeeds.map(key));
  for (const target of order) {
    const own = new Set(net.keys());
    // Possible branch starts: the start itself (first target), or below a sideways-pushing hopper of the network
    const branchStarts: Vec3[] = net.size === 0 ? [start] : [...net.values()].filter((h) => h.facing !== "down").map((h) => add(h.pos, [0, -1, 0]));
    let bestPath: HopperCell[] | undefined;
    for (const b of branchStarts) {
      if (net.has(key(b))) continue;
      const parent = key(add(b, [0, 1, 0]));
      const o: SearchOptions = {
        own,
        allowedFeeds: new Set([...feeds, parent]),
        // No hopper below another network hopper (an unplanned split) or above one (a merge)
        noBelow: new Set([...own].filter((k) => k !== parent)),
        noAbove: own,
        preferHigh: true,
      };
      const path = search(w, b, goalsInto(target), o);
      if (path && (!bestPath || path.length < bestPath.length)) bestPath = path;
    }
    if (!bestPath) return `No hopper branch reaches (${target.join(",")}).`;
    for (const c of bestPath) net.set(key(c.pos), c);
  }
  return [...net.values()];
}

function nearestFirst(start: Vec3, targets: readonly Vec3[]): Vec3[] {
  const d = (p: Vec3) => Math.abs(p[0] - start[0]) + Math.abs(p[2] - start[2]);
  return [...targets].sort((a, b) => d(a) - d(b));
}

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** The cell a hopper pushes into. */
export function hopperTarget(c: HopperCell): Vec3 {
  return add(c.pos, DIR_VECTORS[c.facing]);
}

// ---------- Redstone power (conservative) ----------

const NON_CONDUCTIVE = /glass|slab|stairs|leaves|hopper|chest|fence|wall|sign|piston|observer|repeater|comparator|redstone|torch|lever|button|rail|carpet|pressure_plate|water|lava|kelp|^minecraft:ice$|snow$|scaffolding|lantern|glowstone|sea_lantern/;

/** Can this block carry power to its neighbours when powered (an opaque full block)? Heuristic. */
export function conductsRedstone(id: string): boolean {
  return id !== "minecraft:air" && !NON_CONDUCTIVE.test(id);
}

const ALL_DIRS: readonly Dir[] = ["north", "east", "south", "west", "up", "down"];
const OPPOSITE_DIR: Readonly<Record<Dir, Dir>> = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };

/**
 * Cells that may receive redstone power from the given blocks: next to power
 * sources and dust, in front of repeaters and comparators, and next to solid
 * blocks powered by them. Errs on the side of "powered".
 *
 * Observer outputs are pulses (2 ticks): a hopper there is locked briefly and
 * keeps most of its speed, which compact designs rely on (the kelp core feeds
 * a dispenser through such a hopper). They are left out unless `pulses` is set.
 */
export function poweredCells(
  blocks: Iterable<{ readonly pos: Vec3; readonly block: { readonly id: string; readonly props: Readonly<Record<string, string | number | boolean>> } }>,
  opts: { readonly pulses?: boolean } = {},
): Set<string> {
  const byKey = new Map<string, string>();
  const list = [...blocks];
  for (const b of list) byKey.set(key(b.pos), b.block.id);
  const out = new Set<string>();
  const poweredBlock = (p: Vec3) => {
    out.add(key(p));
    const id = byKey.get(key(p));
    if (id && conductsRedstone(id)) for (const d of ALL_DIRS) out.add(key(add(p, DIR_VECTORS[d])));
  };
  for (const { pos, block } of list) {
    const id = block.id.replace("minecraft:", "");
    const facing = block.props["facing"];
    const f = typeof facing === "string" && facing in DIR_VECTORS ? (facing as Dir) : undefined;
    if (id === "redstone_wire") {
      for (const d of ["north", "east", "south", "west", "down"] as const) poweredBlock(add(pos, DIR_VECTORS[d]));
    } else if (id === "redstone_block" || id === "redstone_torch" || id === "redstone_wall_torch" || id === "lever" || id.endsWith("_button")) {
      for (const d of ALL_DIRS) poweredBlock(add(pos, DIR_VECTORS[d]));
    } else if ((id === "repeater" || id === "comparator") && f) {
      // Repeaters and comparators face their input
      poweredBlock(add(pos, DIR_VECTORS[OPPOSITE_DIR[f]]));
    } else if (id === "observer" && f && opts.pulses) {
      // Observers watch the side they face and pulse out of the back
      poweredBlock(add(pos, DIR_VECTORS[OPPOSITE_DIR[f]]));
    }
  }
  return out;
}
