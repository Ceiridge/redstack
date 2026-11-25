import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Assembly, B, defineComponent } from "@redstack/core";
import { analyzeFlow } from "./index.js";

const Src = defineComponent({
  name: "Src",
  description: "",
  status: "draft",
  defaults: { rate: 100 },
  build(c, { rate }) {
    const h = c.origin(B.hopper().outputTo("forward"));
    c.output("out", "items", h.neighbor("forward"));
    c.produces("out", "minecraft:stone", rate, "game-mechanic");
  },
});

const Pipe = defineComponent({
  name: "Pipe",
  description: "",
  status: "draft",
  defaults: { max: 50 },
  build(c, { max }) {
    const h = c.origin(B.hopper().outputTo("forward"));
    c.input("in", "items", h);
    c.output("out", "items", h.neighbor("forward"));
    c.passes("in", "out", max, "game-mechanic");
  },
});

const Store = defineComponent({
  name: "Store",
  description: "",
  status: "draft",
  defaults: {},
  build(c) {
    const s = c.origin(B.chest());
    c.input("in", "items", s);
    c.stores("in", 1000, "game-mechanic");
  },
});

describe("flow model", () => {
  it("finds the bottleneck and fill time", () => {
    const a = new Assembly("t");
    const src = a.add(Src, { rate: 200 });
    const pipe = a.add(Pipe, { max: 50 }).attach("in", src.port("out"));
    a.add(Store).attach("in", pipe.port("out"));
    const f = analyzeFlow(a.resolve());
    assert.equal(f.bottlenecks.length, 1);
    assert.equal(f.bottlenecks[0]!.utilization, 4);
    assert.equal(f.storedPerHour["minecraft:stone"], 50);
    assert.equal(f.sinks[0]!.hoursToFull, 20);
  });

  it("reports lost items", () => {
    const a = new Assembly("t");
    a.add(Src);
    const f = analyzeFlow(a.resolve());
    assert.ok(f.diagnostics.some((d) => d.code === "flow-spill"));
  });
});
