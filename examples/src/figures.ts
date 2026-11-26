/**
 * Regenerates the pictures in docs/images. Run: pnpm figures
 *
 * The SVGs (debug view) are written directly. The 3D hero image needs a
 * browser: this script writes out/figure-3d.html; scripts/figures.sh turns it
 * into docs/images/cactus-farm-3d.png with headless Chrome.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { type Assembly, runChecks } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import { defaultResourcePackPath, meshGlb, registry } from "@redstack/nucleation";
import { type RenderOptions, toHtml, toSvg, toVizModel } from "@redstack/viz";
import { cactusFarm } from "./cactus-farm.js";
import debuggerDemo from "./debugger-demo.js";
import { kelpFarm } from "./kelp-farm.js";

function model(assembly: Assembly) {
  const resolved = assembly.resolve();
  const flow = analyzeFlow(resolved);
  return { resolved, model: toVizModel(resolved, flow, [...runChecks(resolved, { registry }), ...flow.diagnostics], { registry }) };
}

function svg(file: string, assembly: Assembly, options: RenderOptions): void {
  writeFileSync(`docs/images/${file}`, toSvg(model(assembly).model, options) + "\n");
  console.log(`docs/images/${file}`);
}

mkdirSync("docs/images", { recursive: true });
svg("cactus-farm.svg", cactusFarm(6), { unit: 18, background: "#f6f8fa" });
svg("debugger-demo.svg", debuggerDemo, { unit: 18, background: "#f6f8fa" });
svg("kelp-farm.svg", kelpFarm(2), { unit: 22, background: "#f6f8fa" });

if (existsSync(defaultResourcePackPath())) {
  const { resolved, model: m } = model(cactusFarm(8));
  mkdirSync("out", { recursive: true });
  writeFileSync("out/figure-3d.html", toHtml(m, { glb: meshGlb(resolved) }));
  const kelp = model(kelpFarm(2));
  writeFileSync("out/kelp-farm-3d.html", toHtml(kelp.model, { glb: meshGlb(kelp.resolved) }));
  console.log("out/figure-3d.html, out/kelp-farm-3d.html (run scripts/figures.sh for the PNGs)");
}
