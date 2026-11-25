/**
 * Data model for visualisation (phase 4).
 *
 * The viewer itself (3D in the browser) comes later. This module defines the
 * data it receives: blocks, instances, port flows, bottlenecks and test events
 * with locations, so model and measurement can be overlaid in one picture.
 */

import { type Diagnostic, type ResolvedAssembly, type Vec3, formatBlock } from "@redstack/core";
import type { FlowAnalysis } from "@redstack/flow";

export interface VizModel {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly blocks: ReadonlyArray<{ pos: Vec3; block: string; instance: string }>;
  readonly instances: ReadonlyArray<{ id: string; type: string; status: string; origin: Vec3; rotation: number }>;
  readonly edges: ReadonlyArray<{
    from: string;
    to: string;
    perHour: number;
    /** Utilisation of the target, if known (> 1 = backed up) */
    utilization?: number;
    cells: readonly Vec3[];
  }>;
  readonly highlights: ReadonlyArray<{ at: Vec3; severity: Diagnostic["severity"]; message: string }>;
}

export function toVizModel(a: ResolvedAssembly, flow?: FlowAnalysis, diagnostics: readonly Diagnostic[] = []): VizModel {
  const util = new Map<string, number>();
  for (const b of flow?.bottlenecks ?? []) util.set(`${b.instanceId}.${b.from}`, b.utilization);
  return {
    schemaVersion: 1,
    name: a.name,
    blocks: [...a.blocks.values()]
      .filter((b) => b.block.id !== "minecraft:air")
      .map((b) => ({ pos: b.pos, block: formatBlock(b.block), instance: b.instanceId })),
    instances: [...a.instances.values()].map((i) => ({
      id: i.id,
      type: i.template.typeName,
      status: i.template.status,
      origin: i.origin,
      rotation: i.rotation,
    })),
    edges: a.connections.map((c) => {
      const fromK = `${c.from.instanceId}.${c.from.port}`;
      const toK = `${c.to.instanceId}.${c.to.port}`;
      const u = util.get(toK);
      return {
        from: fromK,
        to: toK,
        perHour: flow?.ports.get(fromK)?.totalPerHour ?? 0,
        ...(u !== undefined ? { utilization: u } : {}),
        cells: a.instances.get(c.from.instanceId)?.ports.get(c.from.port)?.absCells ?? [],
      };
    }),
    highlights: diagnostics
      .filter((d): d is Diagnostic & { at: Vec3 } => d.at !== undefined)
      .map((d) => ({ at: d.at, severity: d.severity, message: d.message })),
  };
}
