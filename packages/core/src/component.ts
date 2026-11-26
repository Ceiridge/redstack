/**
 * Components – the one building concept of redstack.
 *
 * A component has blocks, ports, a rate model, and may contain other
 * components (children) whose ports it can connect and re-export. A farm is
 * just a component at the top (see Assembly), so designs compose without
 * limit: a cell, a row of cells, a farm of rows, a base of farms.
 *
 * Blocks are placed through relations (`above`, `inFrontOf`, …) and children
 * dock onto each other through ports (`attach`, `to`), so coordinates are only
 * needed where geometry is genuinely irregular.
 */

import { type BlockSpec, block as makeBlock } from "./blocks.js";
import type { Diagnostic } from "./diagnostics.js";
import { type Environment, VANILLA_26_3 } from "./environment.js";
import {
  type Dir,
  type RelDir,
  type Rotation,
  type Vec3,
  DIR_VECTORS,
  add,
  isRelDir,
  key,
  normalizeRotation,
  relToLocal,
  rotateVec,
  sub,
} from "./geometry.js";
import type { MaterialChoices, MaterialSlot } from "./materials.js";

// ---------- Ports and rates ----------

/**
 * Port kinds. "items" and "fluid" are for farms, "signal" and "bus" for
 * redstone logic. New kinds can be added here without touching the rest.
 */
export type PortKind = "items" | "fluid" | "signal" | "bus";
export type PortDirection = "in" | "out";

export interface PortDef {
  readonly name: string;
  readonly direction: PortDirection;
  readonly kind: PortKind;
  /**
   * in:  cells that accept something (e.g. the hoppers of a collection belt).
   * out: target cells that something is delivered to (e.g. the block below a hopper).
   * A connection is geometrically valid if all targets of the output lie on
   * cells of the input.
   */
  readonly cells: readonly Vec3[];
  /** Bit width of bus ports */
  readonly width?: number;
  /** Optional item filter, e.g. "minecraft:cactus" */
  readonly item?: string;
  /** May stay unconnected without a warning */
  readonly optional?: boolean;
  readonly description?: string;
}

/** Where a number comes from; needed to compare model and measurement later. */
export type RateBasis = "game-mechanic" | "measured" | "estimate";

interface RateMeta {
  readonly basis: RateBasis;
  readonly note?: string;
}

export type RateDecl =
  | (RateMeta & { readonly type: "produces"; readonly port: string; readonly item: string; readonly perHour: number })
  | (RateMeta & { readonly type: "passes"; readonly from: string; readonly to: string; readonly maxPerHour: number })
  | (RateMeta & { readonly type: "stores"; readonly port: string; readonly capacityItems: number })
  | (RateMeta & { readonly type: "consumes"; readonly item: string; readonly perHour: number });

/** Maturity of a component. Only "game-tested" and above count as working. */
export type ComponentStatus =
  | "draft" // sketched only
  | "unverified" // complete, never tested in-game
  | "game-tested" // automated test on a test server passes
  | "server-verified"; // additionally confirmed on the target server

// ---------- Templates (the result of building a component) ----------

export interface PlacedBlock {
  readonly pos: Vec3;
  readonly block: BlockSpec;
}

/** A port of this component or of one of its children (`child` undefined = this component). */
export interface PortEndpoint {
  readonly child?: string;
  readonly port: string;
}

export interface ChildTemplate {
  readonly id: string;
  readonly template: ComponentTemplate;
  /** Position and rotation in the parent's frame */
  readonly origin: Vec3;
  readonly rotation: Rotation;
}

export interface MaterialUse {
  readonly slot: MaterialSlot;
  readonly id: string;
}

export interface ComponentTemplate {
  readonly typeName: string;
  readonly status: ComponentStatus;
  readonly params: Readonly<Record<string, unknown>>;
  readonly blocks: readonly PlacedBlock[];
  /** Cells that must stay free (growth space, fall paths, neighbours of a cactus …) */
  readonly clear: readonly Vec3[];
  /** Own ports */
  readonly ports: ReadonlyMap<string, PortDef>;
  /** Ports re-exported from children */
  readonly exposed: ReadonlyMap<string, Required<PortEndpoint>>;
  /** Own and exposed ports, with cells in this component's frame */
  readonly portView: ReadonlyMap<string, PortDef>;
  readonly children: readonly ChildTemplate[];
  readonly connections: ReadonlyArray<{ readonly from: PortEndpoint; readonly to: PortEndpoint }>;
  readonly rates: readonly RateDecl[];
  readonly materials: readonly MaterialUse[];
  readonly notes: readonly string[];
  /** Problems found while building, positions in this component's frame */
  readonly diagnostics: readonly Diagnostic[];
}

// ---------- Component types ----------

export interface BuildContext {
  readonly env: Environment;
  /** Material overrides by role */
  readonly materials: MaterialChoices;
}

export const DEFAULT_CONTEXT: BuildContext = { env: VANILLA_26_3, materials: {} };

export interface ComponentSpec<P extends object = Record<string, unknown>> {
  readonly type: ComponentType<P>;
  readonly params: Partial<P>;
}

/**
 * A component type. Call it to choose parameters: `HopperLine({ length: 16 })`.
 * Pass the type itself to use the defaults.
 */
export interface ComponentType<P extends object = Record<string, unknown>> {
  (params?: Partial<P>): ComponentSpec<P>;
  readonly componentName: string;
  readonly description: string;
  readonly status: ComponentStatus;
  readonly defaults: Readonly<P>;
  instantiate(params?: Partial<P>, ctx?: BuildContext): ComponentTemplate;
}

export interface ComponentOptions<P extends object> {
  readonly name: string;
  readonly description?: string;
  readonly status?: ComponentStatus;
  /** Parameters with their defaults */
  readonly params?: P;
}

/**
 * Defines a component.
 *
 *   export const Chest = component({ name: "Chest", status: "game-tested" }, (c) => {
 *     const chest = c.block(B.chest());
 *     c.input("in", chest);
 *     c.stores("in", 27 * 64, "game-mechanic");
 *   });
 */
export function component<P extends object = Record<string, never>>(
  options: ComponentOptions<P>,
  build: (c: ComponentBuilder, params: P) => void,
): ComponentType<P> {
  const defaults = (options.params ?? {}) as P;
  const status = options.status ?? "draft";
  const type = ((params?: Partial<P>): ComponentSpec<P> => ({ type, params: params ?? {} })) as ComponentType<P>;
  Object.defineProperties(type, {
    componentName: { value: options.name, enumerable: true },
    description: { value: options.description ?? "", enumerable: true },
    status: { value: status, enumerable: true },
    defaults: { value: defaults, enumerable: true },
    instantiate: {
      value(params?: Partial<P>, ctx: BuildContext = DEFAULT_CONTEXT): ComponentTemplate {
        const p = { ...defaults, ...(params ?? {}) } as P;
        const b = new ComponentBuilder(options.name, ctx);
        build(b, p);
        return b.finish(status, p as Record<string, unknown>);
      },
    },
  });
  return type;
}

// ---------- Building blocks ----------

type BlockArg = BlockSpec | string;
type CellArg = Placed | Vec3;
type CellsArg = CellArg | ReadonlyArray<CellArg>;

const toSpec = (b: BlockArg): BlockSpec => (typeof b === "string" ? makeBlock(b) : b);
const isVec3 = (x: unknown): x is Vec3 => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === "number");
const toCells = (arg: CellsArg): Vec3[] =>
  (arg instanceof Placed || isVec3(arg) ? [arg as CellArg] : [...(arg as ReadonlyArray<CellArg>)]).map((x) =>
    x instanceof Placed ? x.pos : x,
  );
const dirVec = (d: RelDir | Dir): Vec3 => DIR_VECTORS[isRelDir(d) ? relToLocal(d) : d];

const HORIZONTAL: readonly RelDir[] = ["forward", "right", "back", "left"];
const ALL: readonly RelDir[] = [...HORIZONTAL, "up", "down"];

/** Handle to a block inside a component. */
export class Placed {
  #pos: Vec3 | undefined;
  readonly block: BlockSpec;
  readonly #owner: ComponentBuilder;

  constructor(owner: ComponentBuilder, block: BlockSpec) {
    this.#owner = owner;
    this.block = block;
  }

  get pos(): Vec3 {
    // The first block whose position is needed, while no block is placed yet, is the anchor at (0,0,0)
    if (!this.#pos && this.#owner._nothingPlaced()) this.at([0, 0, 0]);
    if (!this.#pos) throw new Error(`${this.#owner.name}: block ${this.block.id} has no position yet.`);
    return this.#pos;
  }

  get isPositioned(): boolean {
    return this.#pos !== undefined;
  }

  at(pos: Vec3): this {
    if (this.#pos) throw new Error(`${this.#owner.name}: block ${this.block.id} is already placed.`);
    this.#pos = pos;
    this.#owner._register(this);
    return this;
  }

  /** Places this block next to `other`, `n` steps in direction `dir` (local). */
  nextTo(other: CellArg, dir: RelDir | Dir, n = 1): this {
    const base = other instanceof Placed ? other.pos : other;
    const v = dirVec(dir);
    return this.at(add(base, [v[0] * n, v[1] * n, v[2] * n]));
  }
  above(other: CellArg, n = 1): this {
    return this.nextTo(other, "up", n);
  }
  below(other: CellArg, n = 1): this {
    return this.nextTo(other, "down", n);
  }
  inFrontOf(other: CellArg, n = 1): this {
    return this.nextTo(other, "forward", n);
  }
  behind(other: CellArg, n = 1): this {
    return this.nextTo(other, "back", n);
  }
  leftOf(other: CellArg, n = 1): this {
    return this.nextTo(other, "left", n);
  }
  rightOf(other: CellArg, n = 1): this {
    return this.nextTo(other, "right", n);
  }
  offsetFrom(other: CellArg, offset: Vec3): this {
    return this.at(add(other instanceof Placed ? other.pos : other, offset));
  }

  /** The neighbouring cell in a direction (local), e.g. a hopper's target cell. */
  neighbor(dir: RelDir | Dir, n = 1): Vec3 {
    const v = dirVec(dir);
    return add(this.pos, [v[0] * n, v[1] * n, v[2] * n]);
  }
  get up(): Vec3 {
    return this.neighbor("up");
  }
  get down(): Vec3 {
    return this.neighbor("down");
  }

  /** Neighbouring cells: the four horizontal ones, or all six. */
  neighbors(which: "horizontal" | "all" = "horizontal"): Vec3[] {
    return (which === "horizontal" ? HORIZONTAL : ALL).map((d) => this.neighbor(d));
  }
}

// ---------- Children ----------

export interface PortRef {
  /** undefined = a port of the component being built */
  readonly instance: Instance | undefined;
  readonly port: string;
}

type Placement =
  | { kind: "none" }
  | { kind: "at"; pos: Vec3 }
  | { kind: "offset"; from: Instance; offset: Vec3 }
  | { kind: "attach"; myPort: string; target: PortRef; cellIndex: number };

export interface DockOptions {
  /** Output port of this instance (default: its only output of a matching kind) */
  readonly from?: string;
  /** Input port of the new instance (default: its only input of a matching kind) */
  readonly into?: string;
  /** Which input cell to dock onto (default 0) */
  readonly cellIndex?: number;
}

/** Handle to a child component. */
export class Instance {
  readonly id: string;
  readonly template: ComponentTemplate;
  readonly #parent: ComponentBuilder;
  /** @internal */ _placement: Placement = { kind: "none" };
  /** @internal */ _rotation: Rotation | undefined;

  constructor(parent: ComponentBuilder, id: string, template: ComponentTemplate) {
    this.#parent = parent;
    this.id = id;
    this.template = template;
  }

  at(pos: Vec3): this {
    this._placement = { kind: "at", pos };
    return this;
  }

  rotated(quarterTurnsClockwise: number): this {
    this._rotation = normalizeRotation(quarterTurnsClockwise);
    return this;
  }

  /** Offset relative to another instance, in that instance's frame. */
  offsetFrom(other: Instance, offset: Vec3): this {
    this._placement = { kind: "offset", from: other, offset };
    return this;
  }

  /**
   * Docks one of this instance's ports onto another port and records the connection.
   * Own input to an output: the output's target cell becomes own input cell [cellIndex].
   * Own output to an input: own target cell becomes the input's cell [cellIndex].
   */
  attach(myPort: string, target: PortRef, cellIndex = 0): this {
    this.port(myPort);
    this._placement = { kind: "attach", myPort, target, cellIndex };
    return this;
  }

  port(name: string): PortRef {
    if (!this.template.portView.has(name)) {
      const names = [...this.template.portView.keys()].join(", ") || "none";
      throw new Error(`${this.id} (${this.template.typeName}) has no port "${name}". Ports: ${names}.`);
    }
    return { instance: this, port: name };
  }

  /** The only port in a direction (optionally of a kind), or an error that lists the candidates. */
  onlyPort(direction: PortDirection, kind?: PortKind): PortDef {
    const candidates = [...this.template.portView.values()].filter((p) => p.direction === direction && (!kind || p.kind === kind));
    if (candidates.length !== 1) {
      throw new Error(
        `${this.id}: expected exactly one ${direction}put${kind ? ` of kind ${kind}` : ""}, found ${candidates.length} (${candidates.map((p) => p.name).join(", ") || "none"}). Name it explicitly.`,
      );
    }
    return candidates[0]!;
  }

  /**
   * Adds a component after this one and docks it: this instance's output feeds
   * the new instance's input. Returns the new instance, so pipelines read left to right:
   *
   *   c.add(SupplyChest).to(HopperLine({ length: 8 })).to(Chest)
   */
  to<P extends object>(next: ComponentType<P> | ComponentSpec<P>, options: DockOptions = {}): Instance {
    const out = options.from ? this.template.portView.get(options.from) : this.onlyPort("out");
    if (!out || out.direction !== "out") throw new Error(`${this.id}: "${options.from}" is not an output.`);
    const inst = this.#parent.add(next);
    const into = options.into ?? inst.onlyPort("in", out.kind).name;
    return inst.attach(into, this.port(out.name), options.cellIndex ?? 0);
  }
}

// ---------- Builder ----------

export interface PortOptions {
  readonly kind?: PortKind;
  readonly item?: string;
  readonly width?: number;
  readonly optional?: boolean;
  readonly description?: string;
}

export interface OutputOptions extends PortOptions {
  /** Shorthand for `produces(port, item, perHour, basis, note)`; needs `item` */
  readonly rate?: { readonly perHour: number; readonly basis: RateBasis; readonly note?: string };
}

export class ComponentBuilder {
  readonly name: string;
  readonly ctx: BuildContext;
  readonly #placed: Placed[] = [];
  readonly #byKey = new Map<string, Placed>();
  readonly #all: Placed[] = [];
  readonly #clear = new Map<string, Vec3>();
  readonly #ports = new Map<string, PortDef>();
  readonly #exposed = new Map<string, PortRef>();
  readonly #children: Instance[] = [];
  readonly #connections: Array<{ from: PortRef; to: PortRef }> = [];
  readonly #rates: RateDecl[] = [];
  readonly #notes: string[] = [];
  readonly #materials: MaterialUse[] = [];
  readonly #counters = new Map<string, number>();

  constructor(name: string, ctx: BuildContext = DEFAULT_CONTEXT) {
    this.name = name;
    this.ctx = ctx;
  }

  /** The environment this component is built for (version, server settings). */
  get env(): Environment {
    return this.ctx.env;
  }

  /** The block chosen for a material slot: the assembly's override for its role, or the default. */
  material(slot: MaterialSlot): string {
    const id = this.ctx.materials[slot.role] ?? slot.default;
    if (!this.#materials.some((m) => m.slot.role === slot.role)) this.#materials.push({ slot, id });
    return id;
  }

  // ----- blocks -----

  /**
   * Creates a block; its position follows via .at(...) or a relation. The
   * first block that is needed before any other is placed becomes the anchor
   * at (0,0,0), so `c.block(B.sand()).above(c.block(B.stone()))` just works.
   */
  block(spec: BlockArg): Placed {
    const p = new Placed(this, toSpec(spec));
    this.#all.push(p);
    return p;
  }

  /** Shorthand for a block at (0,0,0). */
  origin(spec: BlockArg): Placed {
    return this.block(spec).at([0, 0, 0]);
  }

  /** `count` blocks in a straight line, starting at `start`. `spec` may depend on the index. */
  line(spec: BlockArg | ((i: number) => BlockArg), start: CellArg, dir: RelDir | Dir, count: number): Placed[] {
    const s = start instanceof Placed ? start.pos : start;
    const v = dirVec(dir);
    const out: Placed[] = [];
    for (let i = 0; i < count; i++) {
      out.push(this.block(typeof spec === "function" ? spec(i) : spec).at(add(s, [v[0] * i, v[1] * i, v[2] * i])));
    }
    return out;
  }

  /** Fills the box between two corners (inclusive). */
  fill(spec: BlockArg | ((pos: Vec3) => BlockArg), from: Vec3, to: Vec3): Placed[] {
    const out: Placed[] = [];
    const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
    const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
    const [z0, z1] = [Math.min(from[2], to[2]), Math.max(from[2], to[2])];
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const pos: Vec3 = [x, y, z];
          out.push(this.block(typeof spec === "function" ? spec(pos) : spec).at(pos));
        }
    return out;
  }

  /** Marks cells that must stay free. The checks report anything placed there. */
  keepClear(...cells: CellsArg[]): void {
    for (const arg of cells) for (const c of toCells(arg)) this.#clear.set(key(c), c);
  }

  /** @internal */
  _nothingPlaced(): boolean {
    return this.#placed.length === 0 && this.#clear.size === 0;
  }

  /** @internal called by Placed */
  _register(p: Placed): void {
    if (p.block.id === "minecraft:air") {
      this.#clear.set(key(p.pos), p.pos);
      return;
    }
    const k = key(p.pos);
    const existing = this.#byKey.get(k);
    if (existing) {
      throw new Error(`${this.name}: cell (${k}) is occupied twice: ${existing.block.id} and ${p.block.id}.`);
    }
    this.#byKey.set(k, p);
    this.#placed.push(p);
  }

  // ----- children -----

  /** Adds a child component: `c.add(HopperLine({ length: 8 }))` or `c.add(HopperLine, { length: 8 })`. */
  add<P extends object>(type: ComponentType<P> | ComponentSpec<P>, params?: Partial<P>, id?: string): Instance {
    const spec: ComponentSpec<P> = typeof type === "function" ? type(params) : { type: type.type, params: { ...type.params, ...params } };
    const name = spec.type.componentName;
    const n = (this.#counters.get(name) ?? 0) + 1;
    this.#counters.set(name, n);
    const childId = id ?? `${name}#${n}`;
    if (this.#children.some((c) => c.id === childId)) throw new Error(`${this.name}: duplicate child id "${childId}".`);
    const inst = new Instance(this, childId, spec.type.instantiate(spec.params, this.ctx));
    this.#children.push(inst);
    return inst;
  }

  /** A row of identical components. Place the first yourself; the others follow every `step` in its frame. */
  row<P extends object>(type: ComponentType<P> | ComponentSpec<P>, count: number, step: Vec3, params?: Partial<P>): Instance[] {
    if (count < 1) throw new Error(`${this.name}: row count must be >= 1.`);
    const first = this.add(type, params);
    const out = [first];
    for (let i = 1; i < count; i++) out.push(this.add(type, params).offsetFrom(first, [step[0] * i, step[1] * i, step[2] * i]));
    return out;
  }

  /** Connects an output to an input without moving anything. */
  connect(from: PortRef, to: PortRef): void {
    this.#connections.push({ from, to });
  }

  /** A port of the component being built, for connections to children. */
  port(name: string): PortRef {
    if (!this.#ports.has(name)) throw new Error(`${this.name}: no own port "${name}".`);
    return { instance: undefined, port: name };
  }

  /** Re-exports a child's port as a port of this component. */
  expose(name: string, ref: PortRef): void {
    if (!ref.instance) throw new Error(`${this.name}: expose needs a child port.`);
    if (this.#ports.has(name) || this.#exposed.has(name)) throw new Error(`${this.name}: port "${name}" already exists.`);
    this.#exposed.set(name, ref);
  }

  // ----- own ports and rates -----

  input(name: string, cells: CellsArg, opts: PortOptions = {}): void {
    this.#addPort({ name, direction: "in", kind: opts.kind ?? "items", cells: toCells(cells), ...withoutKind(opts) });
  }

  output(name: string, targets: CellsArg, opts: OutputOptions = {}): void {
    const { rate, ...rest } = opts;
    this.#addPort({ name, direction: "out", kind: rest.kind ?? "items", cells: toCells(targets), ...withoutKind(rest) });
    if (rate) {
      if (!rest.item) throw new Error(`${this.name}: output "${name}" with a rate needs an item.`);
      this.produces(name, rest.item, rate.perHour, rate.basis, rate.note);
    }
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
    if (this.#ports.has(def.name) || this.#exposed.has(def.name)) throw new Error(`${this.name}: port "${def.name}" already exists.`);
    if (def.cells.length === 0) throw new Error(`${this.name}: port "${def.name}" has no cells.`);
    if (def.kind === "bus" && !(def.width && def.width > 0)) throw new Error(`${this.name}: bus port "${def.name}" needs a width.`);
    this.#ports.set(def.name, def);
  }

  // ----- finish -----

  /** @internal Builds the template: checks blocks, places children, resolves port views. */
  finish(status: ComponentStatus, params: Record<string, unknown>): ComponentTemplate {
    if (this.#all[0] && !this.#all[0].isPositioned && this._nothingPlaced()) void this.#all[0].pos;
    const stillUnplaced = this.#all.filter((p) => !p.isPositioned);
    if (stillUnplaced.length > 0) {
      throw new Error(`${this.name}: ${stillUnplaced.length} block(s) without position (${stillUnplaced.map((p) => p.block.id).join(", ")}).`);
    }
    for (const r of this.#rates) {
      const used = r.type === "passes" ? [r.from, r.to] : r.type === "consumes" ? [] : [r.port];
      for (const n of used) if (!this.#ports.has(n)) throw new Error(`${this.name}: rate refers to unknown port "${n}".`);
    }

    const diagnostics: Diagnostic[] = [];
    const placed = this.#placeChildren(diagnostics);
    const children: ChildTemplate[] = [];
    for (const inst of this.#children) {
      const p = placed.get(inst.id);
      if (p) children.push({ id: inst.id, template: inst.template, origin: p.origin, rotation: p.rotation });
    }

    // Port view: own ports plus exposed child ports, in this frame
    const portView = new Map<string, PortDef>(this.#ports);
    const exposed = new Map<string, Required<PortEndpoint>>();
    for (const [name, ref] of this.#exposed) {
      const child = children.find((c) => c.id === ref.instance!.id);
      const def = ref.instance!.template.portView.get(ref.port)!;
      exposed.set(name, { child: ref.instance!.id, port: ref.port });
      if (!child) continue;
      const toFrame = (v: Vec3) => add(child.origin, rotateVec(v, child.rotation));
      portView.set(name, { ...def, name, cells: def.cells.map(toFrame) });
    }

    const endpoint = (r: PortRef): PortEndpoint => (r.instance ? { child: r.instance.id, port: r.port } : { port: r.port });
    const connections = [...this.#connections];
    for (const inst of this.#children) {
      const pl = inst._placement;
      if (pl.kind !== "attach") continue;
      const mine = inst.template.portView.get(pl.myPort)!;
      const me: PortRef = { instance: inst, port: pl.myPort };
      connections.push(mine.direction === "in" ? { from: pl.target, to: me } : { from: me, to: pl.target });
    }

    return {
      typeName: this.name,
      status,
      params,
      blocks: this.#placed.map((p) => ({ pos: p.pos, block: p.block })),
      clear: [...this.#clear.values()],
      ports: new Map(this.#ports),
      exposed,
      portView,
      children,
      connections: connections.map((c) => ({ from: endpoint(c.from), to: endpoint(c.to) })),
      rates: [...this.#rates],
      materials: [...this.#materials],
      notes: [...this.#notes],
      diagnostics,
    };
  }

  #placeChildren(diagnostics: Diagnostic[]): Map<string, { origin: Vec3; rotation: Rotation }> {
    const placed = new Map<string, { origin: Vec3; rotation: Rotation }>();
    if (this.#children.length > 0 && this.#children.every((c) => c._placement.kind !== "at")) {
      const first = this.#children.find((c) => c._placement.kind === "none");
      if (first) first._placement = { kind: "at", pos: [0, 0, 0] };
    }
    const ownPortCells = (name: string): readonly Vec3[] | undefined => this.#ports.get(name)?.cells;

    let progress = true;
    while (progress) {
      progress = false;
      for (const inst of this.#children) {
        if (placed.has(inst.id)) continue;
        const r = this.#tryPlace(inst, placed, ownPortCells);
        if (r) {
          placed.set(inst.id, r);
          progress = true;
        }
      }
    }
    for (const inst of this.#children) {
      if (!placed.has(inst.id)) {
        diagnostics.push({
          severity: "error",
          code: "unplaced",
          message: `${inst.id} could not be placed (no anchor or circular dependency).`,
          instances: [inst.id],
        });
      }
    }
    return placed;
  }

  #tryPlace(
    inst: Instance,
    placed: Map<string, { origin: Vec3; rotation: Rotation }>,
    ownPortCells: (name: string) => readonly Vec3[] | undefined,
  ): { origin: Vec3; rotation: Rotation } | undefined {
    const pl = inst._placement;
    switch (pl.kind) {
      case "none":
        return undefined;
      case "at":
        return { origin: pl.pos, rotation: inst._rotation ?? 0 };
      case "offset": {
        const base = placed.get(pl.from.id);
        if (!base) return undefined;
        return { origin: add(base.origin, rotateVec(pl.offset, base.rotation)), rotation: inst._rotation ?? base.rotation };
      }
      case "attach": {
        const myDef = inst.template.portView.get(pl.myPort)!;
        let targetDef: PortDef | undefined;
        let toFrame: (v: Vec3) => Vec3;
        let rotation: Rotation;
        if (pl.target.instance) {
          const other = placed.get(pl.target.instance.id);
          if (!other) return undefined;
          targetDef = pl.target.instance.template.portView.get(pl.target.port);
          toFrame = (v) => add(other.origin, rotateVec(v, other.rotation));
          rotation = inst._rotation ?? other.rotation;
        } else {
          const cells = ownPortCells(pl.target.port);
          targetDef = this.#ports.get(pl.target.port);
          if (!cells) return undefined;
          toFrame = (v) => v;
          rotation = inst._rotation ?? 0;
        }
        if (!targetDef) throw new Error(`${this.name}: attach target port "${pl.target.port}" not found.`);
        if (myDef.direction === targetDef.direction) {
          throw new Error(`${this.name}: attach ${inst.id}.${pl.myPort} onto a port with the same direction (${myDef.direction}).`);
        }
        // Anchor cell: own input → the output's first target cell; own output → the input's cell [cellIndex]
        const myLocal = myDef.direction === "in" ? myDef.cells[pl.cellIndex] : myDef.cells[0];
        const targetLocal = myDef.direction === "in" ? targetDef.cells[0] : targetDef.cells[pl.cellIndex];
        if (!myLocal || !targetLocal) throw new Error(`${this.name}: attach cell index ${pl.cellIndex} does not exist.`);
        return { origin: sub(toFrame(targetLocal), rotateVec(myLocal, rotation)), rotation };
      }
    }
  }
}

function withoutKind<T extends { kind?: PortKind }>(o: T): Omit<T, "kind"> {
  const { kind: _kind, ...rest } = o;
  return rest;
}
