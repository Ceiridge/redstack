/**
 * Static checks (stage 0). Run in milliseconds, before any simulation.
 */

import type { ResolvedAssembly } from "./assembly.js";
import { REDSTONE_RELEVANT } from "./blocks.js";
import type { Diagnostic } from "./diagnostics.js";
import { DIR_VECTORS, add, key } from "./geometry.js";

export function runChecks(a: ResolvedAssembly): Diagnostic[] {
  return [...a.diagnostics, ...checkConnections(a), ...checkUnconnected(a), ...checkCrosstalk(a)];
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
    const accept = new Set(to.absCells.map(key));
    for (const t of from.absCells) {
      if (!accept.has(key(t))) {
        out.push({
          severity: "error",
          code: "port-misaligned",
          message: `Connection ${label}: target cell (${t.join(",")}) is not on the input.`,
          at: t,
          instances: [c.from.instanceId, c.to.instanceId],
        });
      }
    }
  }
  return out;
}

export function checkUnconnected(a: ResolvedAssembly): Diagnostic[] {
  const used = new Set<string>();
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

/**
 * Crosstalk heuristic: redstone-relevant blocks of different instances that
 * touch each other. Warnings, not errors, since not every contact is a
 * problem. Quasi-connectivity and update chains across several blocks are not
 * detected – that is what the tests are for.
 */
export function checkCrosstalk(a: ResolvedAssembly): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
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
