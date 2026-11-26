/**
 * From a farm to an economic process: what goes in and out per hour,
 * according to the farm's flow model, plus what it costs to build.
 *
 * - Outputs: items arriving in storage (chests, the AFK player)
 * - Inputs: items used up by converters (bone meal → kelp) that come from
 *   outside the design (supply chests marked `external`), plus `consumes`
 *   declarations (fuel, …)
 * - Build cost: the bill of materials, with block ids turned into the items
 *   you place them with; fluids are left out (two buckets make a source)
 */

import { type ResolvedAssembly, billOfMaterials } from "@redstack/core";
import type { ItemRates, Process, SiteNeeds } from "@redstack/economy";
import { type FlowAnalysis, analyzeFlow } from "@redstack/flow";

export interface AssemblyProcessOptions {
  readonly id?: string;
  readonly name?: string;
  /** What the farm needs from its site; default: a player nearby, nothing else */
  readonly site?: Partial<SiteNeeds>;
  /** Measured server load (ms per tick), e.g. from an in-game test report */
  readonly msPerTick?: number;
  /** Include the build cost (default true) */
  readonly buildCost?: boolean;
  /** Use an existing flow analysis instead of computing one */
  readonly flow?: FlowAnalysis;
}

/** Blocks that are placed with a differently named item. */
const ITEM_FOR_BLOCK: Readonly<Record<string, string>> = {
  "minecraft:redstone_wire": "minecraft:redstone",
  "minecraft:redstone_wall_torch": "minecraft:redstone_torch",
  "minecraft:wall_torch": "minecraft:torch",
  "minecraft:tripwire": "minecraft:string",
  "minecraft:kelp_plant": "minecraft:kelp",
};
const FLUIDS = new Set(["minecraft:water", "minecraft:lava", "minecraft:bubble_column"]);

/** The item a block is placed with, or undefined for blocks you do not place (fluids). */
export function itemForBlock(id: string): string | undefined {
  if (FLUIDS.has(id)) return undefined;
  if (ITEM_FOR_BLOCK[id]) return ITEM_FOR_BLOCK[id];
  // oak_wall_sign → oak_sign, spruce_wall_hanging_sign → spruce_hanging_sign
  if (/_wall_(hanging_)?sign$/.test(id)) return id.replace("_wall_", "_");
  return id;
}

export function processFromAssembly(a: ResolvedAssembly, opts: AssemblyProcessOptions = {}): Process {
  const flow = opts.flow ?? analyzeFlow(a);
  const outputs: Record<string, number> = {};
  for (const [item, r] of Object.entries(flow.storedPerHour)) {
    // Supply items that merely pass through into storage are no product
    if (!flow.externalItems.has(item) && r > 0) outputs[item] = r;
  }
  const inputs: Record<string, number> = { ...flow.inputsPerHour };
  for (const [item, r] of Object.entries(flow.convertedPerHour)) {
    if (flow.externalItems.has(item) && r > 0) inputs[item] = (inputs[item] ?? 0) + r;
  }

  const buildCost: Record<string, number> = {};
  if (opts.buildCost ?? true) {
    for (const { id, count } of billOfMaterials(a)) {
      const item = itemForBlock(id);
      if (item) buildCost[item] = (buildCost[item] ?? 0) + count;
    }
  }

  const site: SiteNeeds = {
    needsPlayerNearby: true,
    ...(opts.msPerTick !== undefined ? { msptCost: opts.msPerTick } : {}),
    ...opts.site,
  };
  return {
    id: opts.id ?? a.name,
    name: opts.name ?? a.name,
    inputsPerHour: inputs,
    outputsPerHour: outputs,
    ...(Object.keys(buildCost).length ? { buildCost } : {}),
    site,
    source: { kind: "assembly-model", ref: a.name },
  };
}

/**
 * For a process with one input and one output: the lowest sell price of the
 * output, as a multiple of the input's buy price, at which it breaks even.
 * Prices change; this ratio does not.
 */
export function breakEvenRatio(p: Process): { readonly input: string; readonly output: string; readonly ratio: number } | undefined {
  const ins = Object.entries(p.inputsPerHour).filter(([, r]) => r > 0);
  const outs = Object.entries(p.outputsPerHour).filter(([, r]) => r > 0);
  if (ins.length !== 1 || outs.length !== 1) return undefined;
  const [[input, rin]] = ins as [[string, number]];
  const [[output, rout]] = outs as [[string, number]];
  return { input, output, ratio: rin / rout };
}

/** Readable summary: per hour in and out, build cost. */
export function formatProcess(p: Process): string {
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const list = (r: ItemRates) => Object.entries(r).map(([i, n]) => `  ${i}: ${fmt(n)}/h`);
  const lines = [`Process ${p.name}`, "Out:", ...list(p.outputsPerHour), "In:", ...(Object.keys(p.inputsPerHour).length ? list(p.inputsPerHour) : ["  nothing"])];
  if (p.buildCost) {
    const total = Object.values(p.buildCost).reduce((x, y) => x + y, 0);
    lines.push(`Build: ${total} items (${Object.entries(p.buildCost).sort((x, y) => y[1] - x[1]).map(([i, n]) => `${n} ${i.replace("minecraft:", "")}`).join(", ")})`);
  }
  const be = breakEvenRatio(p);
  if (be) lines.push(`Breaks even when ${be.output} sells for at least ${be.ratio.toFixed(3)} × the price of ${be.input}.`);
  return lines.join("\n");
}
