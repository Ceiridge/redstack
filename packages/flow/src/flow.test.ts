import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { B, assembly, component } from "@redstack/core";
import { analyzeFlow } from "./index.js";

const Src = component({ name: "Src", params: { rate: 100 } }, (c, { rate }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.output("out", h.neighbor("forward"), { item: "minecraft:stone", rate: { perHour: rate, basis: "game-mechanic" } });
});

const Pipe = component({ name: "Pipe", params: { max: 50 } }, (c, { max }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.input("in", h);
  c.output("out", h.neighbor("forward"));
  c.passes("in", "out", max, "game-mechanic");
});

const Store = component({ name: "Store" }, (c) => {
  c.input("in", c.block(B.chest()));
  c.stores("in", 1000, "game-mechanic");
});

describe("flow model", () => {
  it("finds the bottleneck and fill time", () => {
    const f = analyzeFlow(assembly("t", (a) => void a.add(Src({ rate: 200 })).to(Pipe({ max: 50 })).to(Store)).resolve());
    assert.equal(f.bottlenecks.length, 1);
    assert.equal(f.bottlenecks[0]!.utilization, 4);
    assert.equal(f.storedPerHour["minecraft:stone"], 50);
    assert.equal(f.sinks[0]!.hoursToFull, 20);
  });

  it("reports lost items", () => {
    const f = analyzeFlow(assembly("t", (a) => void a.add(Src)).resolve());
    assert.ok(f.diagnostics.some((d) => d.code === "flow-spill"));
  });

  it("flows through nested components", () => {
    const Line = component({ name: "Line" }, (c) => {
      const last = c.add(Src({ rate: 30 })).to(Pipe).to(Pipe);
      c.expose("out", last.port("out"));
    });
    const f = analyzeFlow(assembly("t", (a) => void a.add(Line).to(Store)).resolve());
    assert.equal(f.storedPerHour["minecraft:stone"], 30);
  });
});
