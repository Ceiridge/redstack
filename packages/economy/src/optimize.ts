/**
 * Plan optimizer: how many of each process to run at which site, for the
 * highest profit per hour – as a mixed-integer linear program.
 *
 * Variables: count per process and site (integer), sold and bought amount per
 * item, whether an item is sold or bought (0/1), whether an AFK site is used (0/1).
 * Constraints: inputs are produced by other processes or bought; sales stay
 * within what the market absorbs; mob cap per site (hard: ≤ 100 %, so mob
 * farms do not starve each other); load budget per site; AFK sites ≤ accounts.
 * Objective: revenue − purchases − build cost spread over `horizonHours`.
 *
 * The result is re-checked with evaluatePlan, the same function that rates
 * hand-made plans, so the two cannot drift apart unnoticed.
 */

import { type EvaluationContext, type Optimizer, type Plan, type PlanEvaluation, evaluatePlan } from "./index.js";
import { solveMilp } from "./milp.js";

export interface OptimizeOptions {
  /** Upper bound per process and site */
  readonly maxCountPerProcess: number;
  /** Per-process upper bound, overriding maxCountPerProcess */
  readonly maxCount?: (processId: string) => number | undefined;
  /** Spread build cost over this many hours of running (default: ignore build cost) */
  readonly horizonHours?: number;
  /** Which sites a process may run at (default: all) */
  readonly allowedSites?: (processId: string, siteId: string) => boolean;
  /** Branch-and-bound budget */
  readonly maxNodes?: number;
}

export interface OptimizedPlan {
  readonly plan: Plan;
  readonly evaluation: PlanEvaluation;
  /** Objective value of the program (profit per hour minus build cost per hour) */
  readonly objective: number;
  /** False if the search budget ran out before optimality was proven */
  readonly optimal: boolean;
}

export function optimizePlan(ctx: EvaluationContext, o: OptimizeOptions): OptimizedPlan {
  const processes = [...ctx.processes.values()];
  const sites = [...ctx.sites.values()];
  const items = [...new Set(processes.flatMap((p) => [...Object.keys(p.inputsPerHour), ...Object.keys(p.outputsPerHour)]))];

  // Variable layout
  const counts: Array<{ p: (typeof processes)[number]; s: (typeof sites)[number]; j: number }> = [];
  let n = 0;
  for (const p of processes) for (const s of sites) if (o.allowedSites?.(p.id, s.id) ?? true) counts.push({ p, s, j: n++ });
  const sell = new Map(items.map((i) => [i, n++]));
  const buy = new Map(items.map((i) => [i, n++]));
  const used = new Map(sites.filter((s) => s.needsAccount).map((s) => [s.id, n++]));
  // Per item: 1 = sell surplus, 0 = buy shortfall. Without it the program would
  // buy cheap and resell dear – an arbitrage the plan evaluation does not do.
  const sells = new Map(items.map((i) => [i, n++]));

  const c = new Array<number>(n).fill(0);
  const A: number[][] = [];
  const b: number[] = [];
  const row = (coefs: ReadonlyArray<readonly [number, number]>, rhs: number) => {
    const r = new Array<number>(n).fill(0);
    for (const [j, v] of coefs) r[j]! += v;
    A.push(r);
    b.push(rhs);
  };

  // Objective
  for (const i of items) {
    const q = ctx.quotes.get(i);
    if (q?.sellPrice !== undefined) c[sell.get(i)!] = q.sellPrice;
    if (q?.buyPrice !== undefined) c[buy.get(i)!] = -q.buyPrice;
  }
  if (o.horizonHours) {
    for (const { p, j } of counts) {
      let value = 0;
      for (const [item, k] of Object.entries(p.buildCost ?? {})) value += k * (ctx.quotes.get(item)?.buyPrice ?? 0);
      c[j]! -= value / o.horizonHours;
    }
  }

  // Item balance: sell ≤ produced − used + bought;  used ≤ produced + bought
  for (const i of items) {
    const net = counts.map(({ p, j }) => [j, (p.outputsPerHour[i] ?? 0) - (p.inputsPerHour[i] ?? 0)] as const);
    row([[sell.get(i)!, 1], [buy.get(i)!, -1], ...net.map(([j, v]) => [j, -v] as const)], 0);
    row([[buy.get(i)!, -1], ...net.map(([j, v]) => [j, -v] as const)], 0);
    const q = ctx.quotes.get(i);
    row([[sell.get(i)!, 1]], q?.sellPrice === undefined ? 0 : (q.maxSellPerHour ?? 1e12));
    if (q?.buyPrice === undefined) row([[buy.get(i)!, 1]], 0);
    const big =
      1 + sites.length * processes.reduce((t, p) => t + (o.maxCount?.(p.id) ?? o.maxCountPerProcess) * ((p.outputsPerHour[i] ?? 0) + (p.inputsPerHour[i] ?? 0)), 0);
    row([[sell.get(i)!, 1], [sells.get(i)!, -big]], 0);
    row([[buy.get(i)!, 1], [sells.get(i)!, big]], big);
    row([[sells.get(i)!, 1]], 1);
  }

  for (const s of sites) {
    const here = counts.filter((x) => x.s.id === s.id);
    // Mob caps
    for (const share of ["hostileMobCapShare", "passiveMobCapShare"] as const) {
      const coefs = here.filter((x) => (x.p.site[share] ?? 0) > 0).map((x) => [x.j, x.p.site[share]!] as const);
      if (coefs.length) row(coefs, 1);
    }
    // Load budget
    if (s.msptBudget !== undefined) {
      const coefs = here.filter((x) => (x.p.site.msptCost ?? 0) > 0).map((x) => [x.j, x.p.site.msptCost!] as const);
      if (coefs.length) row(coefs, s.msptBudget);
    }
    // A process runs at an AFK site only if the site is used by an account
    const u = used.get(s.id);
    for (const x of here) {
      const max = o.maxCount?.(x.p.id) ?? o.maxCountPerProcess;
      row([[x.j, 1]], max);
      if (u !== undefined) row([[x.j, 1], [u, -max]], 0);
    }
    if (u !== undefined) row([[u, 1]], 1);
  }
  if (used.size) row([...used.values()].map((j) => [j, 1] as const), ctx.accounts);

  const integers = new Set([...counts.map((x) => x.j), ...used.values(), ...sells.values()]);
  const r = solveMilp({ c, A, b, integers }, o.maxNodes !== undefined ? { maxNodes: o.maxNodes } : {});
  if (r.status === "infeasible" || r.status === "unbounded") throw new Error(`Plan optimisation: ${r.status}.`);
  if (!("x" in r) || !r.x) throw new Error("Plan optimisation: no plan found within the search budget.");
  const x = r.x;
  const plan: Plan = {
    entries: counts.filter(({ j }) => Math.round(x[j]!) > 0).map(({ p, s, j }) => ({ processId: p.id, siteId: s.id, count: Math.round(x[j]!) })),
  };
  return { plan, evaluation: evaluatePlan(plan, ctx), objective: r.value ?? 0, optimal: r.status === "optimal" };
}

export const milpOptimizer: Optimizer = {
  id: "milp",
  optimize: (ctx, options) => optimizePlan(ctx, options).plan,
};
