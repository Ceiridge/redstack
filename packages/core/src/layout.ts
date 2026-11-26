/**
 * Layout search: where the free components of a design go and which way they
 * face, so that nothing overlaps, reserved space stays free, ports that must
 * touch do touch, and the whole thing is as compact and cheap as possible.
 *
 * Model: every free item has candidate placements (a rotation and an origin
 * inside a box). Hard constraints: no block on another block or on a cell
 * someone keeps clear; "touch" links (an output's target cell lies on an
 * input). Soft part, the objective: bounding-box volume and the number of
 * hoppers the router needs for "route" links.
 *
 * Solver: depth-first branch and bound. Items are placed in link order –
 * first what touches a fixed part, then what touches a placed item, then
 * what is routed to one; candidates come from the links where possible (an item that touches
 * a placed one has only a handful of positions), ordered by their lower
 * bound. Lower bound = volume so far + the hoppers every route needs at least
 * (Manhattan distance). Every candidate the search descends into is scored
 * by the caller, which runs the router for the links whose ends are placed.
 * Within the node limit the search is exhaustive and the result optimal for
 * the objective; beyond it the best layout found is improved by moving one
 * item at a time to its best spot, and returned as not proven optimal.
 *
 * The model is deliberately solver-agnostic (items × candidates, pairwise
 * conflicts, linear objective) so a SAT/CP-SAT backend can replace the search
 * once designs outgrow it.
 */

import { type Rotation, type Vec3, add, key } from "./geometry.js";

/** An item's geometry for one rotation, relative to its origin. */
export interface Shape {
  readonly blocks: readonly Vec3[];
  readonly clear: readonly Vec3[];
  /** Port cells: for inputs the accepting cells, for outputs the target cells */
  readonly ports: ReadonlyMap<string, readonly Vec3[]>;
}

export interface FreeItem {
  readonly id: string;
  readonly options: ReadonlyArray<{ readonly rotation: Rotation; readonly shape: Shape }>;
  /** Range for the origin (inclusive) */
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A port of a free item, or fixed cells. */
export type LayoutEnd = { readonly item: string; readonly port: string } | { readonly cells: readonly Vec3[] };

export interface LayoutLink {
  /** touch: some output target cell lies on the input; route: connected by routed hoppers */
  readonly kind: "touch" | "route";
  readonly from: LayoutEnd;
  readonly to: LayoutEnd;
}

export interface LayoutPlacement {
  readonly origin: Vec3;
  readonly rotation: Rotation;
}

export interface LayoutProblem {
  /** Blocks and reserved cells that are already fixed */
  readonly fixedBlocks: readonly Vec3[];
  readonly fixedClear: readonly Vec3[];
  readonly items: readonly FreeItem[];
  readonly links: readonly LayoutLink[];
  readonly weights?: { readonly volume?: number; readonly hoppers?: number };
  /** How far a routed item may be from its partner (blocks, per axis); default 4 */
  readonly routeRadius?: number;
  /** Search budget; default 5,000 nodes */
  readonly maxNodes?: number;
  /**
   * Routes every link whose ends are placed (in a partial layout too) and
   * returns the hoppers needed and the cells they use, or undefined if a
   * route is impossible. Called for each candidate the search descends into,
   * so dead ends are cut early and the bound is exact for routed links.
   */
  readonly evaluate: (placements: ReadonlyMap<string, LayoutPlacement>) => { readonly hoppers: number; readonly cells: readonly Vec3[] } | undefined;
}

export interface LayoutFailure {
  readonly placements?: undefined;
  readonly nodes: number;
  /** True: there is no layout (search complete). False: none found within the budget. */
  readonly impossible: boolean;
}

export interface LayoutSolution {
  readonly placements: ReadonlyMap<string, LayoutPlacement>;
  readonly cost: number;
  readonly volume: number;
  readonly hoppers: number;
  readonly nodes: number;
  /** True if the search finished within its budget: the layout is optimal for the objective */
  readonly optimal: boolean;
}

interface Candidate {
  readonly item: FreeItem;
  readonly placement: LayoutPlacement;
  readonly blocks: readonly Vec3[];
  readonly blockKeys: readonly string[];
  readonly clearKeys: readonly string[];
  readonly ports: ReadonlyMap<string, readonly Vec3[]>;
}

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

const volume = (b: Box | undefined) => (b ? (b.max[0] - b.min[0] + 1) * (b.max[1] - b.min[1] + 1) * (b.max[2] - b.min[2] + 1) : 0);

function grow(b: Box | undefined, cells: readonly Vec3[]): Box | undefined {
  let out = b ? { min: [...b.min] as Box["min"], max: [...b.max] as Box["max"] } : undefined;
  for (const c of cells) {
    if (!out) out = { min: [c[0], c[1], c[2]], max: [c[0], c[1], c[2]] };
    for (let i = 0; i < 3; i++) {
      out.min[i] = Math.min(out.min[i]!, c[i]!);
      out.max[i] = Math.max(out.max[i]!, c[i]!);
    }
  }
  return out;
}

function candidate(item: FreeItem, option: FreeItem["options"][number], origin: Vec3): Candidate {
  const tr = (v: Vec3) => add(origin, v);
  const blocks = option.shape.blocks.map(tr);
  const ports = new Map<string, Vec3[]>();
  for (const [n, cells] of option.shape.ports) ports.set(n, cells.map(tr));
  return {
    item,
    placement: { origin, rotation: option.rotation },
    blocks,
    blockKeys: blocks.map(key),
    clearKeys: option.shape.clear.map((c) => key(tr(c))),
    ports,
  };
}

/** Lower bound on the hoppers of a route: one per cell from the start to a cell next to the target. */
function routeBound(starts: readonly Vec3[], targets: readonly Vec3[]): number {
  let best = Infinity;
  for (const s of starts)
    for (const t of targets) {
      if (s[1] < t[1]) continue; // upward: impossible
      const dx = Math.abs(s[0] - t[0]);
      const dz = Math.abs(s[2] - t[2]);
      const dy = s[1] - t[1];
      // the last hopper sits beside the target (dx+dz ≥ 1) or on top of it (dy ≥ 1)
      best = Math.min(best, Math.max(1, dx + dz + dy));
    }
  return best;
}

export function solveLayout(p: LayoutProblem): LayoutSolution | LayoutFailure {
  const wV = p.weights?.volume ?? 1;
  const wH = p.weights?.hoppers ?? 5;
  const radius = p.routeRadius ?? 4;
  const maxNodes = p.maxNodes ?? 5_000;

  const blocked = new Map<string, number>(); // cell → number of blocks
  const reserved = new Map<string, number>(); // cell → number of clear reservations
  const inc = (m: Map<string, number>, k: string, d: number) => {
    const v = (m.get(k) ?? 0) + d;
    if (v === 0) m.delete(k);
    else m.set(k, v);
  };
  for (const b of p.fixedBlocks) inc(blocked, key(b), 1);
  for (const c of p.fixedClear) inc(reserved, key(c), 1);
  const fixedBox = grow(undefined, p.fixedBlocks);

  const placed = new Map<string, Candidate>();
  const endCells = (e: LayoutEnd): readonly Vec3[] | undefined => ("cells" in e ? e.cells : placed.get(e.item)?.ports.get(e.port));
  const itemOf = (e: LayoutEnd) => ("item" in e ? e.item : undefined);

  const fits = (c: Candidate) =>
    c.blockKeys.every((k) => !blocked.has(k) && !reserved.has(k)) && c.clearKeys.every((k) => !blocked.has(k));

  /** Links between `item` and what is placed (or fixed), checked/scored for a candidate. */
  const linkCheck = (c: Candidate): number | undefined => {
    let bound = 0;
    placed.set(c.item.id, c);
    try {
      for (const l of p.links) {
        const ids = [itemOf(l.from), itemOf(l.to)];
        if (!ids.includes(c.item.id)) continue;
        const from = endCells(l.from);
        const to = endCells(l.to);
        if (!from || !to) continue;
        if (l.kind === "touch") {
          const accept = new Set(to.map(key));
          if (!from.some((t) => accept.has(key(t)))) return undefined;
        } else {
          const b = routeBound(from, to);
          if (!Number.isFinite(b)) return undefined;
          bound += b;
        }
      }
      return bound;
    } finally {
      placed.delete(c.item.id);
    }
  };

  /** Candidate origins for an item: from its links to placed items where possible, else its whole box. */
  const candidatesFor = (item: FreeItem): Candidate[] => {
    const out: Candidate[] = [];
    const inBox = (o: Vec3) => o.every((v, i) => v >= item.min[i]! && v <= item.max[i]!);
    const seen = new Set<string>();
    const push = (opt: FreeItem["options"][number], o: Vec3) => {
      const k = `${opt.rotation}|${key(o)}`;
      if (seen.has(k) || !inBox(o)) return;
      seen.add(k);
      const c = candidate(item, opt, o);
      if (fits(c)) out.push(c);
    };
    // A touch link to something placed pins the item down to a few positions
    for (const l of p.links) {
      if (l.kind !== "touch") continue;
      const mineFrom = itemOf(l.from) === item.id;
      const mineTo = itemOf(l.to) === item.id;
      if (!mineFrom && !mineTo) continue;
      const other = endCells(mineFrom ? l.to : l.from);
      if (!other) continue;
      const port = (mineFrom ? l.from : l.to) as { item: string; port: string };
      for (const opt of item.options) {
        const local = opt.shape.ports.get(port.port) ?? [];
        for (const a of local) for (const b of other) push(opt, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      }
      return out;
    }
    // A route link to something placed keeps the item within reach
    for (const l of p.links) {
      if (l.kind !== "route") continue;
      const mine = itemOf(l.from) === item.id ? l.from : itemOf(l.to) === item.id ? l.to : undefined;
      if (!mine) continue;
      const other = endCells(mine === l.from ? l.to : l.from);
      if (!other?.length) continue;
      const anchor = other[0]!;
      for (const opt of item.options) {
        const local = opt.shape.ports.get((mine as { port: string }).port)?.[0] ?? [0, 0, 0];
        for (let dy = -radius; dy <= radius; dy++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) push(opt, [anchor[0] + dx - local[0], anchor[1] + dy - local[1], anchor[2] + dz - local[2]]);
      }
      return out;
    }
    for (const opt of item.options)
      for (let y = item.min[1]; y <= item.max[1]; y++)
        for (let z = item.min[2]; z <= item.max[2]; z++) for (let x = item.min[0]; x <= item.max[0]; x++) push(opt, [x, y, z]);
    return out;
  };

  let best: { cost: number; volume: number; hoppers: number; placements: Map<string, LayoutPlacement> } | undefined;
  let nodes = 0;
  let exhausted = true;

  const routeBoundAll = () => {
    let b = 0;
    for (const l of p.links) {
      if (l.kind !== "route") continue;
      const from = endCells(l.from);
      const to = endCells(l.to);
      if (from && to) b += routeBound(from, to);
    }
    return b;
  };

  // Placement order: what touches something known first, then what is routed to something known
  const order: FreeItem[] = [];
  {
    const known = (e: LayoutEnd) => !("item" in e) || order.some((i) => i.id === e.item);
    const linkedTo = (it: FreeItem, kind: LayoutLink["kind"]) =>
      p.links.some(
        (l) => l.kind === kind && ((itemOf(l.from) === it.id && known(l.to)) || (itemOf(l.to) === it.id && known(l.from))),
      );
    while (order.length < p.items.length) {
      const rest = p.items.filter((i) => !order.includes(i));
      order.push(rest.find((i) => linkedTo(i, "touch")) ?? rest.find((i) => linkedTo(i, "route")) ?? rest[0]!);
    }
  }

  const search = (box: Box | undefined): void => {
    const item = order[placed.size]!;
    const cands: Array<{ c: Candidate; bound: number; box: Box | undefined }> = [];
    for (const c of candidatesFor(item)) {
      if (linkCheck(c) === undefined) continue;
      cands.push({ c, box: grow(box, c.blocks), bound: 0 });
    }
    for (const x of cands) {
      placed.set(item.id, x.c);
      x.bound = wV * volume(x.box) + wH * routeBoundAll();
      placed.delete(item.id);
    }
    cands.sort((a, b) => a.bound - b.bound);
    for (const x of cands) {
      if (best && x.bound >= best.cost) break; // sorted: the rest is no better
      if (nodes >= maxNodes) {
        exhausted = false;
        break;
      }
      nodes++;
      placed.set(item.id, x.c);
      const placements = new Map([...placed].map(([id, c]) => [id, c.placement]));
      const routed = p.evaluate(placements);
      if (routed) {
        // Exact cost of the routed links so far
        const v = volume(grow(x.box, routed.cells));
        const cost = wV * v + wH * routed.hoppers;
        if (placed.size === order.length) {
          if (!best || cost < best.cost) best = { cost, volume: v, hoppers: routed.hoppers, placements };
        } else if (!best || cost < best.cost) {
          for (const k of x.c.blockKeys) inc(blocked, k, 1);
          for (const k of x.c.clearKeys) inc(reserved, k, 1);
          search(x.box);
          for (const k of x.c.blockKeys) inc(blocked, k, -1);
          for (const k of x.c.clearKeys) inc(reserved, k, -1);
        }
      }
      placed.delete(item.id);
    }
  };

  if (order.length === 0) return { placements: new Map(), cost: 0, volume: volume(fixedBox), hoppers: 0, nodes: 0, optimal: true };
  search(fixedBox);
  if (!best) return { nodes, impossible: exhausted };

  // Improvement passes (when the search did not finish): move one item at a
  // time to its best position with all others fixed, until nothing improves.
  // Fixes the typical weakness of depth-first search: an early item that was
  // placed well for the partial layout but badly for the final one.
  if (!exhausted) {
    const current = new Map<string, Candidate>();
    for (const it of order) {
      const pl = best.placements.get(it.id)!;
      const opt = it.options.find((o) => o.rotation === pl.rotation)!;
      current.set(it.id, candidate(it, opt, pl.origin));
    }
    const occupy = (c: Candidate, d: 1 | -1) => {
      for (const k of c.blockKeys) inc(blocked, k, d);
      for (const k of c.clearKeys) inc(reserved, k, d);
    };
    for (const c of current.values()) occupy(c, 1);
    for (let pass = 0, improved = true; improved && pass < 5; pass++) {
      improved = false;
      for (const it of order) {
        const mine = current.get(it.id)!;
        occupy(mine, -1);
        current.delete(it.id);
        placed.clear();
        for (const [id, c] of current) placed.set(id, c);
        let box = fixedBox;
        for (const c of current.values()) box = grow(box, c.blocks);
        const cands = candidatesFor(it)
          .filter((c) => linkCheck(c) !== undefined)
          .map((c) => {
            placed.set(it.id, c);
            const b = grow(box, c.blocks);
            const bound = wV * volume(b) + wH * routeBoundAll();
            placed.delete(it.id);
            return { c, b, bound };
          })
          .sort((a, b) => a.bound - b.bound);
        let chosen = mine;
        for (const x of cands) {
          if (x.bound >= best.cost) break;
          nodes++;
          placed.set(it.id, x.c);
          const placements = new Map([...placed].map(([id, c]) => [id, c.placement]));
          const routed = p.evaluate(placements);
          placed.delete(it.id);
          if (!routed) continue;
          const v = volume(grow(x.b, routed.cells));
          const cost = wV * v + wH * routed.hoppers;
          if (cost < best.cost) {
            best = { cost, volume: v, hoppers: routed.hoppers, placements };
            chosen = x.c;
            improved = true;
          }
        }
        current.set(it.id, chosen);
        occupy(chosen, 1);
      }
    }
    placed.clear();
  }
  return { placements: best.placements, cost: best.cost, volume: best.volume, hoppers: best.hoppers, nodes, optimal: exhausted };
}
