import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Assembly, B, defineComponent, runChecks } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import { toHtml, toSvg, toVizModel } from "./index.js";

const Source = defineComponent({
  name: "Source",
  description: "",
  status: "draft",
  defaults: { rate: 20_000 },
  build(c, { rate }) {
    const h = c.origin(B.hopper().outputTo("forward"));
    c.output("out", "items", h.neighbor("forward"));
    c.produces("out", "minecraft:stone", rate, "estimate");
  },
});

const Pipe = defineComponent({
  name: "Pipe",
  description: "",
  status: "draft",
  defaults: {},
  build(c) {
    const h = c.origin(B.hopper().outputTo("forward"));
    c.input("in", "items", h);
    c.output("out", "items", h.neighbor("forward"));
    c.passes("in", "out", 9_000, "game-mechanic");
  },
});

const Store = defineComponent({
  name: "Store",
  description: "",
  status: "draft",
  defaults: {},
  build(c) {
    c.input("in", "items", c.origin(B.chest()));
    c.stores("in", 1728, "game-mechanic");
  },
});

function model() {
  const a = new Assembly("viz-test");
  const src = a.add(Source);
  const pipe = a.add(Pipe).attach("in", src.port("out"));
  a.add(Store).attach("in", pipe.port("out"));
  const r = a.resolve();
  const flow = analyzeFlow(r);
  return toVizModel(r, flow, [...runChecks(r), ...flow.diagnostics]);
}

describe("viz model", () => {
  it("marks the throttled output of a bottleneck, not its inputs", () => {
    const m = model();
    const into = m.edges.find((e) => e.to === "Pipe#1.in")!;
    const out = m.edges.find((e) => e.from === "Pipe#1.out")!;
    assert.equal(into.utilization, undefined);
    assert.ok((out.utilization ?? 0) > 2);
    assert.equal(out.perHour, 9_000);
    assert.ok(m.highlights.some((h) => h.severity === "warning" && /Bottleneck in Pipe#1/.test(h.message)));
  });

  it("summarizes yield and fill time", () => {
    assert.ok(model().summary.some((s) => s.startsWith("stone: 9000.0/h")));
  });
});

describe("svg renderer", () => {
  it("draws blocks, a hot flow label and finding outlines", () => {
    const svg = toSvg(model());
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /<title>Pipe#1\nminecraft:hopper\[enabled=true,facing=north\]/);
    assert.match(svg, /fill="#e5484d"[^>]*\/><text[^>]*>9,000\/h</);
    assert.match(svg, /<title>warning: Bottleneck/);
  });

  it("rotation changes the picture, four turns do not", () => {
    const m = model();
    assert.notEqual(toSvg(m, { rotation: 1 }), toSvg(m, { rotation: 0 }));
    assert.equal(toSvg(m, { rotation: 4 }), toSvg(m, { rotation: 0 }));
  });

  it("maxY cuts away blocks above", () => {
    const a = new Assembly("tower");
    const Tower = defineComponent({
      name: "Tower",
      description: "",
      status: "draft",
      defaults: {},
      build(c) {
        c.place(B.glass()).above(c.origin(B.stone()));
      },
    });
    a.add(Tower);
    const m = toVizModel(a.resolve());
    assert.match(toSvg(m), /minecraft:glass/);
    assert.doesNotMatch(toSvg(m, { maxY: 0 }), /minecraft:glass/);
  });
});

describe("html viewer", () => {
  it("is standalone: inlines the renderer and the model, escapes closing tags", () => {
    const html = toHtml({ ...model(), name: "a </script> b" });
    assert.match(html, /export function renderSvg/);
    assert.match(html, /const model = \{/);
    assert.doesNotMatch(html, /sourceMappingURL/);
    assert.equal(html.match(/<\/script>/g)?.length, 1);
  });

  it("contains a syntactically valid module script", () => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(toHtml(model()))![1]!;
    const file = join(mkdtempSync(join(tmpdir(), "redstack-viz-")), "viewer.mjs");
    writeFileSync(file, script);
    execFileSync(process.execPath, ["--check", file]); // throws on a syntax error
  });
});
