import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIR_VECTORS, type Dir, type ResolvedAssembly, VANILLA_26_3, add, assembly, billOfMaterials, bounds, key, runChecks } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import { registry } from "@redstack/nucleation";
import { CACTUS_SURVIVAL, CactusCell, CactusRow, Chest, HopperLine, cactusGrowthPerHour, withSettings } from "./index.js";

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
