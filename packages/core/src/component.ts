/**
 * Komponenten: wiederverwendbare Bausteine mit Blöcken, Ports und Ratenmodell.
 *
 * Blöcke werden über Beziehungen platziert (above, inFrontOf, ...), nicht über
 * Koordinaten. Nur der erste Block braucht einen Ankerpunkt.
 */

import type { BlockSpec } from "./blocks.js";
import {
  type Dir,
  type RelDir,
  type Vec3,
  DIR_VECTORS,
  add,
  isRelDir,
  key,
  relToLocal,
} from "./geometry.js";

/**
 * Port-Typen. "items" und "fluid" sind für Farmen, "signal" und "bus" für
 * Redstone-Logik (spätere CPU-Module). Neue Typen kommen hier dazu, ohne dass
 * sich der Rest ändert.
 */
export type PortKind = "items" | "fluid" | "signal" | "bus";
export type PortDirection = "in" | "out";

export interface PortDef {
  readonly name: string;
  readonly direction: PortDirection;
  readonly kind: PortKind;
  /**
   * in:  Zellen, die etwas annehmen (z. B. die Hopper eines Sammelbands).
   * out: Zielzellen, an die etwas geliefert wird (z. B. der Block unter einem Hopper).
   * Eine Verbindung ist geometrisch gültig, wenn alle Ziele des Ausgangs
   * unter den Zellen des Eingangs liegen.
   */
  readonly cells: readonly Vec3[];
  /** Bitbreite für Bus-Ports */
  readonly width?: number;
  /** Optionaler Item-Filter, z. B. "minecraft:cactus" */
  readonly item?: string;
  /** Darf unverbunden bleiben, ohne Warnung */
  readonly optional?: boolean;
  readonly description?: string;
}

/** Herkunft einer Zahl: wichtig, damit Modell und Messung später verglichen werden können. */
export type RateBasis = "game-mechanic" | "measured" | "estimate";

export type RateDecl =
  | {
      readonly type: "produces";
      readonly port: string;
      readonly item: string;
      readonly perHour: number;
      readonly basis: RateBasis;
      readonly note?: string;
    }
  | {
      readonly type: "passes";
      readonly from: string;
      readonly to: string;
      readonly maxPerHour: number;
      readonly basis: RateBasis;
      readonly note?: string;
    }
  | {
      readonly type: "stores";
      readonly port: string;
      readonly capacityItems: number;
      readonly basis: RateBasis;
      readonly note?: string;
    }
  | {
      readonly type: "consumes";
      readonly item: string;
      readonly perHour: number;
      readonly basis: RateBasis;
      readonly note?: string;
    };

/**
 * Reifegrad einer Komponente. Nur "game-tested" und höher darf als
 * funktionierend gelten.
 */
export type ComponentStatus =
  | "draft" // nur skizziert
  | "unverified" // vollständig, aber nie im Spiel getestet
  | "game-tested" // automatischer Test auf Testserver grün
  | "server-verified"; // zusätzlich auf dem Zielserver bestätigt

export interface PlacedBlock {
  readonly pos: Vec3;
  readonly block: BlockSpec;
}

/** Ergebnis einer gebauten Komponente in lokalen Koordinaten. */
export interface ComponentTemplate {
  readonly typeName: string;
  readonly status: ComponentStatus;
  readonly params: Readonly<Record<string, unknown>>;
  readonly blocks: readonly PlacedBlock[];
  readonly ports: ReadonlyMap<string, PortDef>;
  readonly rates: readonly RateDecl[];
  readonly notes: readonly string[];
}

export interface ComponentType<P extends Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly status: ComponentStatus;
  readonly defaults: P;
  instantiate(params?: Partial<P>): ComponentTemplate;
}

export interface ComponentDefinition<P extends Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly status: ComponentStatus;
  readonly defaults: P;
  build(c: ComponentBuilder, params: P): void;
}

export function defineComponent<P extends Record<string, unknown>>(
  def: ComponentDefinition<P>,
): ComponentType<P> {
  return {
    name: def.name,
    description: def.description,
    status: def.status,
    defaults: def.defaults,
    instantiate(params?: Partial<P>): ComponentTemplate {
      const p = { ...def.defaults, ...(params ?? {}) } as P;
      const builder = new ComponentBuilder(def.name);
      def.build(builder, p);
      return builder.finish(def.status, p);
    },
  };
}

/** Handle auf einen platzierten Block innerhalb einer Komponente. */
export class Placed {
  #pos: Vec3 | undefined;
  readonly block: BlockSpec;
  readonly #owner: ComponentBuilder;

  constructor(owner: ComponentBuilder, block: BlockSpec) {
    this.#owner = owner;
    this.block = block;
  }

  get pos(): Vec3 {
    if (!this.#pos) throw new Error(`${this.#owner.name}: Block ${this.block.id} hat noch keine Position.`);
    return this.#pos;
  }

  get isPositioned(): boolean {
    return this.#pos !== undefined;
  }

  at(pos: Vec3): this {
    if (this.#pos) throw new Error(`${this.#owner.name}: Block ${this.block.id} ist bereits platziert.`);
    this.#pos = pos;
    this.#owner.register(this);
    return this;
  }

  /** Platziert diesen Block neben `other` in Richtung `dir` (lokal). */
  nextTo(other: Placed, dir: RelDir | Dir): this {
    const d = isRelDir(dir) ? relToLocal(dir) : dir;
    return this.at(add(other.pos, DIR_VECTORS[d]));
  }

  above(other: Placed): this {
    return this.nextTo(other, "up");
  }
  below(other: Placed): this {
    return this.nextTo(other, "down");
  }
  inFrontOf(other: Placed): this {
    return this.nextTo(other, "forward");
  }
  behind(other: Placed): this {
    return this.nextTo(other, "back");
  }
  leftOf(other: Placed): this {
    return this.nextTo(other, "left");
  }
  rightOf(other: Placed): this {
    return this.nextTo(other, "right");
  }
  offsetFrom(other: Placed, offset: Vec3): this {
    return this.at(add(other.pos, offset));
  }

  /** Die Nachbarzelle in einer Richtung (lokal) – z. B. Zielzelle eines Hoppers. */
  neighbor(dir: RelDir | Dir): Vec3 {
    const d = isRelDir(dir) ? relToLocal(dir) : dir;
    return add(this.pos, DIR_VECTORS[d]);
  }
}

type CellsArg = Placed | Vec3 | ReadonlyArray<Placed | Vec3>;

function toCells(arg: CellsArg): Vec3[] {
  const list: ReadonlyArray<Placed | Vec3> =
    arg instanceof Placed || isVec3(arg) ? [arg as Placed | Vec3] : (arg as ReadonlyArray<Placed | Vec3>);
  return list.map((x) => (x instanceof Placed ? x.pos : x));
}

function isVec3(x: unknown): x is Vec3 {
  return Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === "number");
}

export interface PortOptions {
  item?: string;
  width?: number;
  optional?: boolean;
  description?: string;
}

export class ComponentBuilder {
  readonly name: string;
  readonly #placed: Placed[] = [];
  readonly #byKey = new Map<string, Placed>();
  readonly #ports = new Map<string, PortDef>();
  readonly #rates: RateDecl[] = [];
  readonly #notes: string[] = [];
  readonly #all: Placed[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /** Erzeugt einen Block. Position folgt über .at(...) oder eine Beziehung. */
  place(block: BlockSpec): Placed {
    const p = new Placed(this, block);
    this.#all.push(p);
    return p;
  }

  /** Kurzform für den Ankerblock bei (0,0,0). */
  origin(block: BlockSpec): Placed {
    return this.place(block).at([0, 0, 0]);
  }

  /** @internal von Placed aufgerufen */
  register(p: Placed): void {
    const k = key(p.pos);
    const existing = this.#byKey.get(k);
    if (existing) {
      throw new Error(
        `${this.name}: Zelle (${k}) ist doppelt belegt: ${existing.block.id} und ${p.block.id}.`,
      );
    }
    this.#byKey.set(k, p);
    this.#placed.push(p);
  }

  input(name: string, kind: PortKind, cells: CellsArg, opts: PortOptions = {}): void {
    this.#addPort({ name, direction: "in", kind, cells: toCells(cells), ...opts });
  }

  output(name: string, kind: PortKind, targets: CellsArg, opts: PortOptions = {}): void {
    this.#addPort({ name, direction: "out", kind, cells: toCells(targets), ...opts });
  }

  produces(port: string, item: string, perHour: number, basis: RateBasis, note?: string): void {
    this.#rates.push({ type: "produces", port, item, perHour, basis, ...(note ? { note } : {}) });
  }

  passes(from: string, to: string, maxPerHour: number, basis: RateBasis, note?: string): void {
    this.#rates.push({ type: "passes", from, to, maxPerHour, basis, ...(note ? { note } : {}) });
  }

  stores(port: string, capacityItems: number, basis: RateBasis, note?: string): void {
    this.#rates.push({ type: "stores", port, capacityItems, basis, ...(note ? { note } : {}) });
  }

  consumes(item: string, perHour: number, basis: RateBasis, note?: string): void {
    this.#rates.push({ type: "consumes", item, perHour, basis, ...(note ? { note } : {}) });
  }

  note(text: string): void {
    this.#notes.push(text);
  }

  #addPort(def: PortDef): void {
    if (this.#ports.has(def.name)) throw new Error(`${this.name}: Port "${def.name}" existiert schon.`);
    if (def.cells.length === 0) throw new Error(`${this.name}: Port "${def.name}" hat keine Zellen.`);
    if (def.kind === "bus" && !(def.width && def.width > 0)) {
      throw new Error(`${this.name}: Bus-Port "${def.name}" braucht eine Breite.`);
    }
    this.#ports.set(def.name, def);
  }

  /** @internal */
  finish(status: ComponentStatus, params: Record<string, unknown>): ComponentTemplate {
    const unplaced = this.#all.filter((p) => !p.isPositioned);
    if (unplaced.length > 0) {
      throw new Error(
        `${this.name}: ${unplaced.length} Block/Blöcke ohne Position (${unplaced.map((p) => p.block.id).join(", ")}).`,
      );
    }
    const portNames = new Set(this.#ports.keys());
    for (const r of this.#rates) {
      const used = r.type === "passes" ? [r.from, r.to] : r.type === "consumes" ? [] : [r.port];
      for (const n of used) {
        if (!portNames.has(n)) throw new Error(`${this.name}: Rate verweist auf unbekannten Port "${n}".`);
      }
    }
    return {
      typeName: this.name,
      status,
      params,
      blocks: this.#placed.map((p) => ({ pos: p.pos, block: p.block })),
      ports: new Map(this.#ports),
      rates: [...this.#rates],
      notes: [...this.#notes],
    };
  }
}
