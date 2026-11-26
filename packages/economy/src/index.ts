/**
 * Economy model: what is worth building, and where?
 *
 * Independent of blocks and of any particular server. Server specifics
 * (sales channels, fees, price data) come from market modules such as
 * @redstack/market-static or @redstack/market-donut.
 *
 * A process is anything with inputs and outputs per hour: a farm, a furnace
 * array, villager trading. Processes run at sites (AFK spots) that share
 * resources such as the mob cap.
 */

export type ItemRates = Readonly<Record<string, number>>;

/** What a process needs from its site */
export interface SiteNeeds {
  /** Share of the site's hostile mob cap the process needs for its rated output (0–1) */
  readonly hostileMobCapShare?: number;
  /** Share of the passive mob cap */
  readonly passiveMobCapShare?: number;
  /** Estimated server load in ms per tick */
  readonly msptCost?: number;
  /** Must be within a player's simulation distance, or it does not run */
  readonly needsPlayerNearby: boolean;
}

export interface Process {
  readonly id: string;
  readonly name: string;
  readonly inputsPerHour: ItemRates;
  readonly outputsPerHour: ItemRates;
  /** One-off build cost in items */
  readonly buildCost?: ItemRates;
  readonly site: SiteNeeds;
  /** Where the numbers come from, e.g. an assembly's flow model or a measurement */
  readonly source?: { readonly kind: "assembly-model" | "measured" | "manual"; readonly ref?: string };
}

export type SiteKind = "afk" | "spawn-chunks" | "forceloaded";

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly kind: SiteKind;
  /** An account can only be AFK at one spot at a time */
  readonly needsAccount: boolean;
  readonly msptBudget?: number;
}

export interface PlanEntry {
  readonly processId: string;
  readonly siteId: string;
  readonly count: number;
}

export interface Plan {
  readonly entries: readonly PlanEntry[];
}

// ---------- Markets ----------

export interface Quote {
  readonly item: string;
  /** Revenue per item when selling (after channel fees) */
  readonly sellPrice?: number;
  /** Cost per item when buying */
  readonly buyPrice?: number;
  /** How much can be sold per hour without pushing the price down */
  readonly maxSellPerHour?: number;
  readonly channel: string;
  readonly asOf: Date;
  readonly source: string;
}

export interface PriceSource {
  readonly id: string;
  quotes(items: readonly string[]): Promise<ReadonlyMap<string, Quote>>;
}

export interface SalesChannel {
  readonly id: string;
  readonly name: string;
  /** Share deducted when selling (0–1) */
  readonly feeRate?: number;
  readonly notes?: string;
}

/** Description of a server economy (Donut, other SMPs, your own server) */
export interface MarketProfile {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly channels: readonly SalesChannel[];
  readonly notes?: readonly string[];
}

// ---------- Evaluation ----------

export interface EvaluationDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
}

export interface SiteUsage {
  readonly siteId: string;
  readonly hostileMobCap: number;
  readonly passiveMobCap: number;
  readonly mspt: number;
  /** Factor applied to mob-dependent processes at this site */
  readonly mobEfficiency: number;
}

export interface PlanEvaluation {
  readonly revenuePerHour: number;
  readonly purchaseCostPerHour: number;
  readonly profitPerHour: number;
  /** Net per item: positive = surplus, negative = demand */
  readonly netItemsPerHour: ItemRates;
  /** Surplus beyond what the market absorbs */
  readonly unsoldPerHour: ItemRates;
  readonly buildCostValue: number;
  readonly paybackHours: number;
  readonly sites: readonly SiteUsage[];
  readonly diagnostics: readonly EvaluationDiagnostic[];
}

export interface EvaluationContext {
  readonly processes: ReadonlyMap<string, Process>;
  readonly sites: ReadonlyMap<string, Site>;
  readonly quotes: ReadonlyMap<string, Quote>;
  /** Number of accounts that can be AFK at the same time */
  readonly accounts: number;
}

/**
 * Evaluates a concrete plan. The basis for any optimizer: an optimizer
 * proposes plans, this function checks them.
 */
export function evaluatePlan(plan: Plan, ctx: EvaluationContext): PlanEvaluation {
  const diags: EvaluationDiagnostic[] = [];
  const net: Record<string, number> = {};
  const usage = new Map<string, { hostile: number; passive: number; mspt: number }>();

  // 1. Site load
  for (const e of plan.entries) {
    const p = ctx.processes.get(e.processId);
    const s = ctx.sites.get(e.siteId);
    if (!p) {
      diags.push({ severity: "error", code: "unknown-process", message: `Unknown process ${e.processId}.` });
      continue;
    }
    if (!s) {
      diags.push({ severity: "error", code: "unknown-site", message: `Unknown site ${e.siteId}.` });
      continue;
    }
    const u = usage.get(s.id) ?? { hostile: 0, passive: 0, mspt: 0 };
    u.hostile += (p.site.hostileMobCapShare ?? 0) * e.count;
    u.passive += (p.site.passiveMobCapShare ?? 0) * e.count;
    u.mspt += (p.site.msptCost ?? 0) * e.count;
    usage.set(s.id, u);
  }

  const accountSites = [...usage.keys()].filter((id) => ctx.sites.get(id)?.needsAccount);
  if (accountSites.length > ctx.accounts) {
    diags.push({
      severity: "error",
      code: "too-many-afk-sites",
      message: `The plan uses ${accountSites.length} AFK spots, but only ${ctx.accounts} account(s) can be AFK at the same time.`,
    });
  }

  const sites: SiteUsage[] = [];
  const efficiency = new Map<string, number>();
  for (const [siteId, u] of usage) {
    const site = ctx.sites.get(siteId)!;
    const mobEfficiency = Math.min(1, u.hostile > 0 ? 1 / u.hostile : 1, u.passive > 0 ? 1 / u.passive : 1);
    if (mobEfficiency < 1) {
      diags.push({
        severity: "warning",
        code: "mob-cap-shared",
        message: `${site.name}: farms need ${(Math.max(u.hostile, u.passive) * 100).toFixed(0)}% of the mob cap together. Mob farms there run at ~${(mobEfficiency * 100).toFixed(0)}% (rough approximation).`,
      });
    }
    if (site.msptBudget !== undefined && u.mspt > site.msptBudget) {
      diags.push({
        severity: "warning",
        code: "mspt-budget",
        message: `${site.name}: estimated load ${u.mspt.toFixed(1)} ms/tick exceeds the budget of ${site.msptBudget}.`,
      });
    }
    efficiency.set(siteId, mobEfficiency);
    sites.push({ siteId, hostileMobCap: u.hostile, passiveMobCap: u.passive, mspt: u.mspt, mobEfficiency });
  }

  // 2. Item balance
  const buildCost: Record<string, number> = {};
  for (const e of plan.entries) {
    const p = ctx.processes.get(e.processId);
    if (!p || !ctx.sites.has(e.siteId)) continue;
    const mobDependent = (p.site.hostileMobCapShare ?? 0) > 0 || (p.site.passiveMobCapShare ?? 0) > 0;
    const k = e.count * (mobDependent ? (efficiency.get(e.siteId) ?? 1) : 1);
    for (const [i, r] of Object.entries(p.outputsPerHour)) net[i] = (net[i] ?? 0) + r * k;
    for (const [i, r] of Object.entries(p.inputsPerHour)) net[i] = (net[i] ?? 0) - r * k;
    for (const [i, n] of Object.entries(p.buildCost ?? {})) buildCost[i] = (buildCost[i] ?? 0) + n * e.count;
  }

  // 3. Selling and buying
  let revenue = 0;
  let purchase = 0;
  const unsold: Record<string, number> = {};
  for (const [item, r] of Object.entries(net)) {
    const q = ctx.quotes.get(item);
    if (r > 0) {
      if (q?.sellPrice === undefined) {
        unsold[item] = r;
        diags.push({ severity: "info", code: "no-sell-price", message: `No sell price for ${item}; surplus is not valued.` });
        continue;
      }
      const sellable = q.maxSellPerHour !== undefined ? Math.min(r, q.maxSellPerHour) : r;
      if (sellable < r) {
        unsold[item] = r - sellable;
        diags.push({
          severity: "warning",
          code: "market-saturated",
          message: `${item}: ${r.toFixed(0)}/h produced, the market only absorbs ~${sellable.toFixed(0)}/h.`,
        });
      }
      revenue += sellable * q.sellPrice;
    } else if (r < 0) {
      if (q?.buyPrice === undefined) {
        diags.push({
          severity: "error",
          code: "input-unavailable",
          message: `${item} is needed (${(-r).toFixed(1)}/h) but neither produced nor purchasable.`,
        });
        continue;
      }
      purchase += -r * q.buyPrice;
    }
  }

  let buildCostValue = 0;
  for (const [item, n] of Object.entries(buildCost)) {
    const q = ctx.quotes.get(item);
    if (q?.buyPrice === undefined) {
      diags.push({ severity: "info", code: "no-build-price", message: `No buy price for building material ${item}; not included in build cost.` });
      continue;
    }
    buildCostValue += n * q.buyPrice;
  }

  const profit = revenue - purchase;
  return {
    revenuePerHour: revenue,
    purchaseCostPerHour: purchase,
    profitPerHour: profit,
    netItemsPerHour: net,
    unsoldPerHour: unsold,
    buildCostValue,
    paybackHours: profit > 0 ? buildCostValue / profit : Number.POSITIVE_INFINITY,
    sites,
    diagnostics: diags,
  };
}

/**
 * Optimizer interface. Planned (phase 2b): mixed-integer linear programming
 * over the count per process and site, with mob cap, accounts, market limits
 * and load budget as constraints.
 */
export interface Optimizer {
  readonly id: string;
  optimize(ctx: EvaluationContext, options: { maxCountPerProcess: number }): Plan;
}
export * from "./milp.js";
export * from "./optimize.js";
