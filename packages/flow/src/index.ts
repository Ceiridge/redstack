/**
 * Flow model (stage 1): computes what flows through an assembly from the
 * components' rate declarations – no simulation, in milliseconds.
 *
 * Covers: item rates per port, bottlenecks, storage fill times, required
 * inputs, lost items (outputs without a receiver).
 * Does not cover: timing, redstone logic, random variation. The tests do.
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
  /** > 1 means items back up */
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
  /** What the assembly needs from outside (e.g. bone meal, fuel) */
  readonly inputsPerHour: ItemRates;
  /** What arrives in storage */
  readonly storedPerHour: ItemRates;
  /** What converters use up (e.g. bone meal turned into kelp) */
  readonly convertedPerHour: ItemRates;
  /** Items that enter the design from outside (supply chests) */
  readonly externalItems: ReadonlySet<string>;
  /** Where the numbers come from – "estimate" means backed by neither game mechanics nor measurement */
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
  const converted: Record<string, number> = {};
  const external = new Set<string>();
  const visiting = new Set<string>();

  // Index connections by target and source port
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

  function outFlow(id: string, port: string): ItemRates {
    const k = portKey(id, port);
    const cached = outFlows.get(k);
    if (cached) return cached;
    if (visiting.has(k)) {
      diagnostics.push({ severity: "error", code: "flow-cycle", message: `Cycle in the flow at ${k}.`, instances: [id] });
      return {};
    }
    visiting.add(k);
    const acc: Record<string, number> = {};
    for (const r of rates(id)) {
      if (r.type === "produces" && r.port === port) {
        acc[r.item] = (acc[r.item] ?? 0) + r.perHour;
        if (r.external) external.add(r.item);
        bases.add(r.basis);
      }
      if (r.type === "passes" && r.to === port) {
        bases.add(r.basis);
        const inflow = inFlow(id, r.from);
        const t = total(inflow);
        if (t > r.maxPerHour) {
          bottlenecks.push({ instanceId: id, from: r.from, to: r.to, inflowPerHour: t, capacityPerHour: r.maxPerHour, utilization: t / r.maxPerHour });
        }
        addRates(acc, inflow, t > r.maxPerHour ? r.maxPerHour / t : 1);
      }
      if (r.type === "converts" && r.to === port) {
        bases.add(r.basis);
        const t = inFlow(id, r.from)[r.input] ?? 0;
        if (t > r.maxPerHour) {
          bottlenecks.push({ instanceId: id, from: r.from, to: r.to, inflowPerHour: t, capacityPerHour: r.maxPerHour, utilization: t / r.maxPerHour });
        }
        acc[r.output] = (acc[r.output] ?? 0) + Math.min(t, r.maxPerHour) * r.outputPerInput;
        converted[r.input] = (converted[r.input] ?? 0) + Math.min(t, r.maxPerHour);
      }
    }
    visiting.delete(k);
    // Several receivers: split evenly (approximation)
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

  for (const inst of a.instances.values()) {
    for (const p of inst.ports.values()) {
      if (p.kind !== "items" && p.kind !== "fluid") continue;
      if (p.direction === "out") outFlow(inst.id, p.name);
      else inFlow(inst.id, p.name);
    }
  }

  // Storage, dead ends, lost items
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
        const handled = rs.some(
          (r) => ((r.type === "passes" || r.type === "converts") && r.from === p.name) || (r.type === "stores" && r.port === p.name),
        );
        if (t > 0 && !handled) {
          diagnostics.push({
            severity: "warning",
            code: "flow-dead-end",
            message: `${k} accepts ${t.toFixed(1)} items/h but passes them nowhere (no passes/stores declaration).`,
            instances: [inst.id],
          });
        }
      } else {
        const t = total(outFlows.get(k) ?? {});
        if (t > 0 && !(outgoingCount.get(k) ?? 0)) {
          diagnostics.push({
            severity: "warning",
            code: "flow-spill",
            message: `${k} outputs ${t.toFixed(1)} items/h but nothing receives them. They are lost.`,
            instances: [inst.id],
          });
        }
      }
    }
  }

  const ports = new Map<string, PortFlow>();
  for (const [k, items] of [...outFlows, ...inFlows]) {
    const i = k.lastIndexOf(".");
    ports.set(k, { instanceId: k.slice(0, i), port: k.slice(i + 1), items, totalPerHour: total(items) });
  }

  if (bases.has("estimate")) {
    diagnostics.push({
      severity: "info",
      code: "flow-estimate",
      message: "At least one rate is an estimate. Treat the result as provisional until measured.",
    });
  }

  return { ports, bottlenecks, sinks, inputsPerHour: inputs, storedPerHour: stored, convertedPerHour: converted, externalItems: external, bases, diagnostics };
}

/** Compact text report, e.g. for the CLI or as context for an AI. */
export function formatFlowReport(f: FlowAnalysis): string {
  const lines: string[] = [];
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "∞");
  lines.push("Yield (into storage):");
  for (const [item, r] of Object.entries(f.storedPerHour)) lines.push(`  ${item}: ${fmt(r)}/h`);
  if (Object.keys(f.inputsPerHour).length) {
    lines.push("Required inputs:");
    for (const [item, r] of Object.entries(f.inputsPerHour)) lines.push(`  ${item}: ${fmt(r)}/h`);
  }
  lines.push(f.bottlenecks.length ? "Bottlenecks:" : "Bottlenecks: none");
  for (const b of f.bottlenecks) {
    lines.push(`  ${b.instanceId} ${b.from}→${b.to}: ${fmt(b.inflowPerHour)}/h in, max ${fmt(b.capacityPerHour)}/h (${fmt(b.utilization * 100)}%)`);
  }
  lines.push("Storage:");
  for (const s of f.sinks) lines.push(`  ${s.instanceId}: ${fmt(s.inflowPerHour)}/h, full after ${fmt(s.hoursToFull)} h`);
  return lines.join("\n");
}
