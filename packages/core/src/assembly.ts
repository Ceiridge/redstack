/**
 * Assemblies: Komponenten zu Farmen (oder Maschinen) zusammensetzen.
 *
 * Instanzen werden über Ports angedockt (attach), nicht über Koordinaten.
 * Nur eine Instanz braucht einen Ankerpunkt; die erste wird sonst bei (0,0,0)
 * verankert.
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

  /** Versatz relativ zu einer anderen Instanz, in deren lokalem Rahmen. */
  offsetFrom(other: InstanceHandle, offset: Vec3): this {
    this.placement = { kind: "offset", from: other, offset };
    return this;
  }

  /**
   * Dockt einen eigenen Port an einen fremden an und legt die Verbindung an.
   * Eigener Eingang an fremden Ausgang: Zielzelle des Ausgangs = eigene Eingangszelle[cellIndex].
   * Eigener Ausgang an fremden Eingang: eigene Zielzelle = Eingangszelle[cellIndex] des anderen.
   */
  attach(myPort: string, target: PortRef, cellIndex = 0): this {
    this.placement = { kind: "attach", myPort, target, cellIndex };
    return this;
  }

  port(name: string): PortRef {
    if (!this.template.ports.has(name)) {
      throw new Error(`${this.id} (${this.template.typeName}) hat keinen Port "${name}".`);
    }
    return { instance: this, port: name };
  }
}

export interface ResolvedPort extends PortDef {
  readonly instanceId: string;
  /** absolute Zellen */
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
  /** Alle Blöcke, Schlüssel "x,y,z" */
  readonly blocks: ReadonlyMap<string, ResolvedBlock>;
  readonly connections: readonly Connection[];
  readonly diagnostics: readonly Diagnostic[];
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
    if (this.#instances.some((i) => i.id === handle.id)) throw new Error(`Instanz-ID "${handle.id}" doppelt.`);
    this.#instances.push(handle);
    return handle;
  }

  /**
   * Reihe gleicher Komponenten. Die erste Instanz platzierst du selbst, die
   * weiteren folgen im Abstand `step` (im lokalen Rahmen der ersten).
   */
  row<P extends Record<string, unknown>>(
    type: ComponentType<P>,
    count: number,
    step: Vec3,
    params?: Partial<P>,
  ): InstanceHandle[] {
    if (count < 1) throw new Error("row: count muss >= 1 sein.");
    const first = this.add(type, params);
    const out = [first];
    for (let i = 1; i < count; i++) {
      out.push(this.add(type, params).offsetFrom(first, [step[0] * i, step[1] * i, step[2] * i]));
    }
    return out;
  }

  /** Verbindet einen Ausgang mit einem Eingang (ohne die Position zu ändern). */
  connect(from: PortRef, to: PortRef): void {
    this.#connections.push({ from, to });
  }

  resolve(): ResolvedAssembly {
    const diagnostics: Diagnostic[] = [];
    const placed = new Map<string, { origin: Vec3; rotation: Rotation }>();
    const connections: Array<{ from: PortRef; to: PortRef }> = [...this.#connections];

    // Attach erzeugt automatisch eine Verbindung
    for (const inst of this.#instances) {
      if (inst.placement.kind === "attach") {
        const mine = inst.port(inst.placement.myPort);
        const myDef = inst.template.ports.get(mine.port)!;
        connections.push(myDef.direction === "in" ? { from: inst.placement.target, to: mine } : { from: mine, to: inst.placement.target });
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
          message: `${inst.id} konnte nicht platziert werden (kein Anker oder zirkuläre Abhängigkeit).`,
          instances: [inst.id],
        });
      }
    }

    // Instanzen auflösen, Blöcke einsammeln
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
          const reserved = existing.block.id === "minecraft:air" || rb.block.id === "minecraft:air";
          diagnostics.push({
            severity: "error",
            code: reserved ? "reserved-cell" : "overlap",
            message: reserved
              ? `Zelle (${k}) ist von ${existing.block.id === "minecraft:air" ? existing.instanceId : inst.id} freigehalten, aber ${existing.block.id === "minecraft:air" ? inst.id : existing.instanceId} setzt dort einen Block.`
              : `Zelle (${k}) doppelt belegt: ${existing.instanceId} (${existing.block.id}) und ${inst.id} (${rb.block.id}).`,
            at: pos,
            instances: [existing.instanceId, inst.id],
          });
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
            `attach: ${inst.id}.${pl.myPort} und ${pl.target.instance.id}.${pl.target.port} haben dieselbe Richtung (${myDef.direction}).`,
          );
        }
        const otherAbs = (v: Vec3) => add(other.origin, rotateVec(v, other.rotation));
        // Ankerzelle: bei eigenem Eingang die Zielzelle des fremden Ausgangs (erste),
        // bei eigenem Ausgang die Eingangszelle[cellIndex] des anderen.
        const myLocal = myDef.direction === "in" ? myDef.cells[pl.cellIndex] : myDef.cells[0];
        const targetAbs = myDef.direction === "in" ? otherAbs(otherDef.cells[0]!) : otherAbs(otherDef.cells[pl.cellIndex]!);
        if (!myLocal || !targetAbs) throw new Error(`attach: Zellindex ${pl.cellIndex} existiert nicht.`);
        return { origin: sub(targetAbs, rotateVec(myLocal, rotation)), rotation };
      }
    }
  }
}
