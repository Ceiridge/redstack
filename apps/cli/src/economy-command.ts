/**
 * `redstack economy <module.js>` – the farm as an economic process: what
 * goes in and out per hour (from the flow model), what it costs to build,
 * the break-even price ratio, and with --prices the profit per hour.
 */

import type { ResolvedAssembly } from "@redstack/core";
import { evaluatePlan } from "@redstack/economy";
import type { FlowAnalysis } from "@redstack/flow";
import { StaticPriceSource } from "@redstack/market-static";
import { formatProcess, processFromAssembly } from "@redstack/planning";

export interface EconomyOptions {
  readonly json: boolean;
  /** Price file in the @redstack/market-static format */
  readonly prices?: string;
  /** Share deducted when selling */
  readonly fee?: number;
  readonly msPerTick?: number;
}

export async function economyCommand(a: ResolvedAssembly, flow: FlowAnalysis, o: EconomyOptions): Promise<void> {
  const process = processFromAssembly(a, { flow, ...(o.msPerTick !== undefined ? { msPerTick: o.msPerTick } : {}) });
  if (!o.prices) {
    console.log(o.json ? JSON.stringify(process, null, 2) : formatProcess(process));
    return;
  }
  const source = StaticPriceSource.fromPath(o.prices, o.fee ?? 0);
  const items = [...new Set([...Object.keys(process.inputsPerHour), ...Object.keys(process.outputsPerHour), ...Object.keys(process.buildCost ?? {})])];
  const quotes = await source.quotes(items);
  const evaluation = evaluatePlan(
    { entries: [{ processId: process.id, siteId: "here", count: 1 }] },
    {
      processes: new Map([[process.id, process]]),
      sites: new Map([["here", { id: "here", name: "AFK spot", kind: "afk", needsAccount: true }]]),
      quotes,
      accounts: 1,
    },
  );
  if (o.json) {
    console.log(JSON.stringify({ process, evaluation }, null, 2));
    return;
  }
  const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "never");
  console.log(formatProcess(process));
  console.log(`Prices: ${source.id}`);
  console.log(`  revenue ${money(evaluation.revenuePerHour)}/h − purchases ${money(evaluation.purchaseCostPerHour)}/h = profit ${money(evaluation.profitPerHour)}/h`);
  console.log(`  build cost ${money(evaluation.buildCostValue)}, paid back after ${Number.isFinite(evaluation.paybackHours) ? `${evaluation.paybackHours.toFixed(1)} h` : "never"}`);
  for (const d of evaluation.diagnostics) console.log(`  [${d.severity}] ${d.message}`);
}
