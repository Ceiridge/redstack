/**
 * Regenerates the pictures in docs/images. Run: pnpm figures
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { type Assembly, runChecks } from "@redstack/core";
import { analyzeFlow } from "@redstack/flow";
import { type RenderOptions, toSvg, toVizModel } from "@redstack/viz";
import { cactusFarm } from "./cactus-farm.js";
import { debuggerDemo } from "./debugger-demo.js";

function figure(file: string, assembly: Assembly, options: RenderOptions): void {
  const resolved = assembly.resolve();
  const flow = analyzeFlow(resolved);
  const model = toVizModel(resolved, flow, [...runChecks(resolved), ...flow.diagnostics]);
  writeFileSync(`docs/images/${file}`, toSvg(model, options) + "\n");
  console.log(`docs/images/${file}`);
}

mkdirSync("docs/images", { recursive: true });
figure("cactus-farm.svg", cactusFarm(6), { unit: 18, background: "#f6f8fa" });
figure("debugger-demo.svg", debuggerDemo(), { unit: 18, background: "#f6f8fa" });
