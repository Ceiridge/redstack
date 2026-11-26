import {
  B,
  type ComponentBuilder,
  type ComponentStatus,
  type ComponentType,
  type ExportOptions,
  type ExportResult,
  type Placed,
  type ResolvedAssembly,
  type SchematicFormat,
  type SchematicReader,
  type SchematicWriter,
  type Vec3,
  component,
  formatBlock,
  itemsSnbt,
} from "@redstack/core";
import { Schematic } from "nucleation";

/**
 * Version note: from data version 5006 (Minecraft 26.3 according to
 * Nucleation) the block palette is written as {id, properties}, before that as
 * {Name, Properties}. Litematica's web preview reads the 26.3 files.
 */

const b64ToBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

/** Data version that Nucleation writes without conversion. */
export function nativeDataVersion(): number {
  return Schematic.canonicalDataVersion();
}

/** Builds a Nucleation schematic from a resolved assembly. Caller must call clearContents() when done. */
export function toNucleationSchematic(assembly: ResolvedAssembly, meta: { author?: string; description?: string } = {}): Schematic {
  const s = Schematic.create(assembly.name);
  if (meta.author) s.setAuthor(meta.author);
  if (meta.description) s.setDescription(meta.description);
  for (const b of assembly.blocks.values()) {
    // Container contents ride along as block-entity NBT: minecraft:hopper[…]{Items:[…]}
    const nbt = b.block.items?.length ? itemsSnbt(b.block.items) : "";
    s.setBlockFromString(b.pos[0], b.pos[1], b.pos[2], formatBlock(b.block) + nbt);
  }
  return s;
}

export const nucleationWriter: SchematicWriter = {
  id: "nucleation",
  write(assembly: ResolvedAssembly, options: ExportOptions): ExportResult {
    const s = toNucleationSchematic(assembly, options);
    try {
      switch (options.format) {
        case "litematic": {
          if (options.targetDataVersion === undefined || options.targetDataVersion === nativeDataVersion()) {
            return { bytes: b64ToBytes(s.toLitematicB64()), losses: [] };
          }
          const r = JSON.parse(s.toLitematicForVersionJson(options.targetDataVersion)) as { data_b64: string; loss: unknown[] };
          return { bytes: b64ToBytes(r.data_b64), losses: r.loss.map((l) => JSON.stringify(l)) };
        }
        case "schem":
          if (options.targetDataVersion !== undefined) throw new Error("schem export with a target version is not wired up yet.");
          return { bytes: b64ToBytes(s.toSchematicB64()), losses: [] };
        case "nbt":
          throw new Error("Structure block export (.nbt) is not wired up yet.");
      }
    } finally {
      s.clearContents();
    }
  },
};

export interface ReadBlock {
  readonly pos: Vec3;
  readonly block: string;
}

function parse(bytes: Uint8Array, format: SchematicFormat): Schematic {
  const data = Array.from(bytes);
  if (format === "litematic") return Schematic.fromLitematic(data);
  if (format === "schem") return Schematic.fromSchematic(data);
  throw new Error(`Import of ${format} is not wired up yet.`);
}

export const nucleationReader: SchematicReader = {
  id: "nucleation",
  read(bytes, format) {
    const s = parse(bytes, format);
    try {
      const list = JSON.parse(s.getNonAirBlocksJson()) as Array<{
        x: number;
        y: number;
        z: number;
        name: string;
        properties: Record<string, string> | Array<[string, string]>;
      }>;
      return list.map((b) => ({
        pos: [b.x, b.y, b.z] as const,
        block: formatBlock({ id: b.name, props: Array.isArray(b.properties) ? Object.fromEntries(b.properties) : b.properties }),
      }));
    } finally {
      s.clearContents();
    }
  },
};

/** Format from a file name. */
export function formatOf(fileName: string): SchematicFormat {
  if (/\.litematic$/i.test(fileName)) return "litematic";
  if (/\.schem$/i.test(fileName)) return "schem";
  if (/\.nbt$/i.test(fileName)) return "nbt";
  throw new Error(`Unknown schematic format: ${fileName}`);
}

function parseBlockString(s: string): { id: string; props: Record<string, string> } {
  const m = /^([^[]+)(?:\[(.*)\])?$/.exec(s);
  if (!m) throw new Error(`Cannot parse block "${s}".`);
  const props: Record<string, string> = {};
  for (const kv of (m[2] ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined) props[k] = v;
  }
  return { id: m[1]!, props };
}

export interface SchematicComponentOptions {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly format: SchematicFormat;
  readonly status?: ComponentStatus;
  readonly description?: string;
  /**
   * Declare ports and rates on the imported blocks. `find` returns the blocks
   * with a given id (or matching a predicate), in the imported design's frame
   * with its lowest corner at (0,0,0).
   */
  readonly setup?: (c: ComponentBuilder, find: (match: string | ((block: string) => boolean)) => Placed[]) => void;
  /** Leave out blocks (position in the design's frame, lowest corner at 0,0,0), e.g. a storage hall to replace */
  readonly exclude?: (pos: Vec3, block: string) => boolean;
}

/**
 * Turns an existing schematic into a component, e.g. to benchmark a proven
 * farm on the test server or to compose it with other components.
 */
export function schematicComponent(o: SchematicComponentOptions): ComponentType {
  const blocks = nucleationReader.read(o.bytes, o.format);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const b of blocks) for (let k = 0; k < 3; k++) min[k] = Math.min(min[k]!, b.pos[k]!);
  return component({ name: o.name, status: o.status ?? "unverified", description: o.description ?? "" }, (c) => {
    const placed: Array<{ p: Placed; block: string }> = [];
    for (const b of blocks) {
      const pos: Vec3 = [b.pos[0] - min[0], b.pos[1] - min[1], b.pos[2] - min[2]];
      if (o.exclude?.(pos, b.block)) continue;
      const { id, props } = parseBlockString(b.block);
      const p = c.block(B.of(id, props)).at(pos);
      placed.push({ p, block: b.block });
    }
    const find = (match: string | ((block: string) => boolean)) =>
      placed
        .filter(({ block }) => (typeof match === "string" ? block === match || block.startsWith(`${match}[`) : match(block)))
        .map(({ p }) => p);
    o.setup?.(c, find);
  });
}
