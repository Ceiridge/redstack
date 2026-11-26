/**
 * Environment: the game version and server settings a design is built for.
 *
 * Rates depend on it (random tick speed, hopper speed, growth modifiers), and
 * so do block states and game rule names. Components read it in `build`, test
 * backends apply what they can, and report what they cannot emulate.
 * Presets live in @redstack/stdlib (`environments`).
 */

export type Platform = "vanilla" | "fabric" | "spigot" | "paper" | "purpur" | "folia";

export interface Environment {
  readonly id: string;
  readonly name: string;
  /** Minecraft version, e.g. "26.3" */
  readonly minecraft: string;
  /** Minecraft data version of that release (schematic format, block states) */
  readonly dataVersion: number;
  readonly platform: Platform;
  /** Game rule `random_tick_speed` */
  readonly randomTickSpeed: number;
  /** Ticks between two hopper transfers (vanilla 8; Spigot `ticks-per.hopper-transfer`) */
  readonly hopperTransferTicks: number;
  /** Items per hopper transfer (vanilla 1; Spigot `hopper-amount`) */
  readonly hopperAmount: number;
  /** Growth speed in percent per crop (Spigot `growth.*-modifier`); missing = 100 */
  readonly growthModifiers: Readonly<Record<string, number>>;
  /** Simulation distance in chunks: how far from a player things tick */
  readonly simulationDistance: number;
  /** Free-form notes, e.g. "values guessed, not measured" */
  readonly notes: readonly string[];
}

/** Vanilla defaults for Minecraft 26.3, the version redstack is tested on. */
export const VANILLA_26_3: Environment = {
  id: "vanilla-26.3",
  name: "Vanilla 26.3",
  minecraft: "26.3",
  dataVersion: 5023,
  platform: "vanilla",
  randomTickSpeed: 3,
  hopperTransferTicks: 8,
  hopperAmount: 1,
  growthModifiers: {},
  simulationDistance: 10,
  notes: [],
};

export function growthFactor(env: Environment, crop: string): number {
  return (env.growthModifiers[crop] ?? 100) / 100;
}

/** Items per hour a single hopper moves in this environment. */
export function hopperItemsPerHour(env: Environment): number {
  return (72_000 / env.hopperTransferTicks) * env.hopperAmount;
}

/** Mean game ticks until one block receives `n` random ticks (4096 blocks per section). */
export function ticksForRandomTicks(env: Environment, n: number): number {
  return (n * 4096) / env.randomTickSpeed;
}
