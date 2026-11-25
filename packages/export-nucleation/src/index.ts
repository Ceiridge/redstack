/**
 * Adapter: ResolvedAssembly → Schematic-Datei über Nucleation.
 *
 * Nucleation ist eine fremde, junge Bibliothek. Sie wird ausschließlich hier
 * verwendet, damit sie austauschbar bleibt (siehe docs/ARCHITECTURE.md).
 *
 * Hinweis zur Version: Nucleation schreibt den Block-Palette-Eintrag ab
 * Datenversion 5006 (laut Nucleation: Minecraft 26.3) als {id, properties},
 * davor als {Name, Properties}. Ob Litematica auf dem Zielsystem das Format
 * liest, muss einmal im Spiel geprüft werden (docs/PLAN.md, Phase 0).
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

/** Datenversion, die Nucleation ohne Konvertierung schreibt. */
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
        if (b.block.id === "minecraft:air") continue; // freigehaltene Zellen nicht exportieren
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
            throw new Error("schem-Export mit Zielversion ist noch nicht angebunden.");
          }
          return { bytes: b64ToBytes(s.toSchematicB64()), losses: [] };
        case "nbt":
          throw new Error("Structure-Block-Export (.nbt) ist noch nicht angebunden.");
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
              throw new Error(`Import von ${format} noch nicht angebunden.`);
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
