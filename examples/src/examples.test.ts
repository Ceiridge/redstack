import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runChecks } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import { registry } from "@redstack/nucleation";
import { kelpFarm } from "./kelp-farm.js";
import { kelpTwin } from "./kelp-twin.js";

describe("example farms", () => {
  it("kelp farm: passes the checks with the real block registry", () => {
    const r = kelpFarm(2).resolve();
    assert.deepEqual(
      runChecks(r, { registry }).filter((d) => d.severity === "error"),
      [],
    );
  });

  it("kelp twin: the layout search places both cores for one player, one hopper per dispenser", () => {
    const r = kelpTwin().resolve();
    const diags = runChecks(r, { registry });
    assert.deepEqual(
      diags.filter((d) => d.severity === "error"),
      [],
    );
    const hoppers = [...r.blocks.values()].filter((b) => b.block.id === "minecraft:hopper");
    assert.equal(hoppers.length, 4, "each supply chest sits right above a hopper next to its dispenser");
    // Both cores deliver to the one player: twice the single farm
    assert.ok(Math.abs(analyzeFlow(r).storedPerHour["minecraft:kelp"]! - 2 * 18_000 * 0.93) < 1e-6);
  });
});
