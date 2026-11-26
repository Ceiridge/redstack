/**
 * A small exact solver for mixed-integer linear programs:
 *
 *   maximise c·x  subject to  A x ≤ b,  x ≥ 0,  x_j integer for j in `integers`
 *
 * Two-phase simplex (dense tableau, Bland's rule against cycling) for the LP
 * relaxations, depth-first branch and bound for the integers. Meant for the
 * planning problems here – tens of variables, not thousands – so it stays
 * dependency-free and easy to check. Every result is verified against the
 * constraints before it is returned.
 */

export interface Milp {
  readonly c: readonly number[];
  readonly A: readonly (readonly number[])[];
  readonly b: readonly number[];
  readonly integers?: ReadonlySet<number>;
}

export type MilpResult =
  | { readonly status: "optimal"; readonly x: readonly number[]; readonly value: number; readonly nodes: number }
  | { readonly status: "infeasible" | "unbounded"; readonly nodes: number }
  | { readonly status: "limit"; readonly x?: readonly number[]; readonly value?: number; readonly nodes: number };

const EPS = 1e-9;

type LpResult = { status: "optimal"; x: number[]; value: number } | { status: "infeasible" } | { status: "unbounded" };

/** Two-phase simplex for max c·x, A x ≤ b, x ≥ 0 (b of any sign). */
export function solveLp(c: readonly number[], A: readonly (readonly number[])[], b: readonly number[]): LpResult {
  const m = A.length;
  const n = c.length;
  // Columns: n originals, m slacks (±1), then artificials for rows with b < 0
  const neg = b.map((v) => v < -EPS);
  const nArt = neg.filter(Boolean).length;
  const cols = n + m + nArt;
  const T: number[][] = [];
  const basis: number[] = [];
  let art = 0;
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(cols + 1).fill(0);
    const sign = neg[i] ? -1 : 1;
    for (let j = 0; j < n; j++) row[j] = sign * (A[i]![j] ?? 0);
    row[n + i] = sign; // slack (becomes surplus when the row is flipped)
    row[cols] = sign * b[i]!;
    if (neg[i]) {
      row[n + m + art] = 1;
      basis.push(n + m + art);
      art++;
    } else basis.push(n + i);
    T.push(row);
  }

  const pivot = (r: number, col: number) => {
    const pr = T[r]!;
    const pv = pr[col]!;
    for (let j = 0; j <= cols; j++) pr[j]! /= pv;
    for (let i = 0; i < T.length; i++) {
      if (i === r) continue;
      const row = T[i]!;
      const f = row[col]!;
      if (Math.abs(f) < EPS) continue;
      for (let j = 0; j <= cols; j++) row[j]! -= f * pr[j]!;
    }
    basis[r] = col;
  };

  /** Maximises obj·x over the current tableau; columns >= `limit` may not enter. */
  const run = (obj: readonly number[], limit: number): "optimal" | "unbounded" => {
    for (let iter = 0; iter < 10_000; iter++) {
      // Reduced costs: obj_j - obj_B · column_j
      let enter = -1;
      for (let j = 0; j < limit; j++) {
        if (basis.includes(j)) continue;
        let rc = obj[j] ?? 0;
        for (let i = 0; i < m; i++) rc -= (obj[basis[i]!] ?? 0) * T[i]![j]!;
        if (rc > EPS) {
          enter = j; // Bland: smallest index
          break;
        }
      }
      if (enter < 0) return "optimal";
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const a = T[i]![enter]!;
        if (a <= EPS) continue;
        const ratio = T[i]![cols]! / a;
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i]! < basis[leave]!)) {
          best = ratio;
          leave = i;
        }
      }
      if (leave < 0) return "unbounded";
      pivot(leave, enter);
    }
    throw new Error("simplex: iteration limit (cycling?)");
  };

  if (nArt > 0) {
    // Phase 1: minimise the artificials (= maximise their negative sum)
    const obj1 = new Array<number>(cols).fill(0);
    for (let k = 0; k < nArt; k++) obj1[n + m + k] = -1;
    run(obj1, cols);
    const infeas = basis.reduce((s, j, i) => s + (j >= n + m ? T[i]![cols]! : 0), 0);
    if (infeas > 1e-7) return { status: "infeasible" };
    // Drive remaining (zero) artificials out of the basis
    for (let i = 0; i < m; i++) {
      if (basis[i]! < n + m) continue;
      const j = T[i]!.findIndex((v, k) => k < n + m && Math.abs(v) > EPS);
      if (j >= 0) pivot(i, j);
    }
  }
  const status = run(c, n + m);
  if (status === "unbounded") return { status };
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i]! < n) x[basis[i]!] = T[i]![cols]!;
  return { status: "optimal", x, value: c.reduce((s, cj, j) => s + cj * x[j]!, 0) };
}

/** Branch and bound over the integer variables. */
export function solveMilp(p: Milp, opts: { readonly maxNodes?: number } = {}): MilpResult {
  const ints = p.integers ?? new Set<number>();
  const maxNodes = opts.maxNodes ?? 20_000;
  let best: { x: number[]; value: number } | undefined;
  let nodes = 0;
  let unbounded = false;
  let limited = false;

  // Each node adds bound rows: x_j ≤ u  or  −x_j ≤ −l
  const visit = (extraA: number[][], extraB: number[]) => {
    if (nodes >= maxNodes) {
      limited = true;
      return;
    }
    nodes++;
    const r = solveLp(p.c, [...p.A, ...extraA], [...p.b, ...extraB]);
    if (r.status === "infeasible") return;
    if (r.status === "unbounded") {
      unbounded = true;
      return;
    }
    if (best && r.value <= best.value + 1e-7) return; // bound
    let branch = -1;
    let frac = 0;
    for (const j of ints) {
      const f = Math.abs(r.x[j]! - Math.round(r.x[j]!));
      if (f > 1e-6 && f > frac) {
        frac = f;
        branch = j;
      }
    }
    if (branch < 0) {
      const x = r.x.map((v, j) => (ints.has(j) ? Math.round(v) : v));
      best = { x, value: p.c.reduce((s, cj, j) => s + cj * x[j]!, 0) };
      return;
    }
    const v = r.x[branch]!;
    const unit = (sign: number) => p.c.map((_, j) => (j === branch ? sign : 0));
    // Try the rounded-up side first: plans with more of something are usually the better ones
    visit([...extraA, unit(-1)], [...extraB, -Math.ceil(v)]);
    visit([...extraA, unit(1)], [...extraB, Math.floor(v)]);
  };
  visit([], []);

  if (unbounded && !best) return { status: "unbounded", nodes };
  if (!best) return limited ? { status: "limit", nodes } : { status: "infeasible", nodes };
  // Verify before trusting it
  for (let i = 0; i < p.A.length; i++) {
    const lhs = p.A[i]!.reduce((s, a, j) => s + a * best!.x[j]!, 0);
    if (lhs > p.b[i]! + 1e-6) throw new Error(`MILP solution violates row ${i}: ${lhs} > ${p.b[i]}`);
  }
  if (best.x.some((v) => v < -1e-6)) throw new Error("MILP solution has a negative variable");
  return limited ? { status: "limit", x: best.x, value: best.value, nodes } : { status: "optimal", x: best.x, value: best.value, nodes };
}
