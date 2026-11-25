/**
 * Test-Schnittstelle. Backends (Fabric-Server, Paper-Server, Redstone-Simulator)
 * implementieren TestBackend; Szenarien und Berichte sind backend-unabhängig.
 *
 * Stufen:
 *   0  statische Checks (@redstack/core)
 *   1  Flussmodell (@redstack/flow)
 *   2  Komponententest auf einem Backend
 *   3  ganze Assembly, mehrere Läufe, Statistik
 */

import type { ResolvedAssembly, Vec3 } from "@redstack/core";
import type { FlowAnalysis } from "@redstack/flow";

/** Was ein Backend simulieren kann. Szenarien verlangen Fähigkeiten, Backends erfüllen sie. */
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
  /** z. B. "void", "flat", "copy-of-terrain" */
  readonly terrain: "void" | "flat" | "terrain";
  readonly biome?: string;
  /** Position des AFK-Spielers relativ zum Assembly-Ursprung */
  readonly afkSpot?: Vec3;
  readonly simulationDistance?: number;
  readonly gamerules?: Readonly<Record<string, string | number | boolean>>;
  /** Server-Profil, z. B. "vanilla", "paper-default", "donut-guess" */
  readonly serverProfile?: string;
}

export type Action =
  | { readonly type: "insert"; readonly at: Vec3; readonly item: string; readonly count: number }
  | { readonly type: "power"; readonly at: Vec3; readonly ticks: number }
  | { readonly type: "reload-chunks" }
  | { readonly type: "wait"; readonly ticks: number };

export type Expectation =
  | { readonly type: "rate-at-least"; readonly item: string; readonly perHour: number }
  | { readonly type: "no-ground-items" }
  | { readonly type: "no-stuck-hoppers" }
  | { readonly type: "container-contains"; readonly at: Vec3; readonly item: string; readonly atLeast: number }
  | { readonly type: "matches-flow-model"; readonly tolerance: number };

export interface Scenario {
  readonly name: string;
  readonly assembly: ResolvedAssembly;
  readonly environment: Environment;
  readonly requires: readonly Capability[];
  readonly durationTicks: number;
  /** Anzahl unabhängiger Läufe, für Statistik bei Zufallsmechaniken */
  readonly repeats: number;
  readonly actions: readonly Action[];
  readonly expectations: readonly Expectation[];
}

/** Ein Ereignis mit Ort – das, was die KI zum Reparieren braucht. */
export interface TestEvent {
  readonly tick: number;
  readonly type: "stuck-hopper" | "ground-items" | "item-destroyed" | "entity-escaped" | "custom";
  readonly at?: Vec3;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface RunResult {
  readonly run: number;
  readonly ticks: number;
  /** gemessene Raten je Item, hochgerechnet auf eine Stunde */
  readonly measuredPerHour: Readonly<Record<string, number>>;
  readonly events: readonly TestEvent[];
  readonly msptAvg?: number;
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
  /** Mittelwert und Standardabweichung über die Läufe */
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

/**
 * Vergleicht Messung mit Flussmodell. Weicht ein Item stärker ab als die
 * Toleranz (relativ), ist entweder das Ratenmodell der Komponente falsch
 * oder die Farm kaputt – beides muss behoben werden.
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
      problems.push(`${item}: Modell ${predicted.toFixed(1)}/h, gemessen ${measured.toFixed(1)}/h (${(rel * 100).toFixed(0)} % Abweichung)`);
    }
  }
  return {
    expectation: { type: "matches-flow-model", tolerance },
    passed: problems.length === 0,
    message: problems.length ? problems.join("; ") : "Messung passt zum Modell.",
  };
}
