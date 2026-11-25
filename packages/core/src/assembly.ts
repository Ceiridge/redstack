/**
 * Assemblies: composing components into farms (or machines).
 *
 * Instances dock onto each other through ports (attach), not coordinates.
 * Only one instance needs an anchor; otherwise the first one is anchored at
 * (0,0,0).
 */

import { type BlockSpec, rotateBlock } from "./blocks.js";
import type { ComponentTemplate, ComponentType, PortDef } from "./component.js";
import type { Diagnostic } from "./diagnostics.js";
import { type Rotation, type Vec3, add, key, normalizeRotation, rotateVec, sub } from "./geometry.js";

export interface PortRef {
  readonly instance: InstanceHandle;
  readonly port: string;
}

type Placement =
  | { kind: "none" }
  | { kind: "at"; pos: Vec3 }
  | { kind: "offset"; from: InstanceHandle; offset: Vec3 }
  | { kind: "attach"; myPort: string; target: PortRef; cellIndex: number };

export class InstanceHandle {
  readonly id: string;
  readonly template: ComponentTemplate;
  /** @internal */ placement: Placement = { kind: "none" };
  /** @internal */ rotation: Rotation | undefined;

  constructor(id: string, template: ComponentTemplate) {
    this.id = id;
    this.template = template;
  }

  at(pos: Vec3): this {
    this.placement = { kind: "at", pos };
    return this;
  }

  rotated(quarterTurnsClockwise: number): this {
    this.rotation = normalizeRotation(quarterTurnsClockwise);
    return this;
  }

  /** Offset relative to another instance, in that instance's local frame. */
  offsetFrom(other: InstanceHandle, offset: Vec3): this {
    this.placement = { kind: "offset", from: other, offset };
    return this;
  }

  /**
   * Docks one of this instance's ports onto another instance's port and
   * records the connection.
   * Own input to foreign output: the output's target cell becomes own input cell [cellIndex].
   * Own output to foreign input: own target cell becomes the other's input cell [cellIndex].
   */
  attach(myPort: string, target: PortRef, cellIndex = 0): this {
    this.placement = { kind: "attach", myPort, target, cellIndex };
    return this;
  }

  port(name: string): PortRef {
    if (!this.template.ports.has(name)) {
      throw new Error(`${this.id} (${this.template.typeName}) has no port "${name}".`);
    }
    return { instance: this, port: name };
  }
}

export interface ResolvedPort extends PortDef {
  readonly instanceId: string;
  /** absolute cells */
  readonly absCells: readonly Vec3[];
}

export interface ResolvedInstance {
  readonly id: string;
  readonly template: ComponentTemplate;
  readonly origin: Vec3;
  readonly rotation: Rotation;
  readonly ports: ReadonlyMap<string, ResolvedPort>;
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
  readonly instances: ReadonlyMap<string, ResolvedInstance>;
  /** All blocks, keyed "x,y,z". Air marks cells that must stay free. */
  readonly blocks: ReadonlyMap<string, ResolvedBlock>;
  readonly connections: readonly Connection[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Bounding box of all blocks and port cells (inclusive). */
export function bounds(a: ResolvedAssembly): { min: Vec3; max: Vec3 } {
  const cells: Vec3[] = [...a.blocks.values()].map((b) => b.pos);
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

export class Assembly {
  readonly name: string;
  readonly #instances: InstanceHandle[] = [];
  readonly #connections: Array<{ from: PortRef; to: PortRef }> = [];
  readonly #counters = new Map<string, number>();

  constructor(name: string) {
    this.name = name;
  }

  add<P extends Record<string, unknown>>(type: ComponentType<P>, params?: Partial<P>, id?: string): InstanceHandle {
    const n = (this.#counters.get(type.name) ?? 0) + 1;
    this.#counters.set(type.name, n);
    const handle = new InstanceHandle(id ?? `${type.name}#${n}`, type.instantiate(params));
    if (this.#instances.some((i) => i.id === handle.id)) throw new Error(`Duplicate instance id "${handle.id}".`);
    this.#instances.push(handle);
    return handle;
  }

  /**
   * A row of identical components. Place the first instance yourself; the
   * others follow every `step` (in the first instance's local frame).
   */
  row<P extends Record<string, unknown>>(
    type: ComponentType<P>,
    count: number,
    step: Vec3,
    params?: Partial<P>,
  ): InstanceHandle[] {
    if (count < 1) throw new Error("row: count must be >= 1.");
    const first = this.add(type, params);
    const out = [first];
    for (let i = 1; i < count; i++) {
      out.push(this.add(type, params).offsetFrom(first, [step[0] * i, step[1] * i, step[2] * i]));
    }
    return out;
  }

  /** Connects an output to an input (without moving anything). */
  connect(from: PortRef, to: PortRef): void {
    this.#connections.push({ from, to });
  }

  resolve(): ResolvedAssembly {
    const diagnostics: Diagnostic[] = [];
    const placed = new Map<string, { origin: Vec3; rotation: Rotation }>();
    const connections: Array<{ from: PortRef; to: PortRef }> = [...this.#connections];

    // attach implies a connection
    for (const inst of this.#instances) {
      if (inst.placement.kind === "attach") {
        const mine = inst.port(inst.placement.myPort);
        const myDef = inst.template.ports.get(mine.port)!;
        connections.push(
          myDef.direction === "in" ? { from: inst.placement.target, to: mine } : { from: mine, to: inst.placement.target },
        );
      }
    }

    if (this.#instances.length > 0 && this.#instances.every((i) => i.placement.kind !== "at")) {
      const first = this.#instances[0]!;
      if (first.placement.kind === "none") first.placement = { kind: "at", pos: [0, 0, 0] };
    }

    let progress = true;
    while (progress) {
      progress = false;
      for (const inst of this.#instances) {
        if (placed.has(inst.id)) continue;
        const r = this.#tryPlace(inst, placed);
        if (r) {
          placed.set(inst.id, r);
          progress = true;
        }
      }
    }

    for (const inst of this.#instances) {
      if (!placed.has(inst.id)) {
        diagnostics.push({
          severity: "error",
          code: "unplaced",
          message: `${inst.id} could not be placed (no anchor or circular dependency).`,
          instances: [inst.id],
        });
      }
    }

    // Resolve instances, collect blocks
    const instances = new Map<string, ResolvedInstance>();
    const blocks = new Map<string, ResolvedBlock>();
    for (const inst of this.#instances) {
      const p = placed.get(inst.id);
      if (!p) continue;
      const toAbs = (v: Vec3) => add(p.origin, rotateVec(v, p.rotation));
      const ports = new Map<string, ResolvedPort>();
      for (const [name, def] of inst.template.ports) {
        ports.set(name, { ...def, instanceId: inst.id, absCells: def.cells.map(toAbs) });
      }
      instances.set(inst.id, { id: inst.id, template: inst.template, origin: p.origin, rotation: p.rotation, ports });

      for (const b of inst.template.blocks) {
        const pos = toAbs(b.pos);
        const k = key(pos);
        const rb: ResolvedBlock = { pos, block: rotateBlock(b.block, p.rotation), instanceId: inst.id };
        const existing = blocks.get(k);
        if (existing) {
          const existingIsAir = existing.block.id === "minecraft:air";
          const newIsAir = rb.block.id === "minecraft:air";
          if (existingIsAir && newIsAir) continue; // both want the cell free: fine
          if (existingIsAir || newIsAir) {
            const keeper = existingIsAir ? existing.instanceId : inst.id;
            const builder = existingIsAir ? inst.id : existing.instanceId;
            diagnostics.push({
              severity: "error",
              code: "reserved-cell",
              message: `Cell (${k}) must stay free for ${keeper}, but ${builder} places a block there.`,
              at: pos,
              instances: [keeper, builder],
            });
          } else {
            diagnostics.push({
              severity: "error",
              code: "overlap",
              message: `Cell (${k}) is occupied twice: ${existing.instanceId} (${existing.block.id}) and ${inst.id} (${rb.block.id}).`,
              at: pos,
              instances: [existing.instanceId, inst.id],
            });
          }
          continue;
        }
        blocks.set(k, rb);
      }
    }

    return {
      name: this.name,
      instances,
      blocks,
      connections: connections
        .filter((c) => placed.has(c.from.instance.id) && placed.has(c.to.instance.id))
        .map((c) => ({
          from: { instanceId: c.from.instance.id, port: c.from.port },
          to: { instanceId: c.to.instance.id, port: c.to.port },
        })),
      diagnostics,
    };
  }

  #tryPlace(
    inst: InstanceHandle,
    placed: Map<string, { origin: Vec3; rotation: Rotation }>,
  ): { origin: Vec3; rotation: Rotation } | undefined {
    const pl = inst.placement;
    switch (pl.kind) {
      case "none":
        return undefined;
      case "at":
        return { origin: pl.pos, rotation: inst.rotation ?? 0 };
      case "offset": {
        const base = placed.get(pl.from.id);
        if (!base) return undefined;
        return {
          origin: add(base.origin, rotateVec(pl.offset, base.rotation)),
          rotation: inst.rotation ?? base.rotation,
        };
      }
      case "attach": {
        const other = placed.get(pl.target.instance.id);
        if (!other) return undefined;
        const rotation = inst.rotation ?? other.rotation;
        const myDef = inst.template.ports.get(pl.myPort)!;
        const otherDef = pl.target.instance.template.ports.get(pl.target.port)!;
        if (myDef.direction === otherDef.direction) {
          throw new Error(
            `attach: ${inst.id}.${pl.myPort} and ${pl.target.instance.id}.${pl.target.port} have the same direction (${myDef.direction}).`,
          );
        }
        const otherAbs = (v: Vec3) => add(other.origin, rotateVec(v, other.rotation));
        // Anchor cell: for an own input, the other output's (first) target cell;
        // for an own output, the other input's cell [cellIndex].
        const myLocal = myDef.direction === "in" ? myDef.cells[pl.cellIndex] : myDef.cells[0];
        const targetLocal = myDef.direction === "in" ? otherDef.cells[0] : otherDef.cells[pl.cellIndex];
        if (!myLocal || !targetLocal) throw new Error(`attach: cell index ${pl.cellIndex} does not exist.`);
        return { origin: sub(otherAbs(targetLocal), rotateVec(myLocal, rotation)), rotation };
      }
    }
  }
}
