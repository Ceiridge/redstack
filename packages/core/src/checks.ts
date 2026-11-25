/**
 * Statische Prüfungen (Stufe 0). Laufen in Millisekunden, vor jeder Simulation.
 */

import type { ResolvedAssembly } from "./assembly.js";
import { REDSTONE_RELEVANT } from "./blocks.js";
import type { Diagnostic } from "./diagnostics.js";
import { DIR_VECTORS, add, key } from "./geometry.js";

export function runChecks(a: ResolvedAssembly): Diagnostic[] {
  return [...a.diagnostics, ...checkConnections(a), ...checkUnconnected(a), ...checkCrosstalk(a)];
}

/** Verbindungen: Richtung, Typ, Bus-Breite und Geometrie müssen passen. */
export function checkConnections(a: ResolvedAssembly): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const c of a.connections) {
    const from = a.instances.get(c.from.instanceId)?.ports.get(c.from.port);
    const to = a.instances.get(c.to.instanceId)?.ports.get(c.to.port);
    const label = `${c.from.instanceId}.${c.from.port} → ${c.to.instanceId}.${c.to.port}`;
    if (!from || !to) {
      out.push({ severity: "error", code: "unknown-port", message: `Verbindung ${label}: Port fehlt.` });
      continue;
    }
    if (from.direction !== "out" || to.direction !== "in") {
      out.push({ severity: "error", code: "port-direction", message: `Verbindung ${label}: muss von out nach in gehen.` });
    }
    if (from.kind !== to.kind) {
      out.push({
        severity: "error",
        code: "port-kind",
        message: `Verbindung ${label}: Typ ${from.kind} passt nicht zu ${to.kind}.`,
      });
    }
    if (from.kind === "bus" && from.width !== to.width) {
      out.push({
        severity: "error",
        code: "bus-width",
        message: `Verbindung ${label}: Busbreite ${from.width} ≠ ${to.width}.`,
      });
    }
    if (from.item && to.item && from.item !== to.item) {
      out.push({
        severity: "error",
        code: "item-filter",
        message: `Verbindung ${label}: liefert ${from.item}, erwartet ${to.item}.`,
      });
    }
    const accept = new Set(to.absCells.map(key));
    for (const t of from.absCells) {
      if (!accept.has(key(t))) {
        out.push({
          severity: "error",
          code: "port-misaligned",
          message: `Verbindung ${label}: Zielzelle (${t.join(",")}) liegt nicht auf dem Eingang.`,
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
          message: `${inst.id}.${p.name} (${p.direction}, ${p.kind}) ist nicht verbunden.`,
          instances: [inst.id],
        });
      }
    }
  }
  return out;
}

/**
 * Heuristik gegen Übersprechen: Redstone-relevante Blöcke verschiedener
 * Instanzen, die direkt nebeneinanderliegen. Erzeugt Warnungen, keine Fehler,
 * weil nicht jede Nachbarschaft ein Problem ist. Quasi-Connectivity und
 * Update-Ketten über mehrere Blöcke erkennt das nicht – dafür sind die Tests da.
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
      // Hopper → Hopper zwischen verbundenen Komponenten ist der Normalfall
      if (b.block.id === "minecraft:hopper" && n.block.id === "minecraft:hopper") continue;
      out.push({
        severity: "warning",
        code: "possible-crosstalk",
        message: `${b.instanceId} (${b.block.id}) grenzt an ${n.instanceId} (${n.block.id}). Mögliches Übersprechen prüfen.`,
        at: b.pos,
        instances: [b.instanceId, n.instanceId],
      });
    }
  }
  return out;
}
