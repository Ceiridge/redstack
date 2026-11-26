/**
 * `redstack optimize <plan.json>` – which farms to build how often at which
 * AFK spot, for the most profit per hour (see @redstack/economy optimizePlan).
 *
 * {
 *   "farms": [{ "module": "../dist/kelp-farm.js", "maxCount": 4, "msPerTick": 0.5, "hostileMobCapShare": 0 }],
 *   "sites": [{ "id": "base", "name": "Base", "kind": "afk", "needsAccount": true, "msptBudget": 5 }],
 *   "accounts": 1,
 *   "prices": "../prices/example.json",
 *   "fee": 0.05,
 *   "horizonHours": 48
 * }
 *
 * Paths are relative to the plan file.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Process, type Site, optimizePlan } from "@redstack/economy";
import { StaticPriceSource } from "@redstack/market-static";
import { processFromAssembly } from "@redstack/planning";
import type { Assembly } from "@redstack/core";

interface FarmEntry {
  readonly module: string;
  readonly maxCount?: number;
  readonly msPerTick?: number;
  readonly hostileMobCapShare?: number;
  readonly passiveMobCapShare?: number;
}

interface PlanFile {
  readonly farms: readonly FarmEntry[];
  readonly sites: readonly Site[];
  readonly accounts: number;
  readonly prices: string;
  readonly fee?: number;
  readonly horizonHours?: number;
}

export async function optimizeCommand(path: string, load: (module: string) => Promise<Assembly>, json: boolean): Promise<void> {
  const file = JSON.parse(readFileSync(path, "utf8")) as PlanFile;
  const base = dirname(resolve(path));
  if (!Array.isArray(file.farms) || !Array.isArray(file.sites) || typeof file.prices !== "string") {
    throw new Error(`${path}: "farms", "sites" and "prices" are required.`);
  }
  const processes = new Map<string, Process>();
  const maxCounts = new Map<string, number>();
  for (const f of file.farms) {
    const a = (await load(resolve(base, f.module))).resolve();
    const site = {
      ...(f.hostileMobCapShare !== undefined ? { hostileMobCapShare: f.hostileMobCapShare } : {}),
      ...(f.passiveMobCapShare !== undefined ? { passiveMobCapShare: f.passiveMobCapShare } : {}),
    };
    const p = processFromAssembly(a, { site, ...(f.msPerTick !== undefined ? { msPerTick: f.msPerTick } : {}) });
    processes.set(p.id, p);
    if (f.maxCount !== undefined) maxCounts.set(p.id, f.maxCount);
  }
  const source = StaticPriceSource.fromPath(resolve(base, file.prices), file.fee ?? 0);
  const items = [...new Set([...processes.values()].flatMap((p) => [...Object.keys(p.inputsPerHour), ...Object.keys(p.outputsPerHour), ...Object.keys(p.buildCost ?? {})]))];
  const ctx = { processes, sites: new Map(file.sites.map((s) => [s.id, s])), quotes: await source.quotes(items), accounts: file.accounts };
  const r = optimizePlan(ctx, {
    maxCountPerProcess: 4,
    maxCount: (id) => maxCounts.get(id),
    ...(file.horizonHours !== undefined ? { horizonHours: file.horizonHours } : {}),
  });
  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  console.log(`Best plan (${r.optimal ? "optimal" : "best found within the search budget"}), prices: ${source.id}`);
  if (r.plan.entries.length === 0) console.log("  build nothing – no farm pays at these prices");
  for (const e of r.plan.entries) console.log(`  ${e.count} × ${e.processId} at ${ctx.sites.get(e.siteId)?.name ?? e.siteId}`);
  const ev = r.evaluation;
  console.log(`Profit ${money(ev.profitPerHour)}/h (revenue ${money(ev.revenuePerHour)} − purchases ${money(ev.purchaseCostPerHour)}), build cost ${money(ev.buildCostValue)}`);
  for (const [item, n] of Object.entries(ev.netItemsPerHour)) console.log(`  ${item}: ${n >= 0 ? "+" : ""}${money(n)}/h`);
  for (const d of ev.diagnostics) if (d.severity !== "info") console.log(`  [${d.severity}] ${d.message}`);
}
