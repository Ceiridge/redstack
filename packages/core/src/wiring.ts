/**
 * Redstone wiring: finds where dust and repeaters go so a signal gets from a
 * source cell to a block it must power, without touching anything else.
 *
 * Elements: dust on a support block, repeaters (on a support, output
 * forward), dust stairs one level up or down. The wire ends pointing into
 * the target or as dust lying on it. Rules encoded here:
 * - Dust loses one strength per block; a repeater restores 15 and costs
 *   2 game ticks per delay step. The wire never runs dry.
 * - Dust connects only to the elements before and after it: no foreign dust
 *   or connecting component (comparators, torches, levers, repeaters and
 *   observers on their axis …) next to it, one level up or down included.
 * - What a wire powers – the side a dust points to, the block under it and
 *   that block's neighbours, the block in front of a repeater – holds nothing
 *   foreign that reacts to redstone (hoppers would lock, pistons fire …),
 *   except the target.
 * - No foreign power gets in: no dust where foreign blocks give off power, no
 *   foreign diode pointing into a repeater's side (it would lock it).
 * A* over (cell, strength, direction); cost: blocks placed, repeaters a bit
 * more, so dust is used where it reaches.
 */

import { REDSTONE_RELEVANT } from "./blocks.js";
import { DIR_VECTORS, type Dir, type HorizontalDir, OPPOSITE, type Vec3, add, eq, key, sub } from "./geometry.js";
import { conductsRedstone } from "./routing.js";

/** What the wire router needs to know about the world. */
export interface WireWorld {
  /** Cells that hold a block or must stay clear */
  readonly occupied: (p: Vec3) => boolean;
  /** Block at a cell (id and facing, if any) */
  readonly blockAt: (p: Vec3) => { readonly id: string; readonly facing?: string } | undefined;
  /** Cells that receive power from what is already there */
  readonly powered: (p: Vec3) => boolean;
  readonly min: Vec3;
  readonly max: Vec3;
}

export type WireElement =
  | { readonly pos: Vec3; readonly kind: "dust" }
  | { readonly pos: Vec3; readonly kind: "repeater"; readonly towards: HorizontalDir; readonly delay: 1 | 2 | 3 | 4 };

export type WireResult =
  | {
      readonly ok: true;
      readonly elements: readonly WireElement[];
      /** Support blocks to place under the elements */
      readonly supports: readonly Vec3[];
      /** Cells that must stay free (above or beside dust stairs) */
      readonly clear: readonly Vec3[];
      /** Game ticks from the source to the target */
      readonly delayTicks: number;
      /** Signal strength arriving at the target */
      readonly strength: number;
    }
  | { readonly ok: false; readonly message: string };

export interface WireOptions {
  /** Signal strength at the start cell (default 15: a repeater, torch or lever feeds it) */
  readonly strength?: number;
  /** At least this many game ticks from source to target; repeaters are set or added for it */
  readonly minDelayTicks?: number;
  /** Search budget (nodes) */
  readonly maxNodes?: number;
  /** Cells the wire must leave free – neither elements nor supports there, nor powered by it (e.g. where hoppers will come in) */
  readonly avoid?: readonly Vec3[];
}

const HORIZONTAL: readonly HorizontalDir[] = ["north", "east", "south", "west"];
const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
/** Components dust turns towards from any side */
const CONNECTS_ANY = /^minecraft:(redstone_wire|redstone_torch|redstone_wall_torch|lever|.*_button|redstone_block|target|comparator|daylight_detector|tripwire_hook|detector_rail|.*_pressure_plate|lectern|trapped_chest)$/;

interface Node {
  readonly el: WireElement;
  /** Direction of travel into this element */
  readonly dir: HorizontalDir;
  /** Strength this element puts out */
  readonly out: number;
  readonly g: number;
  readonly f: number;
  readonly parent: Node | undefined;
}

/**
 * Wire from `start` (the cell the source powers; `sourceDir` = direction
 * from the source into it, if it is a diode) to `target` (the block to
 * power).
 */
export function routeWire(world: WireWorld, start: Vec3, target: Vec3, sourceDir: HorizontalDir | undefined, opts: WireOptions = {}): WireResult {
  const strength0 = opts.strength ?? 15;
  const maxNodes = opts.maxNodes ?? 60_000;
  const inBox = (p: Vec3) => p.every((v, i) => v >= world.min[i]! && v <= world.max[i]!);
  const free = (p: Vec3) => inBox(p) && !world.occupied(p) && !avoid.has(key(p));
  const foreign = (p: Vec3) => world.blockAt(p);
  const reacts = (p: Vec3) => {
    if (eq(p, target)) return false;
    if (avoid.has(key(p))) return true;
    const b = foreign(p);
    return !!b && REDSTONE_RELEVANT.has(b.id);
  };
  const isSolid = (p: Vec3) => {
    const b = foreign(p);
    return !!b && conductsRedstone(b.id);
  };
  /** A block already there can carry dust or a repeater: solid and not itself redstone */
  const usableSupport = (p: Vec3) => {
    const b = foreign(p);
    return !!b && conductsRedstone(b.id) && !REDSTONE_RELEVANT.has(b.id) && !eq(p, target);
  };
  /** Would dust at p turn towards the foreign block at n (direction d from p)? */
  const connectsTo = (n: Vec3, d: HorizontalDir) => {
    const b = foreign(n);
    if (!b) return false;
    if (CONNECTS_ANY.test(b.id)) return true;
    if (b.id === "minecraft:repeater") return b.facing === d || b.facing === OPPOSITE[d];
    if (b.id === "minecraft:observer") return b.facing === d;
    return false;
  };
  const sourceCells = new Set<string>(sourceDir ? [key(sub(start, DIR_VECTORS[sourceDir]))] : []);
  const avoid = new Set((opts.avoid ?? []).map(key));

  const pathOf = (n: Node | undefined): Node[] => {
    const out: Node[] = [];
    for (let x = n; x; x = x.parent) out.push(x);
    return out.reverse();
  };
  const own = (nodes: readonly Node[]) => {
    const cells = new Map<string, WireElement>();
    const supports = new Set<string>();
    for (const n of nodes) {
      cells.set(key(n.el.pos), n.el);
      supports.add(key(add(n.el.pos, DOWN)));
    }
    return { cells, supports };
  };

  /**
   * Can element `el` sit there, given the path before it (ending with its
   * predecessor) and the cell its signal goes to next (`next`)? Checks
   * everything that depends on both neighbours.
   */
  const valid = (el: WireElement, prev: Vec3 | undefined, next: Vec3, path: readonly Node[]): boolean => {
    const p = el.pos;
    const { cells, supports } = own(path);
    const sup = add(p, DOWN);
    if (!free(p) && !eq(p, start)) return false;
    const onTarget = eq(sup, target);
    if (!free(sup) && !supports.has(key(sup)) && !usableSupport(sup) && !onTarget) return false;
    if (cells.has(key(p)) || supports.has(key(p))) return false;
    // The support (powered by dust or holding a repeater) touches nothing that reacts
    if (el.kind === "dust" && !onTarget) {
      for (const d of [...HORIZONTAL, "down" as const]) {
        const n = add(sup, DIR_VECTORS[d]);
        if (reacts(n)) return false;
      }
    }
    const allowed = new Set<string>([key(next), ...(prev ? [key(prev)] : [...sourceCells])]);
    if (el.kind === "repeater") {
      // Nothing foreign locks it from the side
      for (const d of HORIZONTAL) {
        if (d === el.towards || d === OPPOSITE[el.towards]) continue;
        const n = add(p, DIR_VECTORS[d]);
        const b = foreign(n);
        if (b && (b.id === "minecraft:repeater" || b.id === "minecraft:comparator") && b.facing === d) return false;
      }
      return true;
    }
    // Dust: no foreign power in (the start cell is meant to be powered)
    if (!eq(p, start) && world.powered(p)) return false;
    const roofed = isSolid(add(p, UP));
    for (const d of HORIZONTAL) {
      const n = add(p, DIR_VECTORS[d]);
      if (allowed.has(key(n))) continue;
      // No connection to foreign or own dust/components beside, above-diagonal or below-diagonal
      if (connectsTo(n, d) || cells.has(key(n))) return false;
      if (!roofed && (foreign(add(n, UP))?.id === "minecraft:redstone_wire" || cells.has(key(add(n, UP)))) && !allowed.has(key(add(n, UP)))) return false;
      if (!isSolid(n) && (foreign(add(n, DOWN))?.id === "minecraft:redstone_wire" || cells.has(key(add(n, DOWN))))) {
        if (!allowed.has(key(add(n, DOWN)))) return false;
      }
    }
    // Where this dust points: along its line (or everywhere for a lone end): nothing that reacts there
    const pointed: Vec3[] = [];
    const conn = [prev, next].filter((x): x is Vec3 => !!x && x[1] === p[1]);
    if (conn.length === 1) pointed.push(add(p, sub(p, conn[0]!)));
    if (conn.length === 0) for (const d of HORIZONTAL) pointed.push(add(p, DIR_VECTORS[d]));
    for (const c of pointed) if (!allowed.has(key(c)) && reacts(c)) return false;
    return true;
  };

  // Every element costs at least 2, one per cell of distance
  const h = (p: Vec3) => 2 * (Math.abs(p[0] - target[0]) + Math.abs(p[1] - target[1]) + Math.abs(p[2] - target[2]) - 1);
  const open: Node[] = [];
  const push = (n: Node) => {
    // Binary heap on f
    open.push(n);
    let i = open.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (open[pi]!.f <= open[i]!.f) break;
      [open[pi], open[i]] = [open[i]!, open[pi]!];
      i = pi;
    }
  };
  const pop = (): Node | undefined => {
    const top = open[0];
    const last = open.pop();
    if (open.length && last) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < open.length && open[l]!.f < open[m]!.f) m = l;
        if (r < open.length && open[r]!.f < open[m]!.f) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i]!, open[m]!];
        i = m;
      }
    }
    return top;
  };
  // A state is dominated by one at the same place that got there no dearer with no less strength
  const seen = new Map<string, Array<{ g: number; out: number }>>();
  const add0 = (el: WireElement, dir: HorizontalDir, out: number, g: number, parent: Node | undefined) => {
    const k = `${key(el.pos)}|${el.kind}|${dir}`;
    const list = seen.get(k) ?? [];
    if (list.some((x) => x.g <= g && x.out >= out)) return;
    seen.set(k, [...list.filter((x) => !(x.g >= g && x.out <= out)), { g, out }]);
    push({ el, dir, out, g, f: g + h(el.pos), parent });
  };

  // Start: dust in the start cell, or a repeater pointing away from a diode source
  if (free(start)) {
    for (const d of HORIZONTAL) add0({ pos: start, kind: "dust" }, d, strength0, 2, undefined);
    if (sourceDir) add0({ pos: start, kind: "repeater", towards: sourceDir, delay: 1 }, sourceDir, 15, 4, undefined);
  } else {
    return { ok: false, message: `wire: the start cell (${start.join(",")}) is occupied.` };
  }

  let nodes = 0;
  while (open.length && nodes < maxNodes) {
    const cur = pop()!;
    nodes++;
    const path = pathOf(cur);
    const before = path.slice(0, -1);
    const prevPos = cur.parent?.el.pos;
    // Goal: this element points into the target
    const towards = (d: HorizontalDir) => eq(add(cur.el.pos, DIR_VECTORS[d]), target);
    // Dust points into the target if it runs straight at it (or arrives by a stair, then it is a cross)
    const aim =
      cur.el.kind === "repeater"
        ? cur.el.towards
        : HORIZONTAL.find(
            (d) =>
              towards(d) &&
              (prevPos ? prevPos[1] !== cur.el.pos[1] || eq(sub(cur.el.pos, prevPos), DIR_VECTORS[d]) : !sourceDir || sourceDir === d),
          );
    if (aim && towards(aim) && cur.out >= 1 && valid(cur.el, prevPos, target, before)) {
      return finish(path, opts.minDelayTicks ?? 0);
    }
    // Or dust lying on the target powers it from above
    if (cur.el.kind === "dust" && eq(cur.el.pos, add(target, UP)) && cur.out >= 1 && valid(cur.el, prevPos, add(cur.el.pos, DIR_VECTORS[cur.dir]), before)) {
      return finish(path, opts.minDelayTicks ?? 0);
    }
    const moves: Array<{ el: WireElement; dir: HorizontalDir; out: number; cost: number }> = [];
    const dirs = cur.el.kind === "repeater" ? [cur.el.towards] : HORIZONTAL.filter((d) => !prevPos || !eq(add(cur.el.pos, DIR_VECTORS[d]), prevPos));
    for (const d of dirs) {
      const flat = add(cur.el.pos, DIR_VECTORS[d]);
      if (cur.el.kind === "repeater" || cur.out >= 2) moves.push({ el: { pos: flat, kind: "dust" }, dir: d, out: cur.el.kind === "repeater" ? 15 : cur.out - 1, cost: 2 });
      moves.push({ el: { pos: flat, kind: "repeater", towards: d, delay: 1 }, dir: d, out: 15, cost: 4 });
      if (cur.el.kind === "dust" && cur.out >= 2) {
        // Up: the next dust sits on a block beside this one; nothing solid above this dust
        const up = add(flat, UP);
        if (free(add(cur.el.pos, UP))) moves.push({ el: { pos: up, kind: "dust" }, dir: d, out: cur.out - 1, cost: 3 });
        // Down: the cell beside stays air
        const down = add(flat, DOWN);
        if (free(flat)) moves.push({ el: { pos: down, kind: "dust" }, dir: d, out: cur.out - 1, cost: 3 });
      }
    }
    for (const m of moves) {
      if (!inBox(m.el.pos)) continue;
      if (eq(m.el.pos, target)) continue;
      // Dust on top of the target: its support is the target itself
      if (eq(m.el.pos, add(target, UP)) && m.el.kind === "dust") {
        if (!valid(cur.el, prevPos, m.el.pos, before)) continue;
        add0(m.el, m.dir, m.out, cur.g + m.cost, cur);
        continue;
      }
      // Validate the current element now that its successor is known, and the new one as far as possible
      if (!valid(cur.el, prevPos, m.el.pos, before)) continue;
      if (!free(m.el.pos)) continue;
      add0(m.el, m.dir, m.out, cur.g + m.cost, cur);
    }
  }
  return { ok: false, message: nodes >= maxNodes ? `wire: no route within ${maxNodes} nodes.` : "wire: no route (blocked, or every way would touch foreign redstone)." };

  function finish(path: readonly Node[], minDelay: number): WireResult {
    let elements = path.map((n) => n.el);
    // Supports to place: not where a block already carries the element
    const supports = elements.map((e) => add(e.pos, DOWN)).filter((p) => free(p) && !eq(p, target));
    const clear: Vec3[] = [];
    for (let i = 1; i < elements.length; i++) {
      const a = elements[i - 1]!.pos;
      const b = elements[i]!.pos;
      if (b[1] > a[1]) clear.push(add(a, UP));
      if (b[1] < a[1]) clear.push(add(b, UP));
    }
    const ticks = (els: readonly WireElement[]) => els.reduce((t, e) => t + (e.kind === "repeater" ? 2 * e.delay : 0), 0);
    // Delay: first lengthen repeaters, then turn straight dust into repeaters
    const raise = () => {
      for (let i = 0; i < elements.length && ticks(elements) < minDelay; i++) {
        const e = elements[i]!;
        if (e.kind === "repeater" && e.delay < 4) {
          elements = elements.map((x, j) => (j === i ? { ...e, delay: Math.min(4, e.delay + Math.ceil((minDelay - ticks(elements)) / 2)) as 1 | 2 | 3 | 4 } : x));
        }
      }
    };
    raise();
    for (let i = 1; i < elements.length - 1 && ticks(elements) < minDelay; i++) {
      const e = elements[i]!;
      const a = elements[i - 1]!.pos;
      const c = elements[i + 1]!.pos;
      if (e.kind !== "dust" || a[1] !== e.pos[1] || c[1] !== e.pos[1]) continue;
      const d = HORIZONTAL.find((x) => eq(sub(e.pos, a), DIR_VECTORS[x]) && eq(sub(c, e.pos), DIR_VECTORS[x]));
      if (!d) continue;
      elements = elements.map((x, j) => (j === i ? { pos: e.pos, kind: "repeater" as const, towards: d, delay: 1 as const } : x));
      raise();
    }
    if (ticks(elements) < minDelay) return { ok: false, message: `wire: the shortest wire delays ${ticks(elements)} game ticks, ${minDelay} asked for – too short a path for that delay.` };
    // Strength at the target
    let s = strength0;
    for (const e of elements) s = e.kind === "repeater" ? 15 : e === elements[0] ? s : s - 1;
    return { ok: true, elements, supports, clear, delayTicks: ticks(elements), strength: s };
  }
}
