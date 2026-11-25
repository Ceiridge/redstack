/**
 * Test interface. Backends (Fabric server, Paper server, redstone simulator)
 * implement TestBackend; scenarios and reports are backend-independent.
 *
 * Stages:
 *   0  static checks (@redstack/core)
 *   1  flow model (@redstack/flow)
 *   2  component test on a backend
 *   3  whole assembly, several runs, statistics
 */

import type { ResolvedAssembly, Vec3 } from "@redstack/core";
import { type FlowAnalysis, analyzeFlow } from "@redstack/flow";

/** What a backend can simulate. Scenarios require capabilities, backends provide them. */
export type Capability =
  | "redstone"
  | "block-updates"
  | "items"
  | "random-ticks"
  | "mob-spawning"
  | "villagers"
  | "chunk-reload"
  | "fake-player";

export interface Environment {
  readonly terrain: "void" | "flat" | "terrain";
  readonly biome?: string;
  /** Position of the AFK player in assembly coordinates. Default: above the centre of the assembly. */
  readonly afkSpot?: Vec3;
  readonly simulationDistance?: number;
  readonly gamerules?: Readonly<Record<string, string | number | boolean>>;
  /** Server profile, e.g. "vanilla", "paper-default", "donut-guess" */
  readonly serverProfile?: string;
}

/** Preparation actions. Positions in assembly coordinates. More (power, chunk reload) will follow. */
export type Action =
  | { readonly type: "insert"; readonly at: Vec3; readonly item: string; readonly count: number }
  | { readonly type: "wait"; readonly ticks: number };

export type Expectation =
  | { readonly type: "rate-at-least"; readonly item: string; readonly perHour: number }
  | { readonly type: "no-ground-items" }
  | { readonly type: "no-stuck-hoppers" }
  | { readonly type: "matches-flow-model"; readonly tolerance: number };

export interface Scenario {
  readonly name: string;
  readonly assembly: ResolvedAssembly;
  readonly environment: Environment;
  readonly requires: readonly Capability[];
  readonly durationTicks: number;
  /** Ticks at the start that do not count towards the rate (warm-up) */
  readonly warmupTicks: number;
  /** Interval between samples */
  readonly sampleEveryTicks: number;
  /** Number of independent runs, for statistics on random mechanics */
  readonly repeats: number;
  /** Actions before the start (filling containers etc.) */
  readonly actions: readonly Action[];
  readonly expectations: readonly Expectation[];
}

export interface ScenarioOptions {
  readonly name?: string;
  readonly environment?: Partial<Environment>;
  readonly requires?: readonly Capability[];
  readonly durationTicks: number;
  readonly warmupTicks?: number;
  readonly sampleEveryTicks?: number;
  readonly repeats?: number;
  readonly actions?: readonly Action[];
  readonly expectations?: readonly Expectation[];
}

/** Scenario with sensible defaults: empty world, default game rules, one run. */
export function scenario(assembly: ResolvedAssembly, o: ScenarioOptions): Scenario {
  return {
    name: o.name ?? assembly.name,
    assembly,
    environment: { terrain: "void", serverProfile: "vanilla", ...o.environment },
    requires: o.requires ?? ["items", "block-updates"],
    durationTicks: o.durationTicks,
    warmupTicks: o.warmupTicks ?? 0,
    sampleEveryTicks: o.sampleEveryTicks ?? Math.max(20, Math.floor(o.durationTicks / 20)),
    repeats: o.repeats ?? 1,
    actions: o.actions ?? [],
    expectations: o.expectations ?? [],
  };
}

/** An event with a location – what an AI needs to repair a design. */
export interface TestEvent {
  readonly tick: number;
  readonly type: "stuck-hopper" | "ground-items" | "item-destroyed" | "entity-escaped" | "custom";
  readonly at?: Vec3;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface Sample {
  readonly tick: number;
  /** Item → count across all storage */
  readonly stored: Readonly<Record<string, number>>;
}

export interface RunResult {
  readonly run: number;
  readonly ticks: number;
  /** Measured rate per item, scaled to one hour (excluding warm-up) */
  readonly measuredPerHour: Readonly<Record<string, number>>;
  readonly samples: readonly Sample[];
  readonly events: readonly TestEvent[];
  readonly wallClockMs: number;
}

export interface ExpectationResult {
  readonly expectation: Expectation;
  readonly passed: boolean;
  readonly message: string;
}

export interface TestReport {
  readonly schemaVersion: 1;
  readonly scenario: string;
  readonly backend: string;
  readonly startedAt: string;
  readonly runs: readonly RunResult[];
  /** Mean and standard deviation across runs */
  readonly summary: Readonly<Record<string, { readonly mean: number; readonly stdev: number }>>;
  readonly expectations: readonly ExpectationResult[];
  readonly passed: boolean;
}

export interface TestBackend {
  readonly id: string;
  readonly capabilities: ReadonlySet<Capability>;
  run(scenario: Scenario): Promise<TestReport>;
}

export function missingCapabilities(backend: TestBackend, scenario: Scenario): Capability[] {
  return scenario.requires.filter((c) => !backend.capabilities.has(c));
}

export function summarize(runs: readonly RunResult[]): Record<string, { mean: number; stdev: number }> {
  const items = new Set(runs.flatMap((r) => Object.keys(r.measuredPerHour)));
  const out: Record<string, { mean: number; stdev: number }> = {};
  for (const item of items) {
    const xs = runs.map((r) => r.measuredPerHour[item] ?? 0);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0;
    out[item] = { mean, stdev: Math.sqrt(variance) };
  }
  return out;
}

/** Rate per hour from samples, starting after the warm-up. */
export function ratesFromSamples(samples: readonly Sample[], warmupTicks: number): Record<string, number> {
  const start = samples.find((s) => s.tick >= warmupTicks) ?? samples[0];
  const end = samples[samples.length - 1];
  if (!start || !end || end.tick <= start.tick) return {};
  const items = new Set([...Object.keys(start.stored), ...Object.keys(end.stored)]);
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item] = (((end.stored[item] ?? 0) - (start.stored[item] ?? 0)) / (end.tick - start.tick)) * 72_000;
  }
  return out;
}

/** Evaluates a scenario's expectations against its runs. */
export function evaluateExpectations(s: Scenario, runs: readonly RunResult[], flow: FlowAnalysis = analyzeFlow(s.assembly)): ExpectationResult[] {
  const summary = summarize(runs);
  const events = runs.flatMap((r) => r.events);
  return s.expectations.map((e): ExpectationResult => {
    switch (e.type) {
      case "rate-at-least": {
        const m = summary[e.item]?.mean ?? 0;
        return { expectation: e, passed: m >= e.perHour, message: `${e.item}: ${m.toFixed(1)}/h measured, at least ${e.perHour}/h expected.` };
      }
      case "no-ground-items": {
        const n = events.filter((x) => x.type === "ground-items").length;
        return { expectation: e, passed: n === 0, message: n ? `Items on the ground in ${n} run(s).` : "No items on the ground." };
      }
      case "no-stuck-hoppers": {
        const n = events.filter((x) => x.type === "stuck-hopper").length;
        return { expectation: e, passed: n === 0, message: n ? `${n} hopper(s) backed up.` : "No hoppers backed up." };
      }
      case "matches-flow-model":
        return compareWithModel(summary, flow, e.tolerance);
    }
  });
}

/**
 * Compares measurement with the flow model. If an item deviates by more than
 * the (relative) tolerance, either a component's rate model is wrong or the
 * farm is broken – both need fixing.
 */
export function compareWithModel(
  summary: TestReport["summary"],
  model: FlowAnalysis,
  tolerance: number,
): ExpectationResult {
  const problems: string[] = [];
  for (const [item, predicted] of Object.entries(model.storedPerHour)) {
    const measured = summary[item]?.mean ?? 0;
    const rel = predicted === 0 ? (measured === 0 ? 0 : Infinity) : Math.abs(measured - predicted) / predicted;
    if (rel > tolerance) {
      problems.push(`${item}: model ${predicted.toFixed(1)}/h, measured ${measured.toFixed(1)}/h (${(rel * 100).toFixed(0)}% off)`);
    }
  }
  return {
    expectation: { type: "matches-flow-model", tolerance },
    passed: problems.length === 0,
    message: problems.length ? problems.join("; ") : "Measurement matches the model.",
  };
}
