#!/usr/bin/env node
/**
 * redstack – Kommandozeile
 *
 *   redstack check <modul.js>                 statische Prüfungen
 *   redstack flow  <modul.js>                 Flussmodell
 *   redstack build <modul.js> -o <datei>      Schematic schreiben
 *   redstack all   <modul.js> -o <datei>      alles + Visualisierungsdaten (.viz.json)
 *
 * Optionen: --format litematic|schem, --data-version <n>, --json
 *
 * Das Modul exportiert per default eine Assembly oder eine Funktion, die eine liefert.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Assembly, type SchematicFormat, formatDiagnostic, hasErrors, runChecks } from "@redstack/core";
import { nativeDataVersion, nucleationWriter } from "@redstack/export-nucleation";
import { analyzeFlow, formatFlowReport } from "@redstack/flow";
import { toVizModel } from "@redstack/viz";

async function loadAssembly(path: string): Promise<Assembly> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as { default?: unknown };
  const d = mod.default;
  const a = typeof d === "function" ? (d as () => unknown)() : d;
  if (!(a instanceof Assembly)) throw new Error(`${path} exportiert keine Assembly als default.`);
  return a;
}

function usage(): never {
  console.error("Nutzung: redstack <check|flow|build|all> <modul.js> [-o datei] [--format litematic|schem] [--data-version n] [--json]");
  process.exit(2);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      format: { type: "string", default: "litematic" },
      "data-version": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [cmd, modPath] = positionals;
  if (!cmd || !modPath || !["check", "flow", "build", "all"].includes(cmd)) usage();

  const assembly = (await loadAssembly(modPath)).resolve();
  const diags = runChecks(assembly);
  const flow = analyzeFlow(assembly);
  const allDiags = [...diags, ...flow.diagnostics];

  if (cmd === "check" || cmd === "all") {
    if (values.json) console.log(JSON.stringify(allDiags, null, 2));
    else {
      console.log(`${assembly.name}: ${assembly.instances.size} Instanzen, ${assembly.blocks.size} Zellen`);
      for (const d of allDiags) console.log(formatDiagnostic(d));
      if (allDiags.length === 0) console.log("Keine Befunde.");
    }
  }
  if (cmd === "flow" || cmd === "all") {
    console.log(values.json ? JSON.stringify({ ...flow, ports: Object.fromEntries(flow.ports), bases: [...flow.bases] }, null, 2) : formatFlowReport(flow));
  }
  if (hasErrors(allDiags)) {
    console.error("Fehler gefunden – keine Datei geschrieben.");
    process.exit(1);
  }
  if (cmd === "build" || cmd === "all") {
    if (!values.out) usage();
    const format = values.format as SchematicFormat;
    const dv = values["data-version"] ? Number(values["data-version"]) : undefined;
    const res = nucleationWriter.write(assembly, {
      format,
      ...(dv !== undefined ? { targetDataVersion: dv } : {}),
      author: "redstack",
      description: `Erzeugt von redstack. Komponenten-Status: ${[...new Set([...assembly.instances.values()].map((i) => i.template.status))].join(", ")}`,
    });
    const out = resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, res.bytes);
    console.log(`Geschrieben: ${out} (${res.bytes.length} Bytes, Datenversion ${dv ?? nativeDataVersion()})`);
    for (const l of res.losses) console.warn(`Verlust bei Konvertierung: ${l}`);
    if (cmd === "all") {
      const vizPath = out.replace(/\.[^.]+$/, "") + ".viz.json";
      writeFileSync(vizPath, JSON.stringify(toVizModel(assembly, flow, allDiags), null, 2));
      console.log(`Visualisierungsdaten: ${vizPath}`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
