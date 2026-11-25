/**
 * Visualisation: data model, isometric SVG renderer and a standalone
 * interactive HTML viewer.
 *
 * The model combines blocks, instances, port flows, bottlenecks and findings
 * with locations, so design, flow model and (later) measurements can be
 * shown in one picture.
 */

import { readFileSync } from "node:fs";
import { type Diagnostic, type ResolvedAssembly, type Vec3, formatBlock } from "@redstack/core";
import type { FlowAnalysis } from "@redstack/flow";
import { type RenderOptions, renderSvg } from "./render.js";

export { type RenderOptions, renderSvg } from "./render.js";

export interface VizModel {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly blocks: ReadonlyArray<{ pos: Vec3; block: string; instance: string }>;
  readonly instances: ReadonlyArray<{ id: string; type: string; status: string; origin: Vec3; rotation: number }>;
  readonly edges: ReadonlyArray<{
    from: string;
    to: string;
    perHour: number;
    /** Utilisation of the source if it is a bottleneck (> 1 = items back up before it) */
    utilization?: number;
    cells: readonly Vec3[];
  }>;
  readonly highlights: ReadonlyArray<{ at: Vec3; severity: Diagnostic["severity"]; message: string }>;
  /** Short summary lines, e.g. yield and storage fill time */
  readonly summary: readonly string[];
}

export function toVizModel(a: ResolvedAssembly, flow?: FlowAnalysis, diagnostics: readonly Diagnostic[] = []): VizModel {
  // Utilisation belongs to the throttled output of a bottlenecked component
  const util = new Map<string, number>();
  for (const b of flow?.bottlenecks ?? []) util.set(`${b.instanceId}.${b.to}`, b.utilization);

  const highlights: Array<VizModel["highlights"][number]> = diagnostics
    .filter((d): d is Diagnostic & { at: Vec3 } => d.at !== undefined)
    .map((d) => ({ at: d.at, severity: d.severity, message: d.message }));
  for (const b of flow?.bottlenecks ?? []) {
    // Mark the last accepting cell: that is where the backlog shows up first in a belt
    const cells = a.instances.get(b.instanceId)?.ports.get(b.from)?.absCells ?? [];
    const at = cells[cells.length - 1];
    if (at) {
      highlights.push({
        at,
        severity: "warning",
        message: `Bottleneck in ${b.instanceId}: ${Math.round(b.inflowPerHour)}/h arrive, ${Math.round(b.capacityPerHour)}/h pass (${Math.round(b.utilization * 100)}%)`,
      });
    }
  }

  const summary: string[] = [];
  for (const [item, r] of Object.entries(flow?.storedPerHour ?? {})) summary.push(`${item.replace("minecraft:", "")}: ${r.toFixed(1)}/h into storage`);
  for (const s of flow?.sinks ?? []) {
    summary.push(`${s.instanceId} full after ${Number.isFinite(s.hoursToFull) ? `${s.hoursToFull.toFixed(1)} h` : "never"}`);
  }

  return {
    schemaVersion: 1,
    name: a.name,
    blocks: [...a.blocks.values()]
      .filter((b) => b.block.id !== "minecraft:air")
      .map((b) => ({ pos: b.pos, block: formatBlock(b.block), instance: b.instanceId })),
    instances: [...a.instances.values()].map((i) => ({
      id: i.id,
      type: i.template.typeName,
      status: i.template.status,
      origin: i.origin,
      rotation: i.rotation,
    })),
    edges: a.connections.map((c) => {
      const fromK = `${c.from.instanceId}.${c.from.port}`;
      const toK = `${c.to.instanceId}.${c.to.port}`;
      const u = util.get(fromK);
      return {
        from: fromK,
        to: toK,
        perHour: flow?.ports.get(fromK)?.totalPerHour ?? 0,
        ...(u !== undefined ? { utilization: u } : {}),
        cells: a.instances.get(c.from.instanceId)?.ports.get(c.from.port)?.absCells ?? [],
      };
    }),
    highlights,
    summary,
  };
}

/** Standalone SVG, e.g. for documentation. */
export function toSvg(model: VizModel, options: RenderOptions = {}): string {
  return renderSvg(model, options);
}

/** Standalone interactive viewer: rotate, cut away layers, toggle overlays, list findings. */
export function toHtml(model: VizModel): string {
  const renderer = readFileSync(new URL("./render.js", import.meta.url), "utf8").replace(/^\/\/# sourceMappingURL=.*$/m, "");
  const data = JSON.stringify(model).replace(/</g, "\\u003c");
  const ys = model.blocks.map((b) => b.pos[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.name)} – redstack viewer</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f8fa; --panel:#fff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --accent:#0969da; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --panel:#151b23; --fg:#e6edf3; --muted:#9198a1; --line:#3d444d; --accent:#4493f8; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:14px 16px 4px; }
  h1 { margin:0; font-size:18px; }
  .sub { color:var(--muted); font-size:13px; }
  .bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:10px 16px; position:sticky; top:0; background:var(--bg); z-index:1; border-bottom:1px solid var(--line); }
  button, label.t { font:inherit; font-size:14px; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; padding:6px 10px; cursor:pointer; user-select:none; }
  label.t input { margin:0 6px 0 0; vertical-align:-1px; }
  .layer { display:flex; align-items:center; gap:6px; font-size:14px; color:var(--muted); }
  .layer input { width:120px; }
  main { display:grid; grid-template-columns: 1fr 300px; gap:16px; padding:16px; }
  @media (max-width: 820px) { main { grid-template-columns: 1fr; } }
  #view { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:auto; min-height:300px; display:flex; align-items:center; justify-content:center; padding:8px; }
  #view svg { width:100%; height:auto; max-height:78vh; }
  #view.zoom { justify-content:flex-start; align-items:flex-start; }
  #view.zoom svg { width:260%; max-height:none; }
  aside section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:12px; }
  aside h2 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px; }
  ul { margin:0; padding-left:18px; } li { margin:3px 0; }
  .sev-error { color:#e5484d; } .sev-warning { color:#d18d00; } .sev-info { color:var(--accent); }
  .pill { display:inline-block; font-size:11px; padding:1px 7px; border-radius:99px; border:1px solid var(--line); color:var(--muted); margin-left:4px; }
  .ok { color:#2da44e; }
</style>
</head>
<body>
<header><h1>${esc(model.name)}</h1><div class="sub">redstack viewer · hover or tap blocks for details</div></header>
<div class="bar">
  <button id="rl" title="Rotate left">⟲</button><button id="rr" title="Rotate right">⟳</button>
  <span class="layer">Layers ≤ <b id="yl"></b><input id="y" type="range" min="${minY}" max="${maxY}" value="${maxY}"></span>
  <label class="t"><input type="checkbox" id="flows" checked>Flows</label>
  <label class="t"><input type="checkbox" id="hl" checked>Findings</label>
  <button id="zoom">Zoom</button>
</div>
<main>
  <div id="view"></div>
  <aside>
    <section><h2>Model</h2><ul id="summary"></ul></section>
    <section><h2>Findings</h2><ul id="findings"></ul></section>
    <section><h2>Components</h2><ul id="comps"></ul></section>
  </aside>
</main>
<script type="module">
${renderer}
const model = ${data};
let rotation = 0;
const $ = (id) => document.getElementById(id);
const li = (html) => { const e = document.createElement("li"); e.innerHTML = html; return e; };
const text = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function draw() {
  $("yl").textContent = $("y").value;
  $("view").innerHTML = renderSvg(model, { rotation, maxY: Number($("y").value), flows: $("flows").checked, highlights: $("hl").checked, unit: 16 });
}
for (const s of model.summary) $("summary").append(li(text(s)));
if (!model.summary.length) $("summary").append(li("No flow data"));
if (!model.highlights.length) $("findings").append(li('<span class="ok">No findings</span>'));
for (const h of model.highlights) $("findings").append(li('<span class="sev-' + h.severity + '">' + h.severity + "</span> " + text(h.message) + ' <span class="pill">' + h.at.join(",") + "</span>"));
const types = new Map();
for (const i of model.instances) { const t = types.get(i.type) ?? { n: 0, status: i.status }; t.n++; types.set(i.type, t); }
for (const [t, v] of types) $("comps").append(li(text(t) + " × " + v.n + ' <span class="pill">' + text(v.status) + "</span>"));
$("rl").onclick = () => { rotation = (rotation + 3) % 4; draw(); };
$("rr").onclick = () => { rotation = (rotation + 1) % 4; draw(); };
$("zoom").onclick = () => { $("view").classList.toggle("zoom"); };
for (const id of ["y", "flows", "hl"]) $(id).oninput = draw;
draw();
</script>
</body>
</html>
`;
}
