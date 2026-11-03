import { footprint } from "./derive";
import type { NavGrid } from "./nav";
import type { FloorPlan } from "./types";

const ZONE_FILL: Record<string, string> = {
  public: "#f4efe6",
  raw: "#fbd5d5",
  cooked: "#fde9c4",
  storage: "#d6e9f8",
  support: "#e5e7eb",
};

/** Static SVG export of a floor plan (used for previews and downloads). */
export function planToSvg(plan: FloorPlan, opts: { scale?: number; grid?: NavGrid } = {}): string {
  const s = opts.scale ?? 50;
  const pad = 1.5;
  const W = (plan.dimensions.width + pad * 2) * s;
  const H = (plan.dimensions.length + pad * 2) * s;
  // SVG y grows downward; flip so z (north) is up and the street frontage is at the bottom.
  const X = (x: number) => (x + pad) * s;
  const Y = (z: number) => (plan.dimensions.length - z + pad) * s;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial" font-size="${s * 0.2}">`);
  out.push(`<rect width="100%" height="100%" fill="#fff"/>`);
  for (const r of plan.rooms) {
    out.push(`<rect x="${X(r.x)}" y="${Y(r.z + r.d)}" width="${r.w * s}" height="${r.d * s}" fill="${ZONE_FILL[r.hygieneZone]}"/>`);
  }
  if (opts.grid) {
    const g = opts.grid;
    for (let rr = 0; rr < g.rows; rr++)
      for (let c = 0; c < g.cols; c++) {
        if (!g.blocked[rr * g.cols + c]) continue;
        const [x, z] = g.toWorld(c, rr);
        if (x < -pad || z < -pad || x > plan.dimensions.width + pad || z > plan.dimensions.length + pad) continue;
        out.push(`<rect x="${X(x - g.cell / 2)}" y="${Y(z + g.cell / 2)}" width="${g.cell * s}" height="${g.cell * s}" fill="#000" opacity="0.06"/>`);
      }
  }
  for (const r of plan.rooms) {
    out.push(`<text x="${X(r.x + r.w / 2)}" y="${Y(r.z + r.d / 2)}" text-anchor="middle" fill="#555" font-weight="bold">${esc(r.name)}</text>`);
    out.push(`<text x="${X(r.x + r.w / 2)}" y="${Y(r.z + r.d / 2) + s * 0.25}" text-anchor="middle" fill="#888">${(r.w * r.d).toFixed(1)} m²</text>`);
  }
  for (const f of plan.furniture) {
    const { hw, hd } = footprint(f.size, f.rotation);
    out.push(`<rect x="${X(f.position[0] - hw)}" y="${Y(f.position[2] + hd)}" width="${hw * 2 * s}" height="${hd * 2 * s}" rx="4" fill="#c9a27a" stroke="#8a6440"/>`);
  }
  for (const e of plan.equipment) {
    const { hw, hd } = footprint(e.size, e.rotation);
    const elevated = e.position[1] > 1.5;
    out.push(`<rect x="${X(e.position[0] - hw)}" y="${Y(e.position[2] + hd)}" width="${hw * 2 * s}" height="${hd * 2 * s}" fill="${elevated ? "none" : "#9ca3af"}" stroke="#374151" ${elevated ? 'stroke-dasharray="4 3"' : ""}/>`);
    // front indicator
    const fx = e.position[0] + Math.sin(e.rotation) * (e.size[2] / 2);
    const fz = e.position[2] + Math.cos(e.rotation) * (e.size[2] / 2);
    if (!elevated) out.push(`<circle cx="${X(fx)}" cy="${Y(fz)}" r="${s * 0.06}" fill="#ee1d25"/>`);
  }
  for (const w of plan.walls) {
    const color = (w.base ?? 0) > 0 ? "#60a5fa" : w.height < 1.5 ? "#60a5fa" : "#111";
    out.push(`<line x1="${X(w.a[0])}" y1="${Y(w.a[1])}" x2="${X(w.b[0])}" y2="${Y(w.b[1])}" stroke="${color}" stroke-width="${w.thickness * s}" stroke-linecap="square"/>`);
  }
  for (const d of plan.doors) {
    const col = d.kind === "emergency" ? "#16a34a" : d.kind === "entrance" ? "#ee1d25" : d.kind === "delivery" ? "#e7c000" : "#6b7280";
    const [x1, z1, x2, z2] = d.axis === "x" ? [d.x - d.width / 2, d.z, d.x + d.width / 2, d.z] : [d.x, d.z - d.width / 2, d.x, d.z + d.width / 2];
    out.push(`<line x1="${X(x1)}" y1="${Y(z1)}" x2="${X(x2)}" y2="${Y(z2)}" stroke="${col}" stroke-width="${s * 0.08}"/>`);
  }
  for (const ws of plan.workstations) {
    out.push(`<circle cx="${X(ws.standPoint[0])}" cy="${Y(ws.standPoint[1])}" r="${s * 0.12}" fill="#5ab350"/>`);
  }
  for (const c of plan.cameras) {
    out.push(`<line x1="${X(c.position[0])}" y1="${Y(c.position[2])}" x2="${X(c.target[0])}" y2="${Y(c.target[2])}" stroke="#a855f7" stroke-width="1" opacity="0.5"/>`);
    out.push(`<rect x="${X(c.position[0]) - 5}" y="${Y(c.position[2]) - 5}" width="10" height="10" fill="#a855f7"/>`);
  }
  for (const p of plan.navigationPaths.filter((p) => p.kind !== "emergency")) {
    const col = p.kind === "customer" ? "#ee1d25" : p.kind === "delivery" ? "#e7c000" : "#16a34a";
    out.push(`<polyline points="${p.points.map(([x, z]) => `${X(x)},${Y(z)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4" opacity="0.7"/>`);
  }
  out.push(`<text x="${s * 0.3}" y="${H - s * 0.3}" fill="#999">${esc(plan.name)} — CONCEPTUAL, not an official branch plan</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
