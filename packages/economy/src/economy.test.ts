import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type EvaluationContext, type Process, type Quote, type Site, evaluatePlan } from "./index.js";

const now = new Date("2026-11-25T00:00:00Z");
const q = (item: string, sell?: number, buy?: number, maxSellPerHour?: number): Quote => ({
  item,
  ...(sell !== undefined ? { sellPrice: sell } : {}),
  ...(buy !== undefined ? { buyPrice: buy } : {}),
  ...(maxSellPerHour !== undefined ? { maxSellPerHour } : {}),
  channel: "test",
  asOf: now,
  source: "test",
});

const processes = new Map<string, Process>([
  [
    "mobfarm",
    {
      id: "mobfarm",
      name: "Mob farm",
      inputsPerHour: {},
      outputsPerHour: { "minecraft:bone": 1000 },
      site: { hostileMobCapShare: 1, needsPlayerNearby: true },
    },
  ],
  [
    "bonemeal",
    {
      id: "bonemeal",
      name: "Bone meal",
      inputsPerHour: { "minecraft:bone": 500 },
      outputsPerHour: { "minecraft:bone_meal": 1500 },
      site: { needsPlayerNearby: false },
    },
  ],
]);

const sites = new Map<string, Site>([
  ["a", { id: "a", name: "Spot A", kind: "afk", needsAccount: true }],
  ["b", { id: "b", name: "Spot B", kind: "afk", needsAccount: true }],
]);

const ctx = (accounts = 1): EvaluationContext => ({
  processes,
  sites,
  accounts,
  quotes: new Map([
    ["minecraft:bone", q("minecraft:bone", 1, 2)],
    ["minecraft:bone_meal", q("minecraft:bone_meal", 0.5, undefined, 1000)],
  ]),
});

describe("plan evaluation", () => {
  it("accounts for internal use, market limits and revenue", () => {
    const r = evaluatePlan({ entries: [{ processId: "mobfarm", siteId: "a", count: 1 }, { processId: "bonemeal", siteId: "a", count: 1 }] }, ctx());
    assert.equal(r.netItemsPerHour["minecraft:bone"], 500);
    assert.equal(r.unsoldPerHour["minecraft:bone_meal"], 500);
    assert.equal(r.revenuePerHour, 500 * 1 + 1000 * 0.5);
  });

  it("two mob farms at the same AFK spot share the mob cap", () => {
    const r = evaluatePlan({ entries: [{ processId: "mobfarm", siteId: "a", count: 2 }] }, ctx());
    assert.equal(r.netItemsPerHour["minecraft:bone"], 1000);
    assert.ok(r.diagnostics.some((d) => d.code === "mob-cap-shared"));
  });

  it("more AFK spots than accounts is an error", () => {
    const r = evaluatePlan({ entries: [{ processId: "mobfarm", siteId: "a", count: 1 }, { processId: "mobfarm", siteId: "b", count: 1 }] }, ctx(1));
    assert.ok(r.diagnostics.some((d) => d.code === "too-many-afk-sites"));
  });
});
