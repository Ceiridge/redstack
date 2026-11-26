import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIR_VECTORS, type Dir, type ResolvedAssembly, VANILLA_26_3, add, assembly, billOfMaterials, bounds, key, runChecks } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import { registry } from "@redstack/nucleation";
import {
  CACTUS_SURVIVAL,
  CactusCell,
  CactusRow,
  Chest,
  Crafter,
  HopperLine,
  KelpBonemealCore,
  PlayerPickup,
  SupplyChest,
  cactusGrowthPerHour,
  containerSignal,
  disabledSlots,
  itemsForSignal,
  withSettings,
} from "./index.js";

/** Follows hopper outputs from every hopper; returns hoppers whose path does not reach `target`. */
function strandedHoppers(r: ResolvedAssembly, target: string): string[] {
  const hoppers = new Map([...r.blocks.values()].filter((b) => b.block.id === "minecraft:hopper").map((b) => [key(b.pos), b]));
  const stranded: string[] = [];
  for (const start of hoppers.values()) {
    let cur = start;
    for (let step = 0; ; step++) {
      const next = key(add(cur.pos, DIR_VECTORS[cur.block.props["facing"] as Dir]));
      if (next === target) break;
      const h = hoppers.get(next);
      if (!h || step > hoppers.size) {
        stranded.push(`${key(start.pos)} → stops at ${next}`);
        break;
      }
      cur = h;
    }
  }
  return stranded;
}

const errorsAndWarnings = (r: ResolvedAssembly) => runChecks(r, { registry }).filter((d) => d.severity !== "info");

describe("HopperLine", () => {
  it("moves 9,000 items/h in vanilla and follows server hopper settings", () => {
    const rate = (env = VANILLA_26_3) => {
      const t = HopperLine.instantiate({}, { env, materials: {} });
      const p = t.rates.find((r) => r.type === "passes");
      return p?.type === "passes" ? p.maxPerHour : NaN;
    };
    assert.equal(rate(), 9000);
    assert.equal(rate(withSettings(VANILLA_26_3, { id: "fast", hopperTransferTicks: 4 })), 18_000);
  });
});

describe("CactusRow", () => {
  const farm = (cells: number, breaker: "fence" | "glass" = "fence") =>
    assembly(`row-${cells}`, (f) => void f.add(CactusRow({ cells, breaker })).to(Chest)).resolve();

  for (const cells of [1, 2, 5]) {
    it(`${cells} cell(s): valid, every hopper reaches the chest, 5 hoppers per cactus + 3`, () => {
      const r = farm(cells);
      assert.deepEqual(errorsAndWarnings(r), []);
      const chest = [...r.blocks.values()].find((b) => b.block.id === "minecraft:chest")!;
      assert.deepEqual(strandedHoppers(r, key(chest.pos)), []);
      const bom = Object.fromEntries(billOfMaterials(r).map((b) => [b.id, b.count]));
      assert.equal(bom["minecraft:hopper"], 5 * cells + 3);
      assert.equal(bom["minecraft:cactus"], cells);
      assert.equal(bom["minecraft:oak_fence"], cells);
      const { min, max } = bounds(r);
      assert.equal(max[2] - min[2] + 1, 2 * cells + 2, "length: cap + 2 per cell + chest");
    });
  }

  it("predicts cells × growth × survival", () => {
    const flow = analyzeFlow(farm(16));
    assert.ok(Math.abs(flow.storedPerHour["minecraft:cactus"]! - 16 * cactusGrowthPerHour(VANILLA_26_3) * CACTUS_SURVIVAL.row.fence) < 1e-9);
  });

  it("accepts any fence as breaker, but not a full block", () => {
    const build = (breaker: string) =>
      assembly("t", (f) => void f.add(CactusRow({ cells: 2 })).to(Chest), { materials: { cactusBreaker: breaker } }).resolve();
    assert.deepEqual(errorsAndWarnings(build("minecraft:spruce_fence")), []);
    assert.ok(runChecks(build("minecraft:stone"), { registry }).some((d) => d.code === "material-not-accepted"));
  });

  it("follows growth modifiers of the environment", () => {
    const fast = withSettings(VANILLA_26_3, { id: "fast", growthModifiers: { cactus: 200 } });
    assert.equal(cactusGrowthPerHour(fast), 2 * cactusGrowthPerHour(VANILLA_26_3));
  });
});

describe("CactusCell (ring design)", () => {
  for (const rotation of [0, 1, 2, 3]) {
    it(`every ring hopper leads to the exit (rotation ${rotation})`, () => {
      const r = assembly("t", (f) => void f.add(CactusCell).rotated(rotation)).resolve();
      const exit = key(r.instances.get("CactusCell#1")!.ports.get("drops")!.absCells[0]!);
      assert.deepEqual(strandedHoppers(r, exit), []);
    });
  }
});

describe("KelpBonemealCore with routed supply", () => {
  const BONE_MEAL = "minecraft:bone_meal";
  const farm = (supplies: 1 | 2) =>
    assembly(`kelp-${supplies}`, (f) => {
      const core = f.add(KelpBonemealCore).at([0, 0, 0]);
      const player = f.add(PlayerPickup).at([1, 1, 5]);
      f.connect(core.port("kelp"), player.port("in"));
      const a = f.add(SupplyChest, { item: BONE_MEAL }).at([-1, 3, 1]);
      if (supplies === 2) {
        const b = f.add(SupplyChest, { item: BONE_MEAL }).at([3, 3, 3]);
        f.route(a.port("out"), core.port("bonemealWest"));
        f.route(b.port("out"), core.port("bonemealEast"));
      } else {
        f.distribute(a.port("out"), [core.port("bonemealWest"), core.port("bonemealEast")]);
      }
    }).resolve();

  it("passes the checks with the real block registry", () => {
    for (const n of [1, 2] as const) {
      const errs = runChecks(farm(n), { registry }).filter((d) => d.severity === "error");
      assert.deepEqual(errs, [], `supplies=${n}`);
    }
  });

  it("feeds each dispenser through hoppers that start under its chest and end in it", () => {
    const r = farm(2);
    assert.ok(reachesTarget(r, [-1, 2, 1], "0,1,2"), "west dispenser");
    assert.ok(reachesTarget(r, [3, 2, 3], "2,1,2"), "east dispenser");
  });

  it("models the supply line: one chest feeds only half the kelp", () => {
    const kelp = (n: 1 | 2) => analyzeFlow(farm(n)).storedPerHour["minecraft:kelp"]!;
    assert.ok(Math.abs(kelp(2) - 18_000 * 0.93) < 1e-6);
    assert.ok(Math.abs(kelp(1) - 9_000 * 0.93) < 1e-6);
  });

  it("keeps the items' path and the player's cells free of hoppers", () => {
    const r = farm(2);
    for (const b of r.blocks.values()) {
      if (b.block.id !== "minecraft:hopper") continue;
      assert.ok(!(b.pos[2] >= 4 && b.pos[0] >= 0 && b.pos[0] <= 2 && b.pos[1] >= 1), `hopper at ${key(b.pos)} in the kelp's way`);
    }
  });
});

/** Does the hopper chain starting at `pos` end in `target`? */
function reachesTarget(r: ResolvedAssembly, pos: readonly [number, number, number], target: string): boolean {
  let cur = r.blocks.get(key(pos));
  for (let i = 0; cur && i < 64; i++) {
    const next = key(add(cur.pos, DIR_VECTORS[cur.block.props["facing"] as Dir]));
    if (next === target) return true;
    cur = r.blocks.get(next);
    if (cur?.block.id !== "minecraft:hopper") return false;
  }
  return false;
}

describe("processing", () => {
  it("computes comparator signals like the game", () => {
    assert.equal(containerSignal([[22, 64]], 5), 1, "filter hopper: 18 + 4 junk");
    assert.equal(containerSignal([[23, 64]], 5), 2, "one extra item");
    assert.equal(containerSignal([[27 * 64, 64]], 27), 15, "full shulker box");
    assert.equal(containerSignal([[27 * 64 - 1, 64]], 27), 14, "one item short");
    assert.equal(containerSignal([[itemsForSignal(14, 9), 64]], 9), 14);
    assert.equal(containerSignal([[itemsForSignal(8, 9), 64]], 9), 8);
  });

  it("disables the crafter slots the pattern leaves empty", () => {
    assert.deepEqual(disabledSlots({ pattern: ["PPP", "P.P", "PPP"], key: { P: "minecraft:oak_planks" }, result: "minecraft:chest" }), [4]);
    assert.deepEqual(disabledSlots({ pattern: ["S..", "S..", "..."], key: { S: "minecraft:oak_planks" }, result: "minecraft:stick" }), [1, 2, 4, 5, 6, 7, 8]);
  });

  it("refuses shaped recipes with several ingredients, allows shapeless ones", () => {
    const piston = { pattern: ["PPP", "CIC", "CRC"], key: { P: "minecraft:oak_planks", C: "minecraft:cobblestone", I: "minecraft:iron_ingot", R: "minecraft:redstone" }, result: "minecraft:piston" } as const;
    assert.throws(() => Crafter.instantiate({ recipe: { ...piston, pattern: [...piston.pattern] as [string, string, string] } }), /ordered input/);
    const charge = { pattern: ["GBC", "...", "..."] as [string, string, string], key: { G: "minecraft:gunpowder", B: "minecraft:blaze_powder", C: "minecraft:coal" }, result: "minecraft:fire_charge", count: 3 };
    assert.doesNotThrow(() => Crafter.instantiate({ recipe: charge, shapeless: true }));
  });

  it("models a crafter as ingredients → products, limited by its hopper", () => {
    const r = assembly("craft", (f) => {
      const c = f.add(Crafter).at([0, 0, 0]);
      f.connect(f.add(SupplyChest({ item: "minecraft:oak_planks" })).at([0, 2, 0]).port("out"), c.port("in"));
      c.to(Chest);
    }).resolve();
    assert.equal(analyzeFlow(r).storedPerHour["minecraft:chest"], 9_000 / 8);
    assert.deepEqual(
      runChecks(r, { registry }).filter((d) => d.severity === "error"),
      [],
    );
  });
});
