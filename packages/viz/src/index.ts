/**
 * Visualisation: data model, isometric SVG renderer (debug view) and a
 * standalone interactive HTML viewer with an optional textured 3D view.
 *
 * The model combines blocks, instances, port flows, bottlenecks and findings
 * with locations, so design, flow model and measurements can be shown in one
 * picture. Block colours and shapes come from a BlockRegistry, not from a
 * hard-coded list.
 */

import { readFileSync } from "node:fs";
import { type BlockInfo, type BlockRegistry, type Diagnostic, type ResolvedAssembly, type Vec3, formatBlock } from "@redstack/core";
import type { FlowAnalysis } from "@redstack/flow";
import { type BlockStyle, type RenderOptions, type Shape, renderSvg } from "./render.js";

export { type BlockStyle, type RenderOptions, type Shape, renderSvg } from "./render.js";

export interface VizModel {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly blocks: ReadonlyArray<{ pos: Vec3; block: string; instance: string; style?: BlockStyle }>;
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

/** Block kinds drawn as something other than a cube. */
const SHAPE_BY_KIND: Readonly<Record<string, Shape>> = {
  "minecraft:fence": "post",
  "minecraft:wall": "post",
  "minecraft:iron_bars": "post",
  "minecraft:end_rod": "post",
  "minecraft:slab": "slab",
  "minecraft:carpet": "flat",
  "minecraft:wool_carpet": "flat",
  "minecraft:redstone_wire": "flat",
  "minecraft:rail": "flat",
  "minecraft:powered_rail": "flat",
  "minecraft:detector_rail": "flat",
  "minecraft:pressure_plate": "flat",
  "minecraft:weighted_pressure_plate": "flat",
  "minecraft:cactus": "inset",
  "minecraft:chest": "inset",
  "minecraft:ender_chest": "inset",
  "minecraft:trapped_chest": "inset",
};

/** How to draw a block, from its registry facts. */
export function blockStyle(info: BlockInfo): BlockStyle {
  const [r, g, b] = info.color;
  const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  const liquid = info.kind === "minecraft:liquid";
  const seeThrough = info.tags.includes("minecraft:impermeable") || info.kind.includes("leaves");
  const shape: Shape = SHAPE_BY_KIND[info.kind] ?? (info.fullCube ? "cube" : "inset");
  return {
    // Water and lava textures are tinted in game; their average texture colour is grey
    color: liquid && info.id === "minecraft:water" ? "#3f76e4" : hex,
    shape,
    ...(liquid ? { opacity: 0.6 } : seeThrough ? { opacity: 0.45 } : {}),
    solid: shape === "cube" && !liquid && !seeThrough,
  };
}

export interface VizOptions {
  /** Colours and shapes from block facts; without it blocks get stable fallback colours */
  readonly registry?: BlockRegistry;
}

export function toVizModel(a: ResolvedAssembly, flow?: FlowAnalysis, diagnostics: readonly Diagnostic[] = [], options: VizOptions = {}): VizModel {
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

  const styles = new Map<string, BlockStyle | undefined>();
  const styleFor = (id: string) => {
    if (!options.registry) return undefined;
    if (!styles.has(id)) {
      const info = options.registry.info(id);
      styles.set(id, info ? blockStyle(info) : undefined);
    }
    return styles.get(id);
  };

  return {
    schemaVersion: 1,
    name: a.name,
    blocks: [...a.blocks.values()].map((b) => {
      const style = styleFor(b.block.id);
      return { pos: b.pos, block: formatBlock(b.block), instance: b.instanceId, ...(style ? { style } : {}) };
    }),
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

export interface HtmlOptions {
  /** Textured 3D model (from @redstack/nucleation's meshGlb); adds a 3D tab */
  readonly glb?: Uint8Array;
}

/** three.js, pinned; loaded from jsDelivr only when a 3D model is embedded. */
const THREE_VERSION = "0.170.0";

/**
 * Standalone interactive viewer. Debug tab: isometric picture with flows and
 * findings, rotate, cut away layers. 3D tab (with a GLB): textured model with
 * orbit controls and the findings as coloured boxes.
 */
export function toHtml(model: VizModel, options: HtmlOptions = {}): string {
  const renderer = readFileSync(new URL("./render.js", import.meta.url), "utf8").replace(/^\/\/# sourceMappingURL=.*$/m, "");
  const data = JSON.stringify(model).replace(/</g, "\\u003c");
  const ys = model.blocks.map((b) => b.pos[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const has3d = options.glb !== undefined;
  const glb = has3d ? Buffer.from(options.glb!).toString("base64") : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.name)} – redstack viewer</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f8fa; --panel:#fff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --accent:#0969da; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --panel:#151b23; --fg:#e6edf3; --muted:#9198a1; --line:#3d444d; --accent:#4493f8; } }
  :root[data-theme=light] { color-scheme: light; --bg:#f6f8fa; --panel:#fff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --accent:#0969da; }
  :root[data-theme=dark] { color-scheme: dark; --bg:#0d1117; --panel:#151b23; --fg:#e6edf3; --muted:#9198a1; --line:#3d444d; --accent:#4493f8; }
  * { box-sizing: border-box; min-width: 0; }
  body { margin:0; font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:14px 16px 4px; }
  h1 { margin:0; font-size:18px; }
  .sub { color:var(--muted); font-size:13px; }
  .bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:10px 16px; position:sticky; top:0; background:var(--bg); z-index:2; border-bottom:1px solid var(--line); }
  button, label.t { font:inherit; font-size:14px; min-height:36px; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; padding:6px 10px; cursor:pointer; user-select:none; }
  button[aria-pressed=true] { border-color:var(--accent); color:var(--accent); }
  label.t input { margin:0 6px 0 0; vertical-align:-1px; }
  .layer { display:flex; align-items:center; gap:6px; font-size:14px; color:var(--muted); }
  .layer input { width:120px; }
  .sep { width:1px; align-self:stretch; background:var(--line); }
  main { display:grid; grid-template-columns: minmax(0,1fr) 300px; gap:16px; padding:16px; }
  @media (max-width: 820px) { main { grid-template-columns: minmax(0,1fr); } }
  .pane { background:var(--panel); border:1px solid var(--line); border-radius:12px; min-height:320px; }
  #view { overflow:auto; display:flex; align-items:center; justify-content:center; padding:8px; }
  #view svg { width:100%; height:auto; max-height:78vh; }
  #view.zoom { justify-content:flex-start; align-items:flex-start; }
  #view.zoom svg { width:260%; max-height:none; }
  #three { position:relative; height:min(72vh,620px); overflow:hidden; }
  #three canvas { display:block; width:100%; height:100%; border-radius:12px; }
  #three .hint { position:absolute; left:12px; bottom:10px; font-size:12px; color:#fff; text-shadow:0 1px 2px #0008; pointer-events:none; }
  [hidden] { display:none !important; }
  /* #figure: only the 3D model, e.g. for screenshots */
  body.figure header, body.figure .bar, body.figure aside, body.figure .hint { display:none; }
  body.figure main { display:block; padding:0; }
  body.figure #three { height:100vh; border:0; border-radius:0; }
  body.figure #three canvas { border-radius:0; }
  aside section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:12px; }
  aside h2 { font-size:13px; color:var(--muted); margin:0 0 8px; font-weight:600; }
  ul { margin:0; padding-left:18px; } li { margin:3px 0; }
  .sev-error { color:#e5484d; } .sev-warning { color:#d18d00; } .sev-info { color:var(--accent); }
  .pill { display:inline-block; font-size:11px; padding:1px 7px; border-radius:99px; border:1px solid var(--line); color:var(--muted); margin-left:4px; }
  .ok { color:#2da44e; }
</style>
${has3d ? `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"}}</script>` : ""}
</head>
<body>
<header><h1>${esc(model.name)}</h1><div class="sub">redstack viewer · ${has3d ? "drag to orbit, pinch or scroll to zoom · " : ""}hover or tap blocks for details</div></header>
<div class="bar">
  ${has3d ? `<button id="tab3d" aria-pressed="true">3D</button><button id="tabdebug" aria-pressed="false">Debug</button><span class="sep"></span>` : ""}
  <span id="debugtools" style="display:contents">
    <button id="rl" title="Rotate left">⟲</button><button id="rr" title="Rotate right">⟳</button>
    <span class="layer">Layers ≤ <b id="yl"></b><input id="y" type="range" min="${minY}" max="${maxY}" value="${maxY}"></span>
    <label class="t"><input type="checkbox" id="flows" checked>Flows</label>
    <button id="zoom">Zoom</button>
  </span>
  <label class="t"><input type="checkbox" id="hl" checked>Findings</label>
</div>
<main>
  <div>
    ${has3d ? `<div id="three" class="pane"><span class="hint">Textures: Minecraft resource pack</span></div>` : ""}
    <div id="view" class="pane"${has3d ? " hidden" : ""}></div>
  </div>
  <aside>
    <section><h2>Model</h2><ul id="summary"></ul></section>
    <section><h2>Findings</h2><ul id="findings"></ul></section>
    <section><h2>Components</h2><ul id="comps"></ul></section>
  </aside>
</main>
<script type="module">
${renderer}
const model = ${data};
window.redstackModel = model;
if (location.hash === "#figure") document.body.classList.add("figure");
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
for (const id of ["y", "flows", "hl"]) $(id).addEventListener("input", draw);
draw();
${has3d ? `const show = (three) => {
  $("three").hidden = !three; $("view").hidden = three;
  $("debugtools").style.display = three ? "none" : "contents";
  $("tab3d").setAttribute("aria-pressed", String(three)); $("tabdebug").setAttribute("aria-pressed", String(!three));
};
$("tab3d").onclick = () => show(true);
$("tabdebug").onclick = () => show(false);
show(true);` : ""}
</script>
${has3d ? `<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
{
  const model = window.redstackModel;
  const box = document.getElementById("three");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(matchMedia("(prefers-color-scheme: dark)").matches ? 0x1b222c : 0xdfe7ef);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  box.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(4, 10, 6); scene.add(sun);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const resize = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera); };
  new ResizeObserver(resize).observe(box);
  const bytes = Uint8Array.from(atob("${glb}"), (c) => c.charCodeAt(0));
  const marks = new THREE.Group(); scene.add(marks);
  new GLTFLoader().parse(bytes.buffer, "", (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) { if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.NearestFilter; m.map.generateMipmaps = false; m.map.needsUpdate = true; } m.alphaTest = Math.max(m.alphaTest ?? 0, 0.1); }
    });
    scene.add(gltf.scene);
    // Align block coordinates with the mesh (same scale, possibly shifted)
    const mesh = new THREE.Box3().setFromObject(gltf.scene);
    const lo = [Infinity, Infinity, Infinity];
    for (const b of model.blocks) for (let k = 0; k < 3; k++) lo[k] = Math.min(lo[k], b.pos[k]);
    const off = new THREE.Vector3(mesh.min.x - lo[0], mesh.min.y - lo[1], mesh.min.z - lo[2]);
    const colors = { error: 0xe5484d, warning: 0xf5a524, info: 0x3e9bf2 };
    for (const h of model.highlights) {
      const geo = new THREE.BoxGeometry(1.04, 1.04, 1.04);
      const cube = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[h.severity], transparent: true, opacity: 0.3, depthTest: false }));
      cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: colors[h.severity], depthTest: false })));
      cube.position.set(h.at[0] + 0.5 + off.x, h.at[1] + 0.5 + off.y, h.at[2] + 0.5 + off.z);
      cube.renderOrder = 10;
      marks.add(cube);
    }
    // Frame the model: start from its bounding sphere, then scale the distance
    // until the projected corners fill about 85 % of the view
    const sphere = mesh.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0.9, 0.75, 0.55).normalize();
    const corners = [];
    for (const x of [mesh.min.x, mesh.max.x]) for (const y of [mesh.min.y, mesh.max.y]) for (const z of [mesh.min.z, mesh.max.z]) corners.push(new THREE.Vector3(x, y, z));
    resize();
    let dist = sphere.radius * 3;
    for (let i = 0; i < 4; i++) {
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      const extent = Math.max(...corners.map((c) => { const p = c.clone().project(camera); return Math.max(Math.abs(p.x), Math.abs(p.y)); }));
      dist *= extent / 0.85;
    }
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    controls.target.copy(sphere.center);
    controls.update();
    resize();
  }, (e) => { box.querySelector(".hint").textContent = "3D model failed to load: " + e; });
  document.getElementById("hl").addEventListener("input", (e) => { marks.visible = e.target.checked; renderer.render(scene, camera); });
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}
</script>` : ""}
</body>
</html>
`;
}
