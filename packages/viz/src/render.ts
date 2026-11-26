/**
 * Isometric SVG renderer for VizModel.
 *
 * Has no runtime imports, so the compiled file can also be inlined into a
 * browser page (see toHtml). Flat colours only – no game textures.
 */

import type { VizModel } from "./index.js";

export interface RenderOptions {
  /** View rotation in clockwise quarter turns (0–3) */
  readonly rotation?: number;
  /** Hide blocks above this y (cut-away view) */
  readonly maxY?: number;
  /** Show item rates on connections */
  readonly flows?: boolean;
  /** Show findings (errors, warnings, bottlenecks) */
  readonly highlights?: boolean;
  /** Pixels per block edge */
  readonly unit?: number;
  /** Optional title drawn in the top-left corner */
  readonly title?: string;
  readonly background?: string;
}

type V3 = readonly [number, number, number];

/** How a block is drawn. Decided by toVizModel from block facts (see blockStyle). */
export type Shape = "cube" | "post" | "inset" | "slab" | "flat";

export interface BlockStyle {
  readonly color: string;
  readonly shape: Shape;
  readonly opacity?: number;
  /** Full opaque cube: hides the faces of neighbours */
  readonly solid: boolean;
}

function hashColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 35% 55%)`;
}

const fallbackStyle = (block: string): BlockStyle => ({ color: hashColor(block.split("[")[0]!), shape: "cube", solid: true });

function propOf(block: string, name: string): string | undefined {
  const m = new RegExp(`[\\[,]${name}=([a-z_0-9]+)`).exec(block);
  return m?.[1];
}

/** Shade a hex/hsl colour by mixing with black (factor < 1) or white (> 1). */
function shade(color: string, f: number): string {
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1))));
    const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }
  const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(color);
  if (!m) return color;
  const l = Math.max(0, Math.min(100, Number(m[3]) * f));
  return `hsl(${m[1]} ${m[2]}% ${l.toFixed(0)}%)`;
}

const DIR: Readonly<Record<string, V3>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

function rotXZ(x: number, z: number, r: number): [number, number] {
  // clockwise quarter turns seen from above: (x, z) -> (-z, x)
  for (let i = 0; i < r; i++) [x, z] = [-z, x];
  return [x, z];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1));

export function renderSvg(model: VizModel, options: RenderOptions = {}): string {
  const r = (((options.rotation ?? 0) % 4) + 4) % 4;
  const a = options.unit ?? 14;
  const showFlows = options.flows ?? true;
  const showHighlights = options.highlights ?? true;
  const maxY = options.maxY ?? Infinity;

  // World → view coordinates (rotation about the centre of each block)
  const view = (p: V3): V3 => {
    const [x, z] = rotXZ(p[0] + 0.5, p[2] + 0.5, r);
    return [x - 0.5, p[1], z - 0.5];
  };
  const viewDir = (d: V3): V3 => {
    const [x, z] = rotXZ(d[0], d[2], r);
    return [x, d[1], z];
  };
  const P = (x: number, y: number, z: number): [number, number] => [(x - z) * a, ((x + z) * a) / 2 - y * a];

  const blocks = model.blocks
    .filter((b) => b.pos[1] <= maxY)
    .map((b) => ({ ...b, v: view(b.pos), style: b.style ?? fallbackStyle(b.block) }));
  const solid = new Set(blocks.filter((b) => b.style.solid).map((b) => b.v.join(",")));
  blocks.sort((p, q) => p.v[0] + p.v[1] + p.v[2] - (q.v[0] + q.v[1] + q.v[2]) || p.v[1] - q.v[1]);

  const out: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxYs = -Infinity;
  const track = (pts: ReadonlyArray<[number, number]>) => {
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxYs = Math.max(maxYs, y);
    }
  };
  const poly = (pts: Array<[number, number]>, fill: string, extra = "") => {
    track(pts);
    return `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="${fill}"${extra}/>`;
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, hidden: { top: boolean; px: boolean; pz: boolean }, opacity?: number) => {
    const o = opacity !== undefined ? ` fill-opacity="${opacity}"` : "";
    const edge = ` stroke="${shade(color, 0.55)}" stroke-width="0.6" stroke-linejoin="round"`;
    const parts: string[] = [];
    if (!hidden.pz) parts.push(poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], shade(color, 0.78), o + edge));
    if (!hidden.px) parts.push(poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], shade(color, 0.62), o + edge));
    if (!hidden.top) parts.push(poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], shade(color, 1.12), o + edge));
    return parts.join("");
  };

  for (const b of blocks) {
    const [x, y, z] = b.v;
    const s = b.style;
    const hidden = {
      top: solid.has(`${x},${y + 1},${z}`),
      px: solid.has(`${x + 1},${y},${z}`),
      pz: solid.has(`${x},${y},${z + 1}`),
    };
    let g = "";
    if (s.shape === "post") g = box(x + 0.375, y, z + 0.375, x + 0.625, y + 1, z + 0.625, s.color, { top: false, px: false, pz: false });
    else if (s.shape === "inset") g = box(x + 0.0625, y, z + 0.0625, x + 0.9375, y + 0.875, z + 0.9375, s.color, { top: false, px: false, pz: false }, s.opacity);
    else if (s.shape === "slab") g = box(x, y, z, x + 1, y + 0.5, z + 1, s.color, { top: false, px: false, pz: false }, s.opacity);
    else if (s.shape === "flat") g = box(x, y, z, x + 1, y + 0.08, z + 1, s.color, { top: false, px: false, pz: false }, s.opacity);
    else g = box(x, y, z, x + 1, y + 1, z + 1, s.color, hidden, s.opacity);

    // Hopper output direction: arrow on the top face, dot for "down"
    const facing = b.block.startsWith("minecraft:hopper") ? propOf(b.block, "facing") : undefined;
    if (facing && DIR[facing]) {
      const d = viewDir(DIR[facing]);
      const cx = x + 0.5, cz = z + 0.5, top = y + 1;
      if (facing === "down") {
        const [px, py] = P(cx, top, cz);
        g += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(a * 0.13).toFixed(1)}" fill="#e8e8e8"/>`;
      } else {
        const tip = P(cx + d[0] * 0.42, top, cz + d[2] * 0.42);
        const l = P(cx - d[2] * 0.2 - d[0] * 0.05, top, cz + d[0] * 0.2 - d[2] * 0.05);
        const rr = P(cx + d[2] * 0.2 - d[0] * 0.05, top, cz - d[0] * 0.2 - d[2] * 0.05);
        const tail = P(cx - d[0] * 0.3, top, cz - d[2] * 0.3);
        g += `<polyline points="${[tail, P(cx, top, cz)].map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" stroke="#e8e8e8" stroke-width="${(a * 0.09).toFixed(1)}"/>`;
        g += `<polygon points="${[tip, l, rr].map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" fill="#e8e8e8"/>`;
      }
    }
    out.push(`<g><title>${esc(`${b.instance}\n${b.block}\n(${b.pos.join(", ")})`)}</title>${g}</g>`);
  }

  // Findings: red/orange outline boxes on top of everything
  if (showHighlights) {
    for (const h of model.highlights) {
      if (h.at[1] > maxY) continue;
      const [x, y, z] = view(h.at);
      const color = h.severity === "error" ? "#e5484d" : h.severity === "warning" ? "#f5a524" : "#3e9bf2";
      const pts = [P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)];
      const side = [P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y, z), P(x + 1, y + 1, z), P(x, y + 1, z), P(x, y + 1, z + 1)];
      track([...pts, ...side]);
      const outline = [P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y, z), P(x + 1, y, z + 1), P(x, y, z + 1), P(x, y + 1, z + 1)];
      out.push(
        `<g><title>${esc(`${h.severity}: ${h.message}`)}</title><polygon points="${outline.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="${(a * 0.14).toFixed(1)}" stroke-linejoin="round"/></g>`,
      );
    }
  }

  // Flow labels at the target cell of each connection
  if (showFlows) {
    const seen = new Set<string>();
    const placed: Array<[number, number, number, number]> = [];
    const overlaps = (x0: number, y0: number, x1: number, y1: number) =>
      placed.some(([a0, b0, a1, b1]) => x0 < a1 && x1 > a0 && y0 < b1 && y1 > b0);
    for (const e of model.edges) {
      const cell = e.cells[0];
      if (!cell || e.perHour <= 0 || cell[1] > maxY) continue;
      const k = cell.join(",");
      if (seen.has(k)) continue;
      seen.add(k);
      const [x, y, z] = view(cell);
      const hot = (e.utilization ?? 0) > 1;
      const text = `${fmt(e.perHour)}/h`;
      const w = text.length * a * 0.42 + a * 0.6;
      const [px] = P(x + 0.5, y + 1.6, z + 0.5);
      let [, py] = P(x + 0.5, y + 1.6, z + 0.5);
      // Move up until the label no longer covers another one
      while (overlaps(px - w / 2, py - a * 0.5, px + w / 2, py + a * 0.5)) py -= a;
      placed.push([px - w / 2, py - a * 0.5, px + w / 2, py + a * 0.5]);
      track([[px - w / 2, py - a * 0.5], [px + w / 2, py + a * 0.5]]);
      out.push(
        `<g><title>${esc(`${e.from} → ${e.to}: ${fmt(e.perHour)} items/h${e.utilization ? `, utilisation ${(e.utilization * 100).toFixed(0)}%` : ""}`)}</title>` +
          `<rect x="${(px - w / 2).toFixed(1)}" y="${(py - a * 0.45).toFixed(1)}" width="${w.toFixed(1)}" height="${(a * 0.9).toFixed(1)}" rx="${(a * 0.45).toFixed(1)}" fill="${hot ? "#e5484d" : "#1f2328"}" fill-opacity="0.88"/>` +
          `<text x="${px.toFixed(1)}" y="${(py + a * 0.22).toFixed(1)}" font-size="${(a * 0.62).toFixed(1)}" text-anchor="middle" fill="#fff" font-family="ui-sans-serif,system-ui,sans-serif">${esc(text)}</text></g>`,
      );
    }
  }

  const pad = a * 1.5;
  const titleH = options.title ? a * 2 : 0;
  const vbX = minX - pad, vbY = minY - pad - titleH;
  const w = maxX - minX + pad * 2, h = maxYs - minY + pad * 2 + titleH;
  const bg = options.background ? `<rect x="${vbX}" y="${vbY}" width="${w}" height="${h}" fill="${options.background}"/>` : "";
  const title = options.title
    ? `<text x="${(vbX + pad).toFixed(1)}" y="${(vbY + pad + a * 0.6).toFixed(1)}" font-size="${a}" font-weight="600" fill="#57606a" font-family="ui-sans-serif,system-ui,sans-serif">${esc(options.title)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(1)} ${vbY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}">${bg}${title}${out.join("")}</svg>`;
}
