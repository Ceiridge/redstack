/**
 * Flussmodell (Stufe 1): rechnet aus den Ratenangaben der Komponenten,
 * was durch eine Assembly fließt – ohne Simulation, in Millisekunden.
 *
 * Kann: Item-Raten pro Port, Engpässe, Füllzeiten von Lagern, benötigte Inputs,
 * verlorene Items (Ausgang ohne Abnehmer).
 * Kann nicht: Timing, Redstone-Logik, Zufallsschwankungen. Das prüfen die Tests.
 */

import type { Diagnostic, RateBasis, ResolvedAssembly } from "@redstack/core";

export type ItemRates = Readonly<Record<string, number>>;

export interface PortFlow {
  readonly instanceId: string;
  readonly port: string;
  readonly items: ItemRates;
  readonly totalPerHour: number;
}

export interface Bottleneck {
  readonly instanceId: string;
  readonly from: string;
  readonly to: string;
  readonly inflowPerHour: number;
  readonly capacityPerHour: number;
  /** >1 bedeutet Stau */
  readonly utilization: number;
}

export interface SinkStatus {
  readonly instanceId: string;
  readonly port: string;
  readonly inflowPerHour: number;
  readonly capacityItems: number;
  readonly hoursToFull: number;
}

export interface FlowAnalysis {
  readonly ports: ReadonlyMap<string, PortFlow>;
  readonly bottlenecks: readonly Bottleneck[];
  readonly sinks: readonly SinkStatus[];
  /** Was die Assembly von außen braucht (z. B. Knochenmehl, Brennstoff) */
  readonly inputsPerHour: ItemRates;
  /** Was in Lagern ankommt */
  readonly storedPerHour: ItemRates;
  /** Woher die Zahlen stammen – "estimate" heißt: nicht durch Spielmechanik oder Messung belegt */
  readonly bases: ReadonlySet<RateBasis>;
  readonly diagnostics: readonly Diagnostic[];
}

function addRates(a: Record<string, number>, b: ItemRates, k = 1): void {
  for (const [item, r] of Object.entries(b)) a[item] = (a[item] ?? 0) + r * k;
}

function total(r: ItemRates): number {
  return Object.values(r).reduce((s, x) => s + x, 0);
}

const portKey = (instanceId: string, port: string) => `${instanceId}.${port}`;

export function analyzeFlow(a: ResolvedAssembly): FlowAnalysis {
  const diagnostics: Diagnostic[] = [];
  const bases = new Set<RateBasis>();
  const outFlows = new Map<string, ItemRates>();
  const inFlows = new Map<string, ItemRates>();
  const bottlenecks: Bottleneck[] = [];
  const visiting = new Set<string>();

  // Verbindungen nach Ziel- und Quellport indizieren
  const incoming = new Map<string, Array<{ instanceId: string; port: string }>>();
  const outgoingCount = new Map<string, number>();
  for (const c of a.connections) {
    const toK = portKey(c.to.instanceId, c.to.port);
    const list = incoming.get(toK) ?? [];
    list.push(c.from);
    incoming.set(toK, list);
    const fromK = portKey(c.from.instanceId, c.from.port);
    outgoingCount.set(fromK, (outgoingCount.get(fromK) ?? 0) + 1);
  }

  const rates = (id: string) => a.instances.get(id)?.template.rates ?? [];
  const portKind = (id: string, port: string) => a.instances.get(id)?.ports.get(port)?.kind;

  function outFlow(id: string, port: string): ItemRates {
    const k = portKey(id, port);
    const cached = outFlows.get(k);
    if (cached) return cached;
    if (visiting.has(k)) {
      diagnostics.push({ severity: "error", code: "flow-cycle", message: `Zyklus im Fluss bei ${k}.`, instances: [id] });
      return {};
    }
    visiting.add(k);
    const acc: Record<string, number> = {};
    for (const r of rates(id)) {
      if (r.type === "produces" && r.port === port) {
        acc[r.item] = (acc[r.item] ?? 0) + r.perHour;
        bases.add(r.basis);
      }
      if (r.type === "passes" && r.to === port) {
        bases.add(r.basis);
        const inflow = inFlow(id, r.from);
        const t = total(inflow);
        const factor = t > r.maxPerHour ? r.maxPerHour / t : 1;
        if (t > 0) {
          const utilization = t / r.maxPerHour;
          if (utilization > 1) {
            bottlenecks.push({
              instanceId: id,
              from: r.from,
              to: r.to,
              inflowPerHour: t,
              capacityPerHour: r.maxPerHour,
              utilization,
            });
          }
        }
        addRates(acc, inflow, factor);
      }
    }
    visiting.delete(k);
    // Mehrere Abnehmer: gleichmäßig aufteilen (Näherung)
    const n = outgoingCount.get(k) ?? 0;
    const result = n > 1 ? Object.fromEntries(Object.entries(acc).map(([i, r]) => [i, r / n])) : acc;
    outFlows.set(k, result);
    return result;
  }

  function inFlow(id: string, port: string): ItemRates {
    const k = portKey(id, port);
    const cached = inFlows.get(k);
    if (cached) return cached;
    const acc: Record<string, number> = {};
    for (const src of incoming.get(k) ?? []) addRates(acc, outFlow(src.instanceId, src.port));
    inFlows.set(k, acc);
    return acc;
  }

  // Alle Ports durchrechnen
  for (const inst of a.instances.values()) {
    for (const p of inst.ports.values()) {
      if (p.kind !== "items" && p.kind !== "fluid") continue;
      if (p.direction === "out") outFlow(inst.id, p.name);
      else inFlow(inst.id, p.name);
    }
  }

  // Lager, Sackgassen, verlorene Items
  const sinks: SinkStatus[] = [];
  const stored: Record<string, number> = {};
  const inputs: Record<string, number> = {};
  for (const inst of a.instances.values()) {
    const rs = inst.template.rates;
    for (const r of rs) {
      if (r.type === "consumes") {
        inputs[r.item] = (inputs[r.item] ?? 0) + r.perHour;
        bases.add(r.basis);
      }
      if (r.type === "stores") {
        bases.add(r.basis);
        const inflow = inFlow(inst.id, r.port);
        const t = total(inflow);
        addRates(stored, inflow);
        sinks.push({
          instanceId: inst.id,
          port: r.port,
          inflowPerHour: t,
          capacityItems: r.capacityItems,
          hoursToFull: t > 0 ? r.capacityItems / t : Number.POSITIVE_INFINITY,
        });
      }
    }
    for (const p of inst.ports.values()) {
      if (p.kind !== "items" && p.kind !== "fluid") continue;
      const k = portKey(inst.id, p.name);
      if (p.direction === "in") {
        const t = total(inFlows.get(k) ?? {});
        const handled = rs.some((r) => (r.type === "passes" && r.from === p.name) || (r.type === "stores" && r.port === p.name));
        if (t > 0 && !handled) {
          diagnostics.push({
            severity: "warning",
            code: "flow-dead-end",
            message: `${k} nimmt ${t.toFixed(1)} Items/h an, gibt sie aber nirgends weiter (keine passes/stores-Angabe).`,
            instances: [inst.id],
          });
        }
      } else {
        const t = total(outFlows.get(k) ?? {});
        if (t > 0 && !(outgoingCount.get(k) ?? 0)) {
          diagnostics.push({
            severity: "warning",
            code: "flow-spill",
            message: `${k} gibt ${t.toFixed(1)} Items/h aus, aber nichts nimmt sie an. Die Items gehen verloren.`,
            instances: [inst.id],
          });
        }
      }
    }
  }

  const ports = new Map<string, PortFlow>();
  for (const [k, items] of [...outFlows, ...inFlows]) {
    const [instanceId, port] = [k.slice(0, k.lastIndexOf(".")), k.slice(k.lastIndexOf(".") + 1)];
    if (portKind(instanceId, port) === undefined) continue;
    ports.set(k, { instanceId, port, items, totalPerHour: total(items) });
  }

  if (bases.has("estimate")) {
    diagnostics.push({
      severity: "info",
      code: "flow-estimate",
      message: "Mindestens eine Rate ist eine Schätzung. Ergebnis erst nach Messung belastbar.",
    });
  }

  return {
    ports,
    bottlenecks,
    sinks,
    inputsPerHour: inputs,
    storedPerHour: stored,
    bases,
    diagnostics,
  };
}

/** Kompakter Textbericht, z. B. für die CLI oder als Kontext für die KI. */
export function formatFlowReport(f: FlowAnalysis): string {
  const lines: string[] = [];
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "∞");
  lines.push("Ertrag (in Lagern):");
  for (const [item, r] of Object.entries(f.storedPerHour)) lines.push(`  ${item}: ${fmt(r)} /h`);
  if (Object.keys(f.inputsPerHour).length) {
    lines.push("Benötigte Inputs:");
    for (const [item, r] of Object.entries(f.inputsPerHour)) lines.push(`  ${item}: ${fmt(r)} /h`);
  }
  lines.push(f.bottlenecks.length ? "Engpässe:" : "Engpässe: keine");
  for (const b of f.bottlenecks) {
    lines.push(`  ${b.instanceId} ${b.from}→${b.to}: ${fmt(b.inflowPerHour)} /h rein, max ${fmt(b.capacityPerHour)} /h (${fmt(b.utilization * 100)} %)`);
  }
  lines.push("Lager:");
  for (const s of f.sinks) lines.push(`  ${s.instanceId}: ${fmt(s.inflowPerHour)} /h, voll nach ${fmt(s.hoursToFull)} h`);
  return lines.join("\n");
}
