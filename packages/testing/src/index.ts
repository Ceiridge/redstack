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

/**
 * The world a test runs in. The game version and server settings come from
 * the assembly's Environment (@redstack/core); this describes the test setup.
 */
export interface TestWorld {
  readonly terrain: "void" | "flat" | "terrain";
  /**
   * For "flat": the y (assembly coordinates) of the ground's top layer. The
   * design's own blocks replace the ground where they overlap, so a farm that
   * is dug into the ground keeps working. Default: just below the design.
   */
  readonly groundY?: number;
  readonly biome?: string;
  /** Position of the AFK player in assembly coordinates. Default: above the centre of the assembly. */
  readonly afkSpot?: Vec3;
  readonly simulationDistance?: number;
  readonly gamerules?: Readonly<Record<string, string | number | boolean>>;
}

/** Preparation actions. Positions in assembly coordinates. More (chunk reload) will follow. */
export type Action =
  /** Fills slots from 0 on, `stack` items per slot (default 64; 1 for shulker boxes, tools …) */
  | { readonly type: "insert"; readonly at: Vec3; readonly item: string; readonly count: number; readonly stack?: number }
  | { readonly type: "wait"; readonly ticks: number }
  /**
   * Replaces a block, with updates to its direct neighbours only. To flip a
   * lever or press a button, use "use": a replaced lever does not update the
   * block it is attached to.
   */
  | { readonly type: "set"; readonly at: Vec3; readonly block: string }
  /**
   * The AFK player right-clicks a block (lever, button, door, repeater …) like
   * a real player, from `from` (default: a free neighbour cell, preferring the
   * side the block faces), then returns to the AFK spot.
   */
  | { readonly type: "use"; readonly at: Vec3; readonly from?: Vec3 }
  /** Spawns loose items (entities) in the middle of a cell, in stacks of 64, at rest – a burst for collectors and streams */
  | { readonly type: "drop"; readonly at: Vec3; readonly item: string; readonly count: number };

/**
 * How the design is placed. "with-updates" places block by block with normal
 * block updates, like a player building it. "strict" places every block
 * exactly as given without updates – right for schematics saved from a
 * working world, where updates during placement would set off redstone
 * (a TNT duper can blow itself up while it is half built).
 */
export type Placement =
  | "with-updates"
  | "strict"
  /** Strict for the instances the predicate selects (placed first), with updates for the rest */
  | { readonly strict: (instanceId: string) => boolean };

/** What is counted at each sample. Rates are the change of these counts over time. */
export interface Measurement {
  /** Containers to count, in assembly coordinates. Default: all storage ports (`stores` declarations). */
  readonly containers?: readonly Vec3[];
  /**
   * Count the items the AFK player picked up (the inventory is emptied at
   * every sample). For farms that deliver into the player, e.g. kelp or XP farms.
   */
  readonly player?: boolean;
  /** Items to count. Default: the flow model's stored items plus inserted items. */
  readonly items?: readonly string[];
}

export type Expectation =
  | { readonly type: "rate-at-least"; readonly item: string; readonly perHour: number }
  /** E.g. 0 for an item that must not arrive (crosstalk from a neighbouring container) */
  | { readonly type: "rate-at-most"; readonly item: string; readonly perHour: number }
  | { readonly type: "no-ground-items" }
  | { readonly type: "no-stuck-hoppers" }
  | { readonly type: "matches-flow-model"; readonly tolerance: number };

/** Loose items spawned during the measurement, like a farm's drops: every `everyTicks` (default 20) the share of `perHour` */
export interface Feed {
  readonly at: Vec3;
  readonly item: string;
  readonly perHour: number;
  readonly everyTicks?: number;
}

export interface Scenario {
  readonly name: string;
  readonly assembly: ResolvedAssembly;
  readonly world: TestWorld;
  readonly requires: readonly Capability[];
  readonly durationTicks: number;
  /** Ticks at the start that do not count towards the rate (warm-up) */
  readonly warmupTicks: number;
  /** Interval between samples */
  readonly sampleEveryTicks: number;
  /** Number of independent runs, for statistics on random mechanics */
  readonly repeats: number;
  /** Actions before the start (filling containers etc.) */
  readonly placement: Placement;
  readonly actions: readonly Action[];
  /** Items spawned while measuring */
  readonly feeds: readonly Feed[];
  readonly measure: Measurement;
  readonly expectations: readonly Expectation[];
}

export interface ScenarioOptions {
  readonly name?: string;
  readonly world?: Partial<TestWorld>;
  readonly requires?: readonly Capability[];
  readonly durationTicks: number;
  readonly warmupTicks?: number;
  readonly sampleEveryTicks?: number;
  readonly repeats?: number;
  readonly placement?: Placement;
  readonly actions?: readonly Action[];
  readonly feeds?: readonly Feed[];
  readonly measure?: Measurement;
  readonly expectations?: readonly Expectation[];
}

/** Scenario with sensible defaults: empty world, default game rules, one run. */
export function scenario(assembly: ResolvedAssembly, o: ScenarioOptions): Scenario {
  return {
    name: o.name ?? assembly.name,
    assembly,
    world: { terrain: "void", ...o.world },
    requires: o.requires ?? ["items", "block-updates"],
    durationTicks: o.durationTicks,
    warmupTicks: o.warmupTicks ?? 0,
    sampleEveryTicks: o.sampleEveryTicks ?? Math.max(20, Math.floor(o.durationTicks / 20)),
    repeats: o.repeats ?? 1,
    placement: o.placement ?? "with-updates",
    actions: o.actions ?? [],
    feeds: o.feeds ?? [],
    measure: o.measure ?? {},
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
  /** Milliseconds of server time per game tick while fast-forwarding the farm (lag indicator) */
  readonly msPerTick?: number;
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
  /** Reasons why this backend cannot reproduce the scenario's environment (empty = fine) */
  unsupported(scenario: Scenario): string[];
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

/**
 * Rate per hour from samples, starting after the warm-up. Negative rates mean
 * consumption (e.g. bone meal draining from the supply containers).
 */
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
      case "rate-at-most": {
        const m = summary[e.item]?.mean ?? 0;
        return { expectation: e, passed: m <= e.perHour, message: `${e.item}: ${m.toFixed(1)}/h measured, at most ${e.perHour}/h allowed.` };
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

/** Positions of all storage (ports with a stores declaration). */
export function storagePositions(a: ResolvedAssembly): Vec3[] {
  const out: Vec3[] = [];
  for (const inst of a.instances.values()) {
    for (const r of inst.template.rates) {
      if (r.type !== "stores") continue;
      const cell = inst.ports.get(r.port)?.absCells[0];
      if (cell) out.push(cell);
    }
  }
  return out;
}

