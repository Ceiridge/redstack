/**
 * Wirtschaftsmodell: Was lohnt sich wo zu bauen?
 *
 * Unabhängig von Blöcken und von einem bestimmten Server. Server-spezifisches
 * (Handelskanäle, Gebühren, Preisdaten) kommt aus Markt-Modulen wie
 * @redstack/market-static oder @redstack/market-donut.
 *
 * Ein Prozess ist alles mit Inputs und Outputs pro Stunde: eine Farm, ein
 * Schmelzofen-Array, Villager-Handel. Prozesse laufen an Standorten
 * (AFK-Spots), die sich Ressourcen wie das Mob-Cap teilen.
 */

export type ItemRates = Readonly<Record<string, number>>;

/** Was ein Prozess von seinem Standort braucht */
export interface SiteNeeds {
  /** Anteil am feindlichen Mob-Cap des Standorts, den der Prozess für seine Nennrate braucht (0–1) */
  readonly hostileMobCapShare?: number;
  /** Anteil am passiven Mob-Cap */
  readonly passiveMobCapShare?: number;
  /** Geschätzte Server-Last in ms pro Tick */
  readonly msptCost?: number;
  /** Muss im Simulationsradius des Spielers liegen (sonst läuft er nicht) */
  readonly needsPlayerNearby: boolean;
}

export interface Process {
  readonly id: string;
  readonly name: string;
  readonly inputsPerHour: ItemRates;
  readonly outputsPerHour: ItemRates;
  /** Einmalige Baukosten in Items */
  readonly buildCost?: ItemRates;
  readonly site: SiteNeeds;
  /** Herkunft der Zahlen, z. B. Flussmodell einer Assembly oder Messung */
  readonly source?: { readonly kind: "assembly-model" | "measured" | "manual"; readonly ref?: string };
}

export type SiteKind = "afk" | "spawn-chunks" | "forceloaded";

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly kind: SiteKind;
  /** Ein Account kann nur an einem AFK-Spot gleichzeitig sein */
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

// ---------- Märkte ----------

export interface Quote {
  readonly item: string;
  /** Erlös pro Item beim Verkauf (nach Gebühren des Kanals) */
  readonly sellPrice?: number;
  /** Kosten pro Item beim Einkauf */
  readonly buyPrice?: number;
  /** Wie viel sich pro Stunde verkaufen lässt, ohne den Preis zu drücken */
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
  /** Anteil, der beim Verkauf abgezogen wird (0–1) */
  readonly feeRate?: number;
  readonly notes?: string;
}

/** Beschreibung eines Servers mit Wirtschaft (Donut, andere SMPs, eigener Server) */
export interface MarketProfile {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly channels: readonly SalesChannel[];
  readonly notes?: readonly string[];
}

// ---------- Bewertung ----------

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
  /** Faktor, mit dem mob-abhängige Prozesse an diesem Standort skaliert wurden */
  readonly mobEfficiency: number;
}

export interface PlanEvaluation {
  readonly revenuePerHour: number;
  readonly purchaseCostPerHour: number;
  readonly profitPerHour: number;
  /** Netto pro Item: positiv = Überschuss, negativ = Bedarf */
  readonly netItemsPerHour: ItemRates;
  /** Überschuss, der über die Absatzgrenze hinausgeht */
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
  /** Anzahl Accounts, die gleichzeitig AFK sein können */
  readonly accounts: number;
}

/**
 * Bewertet einen konkreten Plan. Grundlage für jeden Optimierer:
 * Ein Optimierer schlägt Pläne vor, diese Funktion rechnet sie nach.
 */
export function evaluatePlan(plan: Plan, ctx: EvaluationContext): PlanEvaluation {
  const diags: EvaluationDiagnostic[] = [];
  const net: Record<string, number> = {};
  const usage = new Map<string, { hostile: number; passive: number; mspt: number }>();

  // 1. Standort-Auslastung
  for (const e of plan.entries) {
    const p = ctx.processes.get(e.processId);
    const s = ctx.sites.get(e.siteId);
    if (!p) {
      diags.push({ severity: "error", code: "unknown-process", message: `Prozess ${e.processId} unbekannt.` });
      continue;
    }
    if (!s) {
      diags.push({ severity: "error", code: "unknown-site", message: `Standort ${e.siteId} unbekannt.` });
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
      message: `Plan nutzt ${accountSites.length} AFK-Spots, aber nur ${ctx.accounts} Account(s) können gleichzeitig AFK sein.`,
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
        message: `${site.name}: Farmen brauchen zusammen ${(Math.max(u.hostile, u.passive) * 100).toFixed(0)} % des Mob-Caps. Mob-Farmen dort laufen nur mit ~${(mobEfficiency * 100).toFixed(0)} % (grobe Näherung).`,
      });
    }
    if (site.msptBudget !== undefined && u.mspt > site.msptBudget) {
      diags.push({
        severity: "warning",
        code: "mspt-budget",
        message: `${site.name}: geschätzte Last ${u.mspt.toFixed(1)} ms/Tick über Budget ${site.msptBudget}.`,
      });
    }
    efficiency.set(siteId, mobEfficiency);
    sites.push({ siteId, hostileMobCap: u.hostile, passiveMobCap: u.passive, mspt: u.mspt, mobEfficiency });
  }

  // 2. Item-Bilanz
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

  // 3. Verkauf und Einkauf
  let revenue = 0;
  let purchase = 0;
  const unsold: Record<string, number> = {};
  for (const [item, r] of Object.entries(net)) {
    const q = ctx.quotes.get(item);
    if (r > 0) {
      if (q?.sellPrice === undefined) {
        unsold[item] = r;
        diags.push({ severity: "info", code: "no-sell-price", message: `Kein Verkaufspreis für ${item}; Überschuss wird nicht bewertet.` });
        continue;
      }
      const sellable = q.maxSellPerHour !== undefined ? Math.min(r, q.maxSellPerHour) : r;
      if (sellable < r) {
        unsold[item] = r - sellable;
        diags.push({
          severity: "warning",
          code: "market-saturated",
          message: `${item}: ${r.toFixed(0)}/h produziert, Markt nimmt nur ~${sellable.toFixed(0)}/h auf.`,
        });
      }
      revenue += sellable * q.sellPrice;
    } else if (r < 0) {
      if (q?.buyPrice === undefined) {
        diags.push({ severity: "error", code: "input-unavailable", message: `${item} wird gebraucht (${(-r).toFixed(1)}/h), ist aber weder produziert noch käuflich.` });
        continue;
      }
      purchase += -r * q.buyPrice;
    }
  }

  let buildCostValue = 0;
  for (const [item, n] of Object.entries(buildCost)) {
    const q = ctx.quotes.get(item);
    if (q?.buyPrice === undefined) {
      diags.push({ severity: "info", code: "no-build-price", message: `Kein Einkaufspreis für Baumaterial ${item}; nicht in Baukosten enthalten.` });
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
 * Optimierer-Schnittstelle. Geplant (Phase 2b): gemischt-ganzzahlige lineare
 * Optimierung über Anzahl je Prozess und Standort, mit Mob-Cap, Accounts,
 * Absatzgrenzen und Lastbudget als Nebenbedingungen.
 */
export interface Optimizer {
  readonly id: string;
  optimize(ctx: EvaluationContext, options: { maxCountPerProcess: number }): Plan;
}
