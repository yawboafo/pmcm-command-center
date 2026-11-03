import { isElevated } from "./catalog";
import { footprint, wallBase } from "./derive";
import type { FloorPlan, Vec2 } from "./types";

/**
 * Occupancy grid used for agent path-finding, first-person collision and
 * editor circulation checks. Covers the building plus a margin of street/yard.
 */
export class NavGrid {
  readonly cell = 0.2;
  readonly ox: number;
  readonly oz: number;
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;

  constructor(plan: FloorPlan, opts: { margin?: number; agentRadius?: number } = {}) {
    const margin = opts.margin ?? 7;
    const r = opts.agentRadius ?? 0.22;
    this.ox = -margin;
    this.oz = -margin - 2;
    this.cols = Math.ceil((plan.dimensions.width + margin * 2) / this.cell);
    this.rows = Math.ceil((plan.dimensions.length + margin * 2 + 2) / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);

    for (const w of plan.walls) {
      if (wallBase(w) > 0.5) continue;
      const pad = w.thickness / 2 + r;
      const x0 = Math.min(w.a[0], w.b[0]) - (w.a[0] === w.b[0] ? pad : 0);
      const x1 = Math.max(w.a[0], w.b[0]) + (w.a[0] === w.b[0] ? pad : 0);
      const z0 = Math.min(w.a[1], w.b[1]) - (w.a[1] === w.b[1] ? pad : 0);
      const z1 = Math.max(w.a[1], w.b[1]) + (w.a[1] === w.b[1] ? pad : 0);
      // Shrink along the wall axis by the agent radius so door jambs leave the full opening walkable.
      this.fillRect(x0, z0, x1, z1);
    }
    for (const e of plan.equipment) {
      if (isElevated(e.type)) continue;
      const { hw, hd } = footprint(e.size, e.rotation);
      this.fillRect(e.position[0] - hw - r * 0.6, e.position[2] - hd - r * 0.6, e.position[0] + hw + r * 0.6, e.position[2] + hd + r * 0.6);
    }
    for (const f of plan.furniture) {
      const { hw, hd } = footprint(f.size, f.rotation);
      const shrink = f.type.startsWith("table") || f.type === "booth-4" ? 0.25 : 0;
      this.fillRect(f.position[0] - hw + shrink, f.position[2] - hd + shrink, f.position[0] + hw - shrink, f.position[2] + hd - shrink);
    }
  }

  private fillRect(x0: number, z0: number, x1: number, z1: number) {
    const c0 = Math.max(0, Math.floor((x0 - this.ox) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.ox) / this.cell));
    const r0 = Math.max(0, Math.floor((z0 - this.oz) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((z1 - this.oz) / this.cell));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) this.blocked[rr * this.cols + cc] = 1;
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.ox) / this.cell), Math.floor((z - this.oz) / this.cell)];
  }

  toWorld(c: number, r: number): Vec2 {
    return [this.ox + (c + 0.5) * this.cell, this.oz + (r + 0.5) * this.cell];
  }

  inBounds(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  isFree(c: number, r: number) {
    return this.inBounds(c, r) && this.blocked[r * this.cols + c] === 0;
  }

  isWalkable(x: number, z: number) {
    const [c, r] = this.toCell(x, z);
    return this.isFree(c, r);
  }

  /** Nearest walkable cell to a world point (spiral search). */
  nearestFree(x: number, z: number, maxRadius = 12): [number, number] | null {
    const [c, r] = this.toCell(x, z);
    if (this.isFree(c, r)) return [c, r];
    for (let rad = 1; rad <= maxRadius; rad++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          if (!this.isFree(c + dc, r + dr)) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) {
            bestD = d;
            best = [c + dc, r + dr];
          }
        }
      if (best) return best;
    }
    return null;
  }

  private lineOfSight(a: [number, number], b: [number, number]) {
    let [x0, y0] = a;
    const [x1, y1] = b;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (!this.isFree(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      // Check both cells when stepping diagonally so paths never clip a corner.
      if (e2 > -dy && e2 < dx && (!this.isFree(x0 - sx, y0) || !this.isFree(x0, y0 - sy))) return false;
    }
  }

  /** A* on an 8-connected grid with corner-cut prevention, then string-pulled. Returns world waypoints or null. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const s = this.nearestFree(from[0], from[1]);
    const g = this.nearestFree(to[0], to[1]);
    if (!s || !g) return null;
    const N = this.cols * this.rows;
    const start = s[1] * this.cols + s[0];
    const goal = g[1] * this.cols + g[0];
    if (start === goal) return [to];
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    gScore[start] = 0;
    heap.push(start, 0);
    const gx = g[0];
    const gy = g[1];
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gx);
      const dy = Math.abs(Math.floor(i / this.cols) - gy);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.cols;
      const cy = (cur - cx) / this.cols;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.isFree(nx, ny)) continue;
          if (dx && dy && (!this.isFree(cx + dx, cy) || !this.isFree(cx, cy + dy))) continue;
          const ni = ny * this.cols + nx;
          if (closed[ni]) continue;
          const ng = gScore[cur] + (dx && dy ? Math.SQRT2 : 1);
          if (ng < gScore[ni]) {
            gScore[ni] = ng;
            came[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
    }
    if (!found) return null;
    const cells: Array<[number, number]> = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push([i % this.cols, Math.floor(i / this.cols)]);
    cells.reverse();
    // String pulling
    const pulled: Array<[number, number]> = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.lineOfSight(cells[anchor], cells[i])) {
        pulled.push(cells[i - 1]);
        anchor = i - 1;
      }
    }
    pulled.push(cells[cells.length - 1]);
    const pts = pulled.map(([c, r]) => this.toWorld(c, r));
    pts[pts.length - 1] = this.isWalkable(to[0], to[1]) ? to : pts[pts.length - 1];
    return pts;
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
