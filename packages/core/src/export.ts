/**
 * Schnittstelle für Schematic-Ausgabe. Der Kern kennt kein Dateiformat;
 * Adapter (z. B. @redstack/export-nucleation) implementieren das.
 */

import type { ResolvedAssembly } from "./assembly.js";

export type SchematicFormat = "litematic" | "schem" | "nbt";

export interface ExportOptions {
  readonly format: SchematicFormat;
  /** Ziel-Datenversion von Minecraft. Weglassen = neueste, die der Adapter kennt. */
  readonly targetDataVersion?: number;
  readonly author?: string;
  readonly description?: string;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  /** Was bei der Konvertierung verloren ging (z. B. Blöcke, die es in der Zielversion nicht gibt). */
  readonly losses: readonly string[];
}

export interface SchematicWriter {
  readonly id: string;
  write(assembly: ResolvedAssembly, options: ExportOptions): ExportResult;
}

export interface SchematicReader {
  readonly id: string;
  /** Liest eine Datei als flache Blockliste – Basis für den Import erprobter Designs. */
  read(bytes: Uint8Array, format: SchematicFormat): ReadonlyArray<{ pos: readonly [number, number, number]; block: string }>;
}
