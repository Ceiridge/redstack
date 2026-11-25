/**
 * Adapter: ResolvedAssembly → schematic file via Nucleation.
 *
 * Nucleation is a young third-party library. It is used only here, so it
 * stays replaceable (see docs/ARCHITECTURE.md).
 *
 * Version note: from data version 5006 (Minecraft 26.3 according to
 * Nucleation) the block palette is written as {id, properties}, before that as
 * {Name, Properties}. Whether Litematica reads the format on the target
 * system still has to be checked once in-game (docs/PLAN.md, phase 0).
 */

import {
  type ExportOptions,
  type ExportResult,
  type ResolvedAssembly,
  type SchematicReader,
  type SchematicWriter,
  formatBlock,
} from "@redstack/core";
import { Schematic } from "nucleation";

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Data version that Nucleation writes without conversion. */
export function nativeDataVersion(): number {
  return Schematic.canonicalDataVersion();
}

export const nucleationWriter: SchematicWriter = {
  id: "nucleation",
  write(assembly: ResolvedAssembly, options: ExportOptions): ExportResult {
    const s = Schematic.create(assembly.name);
    try {
      if (options.author) s.setAuthor(options.author);
      if (options.description) s.setDescription(options.description);
      for (const b of assembly.blocks.values()) {
        if (b.block.id === "minecraft:air") continue; // reserved cells are not exported
        s.setBlockFromString(b.pos[0], b.pos[1], b.pos[2], formatBlock(b.block));
      }
      switch (options.format) {
        case "litematic": {
          if (options.targetDataVersion === undefined || options.targetDataVersion === nativeDataVersion()) {
            return { bytes: b64ToBytes(s.toLitematicB64()), losses: [] };
          }
          const r = JSON.parse(s.toLitematicForVersionJson(options.targetDataVersion)) as {
            data_b64: string;
            loss: unknown[];
          };
          return { bytes: b64ToBytes(r.data_b64), losses: r.loss.map((l) => JSON.stringify(l)) };
        }
        case "schem":
          if (options.targetDataVersion !== undefined) {
            throw new Error("schem export with a target version is not wired up yet.");
          }
          return { bytes: b64ToBytes(s.toSchematicB64()), losses: [] };
        case "nbt":
          throw new Error("Structure block export (.nbt) is not wired up yet.");
      }
    } finally {
      s.clearContents();
    }
  },
};

export const nucleationReader: SchematicReader = {
  id: "nucleation",
  read(bytes, format) {
    const data = Array.from(bytes);
    const s =
      format === "litematic"
        ? Schematic.fromLitematic(data)
        : format === "schem"
          ? Schematic.fromSchematic(data)
          : (() => {
              throw new Error(`Import of ${format} is not wired up yet.`);
            })();
    try {
      const list = JSON.parse(s.getNonAirBlocksJson()) as Array<{
        x: number;
        y: number;
        z: number;
        name: string;
        properties: Record<string, string> | Array<[string, string]>;
      }>;
      return list.map((b) => {
        const props = Array.isArray(b.properties) ? Object.fromEntries(b.properties) : b.properties;
        return {
          pos: [b.x, b.y, b.z] as const,
          block: formatBlock({ id: b.name, props }),
        };
      });
    } finally {
      s.clearContents();
    }
  },
};
