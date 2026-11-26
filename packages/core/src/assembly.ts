/**
 * Assembly: the top-level component of a design, plus resolution of the
 * component tree into absolute blocks, ports and connections.
 *
 *   const farm = assembly("cactus-farm", (f) => {
 *     f.add(CactusRow({ cells: 16 })).to(Chest);
 *   });
 *   const resolved = farm.resolve();
 */

import { type BlockSpec, rotateBlock } from "./blocks.js";
import {
  type BuildContext,
  ComponentBuilder,
  type ComponentTemplate,
  DEFAULT_CONTEXT,
  type MaterialUse,
  type PortDef,
  type PortEndpoint,
} from "./component.js";
import type { Diagnostic } from "./diagnostics.js";
import type { Environment } from "./environment.js";
import { type Rotation, type Vec3, add, key, normalizeRotation, rotateVec } from "./geometry.js";
import type { MaterialChoices } from "./materials.js";

export interface ResolvedPort extends PortDef {
  readonly instanceId: string;
  /** absolute cells */
  readonly absCells: readonly Vec3[];
}

export interface ResolvedInstance {
  /** Path in the component tree, e.g. "CactusRow#1/HopperLine#1" */
  readonly id: string;
  readonly template: ComponentTemplate;
  readonly origin: Vec3;
  readonly rotation: Rotation;
  /** Own ports only (exposed ports are resolved to the child that owns them) */
  readonly ports: ReadonlyMap<string, ResolvedPort>;
  readonly parent?: string;
}

export interface ResolvedBlock {
  readonly pos: Vec3;
  readonly block: BlockSpec;
  readonly instanceId: string;
}

export interface Connection {
  readonly from: { readonly instanceId: string; readonly port: string };
  readonly to: { readonly instanceId: string; readonly port: string };
}

export interface ResolvedAssembly {
  readonly name: string;
  readonly env: Environment;
  readonly instances: ReadonlyMap<string, ResolvedInstance>;
  /** All blocks, keyed "x,y,z" */
  readonly blocks: ReadonlyMap<string, ResolvedBlock>;
  /** Cells that must stay free, with the instances that need them */
  readonly clear: ReadonlyMap<string, { readonly pos: Vec3; readonly instances: readonly string[] }>;
  /** Connections between ports that own cells (exposed ports resolved) */
  readonly connections: readonly Connection[];
  readonly materials: ReadonlyArray<MaterialUse & { readonly instanceId: string }>;
  /** Ports of the root that lead outside (they may stay unconnected) */
  readonly openPorts: ReadonlyArray<{ readonly instanceId: string; readonly port: string }>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AssemblyOptions {
  readonly env?: Environment;
  /** Material overrides by role, e.g. { cactusBreaker: "minecraft:spruce_fence" } */
  readonly materials?: MaterialChoices;
}

/** The top-level component of a design. Has every builder method, plus `resolve()`. */
export class Assembly extends ComponentBuilder {
  constructor(name: string, options: AssemblyOptions = {}) {
    const ctx: BuildContext = { env: options.env ?? DEFAULT_CONTEXT.env, materials: options.materials ?? {} };
    super(name, ctx);
  }

  resolve(): ResolvedAssembly {
    return flatten(this.finish("draft", {}), this.name, this.ctx.env);
  }
}

/** Creates an assembly and runs `build` on it. */
export function assembly(name: string, build: (a: Assembly) => void, options: AssemblyOptions = {}): Assembly {
  const a = new Assembly(name, options);
  build(a);
  return a;
}

/** Resolves a component tree into absolute positions. */
export function flatten(root: ComponentTemplate, name: string, env: Environment): ResolvedAssembly {
  const instances = new Map<string, ResolvedInstance>();
  const blocks = new Map<string, ResolvedBlock>();
  const clear = new Map<string, { pos: Vec3; instances: string[] }>();
  const diagnostics: Diagnostic[] = [];
  const pending: Array<{ from: { path: string; ep: PortEndpoint }; to: { path: string; ep: PortEndpoint } }> = [];
  const materials: Array<MaterialUse & { instanceId: string }> = [];
  const templates = new Map<string, ComponentTemplate>();

  const childPath = (parent: string, id: string) => (parent === name ? id : `${parent}/${id}`);

  const visit = (t: ComponentTemplate, path: string, origin: Vec3, rot: Rotation, parent?: string): void => {
    templates.set(path, t);
    const toAbs = (v: Vec3) => add(origin, rotateVec(v, rot));
    const ports = new Map<string, ResolvedPort>();
    for (const [n, def] of t.ports) ports.set(n, { ...def, instanceId: path, absCells: def.cells.map(toAbs) });
    instances.set(path, { id: path, template: t, origin, rotation: rot, ports, ...(parent ? { parent } : {}) });

    for (const b of t.blocks) {
      const pos = toAbs(b.pos);
      const k = key(pos);
      const existing = blocks.get(k);
      if (existing) {
        diagnostics.push({
          severity: "error",
          code: "overlap",
          message: `Cell (${k}) is occupied twice: ${existing.instanceId} (${existing.block.id}) and ${path} (${b.block.id}).`,
          at: pos,
          instances: [existing.instanceId, path],
        });
        continue;
      }
      blocks.set(k, { pos, block: rotateBlock(b.block, rot), instanceId: path });
    }
    for (const c of t.clear) {
      const pos = toAbs(c);
      const k = key(pos);
      const entry = clear.get(k) ?? { pos, instances: [] };
      entry.instances.push(path);
      clear.set(k, entry);
    }
    for (const d of t.diagnostics) {
      diagnostics.push({
        ...d,
        message: `${path}: ${d.message}`,
        ...(d.at ? { at: toAbs(d.at) } : {}),
        ...(d.instances ? { instances: d.instances.map((i) => childPath(path, i)) } : {}),
      });
    }
    for (const m of t.materials) materials.push({ ...m, instanceId: path });
    for (const c of t.connections) pending.push({ from: { path, ep: c.from }, to: { path, ep: c.to } });
    for (const child of t.children) {
      visit(child.template, childPath(path, child.id), toAbs(child.origin), normalizeRotation(rot + child.rotation), path);
    }
  };
  visit(root, name, [0, 0, 0], 0);

  // Resolve a port reference to the instance that owns its cells
  const resolvePort = (path: string, port: string): { instanceId: string; port: string } | undefined => {
    const t = templates.get(path);
    if (!t) return undefined;
    if (t.ports.has(port)) return { instanceId: path, port };
    const exp = t.exposed.get(port);
    return exp ? resolvePort(childPath(path, exp.child), exp.port) : undefined;
  };
  const resolveEndpoint = (path: string, ep: PortEndpoint) => resolvePort(ep.child ? childPath(path, ep.child) : path, ep.port);

  const connections: Connection[] = [];
  for (const c of pending) {
    const from = resolveEndpoint(c.from.path, c.from.ep);
    const to = resolveEndpoint(c.to.path, c.to.ep);
    if (from && to) connections.push({ from, to });
  }

  // Free cells must not hold blocks of other instances
  for (const [k, c] of clear) {
    const b = blocks.get(k);
    if (!b) continue;
    diagnostics.push({
      severity: "error",
      code: "reserved-cell",
      message: `Cell (${k}) must stay free for ${c.instances.join(", ")}, but ${b.instanceId} places ${b.block.id} there.`,
      at: c.pos,
      instances: [...c.instances, b.instanceId],
    });
  }

  const openPorts = [...root.portView.keys()]
    .map((p) => resolvePort(name, p))
    .filter((p): p is { instanceId: string; port: string } => p !== undefined);

  return { name, env, instances, blocks, clear, connections, materials, openPorts, diagnostics };
}

/** Bounding box of all blocks, free cells and port cells (inclusive). */
export function bounds(a: ResolvedAssembly): { min: Vec3; max: Vec3 } {
  const cells: Vec3[] = [...a.blocks.values()].map((b) => b.pos);
  for (const c of a.clear.values()) cells.push(c.pos);
  for (const i of a.instances.values()) for (const p of i.ports.values()) cells.push(...p.absCells);
  if (cells.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, c[k]!);
      max[k] = Math.max(max[k]!, c[k]!);
    }
  }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}

/** Block counts by id (without block states), most used first – the bill of materials. */
export function billOfMaterials(a: ResolvedAssembly): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const b of a.blocks.values()) counts.set(b.block.id, (counts.get(b.block.id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((x, y) => y.count - x.count || x.id.localeCompare(y.id));
}
