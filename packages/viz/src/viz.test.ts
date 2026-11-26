import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { B, assembly, component, runChecks } from "@redstack/core";
import { registry } from "@redstack/nucleation";
import { analyzeFlow } from "@redstack/flow";
import { blockStyle, toHtml, toSvg, toVizModel } from "./index.js";

const Source = component({ name: "Source", params: { rate: 20_000 } }, (c, { rate }) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.output("out", h.neighbor("forward"), { item: "minecraft:stone", rate: { perHour: rate, basis: "estimate" } });
});

const Pipe = component({ name: "Pipe" }, (c) => {
  const h = c.block(B.hopper().outputTo("forward"));
  c.input("in", h);
  c.output("out", h.neighbor("forward"));
  c.passes("in", "out", 9_000, "game-mechanic");
});

const Store = component({ name: "Store" }, (c) => {
  c.input("in", c.block(B.chest()));
  c.stores("in", 1728, "game-mechanic");
});

function model() {
  const r = assembly("viz-test", (a) => void a.add(Source).to(Pipe).to(Store)).resolve();
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
    const Tower = component({ name: "Tower" }, (c) => void c.block(B.glass()).above(c.block(B.stone())));
    const m = toVizModel(assembly("tower", (a) => void a.add(Tower)).resolve());
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
    assert.doesNotMatch(html, /a <\/script> b/);
  });

  it("contains syntactically valid module scripts, with and without 3D", () => {
    const fakeGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    for (const html of [toHtml(model()), toHtml(model(), { glb: fakeGlb })]) {
      for (const [, script] of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) {
        const file = join(mkdtempSync(join(tmpdir(), "redstack-viz-")), "viewer.mjs");
        writeFileSync(file, script!);
        execFileSync(process.execPath, ["--check", file]); // throws on a syntax error
      }
    }
  });

  it("loads three.js only when a 3D model is embedded", () => {
    assert.doesNotMatch(toHtml(model()), /importmap/);
    assert.match(toHtml(model(), { glb: new Uint8Array([1]) }), /importmap[\s\S]*three@0\.170\.0/);
  });
});

describe("block styles from the registry", () => {
  it("derives colour, shape and transparency from block facts", () => {
    assert.equal(blockStyle(registry.info("minecraft:oak_fence")!).shape, "post");
    assert.equal(blockStyle(registry.info("minecraft:stone_slab")!).shape, "slab");
    assert.equal(blockStyle(registry.info("minecraft:glass")!).opacity, 0.45);
    assert.equal(blockStyle(registry.info("minecraft:stone")!).solid, true);
    assert.match(blockStyle(registry.info("minecraft:cactus")!).color, /^#[0-9a-f]{6}$/);
  });

  it("the model carries styles when a registry is given", () => {
    const r = assembly("t", (a) => void a.add(Store)).resolve();
    assert.equal(toVizModel(r).blocks[0]!.style, undefined);
    assert.equal(toVizModel(r, undefined, [], { registry }).blocks[0]!.style!.shape, "inset");
  });
});
