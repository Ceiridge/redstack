import type { BlockInfo, BlockRegistry } from "@redstack/core";
import { Blocks } from "nucleation";

/**
 * Block registry backed by Nucleation's built-in block table (all vanilla
 * blocks with tags, definition kinds, states and average texture colours).
 *
 * Besides vanilla tags it defines redstack tags derived from block facts:
 *   #redstack:solid  plain full solid blocks: kind "block" or "rotated_pillar",
 *                    full cube, no block entity (no sand, glass, slime, TNT, …)
 *   #redstack:glass  every glass block (vanilla tag "impermeable" without barrier)
 */
export class NucleationRegistry implements BlockRegistry {
  readonly id = "nucleation";
  readonly #info = new Map<string, BlockInfo | undefined>();
  readonly #tags = new Map<string, readonly string[]>();

  info(id: string): BlockInfo | undefined {
    if (this.#info.has(id)) return this.#info.get(id);
    let info: BlockInfo | undefined;
    try {
      const j = JSON.parse(Blocks.getJson(id)) as {
        id: string;
        kind: string;
        tags?: string[];
        properties?: Record<string, string[]>;
        default_state?: Record<string, string>;
        full_cube: boolean;
        has_block_entity: boolean;
        color: [number, number, number];
      };
      info = {
        id: j.id,
        kind: j.kind,
        tags: j.tags ?? [],
        properties: j.properties ?? {},
        defaultState: j.default_state ?? {},
        fullCube: j.full_cube,
        hasBlockEntity: j.has_block_entity,
        color: j.color,
      };
    } catch {
      info = undefined;
    }
    this.#info.set(id, info);
    return info;
  }

  withTag(tag: string): readonly string[] {
    const t = tag.replace(/^#/, "");
    const cached = this.#tags.get(t);
    if (cached) return cached;
    let ids: readonly string[];
    if (t === "redstack:solid") {
      ids = this.allIds().filter((id) => {
        const i = this.info(id);
        return !!i && i.fullCube && !i.hasBlockEntity && (i.kind === "minecraft:block" || i.kind === "minecraft:rotated_pillar");
      });
    } else if (t === "redstack:glass") {
      ids = this.withTag("minecraft:impermeable").filter((id) => id !== "minecraft:barrier");
    } else {
      ids = JSON.parse(Blocks.byTagJson(t)) as string[];
    }
    this.#tags.set(t, ids);
    return ids;
  }

  allIds(): readonly string[] {
    return JSON.parse(Blocks.idsJson()) as string[];
  }
}

/** Shared instance (the table is static). */
export const registry = new NucleationRegistry();
