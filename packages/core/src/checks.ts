/**
 * Static checks (stage 0). Run in milliseconds, before any simulation.
 */

import type { ResolvedAssembly } from "./assembly.js";
import { REDSTONE_RELEVANT } from "./blocks.js";
import type { Diagnostic } from "./diagnostics.js";
import { DIR_VECTORS, type Dir, type Vec3, add, key, sub } from "./geometry.js";
import { type BlockRegistry, accepts } from "./registry.js";
import { dustPoints, isContainer } from "./routing.js";

export interface CheckOptions {
  /** Enables block-state and material checks */
  readonly registry?: BlockRegistry;
}

export function runChecks(a: ResolvedAssembly, options: CheckOptions = {}): Diagnostic[] {
  return [
    ...a.diagnostics,
    ...checkConnections(a),
    ...checkUnconnected(a),
    ...checkCrosstalk(a),
    ...(options.registry ? [...checkBlockStates(a, options.registry), ...checkMaterials(a, options.registry)] : []),
  ];
}

/** Every block must exist, and every property and value must be valid for it. */
export function checkBlockStates(a: ResolvedAssembly, registry: BlockRegistry): Diagnostic[] {
  const out: Diagnostic[] = [];
  const reported = new Set<string>();
  for (const b of a.blocks.values()) {
    const info = registry.info(b.block.id);
    const problems: string[] = [];
    if (!info) problems.push(`unknown block ${b.block.id}`);
    else {
      for (const [prop, value] of Object.entries(b.block.props)) {
        const allowed = info.properties[prop];
        if (!allowed) problems.push(`${b.block.id} has no property "${prop}"`);
        else if (!allowed.includes(String(value))) problems.push(`${b.block.id}[${prop}=${String(value)}] is invalid (allowed: ${allowed.join(", ")})`);
      }
    }
    for (const p of problems) {
      const k = `${b.instanceId}|${p}`;
      if (reported.has(k)) continue;
      reported.add(k);
      out.push({ severity: "error", code: "invalid-block-state", message: `${b.instanceId}: ${p}.`, at: b.pos, instances: [b.instanceId] });
    }
  }
  return out;
}

/** Material overrides must satisfy the slot's tag or list. */
export function checkMaterials(a: ResolvedAssembly, registry: BlockRegistry): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const m of a.materials) {
    if (accepts(registry, m.slot.accepts, m.id)) continue;
    const what = typeof m.slot.accepts === "string" ? m.slot.accepts : m.slot.accepts.join(", ");
    out.push({
      severity: "error",
      code: "material-not-accepted",
      message: `${m.instanceId}: material "${m.slot.role}" = ${m.id} is not in ${what}.`,
      instances: [m.instanceId],
    });
  }
  return out;
}

/** Connections: direction, kind, bus width and geometry must match. */
export function checkConnections(a: ResolvedAssembly): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const c of a.connections) {
    const from = a.instances.get(c.from.instanceId)?.ports.get(c.from.port);
    const to = a.instances.get(c.to.instanceId)?.ports.get(c.to.port);
    const label = `${c.from.instanceId}.${c.from.port} → ${c.to.instanceId}.${c.to.port}`;
    if (!from || !to) {
      out.push({ severity: "error", code: "unknown-port", message: `Connection ${label}: port missing.` });
      continue;
    }
    if (from.direction !== "out" || to.direction !== "in") {
      out.push({ severity: "error", code: "port-direction", message: `Connection ${label}: must go from out to in.` });
    }
    if (from.kind !== to.kind) {
      out.push({ severity: "error", code: "port-kind", message: `Connection ${label}: kind ${from.kind} does not match ${to.kind}.` });
    }
    if (from.kind === "bus" && from.width !== to.width) {
      out.push({ severity: "error", code: "bus-width", message: `Connection ${label}: bus width ${from.width} ≠ ${to.width}.` });
    }
    if (from.item && to.item && from.item !== to.item) {
      out.push({ severity: "error", code: "item-filter", message: `Connection ${label}: delivers ${from.item}, expects ${to.item}.` });
    }
    // An output with several target cells may feed several inputs (a splitter):
    // every connection needs one of the target cells, and every target cell
    // needs a receiver among the output's connections.
    const accept = new Set(to.absCells.map(key));
    if (!from.absCells.some((t) => accept.has(key(t)))) {
      const t = from.absCells[0]!;
      out.push({
        severity: "error",
        code: "port-misaligned",
        message: `Connection ${label}: target cell (${t.join(",")}) is not on the input.`,
        at: t,
        instances: [c.from.instanceId, c.to.instanceId],
      });
    }
  }
  const receivers = new Map<string, Set<string>>();
  for (const c of a.connections) {
    const to = a.instances.get(c.to.instanceId)?.ports.get(c.to.port);
    const k = `${c.from.instanceId}.${c.from.port}`;
    const set = receivers.get(k) ?? new Set<string>();
    for (const cell of to?.absCells ?? []) set.add(key(cell));
    receivers.set(k, set);
  }
  for (const [k, accept] of receivers) {
    const [id, port] = [k.slice(0, k.lastIndexOf(".")), k.slice(k.lastIndexOf(".") + 1)];
    const from = a.instances.get(id)?.ports.get(port);
    for (const t of from?.absCells ?? []) {
      if (accept.has(key(t))) continue;
      out.push({
        severity: "error",
        code: "port-misaligned",
        message: `Output ${k}: target cell (${t.join(",")}) is on none of its receivers' inputs.`,
        at: t,
        instances: [id],
      });
    }
  }
  return out;
}

export function checkUnconnected(a: ResolvedAssembly): Diagnostic[] {
  const used = new Set<string>(a.openPorts.map((p) => `${p.instanceId}.${p.port}`));
  for (const c of a.connections) {
    used.add(`${c.from.instanceId}.${c.from.port}`);
    used.add(`${c.to.instanceId}.${c.to.port}`);
  }
  const out: Diagnostic[] = [];
  for (const inst of a.instances.values()) {
    for (const p of inst.ports.values()) {
      if (!p.optional && !used.has(`${inst.id}.${p.name}`)) {
        out.push({
          severity: "warning",
          code: "unconnected-port",
          message: `${inst.id}.${p.name} (${p.direction}, ${p.kind}) is not connected.`,
          instances: [inst.id],
        });
      }
    }
  }
  return out;
}

/** Blocks that give off a signal (or move blocks) in every direction. */
const EMITS_ALL = new Set(
  [
    "redstone_wire",
    "redstone_torch",
    "redstone_wall_torch",
    "redstone_block",
    "lever",
    "stone_button",
    "target",
    "daylight_detector",
    "tripwire_hook",
    "sculk_sensor",
    "calibrated_sculk_sensor",
    "detector_rail",
  ].map((id) => `minecraft:${id}`),
);

/** Can block `b` act on the cell `other` next to it (power it, watch it, push it)? */
function acts(
  b: { pos: Vec3; block: { id: string; props: Readonly<Record<string, unknown>> } },
  other: Vec3,
  blockAt: (p: Vec3) => { readonly id: string; readonly facing?: string } | undefined,
): boolean {
  const id = b.block.id;
  // Dust powers the block below and the sides it points to
  if (id === "minecraft:redstone_wire") {
    const o = key(other);
    return o === key(add(b.pos, [0, -1, 0])) || dustPoints(b.pos, blockAt).some((d) => key(add(b.pos, DIR_VECTORS[d])) === o);
  }
  if (EMITS_ALL.has(id) || id.endsWith("_button") || id.endsWith("_pressure_plate")) return true;
  const facing = b.block.props["facing"];
  if (typeof facing !== "string" || !(facing in DIR_VECTORS)) return false;
  const front = key(add(b.pos, DIR_VECTORS[facing as Dir]));
  const back = key(sub(b.pos, DIR_VECTORS[facing as Dir]));
  const o = key(other);
  // Observers watch the front and pulse out of the back; repeaters and comparators take input
  // at the front and output at the back; pistons push to the front.
  if (id === "minecraft:observer" || id === "minecraft:repeater" || id === "minecraft:comparator") return o === front || o === back;
  if (id === "minecraft:piston" || id === "minecraft:sticky_piston") return o === front;
  return false;
}

/**
 * Crosstalk heuristic: redstone-relevant blocks of different instances that
 * touch each other. Warnings, not errors, since not every contact is a
 * problem. Quasi-connectivity and update chains across several blocks are not
 * detected – that is what the tests are for.
 */
export function checkCrosstalk(a: ResolvedAssembly): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  // Instances connected through ports touch on purpose (a hopper route ending in its dispenser)
  const blockAt = (p: Vec3) => {
    const x = a.blocks.get(key(p));
    if (!x) return undefined;
    const f = x.block.props["facing"];
    return typeof f === "string" ? { id: x.block.id, facing: f } : { id: x.block.id };
  };
  // Signal ports declare intended contact: a block on another instance's signal port cell is wired there on purpose
  const signalCells = new Map<string, Set<string>>();
  for (const inst of a.instances.values()) {
    const cells = new Set<string>();
    for (const p of inst.ports.values()) if (p.kind === "signal") for (const c of p.absCells) cells.add(key(c));
    if (cells.size) signalCells.set(inst.id, cells);
  }
  const onSignalPort = (b: { instanceId: string }, pos: Vec3) => signalCells.get(b.instanceId)?.has(key(pos)) ?? false;
  const linked = new Set(a.connections.flatMap((c) => [`${c.from.instanceId}|${c.to.instanceId}`, `${c.to.instanceId}|${c.from.instanceId}`]));
  for (const b of a.blocks.values()) {
    if (!REDSTONE_RELEVANT.has(b.block.id)) continue;
    for (const v of Object.values(DIR_VECTORS)) {
      const n = a.blocks.get(key(add(b.pos, v)));
      if (!n || n.instanceId === b.instanceId || !REDSTONE_RELEVANT.has(n.block.id)) continue;
      const pair = [key(b.pos), key(n.pos)].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      // hopper next to hopper across connected components is the normal case
      if (b.block.id === "minecraft:hopper" && n.block.id === "minecraft:hopper") continue;
      if (linked.has(`${b.instanceId}|${n.instanceId}`) && isContainer(b.block.id) && isContainer(n.block.id)) continue;
      if (onSignalPort(b, n.pos) || onSignalPort(n, b.pos)) continue;
      // Two blocks that only react to signals cannot disturb each other
      if (!acts(b, n.pos, blockAt) && !acts(n, b.pos, blockAt)) continue;
      out.push({
        severity: "warning",
        code: "possible-crosstalk",
        message: `${b.instanceId} (${b.block.id}) touches ${n.instanceId} (${n.block.id}). Check for crosstalk.`,
        at: b.pos,
        instances: [b.instanceId, n.instanceId],
      });
    }
  }
  return out;
}
