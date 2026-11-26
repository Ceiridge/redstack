import {
  B,
  type ComponentBuilder,
  type ComponentStatus,
  type ComponentType,
  type ExportOptions,
  type ExportResult,
  type ItemSlot,
  type Placed,
  type ResolvedAssembly,
  type SchematicFormat,
  type SchematicReader,
  type SchematicWriter,
  type Vec3,
  component,
  formatBlock,
  blockEntitySnbt,
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
    const nbt = blockEntitySnbt(b.block);
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
  /** Block entity as SNBT */
  readonly nbt?: string;
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
      const entities = new Map<string, string>();
      for (const e of JSON.parse(s.getAllBlockEntitiesSnbtJson()) as Array<{ position: [number, number, number]; snbt: string }>) {
        entities.set(e.position.join(","), e.snbt);
      }
      return list.map((b) => {
        const nbt = entities.get([b.x, b.y, b.z].join(","));
        return {
          pos: [b.x, b.y, b.z] as const,
          block: formatBlock({ id: b.name, props: Array.isArray(b.properties) ? Object.fromEntries(b.properties) : b.properties }),
          ...(nbt ? { nbt } : {}),
        };
      });
    } finally {
      s.clearContents();
    }
  },
};

/** Fields of a block entity that describe its position or transient state, not the design */
const TRANSIENT_FIELDS = new Set(["x", "y", "z", "id", "keepPacked", "TransferCooldown", "crafting_ticks_remaining", "triggered", "BurnTime", "CookTime", "CookTimeTotal", "cooking_time_spent", "cooking_total_time", "lit_time_remaining", "lit_total_time", "RecipesUsed", "OutputSignal"]);
/** Fields the game reads as int arrays; Nucleation prints them as plain lists */
const INT_ARRAY_FIELDS = new Set(["disabled_slots"]);

/** Splits an SNBT compound or list body at top-level commas. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** Top-level key → value (SNBT) of a compound. */
export function snbtFields(snbt: string): Map<string, string> {
  const t = snbt.trim();
  const out = new Map<string, string>();
  if (!t.startsWith("{") || !t.endsWith("}")) return out;
  for (const part of splitTopLevel(t.slice(1, -1))) {
    // The key ends at the first colon outside quotes
    let i = 0;
    let quote: string | undefined;
    for (; i < part.length; i++) {
      const ch = part[i]!;
      if (quote) {
        if (ch === quote) quote = undefined;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ":") break;
    }
    const key = part.slice(0, i).trim().replace(/^["']|["']$/g, "");
    out.set(key, part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Items and further fields of a block entity. Items with components (a
 * filled shulker box in a chest) are kept as raw SNBT under `Items`, so
 * nothing is lost; plain ones become item slots.
 */
export function blockEntityFields(snbt: string): { items: ItemSlot[]; data: Record<string, string> } {
  const fields = snbtFields(snbt);
  const items: ItemSlot[] = [];
  const data: Record<string, string> = {};
  for (const [k, v] of fields) {
    if (TRANSIENT_FIELDS.has(k)) continue;
    if (k === "components" && v.replace(/\s/g, "") === "{}") continue;
    if (k === "Items" && v.startsWith("[")) {
      const entries = splitTopLevel(v.slice(1, -1)).map(snbtFields);
      const plain = entries.every((e) => !e.has("components") || e.get("components")!.replace(/\s/g, "") === "{}");
      if (plain) {
        for (const e of entries) {
          items.push({
            slot: Number.parseInt(e.get("Slot") ?? "0", 10),
            id: (e.get("id") ?? "").replace(/^["']|["']$/g, ""),
            count: Number.parseInt(e.get("count") ?? e.get("Count") ?? "1", 10),
          });
        }
        continue;
      }
    }
    data[k] = INT_ARRAY_FIELDS.has(k) && /^\[\s*-?\d/.test(v) && !v.startsWith("[I;") ? `[I;${v.slice(1)}` : v;
  }
  return { items, data };
}

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
      let spec = B.of(id, props);
      if (b.nbt) {
        const { items, data } = blockEntityFields(b.nbt);
        if (items.length) spec = spec.withSlots(items);
        if (Object.keys(data).length) spec = spec.withData(data);
      }
      const p = c.block(spec).at(pos);
      placed.push({ p, block: b.block });
    }
    const find = (match: string | ((block: string) => boolean)) =>
      placed
        .filter(({ block }) => (typeof match === "string" ? block === match || block.startsWith(`${match}[`) : match(block)))
        .map(({ p }) => p);
    o.setup?.(c, find);
  });
}
