/**
 * Test backend: a running Fabric server with Carpet, controlled over RCON.
 *
 * Per run:
 *  1. Load the test area (forceload), clear it, remove items, lay a catch floor
 *  2. Put a Carpet fake player on a glass platform above the assembly –
 *     without a player nearby there are no random ticks and no spawns
 *  3. Place blocks bottom-up, run the preparation actions
 *  4. Keep the game frozen and advance it with `tick sprint`; measure the
 *     storage after each step, using the actual game time
 *  5. Collect events with locations (items on the ground, backed-up hoppers)
 *
 * Target version: Minecraft 26.3 (game rule names are snake_case there).
 * Server setup: see this package's README.
 */

import { type ResolvedAssembly, type Vec3, add, bounds, formatBlock } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import {
  type Capability,
  type RunResult,
  type Sample,
  type Scenario,
  type TestBackend,
  type TestEvent,
  type TestReport,
  evaluateExpectations,
  missingCapabilities,
  ratesFromSamples,
  summarize,
} from "@redstack/testing";
import { Rcon } from "./rcon.js";

export { Rcon } from "./rcon.js";

export interface FabricCarpetOptions {
  readonly host?: string;
  readonly port?: number;
  readonly password: string;
  /** World position the assembly origin is placed at */
  readonly origin?: Vec3;
  /** Name of the fake player */
  readonly botName?: string;
  /** Progress messages */
  readonly log?: (message: string) => void;
}

/** Game rules set for every run (26.3 names). Scenarios can override them. */
const BASE_GAMERULES: Readonly<Record<string, string | number | boolean>> = {
  advance_time: false,
  advance_weather: false,
  random_tick_speed: 3,
  max_block_modifications: 1_000_000,
};

const ITEM_ALL = "*";
/** Horizontal margin around the assembly that is cleared and covered by the catch floor */
const CATCH_MARGIN = 6;

export class FabricCarpetBackend implements TestBackend {
  readonly id = "fabric-carpet";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "redstone",
    "block-updates",
    "items",
    "random-ticks",
    "mob-spawning",
    "villagers",
    "fake-player",
  ]);

  readonly #opts: Required<Omit<FabricCarpetOptions, "log">> & Pick<FabricCarpetOptions, "log">;

  constructor(opts: FabricCarpetOptions) {
    this.#opts = {
      host: opts.host ?? "127.0.0.1",
      port: opts.port ?? 25575,
      password: opts.password,
      origin: opts.origin ?? [0, 100, 0],
      botName: opts.botName ?? "redstack",
      log: opts.log,
    };
  }

  async run(s: Scenario): Promise<TestReport> {
    const missing = missingCapabilities(this, s);
    if (missing.length) throw new Error(`${this.id} cannot provide: ${missing.join(", ")}`);

    const startedAt = new Date().toISOString();
    const rcon = await Rcon.connect(this.#opts.host, this.#opts.port, this.#opts.password);
    const server = new Server(rcon);
    const runs: RunResult[] = [];
    try {
      await this.#prepareServer(server, s);
      for (let i = 0; i < s.repeats; i++) {
        this.#opts.log?.(`${s.name}: run ${i + 1}/${s.repeats}`);
        runs.push(await this.#runOnce(server, s, i));
      }
    } finally {
      rcon.close();
    }

    const expectations = evaluateExpectations(s, runs, analyzeFlow(s.assembly));
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

  async #prepareServer(server: Server, s: Scenario): Promise<void> {
    await server.ok("tick freeze");
    const rules = {
      ...BASE_GAMERULES,
      spawn_mobs: s.requires.includes("mob-spawning"),
      ...s.environment.gamerules,
    };
    for (const [rule, value] of Object.entries(rules)) await server.ok(`gamerule ${rule} ${String(value)}`);
  }

  async #runOnce(server: Server, s: Scenario, run: number): Promise<RunResult> {
    const t0 = Date.now();
    const a = s.assembly;
    const w = (v: Vec3) => add(this.#opts.origin, v);
    const box = bounds(a);
    const lo = w(add(box.min, [-CATCH_MARGIN, -2, -CATCH_MARGIN]));
    const hi = w(add(box.max, [CATCH_MARGIN, 4, CATCH_MARGIN]));

    // 1. Load and clear the area
    await server.ok(`forceload add ${lo[0]} ${lo[2]} ${hi[0]} ${hi[2]}`, /added|already|marked/i);
    await server.ok(`fill ${lo.join(" ")} ${hi.join(" ")} minecraft:air`, /./);
    await server.ok("kill @e[type=item]", /./);
    // Catch floor: in a void world, lost items would fall out of the world unseen.
    // With a floor they stay in the test area and are reported as ground items.
    await server.ok(`fill ${lo[0]} ${lo[1]} ${lo[2]} ${hi[0]} ${lo[1]} ${hi[2]} minecraft:barrier`, /./);

    // 2. Fake player on a platform
    const afk = w(s.environment.afkSpot ?? [Math.round((box.min[0] + box.max[0]) / 2), box.max[1] + 3, Math.round((box.min[2] + box.max[2]) / 2)]);
    await server.ok(`setblock ${afk[0]} ${afk[1] - 1} ${afk[2]} minecraft:glass`, /./);
    await this.#ensureBot(server, afk);

    // 3. Blocks bottom-up
    const blocks = [...a.blocks.values()].filter((b) => b.block.id !== "minecraft:air").sort((x, y) => x.pos[1] - y.pos[1]);
    for (const b of blocks) {
      const p = w(b.pos);
      await server.ok(`setblock ${p.join(" ")} ${formatBlock(b.block)}`, /Changed the block/);
    }
    // One tick so block updates and block entities settle
    await server.sprint(1);

    for (const act of s.actions) {
      if (act.type === "insert") await this.#insert(server, w(act.at), act.item, act.count);
      else if (act.type === "wait") await server.sprint(act.ticks);
    }

    // 4. Measure
    const sinks = sinkPositions(a).map(w);
    const items = [...new Set([...Object.keys(analyzeFlow(a).storedPerHour), ...s.actions.flatMap((x) => (x.type === "insert" ? [x.item] : []))])];
    const samples: Sample[] = [];
    const measure = async (tick: number) => samples.push({ tick, stored: await this.#countStored(server, sinks, items) });
    const t0Game = await server.gameTime();
    let tick = 0;
    await measure(tick);
    while (tick < s.durationTicks) {
      const step = Math.min(s.sampleEveryTicks, s.durationTicks - tick);
      tick = (await server.sprint(step, this.#opts.log)) - t0Game;
      await measure(tick);
    }

    // 5. Events
    const events: TestEvent[] = [];
    const area = `x=${lo[0]},y=${lo[1]},z=${lo[2]},dx=${hi[0] - lo[0]},dy=${hi[1] - lo[1]},dz=${hi[2] - lo[2]}`;
    const ground = await server.numbers(`execute as @e[type=item,${area}] run data get entity @s Item.count`);
    if (ground.length > 0) {
      const items = ground.reduce((x, y) => x + y, 0);
      events.push({ tick, type: "ground-items", message: `${items} item(s) in ${ground.length} stack(s) on the ground in the test area.`, data: { items, stacks: ground.length } });
    }
    for (const b of a.blocks.values()) {
      if (b.block.id !== "minecraft:hopper") continue;
      const n = await server.count(`execute if items block ${w(b.pos).join(" ")} container.* ${ITEM_ALL}`);
      if (n >= 64) {
        events.push({ tick, type: "stuck-hopper", at: b.pos, message: `Backed up: ${n} items in a hopper of ${b.instanceId}.`, data: { items: n, instance: b.instanceId } });
      }
    }

    return {
      run,
      ticks: tick,
      measuredPerHour: ratesFromSamples(samples, s.warmupTicks),
      samples,
      events,
      wallClockMs: Date.now() - t0,
    };
  }

  async #ensureBot(server: Server, pos: Vec3): Promise<void> {
    const name = this.#opts.botName;
    const list = await server.command("list");
    const online = new RegExp(`\\b${name}\\b`, "i").test(list.split(":").slice(1).join(":"));
    if (online) {
      await server.ok(`tp ${name} ${pos[0] + 0.5} ${pos[1]} ${pos[2] + 0.5}`, /Teleported/);
      return;
    }
    await server.command(`player ${name} spawn at ${pos[0] + 0.5} ${pos[1]} ${pos[2] + 0.5}`);
    // The login is processed asynchronously over the next ticks
    for (let i = 0; i < 20; i++) {
      await server.sprint(1);
      if (new RegExp(`\\b${name}\\b`, "i").test(await server.command("list"))) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Could not create fake player "${name}" (is Carpet installed?).`);
  }

  async #insert(server: Server, pos: Vec3, item: string, count: number): Promise<void> {
    let left = count;
    for (let slot = 0; left > 0; slot++) {
      if (slot >= 54) throw new Error(`insert: ${count} × ${item} does not fit into the container at (${pos.join(",")}).`);
      const n = Math.min(64, left);
      await server.ok(`item replace block ${pos.join(" ")} container.${slot} with ${item} ${n}`, /Replaced/);
      left -= n;
    }
  }

  async #countStored(server: Server, sinks: readonly Vec3[], items: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const item of [...items, ITEM_ALL]) {
      let sum = 0;
      for (const p of sinks) sum += await server.count(`execute if items block ${p.join(" ")} container.* ${item}`);
      out[item] = sum;
    }
    return out;
  }
}

/** Positions of all storage (ports with a stores declaration). */
function sinkPositions(a: ResolvedAssembly): Vec3[] {
  const out: Vec3[] = [];
  for (const inst of a.instances.values()) {
    for (const r of inst.template.rates) {
      if (r.type !== "stores") continue;
      const cell = inst.ports.get(r.port)?.absCells[0];
      if (cell) out.push(cell);
    }
  }
  return out;
}

/** Thin layer over RCON with error checking. */
class Server {
  constructor(readonly rcon: Rcon) {}

  command(cmd: string): Promise<string> {
    return this.rcon.command(cmd);
  }

  /** Runs a command; the reply must match the pattern, otherwise it throws. */
  async ok(cmd: string, expect: RegExp = /./): Promise<string> {
    const r = await this.rcon.command(cmd);
    if (/Unknown|Incorrect|not loaded|Could not|Invalid|Expected|cannot/i.test(r) || !expect.test(r)) {
      throw new Error(`Command failed: /${cmd}\n→ ${r || "(no reply)"}`);
    }
    return r;
  }

  /** Counting command (execute if …): "Count: N", or "Test failed" = 0. */
  async count(cmd: string): Promise<number> {
    const r = await this.rcon.command(cmd);
    const m = /Count:\s*(\d+)/i.exec(r);
    if (m) return Number(m[1]);
    if (/Test failed/i.test(r)) return 0;
    throw new Error(`Unexpected reply to /${cmd}: ${r}`);
  }

  /** Numbers from a command that reports one value per entity ("... entity data: N"). */
  async numbers(cmd: string): Promise<number[]> {
    const r = await this.rcon.command(cmd);
    if (/Unknown|Incorrect|not loaded|Invalid/i.test(r)) throw new Error(`Command failed: /${cmd}\n→ ${r}`);
    return [...r.matchAll(/entity data:\s*(\d+)/g)].map((m) => Number(m[1]));
  }

  async gameTime(): Promise<number> {
    const r = await this.rcon.command("time query gametime");
    const m = /(\d+)\s*tick/i.exec(r);
    if (!m) throw new Error(`Unexpected reply to /time query gametime: ${r}`);
    return Number(m[1]);
  }

  /**
   * Advances a frozen game by at least `ticks`, waits for the sprint to end and
   * makes sure the game is frozen again. Returns the game time afterwards.
   * Callers must use the returned time: with players online Minecraft 26.3 runs
   * one extra tick per sprint, and an unexpected unfreeze is corrected here
   * (the extra ticks are then part of the measured interval, not lost).
   */
  async sprint(ticks: number, log?: (m: string) => void): Promise<number> {
    if (ticks <= 0) return this.gameTime();
    await this.ok(`tick sprint ${ticks}`, /sprinting/i);
    const deadline = Date.now() + 30_000 + ticks; // generous: >1000 ticks/s expected
    for (let i = 0; ; i++) {
      const state = await this.rcon.command("tick query");
      if (!/sprinting/i.test(state)) {
        if (!/frozen/i.test(state)) {
          await this.ok("tick freeze", /frozen/i);
          log?.("Game was running after a sprint; froze it again.");
        }
        return this.gameTime();
      }
      if (Date.now() > deadline) {
        await this.rcon.command("tick sprint stop");
        await this.ok("tick freeze", /frozen/i);
        throw new Error(`Sprint of ${ticks} ticks did not finish in time; stopped.`);
      }
      await new Promise((r) => setTimeout(r, Math.min(250, 20 + i * 10)));
    }
  }
}
