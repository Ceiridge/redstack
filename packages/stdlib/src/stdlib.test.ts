import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Assembly, DIR_VECTORS, type Dir, add, key, runChecks } from "@redstack/core";
import { CACTUS_SURVIVAL, CactusCell, Chest, HopperLine, cactusTicksPerGrowth } from "./index.js";

describe("CactusCell", () => {
  for (const rotation of [0, 1, 2, 3]) {
    it(`every ring hopper leads to the exit (rotation ${rotation})`, () => {
      const a = new Assembly("t");
      a.add(CactusCell).at([0, 0, 0]).rotated(rotation);
      const r = a.resolve();
      const hoppers = new Map([...r.blocks.values()].filter((b) => b.block.id === "minecraft:hopper").map((b) => [key(b.pos), b]));
      assert.equal(hoppers.size, 8);
      const exitTarget = key(r.instances.get("CactusCell#1")!.ports.get("drops")!.absCells[0]!);
      for (const start of hoppers.values()) {
        let cur = start;
        for (let step = 0; step < 8; step++) {
          const next = key(add(cur.pos, DIR_VECTORS[cur.block.props["facing"] as Dir]));
          if (next === exitTarget) break;
          const h = hoppers.get(next);
          assert.ok(h, `hopper at ${key(cur.pos)} points at ${next}, which is neither a ring hopper nor the exit`);
          cur = h;
        }
      }
    });
  }

  it("uses the measured survival share of its breaker", () => {
    const rate = (breaker: "fence" | "glass") => {
      const t = CactusCell.instantiate({ breaker });
      const r = t.rates.find((x) => x.type === "produces");
      return r && r.type === "produces" ? r.perHour : NaN;
    };
    const growth = 72_000 / cactusTicksPerGrowth();
    assert.ok(Math.abs(rate("fence") - growth * CACTUS_SURVIVAL.fence) < 1e-9);
    assert.ok(Math.abs(rate("glass") - growth * CACTUS_SURVIVAL.glass) < 1e-9);
  });

  it("a row of cells over a belt passes the static checks", () => {
    const a = new Assembly("t");
    const cells = a.row(CactusCell, 4, [0, 0, -3]);
    const belt = a.add(HopperLine, { length: 10 }).attach("in", cells[0]!.port("drops"));
    for (const c of cells.slice(1)) a.connect(c.port("drops"), belt.port("in"));
    a.add(Chest).attach("in", belt.port("out"));
    assert.deepEqual(runChecks(a.resolve()).filter((d) => d.severity !== "info"), []);
  });
});
