/**
 * Block registry: facts about blocks (properties, tags, shape, colour).
 *
 * The core only defines the interface; @redstack/nucleation implements it from
 * Nucleation's built-in block table. Everything that needs block facts takes a
 * registry as an optional argument, so the core stays dependency-free.
 */

export interface BlockInfo {
  readonly id: string;
  /** Official definition kind, e.g. "minecraft:fence" */
  readonly kind: string;
  readonly tags: readonly string[];
  /** Property name → allowed values */
  readonly properties: Readonly<Record<string, readonly string[]>>;
  readonly defaultState: Readonly<Record<string, string>>;
  /** Occupies the whole cell */
  readonly fullCube: boolean;
  readonly hasBlockEntity: boolean;
  /** Average texture colour [r, g, b] */
  readonly color: readonly [number, number, number];
}

export interface BlockRegistry {
  readonly id: string;
  info(id: string): BlockInfo | undefined;
  /** Block ids carrying a tag ("#minecraft:fences" or "minecraft:fences", or a redstack tag) */
  withTag(tag: string): readonly string[];
}

/** Whether `id` satisfies a material's `accepts` (tag or list). */
export function accepts(registry: BlockRegistry, accepted: string | readonly string[], id: string): boolean {
  if (typeof accepted !== "string") return accepted.includes(id);
  return registry.withTag(accepted).includes(id);
}
