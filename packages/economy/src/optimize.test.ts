import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type EvaluationContext, type Plan, type Process, type Quote, type Site, evaluatePlan, optimizePlan, solveLp, solveMilp } from "./index.js";

describe("simplex and branch and bound", () => {
  it("solves a textbook LP", () => {
    // max 3x + 5y, x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18 → x=2, y=6, 36
    const r = solveLp([3, 5], [[1, 0], [0, 2], [3, 2]], [4, 12, 18]);
    assert.equal(r.status, "optimal");
    assert.ok(r.status === "optimal" && Math.abs(r.value - 36) < 1e-9);
  });

  it("handles ≥ rows (negative right-hand sides) and detects infeasibility", () => {
    // max −x − y, x + y ≥ 3 → value −3
    const r = solveLp([-1, -1], [[-1, -1]], [-3]);
    assert.ok(r.status === "optimal" && Math.abs(r.value + 3) < 1e-9);
    assert.equal(solveLp([1], [[1], [-1]], [1, -2]).status, "infeasible");
  });

  it("finds the integer optimum where rounding the LP would be wrong", () => {
    // max 5x + 4y, 6x + 4y ≤ 24, x + 2y ≤ 6, integers → x=4, y=0 → 20 (LP: 21 at 3, 1.5)
    const r = solveMilp({ c: [5, 4], A: [[6, 4], [1, 2]], b: [24, 6], integers: new Set([0, 1]) });
    assert.equal(r.status, "optimal");
    assert.ok(r.status === "optimal" && Math.abs(r.value - 20) < 1e-9);
  });
});

// ---------- optimizer vs brute force ----------

const quote = (item: string, sell?: number, buy?: number, maxSellPerHour?: number): Quote => ({
  item,
  ...(sell !== undefined ? { sellPrice: sell } : {}),
  ...(buy !== undefined ? { buyPrice: buy } : {}),
  ...(maxSellPerHour !== undefined ? { maxSellPerHour } : {}),
  channel: "test",
  asOf: new Date(0),
  source: "test",
});

/** Deterministic pseudo-random numbers */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function randomContext(seed: number): EvaluationContext {
  const r = rng(seed);
  const items = ["a", "b", "c"];
  const processes = new Map<string, Process>();
  for (let k = 0; k < 3; k++) {
    const out = items[Math.floor(r() * 3)]!;
    const inp = r() < 0.5 ? items[Math.floor(r() * 3)]! : undefined;
    processes.set(`p${k}`, {
      id: `p${k}`,
      name: `p${k}`,
      outputsPerHour: { [out]: Math.round(50 + r() * 100) },
      inputsPerHour: inp && inp !== out ? { [inp]: Math.round(20 + r() * 80) } : {},
      site: { needsPlayerNearby: true, ...(r() < 0.5 ? { hostileMobCapShare: 0.4 + Math.round(r() * 6) / 10 } : {}), msptCost: Math.round(r() * 4) },
    });
  }
  const sites = new Map<string, Site>([
    ["s1", { id: "s1", name: "s1", kind: "afk", needsAccount: true, msptBudget: 6 }],
    ["s2", { id: "s2", name: "s2", kind: "afk", needsAccount: true }],
    ["chunks", { id: "chunks", name: "chunks", kind: "spawn-chunks", needsAccount: false, msptBudget: 3 }],
  ]);
  const quotes = new Map(items.map((i) => [i, quote(i, Math.round(r() * 10) / 2, r() < 0.7 ? Math.round(r() * 12) / 2 : undefined, r() < 0.5 ? 200 : undefined)]));
  return { processes, sites, quotes, accounts: 1 };
}

/** All plans with counts 0..max, filtered by the hard constraints the optimizer models. */
function bruteForce(ctx: EvaluationContext, max: number): number {
  const ps = [...ctx.processes.keys()];
  const ss = [...ctx.sites.keys()];
  const slots = ps.flatMap((p) => ss.map((s) => [p, s] as const));
  let best = -Infinity;
  const counts = new Array<number>(slots.length).fill(0);
  const rec = (k: number) => {
    if (k === slots.length) {
      const plan: Plan = { entries: slots.map(([p, s], i) => ({ processId: p, siteId: s, count: counts[i]! })).filter((e) => e.count > 0) };
      const e = evaluatePlan(plan, ctx);
      if (e.diagnostics.some((d) => d.severity === "error" || d.code === "mob-cap-shared" || d.code === "mspt-budget")) return;
      best = Math.max(best, e.profitPerHour);
      return;
    }
    for (let c = 0; c <= max; c++) {
      counts[k] = c;
      rec(k + 1);
    }
  };
  rec(0);
  return best;
}

describe("optimizePlan", () => {
  it("matches brute force on 25 random small economies", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const ctx = randomContext(seed);
      const opt = optimizePlan(ctx, { maxCountPerProcess: 2 });
      const brute = bruteForce(ctx, 2);
      assert.ok(opt.optimal);
      assert.ok(Math.abs(opt.evaluation.profitPerHour - brute) < 1e-6, `seed ${seed}: optimizer ${opt.evaluation.profitPerHour}, brute force ${brute}`);
      assert.ok(!opt.evaluation.diagnostics.some((d) => d.severity === "error"), `seed ${seed}: plan has errors`);
    }
  });

  it("builds a supply chain: a bone farm feeds the kelp converter instead of buying bone meal", () => {
    const processes = new Map<string, Process>([
      ["kelp", { id: "kelp", name: "kelp", inputsPerHour: { bonemeal: 18_000 }, outputsPerHour: { kelp: 16_740 }, site: { needsPlayerNearby: true } }],
      ["bones", { id: "bones", name: "bones", inputsPerHour: {}, outputsPerHour: { bonemeal: 20_000 }, site: { needsPlayerNearby: true, hostileMobCapShare: 1 } }],
    ]);
    const ctx: EvaluationContext = {
      processes,
      sites: new Map([["base", { id: "base", name: "base", kind: "afk", needsAccount: true }]]),
      quotes: new Map([
        ["kelp", quote("kelp", 1.2)],
        ["bonemeal", quote("bonemeal", 0.5, 1.0)],
      ]),
      accounts: 1,
    };
    const r = optimizePlan(ctx, { maxCountPerProcess: 3 });
    const count = (id: string) => r.plan.entries.find((e) => e.processId === id)?.count ?? 0;
    assert.equal(count("bones"), 1, "one mob farm fills the mob cap");
    assert.equal(count("kelp"), 3);
    // 3 × 18,000 bone meal needed, 20,000 made, 34,000 bought
    assert.ok(Math.abs(r.evaluation.purchaseCostPerHour - 34_000) < 1e-6);
  });

  it("spreads build cost over the horizon", () => {
    const processes = new Map<string, Process>([
      ["p", { id: "p", name: "p", inputsPerHour: {}, outputsPerHour: { x: 10 }, buildCost: { block: 100 }, site: { needsPlayerNearby: true } }],
    ]);
    const ctx: EvaluationContext = {
      processes,
      sites: new Map([["s", { id: "s", name: "s", kind: "afk", needsAccount: true }]]),
      quotes: new Map([
        ["x", quote("x", 1)],
        ["block", quote("block", undefined, 1)],
      ]),
      accounts: 1,
    };
    assert.equal(optimizePlan(ctx, { maxCountPerProcess: 4, horizonHours: 20 }).plan.entries[0]?.count, 4, "pays back in 10 h < 20 h");
    assert.equal(optimizePlan(ctx, { maxCountPerProcess: 4, horizonHours: 5 }).plan.entries.length, 0, "does not pay back within 5 h");
  });
});
