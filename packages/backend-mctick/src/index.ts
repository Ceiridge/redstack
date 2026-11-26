/**
 * Test backend: mc-tick, Nucleation's headless tick engine (vendor/nucleation,
 * crates/mc-tick), driven through a small native tool (./native). No server,
 * no network, deterministic with a seed – for redstone and item logistics.
 *
 * What it cannot do: players (no AFK player, no pickup), mob spawning, chunk
 * behaviour. Blocks the engine does not model are refused by name, never
 * simulated wrongly; the report then carries that refusal.
 *
 * Build the tool once: `pnpm mctick:build` (needs Rust and the Nucleation
 * submodule: `git submodule update --init --checkout vendor/nucleation`).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ResolvedAssembly, type Vec3, add, bounds, key, sub } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import {
  type Capability,
  type RunResult,
  type Scenario,
  type TestBackend,
  type TestEvent,
  type TestReport,
  evaluateExpectations,
  missingCapabilities,
  ratesFromSamples,
  storagePositions,
  summarize,
} from "@redstack/testing";

/** Data version of Minecraft 26.3 */
const DATA_VERSION = 5023;
const CONTAINER_IDS = /^minecraft:(chest|trapped_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|crafter|([a-z_]+_)?shulker_box)$/;

export interface McTickOptions {
  /** Path of the native tool (default: ./native/target/release/redstack-mctick, or REDSTACK_MCTICK) */
  readonly binary?: string;
  /** Seed for random mechanics; runs with different seeds differ (default: 1 + run index) */
  readonly seed?: number;
  readonly log?: (message: string) => void;
}

interface NativeResponse {
  ok: boolean;
  error?: string;
  samples: Array<{ tick: number; stored: Record<string, number> }>;
  groundItems: Array<{ item: string; count: number; pos: [number, number, number] }>;
  msPerTick?: number;
}

export function defaultBinary(): string {
  return process.env["REDSTACK_MCTICK"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../native/target/release/redstack-mctick");
}

const snbtString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Gametest-flavoured structure SNBT for an assembly, shifted so its lowest
 * corner is 0,0,0. `items` fills containers (slot by slot, 64 per slot).
 */
export function toStructureSnbt(
  a: ResolvedAssembly,
  opts: { readonly items?: ReadonlyArray<{ at: Vec3; item: string; count: number; stack?: number }>; readonly ground?: number } = {},
): { snbt: string; offset: Vec3 } {
  const box = bounds(a);
  const groundY = opts.ground;
  const minY = groundY !== undefined ? Math.min(box.min[1], groundY) : box.min[1];
  const offset: Vec3 = [box.min[0] - 1, minY, box.min[2] - 1];
  const size: Vec3 = [box.max[0] - box.min[0] + 3, box.max[1] - minY + 1, box.max[2] - box.min[2] + 3];
  const palette: string[] = [];
  const index = new Map<string, number>();
  const stateOf = (id: string, props: Readonly<Record<string, unknown>>) => {
    const entries = Object.entries(props).sort(([x], [y]) => x.localeCompare(y));
    const k = `${id}${JSON.stringify(entries)}`;
    let i = index.get(k);
    if (i === undefined) {
      i = palette.length;
      index.set(k, i);
      palette.push(
        entries.length
          ? `{Name: ${snbtString(id)}, Properties: {${entries.map(([p, v]) => `${p}: ${snbtString(String(v))}`).join(", ")}}}`
          : `{Name: ${snbtString(id)}}`,
      );
    }
    return i;
  };
  const items = new Map<string, Array<{ item: string; count: number; stack?: number }>>();
  for (const x of opts.items ?? []) items.set(key(x.at), [...(items.get(key(x.at)) ?? []), x]);
  const rel = (p: Vec3) => sub(p, offset);
  const lines: string[] = [];
  const occupied = new Set<string>();
  for (const b of a.blocks.values()) {
    occupied.add(key(b.pos));
    const r = rel(b.pos);
    const st = stateOf(b.block.id, b.block.props);
    let nbt = "";
    if (CONTAINER_IDS.test(b.block.id)) {
      const stacks: string[] = [];
      for (const it of b.block.items ?? []) stacks.push(`{Slot: ${it.slot}b, id: ${snbtString(it.id)}, count: ${it.count}}`);
      let slot = Math.max(-1, ...(b.block.items ?? []).map((it) => it.slot)) + 1;
      for (const x of items.get(key(b.pos)) ?? []) {
        const per = x.stack ?? 64;
        // "minecraft:shulker_box[container=[…]]" carries its contents as a component
        const m = /^([^[]+)\[container=(\[.*\])\]$/.exec(x.item);
        const id = m ? m[1]! : x.item;
        const comp = m ? `, components: {"minecraft:container": ${m[2]}}` : "";
        for (let left = x.count; left > 0; left -= per) stacks.push(`{Slot: ${slot++}b, id: ${snbtString(id)}, count: ${Math.min(per, left)}${comp}}`);
      }
      const data = Object.entries(b.block.data ?? {}).map(([k, v]) => `, ${k}: ${v}`).join("");
      nbt = `, nbt: {id: ${snbtString(b.block.id)}, Items: [${stacks.join(", ")}]${data}}`;
    }
    lines.push(`{pos: [${r.join(", ")}], state: ${st}${nbt}}`);
  }
  if (groundY !== undefined) {
    const stone = stateOf("minecraft:stone", {});
    for (let x = 0; x < size[0]; x++)
      for (let z = 0; z < size[2]; z++) {
        const world: Vec3 = [x + offset[0], groundY, z + offset[2]];
        if (!occupied.has(key(world))) lines.push(`{pos: [${rel(world).join(", ")}], state: ${stone}}`);
      }
  }
  const snbt = `{\n  DataVersion: ${DATA_VERSION},\n  size: [${size.join(", ")}],\n  palette: [\n    ${palette.join(",\n    ")}\n  ],\n  blocks: [\n    ${lines.join(",\n    ")}\n  ],\n  entities: []\n}\n`;
  return { snbt, offset };
}

export class McTickBackend implements TestBackend {
  readonly id = "mc-tick";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(["redstone", "block-updates", "items", "random-ticks"]);
  readonly #opts: McTickOptions;

  constructor(opts: McTickOptions = {}) {
    this.#opts = opts;
  }

  unsupported(s: Scenario): string[] {
    const out: string[] = [];
    if (s.measure.player) out.push("mc-tick has no players: items picked up by the AFK player cannot be counted");
    if (s.actions.some((x) => x.type === "set")) out.push('"set" actions are not supported yet');
    if (s.actions.some((x) => x.type === "drop") || s.feeds.length) out.push("spawning item entities (drop actions, feeds) is not supported");
    if (s.world.terrain === "terrain") out.push("natural terrain is not supported");
    if (typeof s.placement === "object") out.push("mixed strict/with-updates placement is not supported");
    const ids = new Set([...s.assembly.blocks.values()].map((b) => b.block.id));
    const crafting = ["minecraft:furnace", "minecraft:blast_furnace", "minecraft:smoker", "minecraft:crafter"].filter((id) => ids.has(id));
    if (crafting.length) out.push(`the engine does not execute recipes (${crafting.join(", ")})`);
    const boxes = [...ids].some((id) => /shulker_box$/.test(id)) || s.actions.some((a) => a.type === "insert" && /shulker_box/.test(a.item));
    if (boxes) out.push("filled shulker boxes stack and lose their contents in the engine");
    const env = s.assembly.env;
    if (env.hopperTransferTicks !== 8 || env.hopperAmount !== 1 || Object.keys(env.growthModifiers).length) {
      out.push("Spigot/Paper settings cannot be emulated");
    }
    return out;
  }

  async run(s: Scenario): Promise<TestReport> {
    const missing = missingCapabilities(this, s);
    if (missing.length) throw new Error(`${this.id} cannot provide: ${missing.join(", ")}`);
    const why = this.unsupported(s);
    if (why.length) throw new Error(`${this.id} cannot run "${s.name}": ${why.join("; ")}.`);
    const binary = this.#opts.binary ?? defaultBinary();
    if (!existsSync(binary)) throw new Error(`mc-tick tool not built: ${binary} (run pnpm mctick:build).`);

    const a = s.assembly;
    const inserts = s.actions.flatMap((x) => (x.type === "insert" ? [{ at: x.at, item: x.item, count: x.count, ...(x.stack ? { stack: x.stack } : {}) }] : []));
    const { snbt, offset } = toStructureSnbt(a, {
      items: inserts,
      ...(s.world.terrain === "flat" ? { ground: s.world.groundY ?? bounds(a).min[1] - 1 } : {}),
    });
    const rel = (p: Vec3) => sub(p, offset);
    const items = s.measure.items ?? [
      ...new Set([...Object.keys(analyzeFlow(a).storedPerHour), ...inserts.map((x) => x.item)]),
    ];
    const startedAt = new Date().toISOString();
    const runs: RunResult[] = [];
    for (let i = 0; i < s.repeats; i++) {
      this.#opts.log?.(`${s.name}: run ${i + 1}/${s.repeats} (mc-tick)`);
      const t0 = Date.now();
      const request = {
        snbt,
        settle: s.placement === "strict" ? "in-world" : "placement",
        dataVersion: DATA_VERSION,
        randomTickSpeed: a.env.randomTickSpeed,
        seed: (this.#opts.seed ?? 1) + i,
        actions: s.actions.flatMap((x): Array<{ type: "use"; at: Vec3 } | { type: "wait"; ticks: number }> =>
          x.type === "use" ? [{ type: "use", at: rel(x.at) }] : x.type === "wait" ? [{ type: "wait", ticks: x.ticks }] : [],
        ),
        durationTicks: s.durationTicks,
        sampleEvery: s.sampleEveryTicks,
        containers: (s.measure.containers ?? storagePositions(a)).map(rel),
        items,
      };
      const res = spawnSync(binary, [], { input: JSON.stringify(request), maxBuffer: 256 * 1024 * 1024 });
      if (res.error) throw res.error;
      const out = JSON.parse(res.stdout.toString()) as NativeResponse;
      if (!out.ok) throw new Error(`mc-tick: ${out.error}`);
      const events: TestEvent[] = [];
      if (out.groundItems.length) {
        const at = out.groundItems.map((g) => add([Math.floor(g.pos[0]), Math.floor(g.pos[1]), Math.floor(g.pos[2])], offset));
        const total = out.groundItems.reduce((n, g) => n + g.count, 0);
        events.push({
          tick: s.durationTicks,
          type: "ground-items",
          at: at[0]!,
          message: `${total} item(s) in ${out.groundItems.length} stack(s) on the ground at ${at.slice(0, 10).map((p) => `(${p.join(",")})`).join(" ")}.`,
          data: { items: total, stacks: out.groundItems.length, positions: at.slice(0, 10) },
        });
      }
      const ticks = out.samples[out.samples.length - 1]?.tick ?? 0;
      runs.push({
        run: i,
        ticks,
        measuredPerHour: ratesFromSamples(out.samples, s.warmupTicks),
        samples: out.samples,
        events,
        wallClockMs: Date.now() - t0,
        ...(out.msPerTick !== undefined ? { msPerTick: out.msPerTick } : {}),
      });
    }
    const expectations = evaluateExpectations(s, runs, analyzeFlow(a));
    return {
      schemaVersion: 1,
      scenario: s.name,
      backend: this.id,
      startedAt,
      runs,
      summary: summarize(runs),
      expectations,
      passed: expectations.every((e) => e.passed),
    };
  }
}
