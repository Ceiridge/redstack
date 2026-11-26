#!/usr/bin/env node
/**
 * redstack – command line
 *
 *   redstack check   <module.js>               static checks (incl. block states and materials)
 *   redstack flow    <module.js>               flow model
 *   redstack build   <module.js> -o <file>     schematic (.litematic / .schem)
 *   redstack render  <module.js> -o <file>     picture (.svg) or viewer (.html, 3D if assets exist)
 *   redstack all     <module.js> -o <file>     all of the above
 *   redstack inspect <file.litematic> [-o x.html]   analyse an existing schematic
 *   redstack test    <scenarios.js> [name...]  in-game scenarios (see test-command.ts)
 *   redstack economy <module.js> [--prices f.json] [--fee 0.05] [--ms-per-tick n]
 *                                              in and out per hour, build cost, break-even, profit
 *   redstack optimize <plan.json>              which farms how often at which AFK spot (see optimize-command.ts)
 *
 * Options: --format litematic|schem, --data-version <n>, --json, --rotation <0-3>, --title <text>, --no-3d
 *
 * A module's default export is an Assembly, a component (type or spec), or a
 * function returning one of those.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  Assembly,
  type ComponentSpec,
  type ComponentType,
  type ResolvedAssembly,
  type SchematicFormat,
  billOfMaterials,
  bounds,
  formatDiagnostic,
  hasErrors,
  runChecks,
} from "@redstack/core";
import { analyzeFlow, formatFlowReport } from "@redstack/flow";
import { defaultResourcePackPath, formatOf, meshGlb, nativeDataVersion, nucleationWriter, registry, schematicComponent } from "@redstack/nucleation";
import { toHtml, toSvg, toVizModel } from "@redstack/viz";
import { economyCommand } from "./economy-command.js";
import { optimizeCommand } from "./optimize-command.js";
import { testCommand } from "./test-command.js";

type Exported = Assembly | ComponentType<object> | ComponentSpec<object>;

function toAssembly(x: Exported, name: string): Assembly {
  if (x instanceof Assembly) return x;
  const a = new Assembly(name);
  a.add(x as ComponentType<object>);
  return a;
}

async function loadAssembly(path: string): Promise<Assembly> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as { default?: unknown };
  let d = mod.default;
  if (typeof d === "function" && !("componentName" in d)) d = (d as () => unknown)();
  if (d instanceof Assembly || (typeof d === "function" && "componentName" in d) || (typeof d === "object" && d !== null && "type" in d)) {
    return toAssembly(d as Exported, basename(path).replace(/\.[^.]+$/, ""));
  }
  throw new Error(`${path} does not export an Assembly or a component as default.`);
}

function usage(): never {
  console.error(
    "usage: redstack <check|flow|build|render|all|inspect|test|economy|optimize> <module.js|file> [-o file] [--format litematic|schem] [--data-version n] [--rotation n] [--title text] [--no-3d] [--json] [--prices file.json] [--fee x] [--ms-per-tick n]",
  );
  process.exit(2);
}

/** Viewer HTML, with a textured 3D tab when the resource pack is available. */
function viewer(resolved: ResolvedAssembly, model: ReturnType<typeof toVizModel>, with3d: boolean): string {
  if (!with3d || !existsSync(defaultResourcePackPath())) return toHtml(model);
  return toHtml(model, { glb: meshGlb(resolved) });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      format: { type: "string", default: "litematic" },
      "data-version": { type: "string" },
      json: { type: "boolean", default: false },
      rotation: { type: "string", default: "0" },
      title: { type: "string" },
      "no-3d": { type: "boolean", default: false },
      prices: { type: "string" },
      fee: { type: "string" },
      "ms-per-tick": { type: "string" },
    },
  });
  const [cmd, target, ...rest] = positionals;
  const commands = ["check", "flow", "build", "render", "all", "inspect", "test", "economy", "optimize"];
  if (!cmd || !target || !commands.includes(cmd)) usage();
  const with3d = !values["no-3d"];

  if (cmd === "test") {
    const passed = await testCommand(target, rest, { json: values.json ?? false, outDir: values.out ?? "out/reports" });
    process.exit(passed ? 0 : 1);
  }

  if (cmd === "optimize") {
    await optimizeCommand(target, loadAssembly, values.json ?? false);
    return;
  }

  if (cmd === "inspect") {
    const name = basename(target).replace(/\.[^.]+$/, "");
    const Imported = schematicComponent({ name, bytes: new Uint8Array(readFileSync(target)), format: formatOf(target) });
    const resolved = toAssembly(Imported, name).resolve();
    const { min, max } = bounds(resolved);
    const diags = runChecks(resolved, { registry }).filter((d) => d.code !== "possible-crosstalk");
    const bom = billOfMaterials(resolved);
    if (values.json) console.log(JSON.stringify({ size: [0, 1, 2].map((k) => max[k]! - min[k]! + 1), blocks: resolved.blocks.size, bom, diagnostics: diags }, null, 2));
    else {
      console.log(`${name}: ${max[0] - min[0] + 1} × ${max[1] - min[1] + 1} × ${max[2] - min[2] + 1} (x × y × z), ${resolved.blocks.size} blocks`);
      for (const b of bom) console.log(`  ${String(b.count).padStart(5)}  ${b.id.replace("minecraft:", "")}`);
      for (const d of diags) console.log(formatDiagnostic(d));
    }
    if (values.out) {
      const out = resolve(values.out);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, viewer(resolved, toVizModel(resolved, undefined, diags, { registry }), with3d));
      console.log(`Viewer: ${out}`);
    }
    return;
  }

  const assembly = (await loadAssembly(target)).resolve();
  const diags = runChecks(assembly, { registry });
  const flow = analyzeFlow(assembly);
  const allDiags = [...diags, ...flow.diagnostics];
  const model = () => toVizModel(assembly, flow, allDiags, { registry });

  if (cmd === "check" || cmd === "all") {
    if (values.json) console.log(JSON.stringify(allDiags, null, 2));
    else {
      console.log(`${assembly.name}: ${assembly.instances.size} instances, ${assembly.blocks.size} blocks (${assembly.env.name})`);
      for (const d of allDiags) console.log(formatDiagnostic(d));
      if (allDiags.length === 0) console.log("No findings.");
    }
  }
  if (cmd === "flow" || cmd === "all") {
    console.log(values.json ? JSON.stringify({ ...flow, ports: Object.fromEntries(flow.ports), bases: [...flow.bases] }, null, 2) : formatFlowReport(flow));
  }
  if (cmd === "economy") {
    await economyCommand(assembly, flow, {
      json: values.json ?? false,
      ...(values.prices ? { prices: values.prices } : {}),
      ...(values.fee ? { fee: Number(values.fee) } : {}),
      ...(values["ms-per-tick"] ? { msPerTick: Number(values["ms-per-tick"]) } : {}),
    });
    return;
  }
  if (cmd === "render") {
    if (!values.out) usage();
    const out = resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      out.endsWith(".html")
        ? viewer(assembly, model(), with3d)
        : toSvg(model(), { rotation: Number(values.rotation), ...(values.title ? { title: values.title } : {}) }),
    );
    console.log(`Rendered: ${out}`);
    return;
  }
  if (hasErrors(allDiags)) {
    console.error("Errors found – no file written.");
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
      description: `Generated by redstack. Component status: ${[...new Set([...assembly.instances.values()].map((i) => i.template.status))].join(", ")}`,
    });
    const out = resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, res.bytes);
    console.log(`Written: ${out} (${res.bytes.length} bytes, data version ${dv ?? nativeDataVersion()})`);
    for (const l of res.losses) console.warn(`Lost in conversion: ${l}`);
    if (cmd === "all") {
      const base = out.replace(/\.[^.]+$/, "");
      writeFileSync(`${base}.viz.json`, JSON.stringify(model(), null, 2));
      writeFileSync(`${base}.html`, viewer(assembly, model(), with3d));
      console.log(`Viewer: ${base}.html`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
