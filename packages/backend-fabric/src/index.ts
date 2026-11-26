/**
 * Test backend: a running Fabric server with Carpet, controlled over RCON.
 *
 * Per run:
 *  1. Load the test area (forceload), clear it, remove items, lay a catch floor
 *  2. Place blocks bottom-up (the game is frozen, nothing moves yet)
 *  3. Put a Carpet fake player at the AFK spot, on a glass platform unless the
 *     design has a floor there – without a player nearby there are no random
 *     ticks and no spawns; then run the preparation actions
 *  4. Keep the game frozen and advance it with `tick sprint`; measure the
 *     storage after each step, using the actual game time
 *  5. Collect events with locations (items on the ground, backed-up hoppers)
 *
 * Target version: Minecraft 26.3 (game rule names are snake_case there).
 * Server setup: see this package's README.
 */

import { type ResolvedAssembly, type Vec3, add, blockEntitySnbt, bounds, formatBlock, key, sub } from "@redstack/core";
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
  storagePositions,
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

/** The server version this backend is set up for (see server-manifest.json). */
const SERVER_MINECRAFT = "26.3";

/** Game rules set for every run (26.3 names). Scenarios can override them. */
const BASE_GAMERULES: Readonly<Record<string, string | number | boolean>> = {
  advance_time: false,
  advance_weather: false,
  max_block_modifications: 1_000_000,
};

const ITEM_ALL = "*";
/** Horizontal margin around the assembly that is cleared and covered by the catch floor */
const CATCH_MARGIN = 6;
/** Standard test area relative to the origin, cleared before every run whatever the design's size */
const CLEAR_MIN: Vec3 = [-16, -8, -16];
const CLEAR_MAX: Vec3 = [63, 63, 63];
/** Longest delay of a scheduled tick worth waiting out after clearing (lava flows every 30 ticks) */
const STALE_TICKS = 40;

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

  unsupported(s: Scenario): string[] {
    const env = s.assembly.env;
    const out: string[] = [];
    if (env.minecraft !== SERVER_MINECRAFT) out.push(`the server runs Minecraft ${SERVER_MINECRAFT}, the design targets ${env.minecraft}`);
    if (env.hopperTransferTicks !== 8 || env.hopperAmount !== 1) out.push("custom hopper speed (Spigot/Paper setting) cannot be emulated on Fabric");
    if (Object.keys(env.growthModifiers).length) out.push("growth modifiers (Spigot/Paper setting) cannot be emulated on Fabric");
    return out;
  }

  async run(s: Scenario): Promise<TestReport> {
    const missing = missingCapabilities(this, s);
    if (missing.length) throw new Error(`${this.id} cannot provide: ${missing.join(", ")}`);
    const unsupported = this.unsupported(s);
    if (unsupported.length) throw new Error(`${this.id} cannot run "${s.name}": ${unsupported.join("; ")}.`);

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
      random_tick_speed: s.assembly.env.randomTickSpeed,
      spawn_mobs: s.requires.includes("mob-spawning"),
      ...s.world.gamerules,
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

    // 1. Load and clear the area – at least the standard test area, so that
    // leftovers of an earlier, larger design (a running TNT duper, flowing
    // lava) cannot leak into this run
    const clo = w([0, 1, 2].map((i) => Math.min(lo[i]! - this.#opts.origin[i]!, CLEAR_MIN[i]!)) as unknown as Vec3);
    const chi = w([0, 1, 2].map((i) => Math.max(hi[i]! - this.#opts.origin[i]!, CLEAR_MAX[i]!)) as unknown as Vec3);
    await server.ok(`forceload add ${clo[0]} ${clo[2]} ${chi[0]} ${chi[2]}`, /added|already|marked/i);
    await server.ok(`fill ${clo.join(" ")} ${chi.join(" ")} minecraft:air strict`, /./);
    const killAll = `kill @e[type=!player,x=${clo[0]},y=${clo[1]},z=${clo[2]},dx=${chi[0] - clo[0]},dy=${chi[1] - clo[1]},dz=${chi[2] - clo[2]}]`;
    await server.ok(killAll, /./);
    // Let ticks still scheduled by the previous run (observers, pistons, fluids)
    // run out on the empty area; otherwise they fire on the new design's blocks
    await server.sprint(STALE_TICKS);
    await server.ok(killAll, /./);
    // Catch floor: in a void world, lost items would fall out of the world unseen.
    // With a floor they stay in the test area and are reported as ground items.
    await server.ok(`fill ${lo[0]} ${lo[1]} ${lo[2]} ${hi[0]} ${lo[1]} ${hi[2]} minecraft:barrier`, /./);

    if (s.world.terrain === "flat") {
      const gy = this.#opts.origin[1] + (s.world.groundY ?? box.min[1] - 1);
      await server.ok(`fill ${lo[0]} ${gy} ${lo[2]} ${hi[0]} ${gy} ${hi[2]} minecraft:stone`, /./);
    } else if (s.world.terrain === "terrain") {
      throw new Error(`${this.id}: natural terrain is not supported yet.`);
    }

    // 2. Blocks bottom-up
    const strict = (instanceId: string) =>
      s.placement === "strict" ? true : s.placement === "with-updates" ? false : s.placement.strict(instanceId);
    // Strict blocks first, then the rest bottom-up with updates
    const blocks = [...a.blocks.values()].sort((x, y) => Number(strict(y.instanceId)) - Number(strict(x.instanceId)) || x.pos[1] - y.pos[1]);
    for (const b of blocks) {
      const p = w(b.pos);
      const nbt = blockEntitySnbt(b.block);
      await server.ok(`setblock ${p.join(" ")} ${formatBlock(b.block)}${nbt}${strict(b.instanceId) ? " strict" : ""}`, /Changed the block/);
    }
    // 3. Fake player on a platform, after the blocks: the design may provide its floor
    const afk = w(s.world.afkSpot ?? [Math.round((box.min[0] + box.max[0]) / 2), box.max[1] + 3, Math.round((box.min[2] + box.max[2]) / 2)]);
    // The platform is only needed when the design does not provide the floor itself
    const floor = sub(afk, this.#opts.origin);
    if (!a.blocks.has(key([floor[0], floor[1] - 1, floor[2]]))) {
      await server.ok(`setblock ${afk[0]} ${afk[1] - 1} ${afk[2]} minecraft:glass`, /./);
    }
    await this.#ensureBot(server, afk);

    // One tick so block updates and block entities settle
    await server.sprint(1);

    const bot = this.#opts.botName;
    if (s.measure.player) await server.command(`clear ${bot}`);
    for (const act of s.actions) {
      if (act.type === "insert") await this.#insert(server, w(act.at), act.item, act.count, act.stack ?? 64);
      else if (act.type === "wait") await server.sprint(act.ticks);
      else if (act.type === "set") await server.ok(`setblock ${w(act.at).join(" ")} ${act.block}`, /Changed the block/);
      else if (act.type === "use") await this.#use(server, a, act.at, act.from ?? standingCell(a, act.at), afk);
      else if (act.type === "drop") {
        const [x, y, z] = w(act.at);
        for (let left = act.count; left > 0; left -= 64) {
          const n = Math.min(64, left);
          await server.command(`summon item ${x + 0.5} ${y + 0.5} ${z + 0.5} {Item:{id:"${act.item}",count:${n}},Motion:[0.0,0.0,0.0]}`);
        }
      }
    }

    // 4. Measure
    const sinks = (s.measure.containers ?? storagePositions(a)).map(w);
    const items = s.measure.items ?? [
      ...new Set([...Object.keys(analyzeFlow(a).storedPerHour), ...s.actions.flatMap((x) => (x.type === "insert" ? [x.item] : []))]),
    ];
    const picked: Record<string, number> = {};
    const samples: Sample[] = [];
    const measure = async (tick: number) => {
      const stored = await this.#countStored(server, sinks, items);
      if (s.measure.player) {
        // Emptying the inventory at every sample keeps it from filling up
        for (const item of [...items, ITEM_ALL]) {
          const n = await server.removed(item === ITEM_ALL ? `clear ${bot}` : `clear ${bot} ${item}`);
          picked[item] = (picked[item] ?? 0) + n;
          if (item !== ITEM_ALL) picked[ITEM_ALL] = (picked[ITEM_ALL] ?? 0) + n;
        }
        for (const [item, n] of Object.entries(picked)) stored[item] = (stored[item] ?? 0) + n;
      }
      samples.push({ tick, stored });
    };
    const t0Game = await server.gameTime();
    let tick = 0;
    let sprintMs = 0;
    await measure(tick);
    // Feeds spawn their share every few ticks; the remainder carries over
    const owed = s.feeds.map(() => 0);
    const feedEvery = Math.min(...s.feeds.map((f) => f.everyTicks ?? 20), s.sampleEveryTicks);
    const spawn = async (ticks: number) => {
      for (const [i, f] of s.feeds.entries()) {
        owed[i]! += (f.perHour * ticks) / 72_000;
        const n = Math.floor(owed[i]!);
        owed[i]! -= n;
        const [x, y, z] = w(f.at);
        for (let left = n; left > 0; left -= 64) {
          await server.command(`summon item ${x + 0.5} ${y + 0.5} ${z + 0.5} {Item:{id:"${f.item}",count:${Math.min(64, left)}},Motion:[0.0,0.0,0.0]}`);
        }
      }
    };
    while (tick < s.durationTicks) {
      const sampleAt = Math.min(tick + s.sampleEveryTicks, s.durationTicks);
      while (tick < sampleAt) {
        const step = s.feeds.length ? Math.min(feedEvery, sampleAt - tick) : sampleAt - tick;
        if (s.feeds.length) await spawn(step);
        const started = Date.now();
        const now = await server.sprint(step, this.#opts.log);
        sprintMs += Date.now() - started;
        tick = now - t0Game;
      }
      await measure(tick);
    }

    // 5. Events
    const events: TestEvent[] = [];
    const area = `x=${lo[0]},y=${lo[1]},z=${lo[2]},dx=${hi[0] - lo[0]},dy=${hi[1] - lo[1]},dz=${hi[2] - lo[2]}`;
    const ground = await server.numbers(`execute as @e[type=item,${area}] run data get entity @s Item.count`);
    if (ground.length > 0) {
      const items = ground.reduce((x, y) => x + y, 0);
      // Positions in assembly coordinates, so the viewer and an AI can point at the leak
      const raw = await server.command(`execute as @e[type=item,${area},limit=10] run data get entity @s Pos`);
      const at = [...raw.matchAll(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/g)].map(
        (m) => [Math.floor(Number(m[1])) - this.#opts.origin[0], Math.floor(Number(m[2])) - this.#opts.origin[1], Math.floor(Number(m[3])) - this.#opts.origin[2]] as const,
      );
      events.push({
        tick,
        type: "ground-items",
        ...(at[0] ? { at: at[0] } : {}),
        message: `${items} item(s) in ${ground.length} stack(s) on the ground${at.length ? ` at ${at.map((p) => `(${p.join(",")})`).join(" ")}` : ""}.`,
        data: { items, stacks: ground.length, positions: at },
      });
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
      ...(tick > 0 ? { msPerTick: sprintMs / tick } : {}),
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

  /** Right-click by the fake player, like a real player would flip a lever. */
  async #use(server: Server, a: ResolvedAssembly, at: Vec3, from: Vec3, afk: Vec3): Promise<void> {
    const bot = this.#opts.botName;
    const [fx, fy, fz] = this.#opts.origin.map((o, i) => o + from[i]!) as [number, number, number];
    const [tx, ty, tz] = this.#opts.origin.map((o, i) => o + at[i]! + 0.5) as [number, number, number];
    await server.ok(`tp ${bot} ${fx + 0.5} ${fy} ${fz + 0.5}`, /Teleported/);
    await server.command(`player ${bot} look at ${tx} ${ty} ${tz}`);
    await server.command(`player ${bot} use once`);
    await server.sprint(1);
    await server.ok(`tp ${bot} ${afk[0] + 0.5} ${afk[1]} ${afk[2] + 0.5}`, /Teleported/);
    const block = a.blocks.get(key(at));
    if (block) this.#opts.log?.(`used ${block.block.id} at (${at.join(",")}) from (${from.join(",")})`);
  }

  async #insert(server: Server, pos: Vec3, item: string, count: number, stack: number): Promise<void> {
    // RCON accepts at most 1,446 bytes per command; ids inside item components
    // (a filled shulker box) are written without the default namespace
    const bracket = item.indexOf("[");
    if (bracket > 0) item = item.slice(0, bracket) + item.slice(bracket).replaceAll('"minecraft:', '"');
    let left = count;
    for (let slot = 0; left > 0; slot++) {
      if (slot >= 54) throw new Error(`insert: ${count} × ${item} does not fit into the container at (${pos.join(",")}).`);
      const n = Math.min(stack, left);
      await server.ok(`item replace block ${pos.join(" ")} container.${slot} with ${item} ${n}`, /Replaced/);
      left -= n;
    }
  }

  /**
   * Item counts across containers, items inside shulker boxes included: one
   * `data get block` per container, every {count, id} entry in it summed.
   */
  async #countStored(server: Server, sinks: readonly Vec3[], items: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = Object.fromEntries([...items, ITEM_ALL].map((i) => [i, 0]));
    for (const p of sinks) {
      const r = await server.command(`data get block ${p.join(" ")} Items`);
      for (const [id, n] of countItemsInSnbt(r)) {
        out[ITEM_ALL]! += n;
        if (id in out) out[id]! += n;
      }
    }
    return out;
  }
}

/**
 * Every item entry in `/data get` output, nested container contents included:
 * `{count: 64, Slot: 0b, id: "minecraft:stone"}` and `item: {count: 64, id: "…"}`.
 */
export function countItemsInSnbt(text: string): Array<[string, number]> {
  return [...text.matchAll(/count: (\d+)(?:, Slot: -?\d+b)?, id: "([^"]+)"/g)].map((m) => [m[2]!, Number(m[1])]);
}

const FACING: Readonly<Record<string, Vec3>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

/**
 * A cell to stand in for using a block: free for the player's feet and head,
 * preferring the side the block faces (a lever on a wall faces away from it).
 */
export function standingCell(a: ResolvedAssembly, at: Vec3): Vec3 {
  const block = a.blocks.get(key(at));
  const facing = String(block?.block.props["facing"] ?? "");
  const dirs = [...(facing && FACING[facing] ? [FACING[facing]] : []), ...Object.values(FACING)];
  const free = (p: Vec3) => !a.blocks.has(key(p));
  for (const d of dirs) {
    const feet = add(at, d);
    if (free(feet) && free(add(feet, [0, 1, 0]))) return feet;
    const lower = add(feet, [0, -1, 0]);
    if (free(lower) && free(feet)) return lower;
  }
  throw new Error(`No free cell next to (${at.join(",")}) to use it from; give "from" explicitly.`);
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

  /** Items removed by /clear ("Removed N item(s) from player X"); no matching items = 0. */
  async removed(cmd: string): Promise<number> {
    const r = await this.rcon.command(cmd);
    const m = /Removed (\d+) item/i.exec(r);
    if (m) return Number(m[1]);
    if (/No items were found/i.test(r)) return 0;
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
