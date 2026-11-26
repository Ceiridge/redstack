import { type Environment, VANILLA_26_3 } from "@redstack/core";

/**
 * Environment presets. Pass one to an assembly (`{ env }`) so rates and
 * block states fit the target server. Values that are guesses say so in
 * `notes`; measure on the real server before relying on them.
 */

export const vanilla = VANILLA_26_3;

/** Paper with its default configuration (Spigot defaults for growth and hoppers). */
export const paperDefaults: Environment = {
  ...VANILLA_26_3,
  id: "paper-26.3",
  name: "Paper 26.3 (default config)",
  platform: "paper",
  notes: ["Paper default configuration; server operators often change growth, hopper and entity settings."],
};

/**
 * DonutSMP – a guess. Donut does not publish its configuration; this assumes
 * Paper defaults with a short simulation distance, which is common on large
 * servers. Verify rates in-game before planning around them.
 */
export const donutGuess: Environment = {
  ...paperDefaults,
  id: "donut-guess",
  name: "DonutSMP (guessed)",
  simulationDistance: 4,
  notes: ["Not measured: assumed Paper defaults and simulation distance 4."],
};

export const environments = { vanilla, paperDefaults, donutGuess } as const;

/** Builds a variant, e.g. a server with a 200 % cactus growth modifier. */
export function withSettings(base: Environment, changes: Partial<Omit<Environment, "id">> & { id: string }): Environment {
  return { ...base, ...changes, growthModifiers: { ...base.growthModifiers, ...changes.growthModifiers } };
}
