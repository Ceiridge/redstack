/**
 * Schematic output interfaces. The core knows no file format; adapters
 * (e.g. @redstack/nucleation) implement them.
 */

import type { ResolvedAssembly } from "./assembly.js";

export type SchematicFormat = "litematic" | "schem" | "nbt";

export interface ExportOptions {
  readonly format: SchematicFormat;
  /** Target Minecraft data version. Omit for the newest one the adapter knows. */
  readonly targetDataVersion?: number;
  readonly author?: string;
  readonly description?: string;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  /** What was lost in conversion (e.g. blocks that do not exist in the target version) */
  readonly losses: readonly string[];
}

export interface SchematicWriter {
  readonly id: string;
  write(assembly: ResolvedAssembly, options: ExportOptions): ExportResult;
}

export interface SchematicReader {
  readonly id: string;
  /** Reads a file as a flat block list – the basis for importing proven designs. */
  read(bytes: Uint8Array, format: SchematicFormat): ReadonlyArray<{ pos: readonly [number, number, number]; block: string }>;
}
