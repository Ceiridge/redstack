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
import { McTickBackend } from "@redstack/backend-mctick";
import { type Scenario, type TestBackend, type TestReport, missingCapabilities } from "@redstack/testing";

export async function testCommand(
  modulePath: string,
  names: readonly string[],
  opts: { json: boolean; outDir: string; backend?: string },
): Promise<boolean> {
  const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as { scenarios?: Record<string, () => Scenario> };
  const all = mod.scenarios;
  if (!all) throw new Error(`${modulePath} does not export "scenarios".`);
  const selected = names.length ? names : Object.keys(all);
  for (const n of selected) if (!all[n]) throw new Error(`Unknown scenario "${n}". Available: ${Object.keys(all).join(", ")}`);

  const backend = makeBackend(opts.backend ?? "fabric");

  mkdirSync(opts.outDir, { recursive: true });
  let allPassed = true;
  for (const n of selected) {
    const scenario = all[n]!();
    const lacking = missingCapabilities(backend, scenario);
    const why = [...(lacking.length ? [`needs ${lacking.join(", ")}`] : []), ...backend.unsupported(scenario)];
    if (why.length) {
      console.log(`SKIP ${n} (${backend.id}): ${why.join("; ")}`);
      continue;
    }
    const report = await backend.run(scenario);
    const suffix = backend.id === "fabric-carpet" ? "" : `.${backend.id}`;
    writeFileSync(resolve(opts.outDir, `${n}${suffix}.report.json`), JSON.stringify(report, null, 2));
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    allPassed &&= report.passed;
  }
  return allPassed;
}

function makeBackend(id: string): TestBackend {
  const log = (m: string) => console.error(m);
  if (id === "mc-tick") return new McTickBackend({ log });
  if (id !== "fabric") throw new Error(`Unknown backend "${id}" (fabric, mc-tick).`);
  const password = process.env["REDSTACK_RCON_PASSWORD"];
  if (!password) throw new Error("REDSTACK_RCON_PASSWORD is not set.");
  return new FabricCarpetBackend({
    host: process.env["REDSTACK_RCON_HOST"] ?? "127.0.0.1",
    port: Number(process.env["REDSTACK_RCON_PORT"] ?? 25575),
    password,
    log,
  });
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
