/**
 * Materials: a component asks for "a fence" or "any solid block", not for one
 * hard-coded block. Each slot has a tag that describes what is acceptable and a
 * default. Assemblies can override slots by role (e.g. to build with cheaper
 * blocks); the static checks verify overrides against the tag when a block
 * registry is available.
 *
 * Tags are vanilla block tags ("#minecraft:fences") or redstack tags
 * ("#redstack:solid") that a BlockRegistry defines from block properties.
 */

export interface MaterialSlot {
  /** Role name used for overrides, e.g. "breaker" or "support" */
  readonly role: string;
  /** Acceptable blocks: "#namespace:tag", or an explicit list of block ids */
  readonly accepts: string | readonly string[];
  /** Block used when nothing is overridden */
  readonly default: string;
  readonly description?: string;
}

export function material(role: string, accepts: string | readonly string[], defaultId: string, description?: string): MaterialSlot {
  return { role, accepts, default: namespaced(defaultId), ...(description ? { description } : {}) };
}

/** Role → block id */
export type MaterialChoices = Readonly<Record<string, string>>;

export function namespaced(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** Common slots. Components may define their own with `material(...)`. */
export const M = {
  /** Any full, solid, non-falling block without a block entity (support, walls, floors) */
  solid: material("solid", "#redstack:solid", "minecraft:stone", "full solid block"),
  /** Blocks that cactus can stand on */
  cactusSoil: material("cactusSoil", "#minecraft:sand", "minecraft:sand", "sand or red sand"),
  /** Thin blocks that break cactus growth without blocking falling items much */
  cactusBreaker: material("cactusBreaker", "#minecraft:fences", "minecraft:oak_fence", "any fence"),
  /** Full blocks that are see-through (for windows and visual checks) */
  glass: material("glass", "#redstack:glass", "minecraft:glass", "any glass block"),
} as const;
