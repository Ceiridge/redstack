/**
 * `redstack test <module.js> [name...]` – runs in-game scenarios on a test backend.
 *
 * The module exports `scenarios: Record<string, () => Scenario>`.
 * Connection settings come from the environment (see .env.example):
 *   REDSTACK_RCON_HOST, REDSTACK_RCON_PORT, REDSTACK_RCON_PASSWORD
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FabricCarpetBackend } from "@redstack/backend-fabric";
import type { Scenario, TestReport } from "@redstack/testing";

export async function testCommand(modulePath: string, names: readonly string[], opts: { json: boolean; outDir: string }): Promise<boolean> {
  const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as { scenarios?: Record<string, () => Scenario> };
  const all = mod.scenarios;
  if (!all) throw new Error(`${modulePath} does not export "scenarios".`);
  const selected = names.length ? names : Object.keys(all);
  for (const n of selected) if (!all[n]) throw new Error(`Unknown scenario "${n}". Available: ${Object.keys(all).join(", ")}`);

  const password = process.env["REDSTACK_RCON_PASSWORD"];
  if (!password) throw new Error("REDSTACK_RCON_PASSWORD is not set.");
  const backend = new FabricCarpetBackend({
    host: process.env["REDSTACK_RCON_HOST"] ?? "127.0.0.1",
    port: Number(process.env["REDSTACK_RCON_PORT"] ?? 25575),
    password,
    log: (m) => console.error(m),
  });

  mkdirSync(opts.outDir, { recursive: true });
  let allPassed = true;
  for (const n of selected) {
    const report = await backend.run(all[n]!());
    writeFileSync(resolve(opts.outDir, `${n}.report.json`), JSON.stringify(report, null, 2));
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    allPassed &&= report.passed;
  }
  return allPassed;
}

export function formatReport(r: TestReport): string {
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const lines = [`${r.passed ? "PASS" : "FAIL"} ${r.scenario} (${r.backend}, ${r.runs.length} run(s))`];
  for (const [item, s] of Object.entries(r.summary)) {
    if (item === "*") continue;
    lines.push(`  measured ${item}: ${fmt(s.mean)}/h${r.runs.length > 1 ? ` ± ${fmt(s.stdev)}` : ""}`);
  }
  for (const e of r.expectations) lines.push(`  ${e.passed ? "ok  " : "FAIL"} ${e.expectation.type}: ${e.message}`);
  for (const run of r.runs) {
    for (const ev of run.events) lines.push(`  event run ${run.run} @${ev.at ? ev.at.join(",") : "-"}: ${ev.message}`);
    lines.push(`  run ${run.run}: ${fmt(run.ticks)} ticks in ${fmt(run.wallClockMs / 1000)} s${run.msPerTick !== undefined ? `, ${run.msPerTick.toFixed(3)} ms server time per tick` : ""}`);
  }
  return lines.join("\n");
}
