/**
 * Pure floor-plan editing helpers: recomputation, validation, layout metrics
 * and the one-click optimiser. No React here so it can be unit-tested.
 */
import { EQUIPMENT_CATALOG, FURNITURE_CATALOG, isElevated } from "../../lib/floorplan/catalog";
import { deriveNavigationPaths, deriveWalls, fillWorkstationStandPoints, footprint, roomAt } from "../../lib/floorplan/derive";
import { NavGrid } from "../../lib/floorplan/nav";
import type { Door, Equipment, EquipmentType, FloorPlan, Furniture, FurnitureType, Room, Vec2, Vec3, WorkstationType } from "../../lib/floorplan/types";
import { CHICKEN_BATCH, MENU, stagesFor } from "../../lib/sim/menu";

export type ItemKind = "equipment" | "furniture" | "camera" | "sensor" | "room" | "door" | "window";
export interface SelItem {
  kind: ItemKind;
  id: string;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function round(n: number, p = 1000) {
  return Math.round(n * p) / p;
}

export function snap(v: number, step: number) {
  return step > 0 ? round(Math.round(v / step) * step) : round(v);
}

export function uid(prefix: string, taken: Iterable<string>) {
  const set = new Set(taken);
  let i = 1;
  while (set.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

export function allIds(plan: FloorPlan): string[] {
  return [
    ...plan.equipment.map((e) => e.id),
    ...plan.furniture.map((f) => f.id),
    ...plan.cameras.map((c) => c.id),
    ...plan.sensors.map((s) => s.id),
    ...plan.rooms.map((r) => r.id),
    ...plan.doors.map((d) => d.id),
    ...plan.windows.map((w) => w.id),
    ...plan.workstations.map((w) => w.id),
  ];
}

export function itemRect(item: { position: Vec3; size: Vec3; rotation: number }): Rect {
  const { hw, hd } = footprint(item.size, item.rotation);
  return { x0: item.position[0] - hw, z0: item.position[2] - hd, x1: item.position[0] + hw, z1: item.position[2] + hd };
}

export function penetration(a: Rect, b: Rect): { px: number; pz: number } | null {
  const px = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const pz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return px > 0 && pz > 0 ? { px, pz } : null;
}

/** Floor-standing objects that occupy circulation space. */
export function floorItems(plan: FloorPlan): Array<{ id: string; kind: "equipment" | "furniture"; name: string; rect: Rect; roomId: string }> {
  return [
    ...plan.equipment.filter((e) => !isElevated(e.type)).map((e) => ({ id: e.id, kind: "equipment" as const, name: e.name, rect: itemRect(e), roomId: e.roomId })),
    ...plan.furniture.map((f) => ({ id: f.id, kind: "furniture" as const, name: FURNITURE_CATALOG[f.type].label, rect: itemRect(f), roomId: f.roomId })),
  ];
}

/** Recompute derived geometry after an edit. Cameras and sensors are left untouched on purpose. */
export function recompute(plan: FloorPlan, opts: { walls?: boolean } = {}): FloorPlan {
  if (opts.walls !== false) plan.walls = deriveWalls(plan);
  fillWorkstationStandPoints(plan);
  plan.navigationPaths = deriveNavigationPaths(plan);
  return plan;
}

// ───────────────────────────── creators ─────────────────────────────

export function newEquipment(plan: FloorPlan, type: EquipmentType, x: number, z: number): Equipment {
  const spec = EQUIPMENT_CATALOG[type];
  const room = roomAt(plan.rooms, x, z) ?? plan.rooms[0];
  const n = plan.equipment.filter((e) => e.type === type).length + 1;
  return {
    id: uid(type, allIds(plan)),
    type,
    name: `${spec.label} ${String(n).padStart(2, "0")}`,
    category: spec.category,
    roomId: room.id,
    position: [round(x), spec.elevation ?? 0, round(z)],
    rotation: 0,
    size: [...spec.size],
    operational: { powered: true, setpointC: spec.setpointC, capacity: spec.capacity, maintenanceIntervalDays: spec.maintenanceIntervalDays },
    interaction: { inspect: [...spec.inspect], focusDistance: Math.max(2.2, spec.size[0] * 1.6) },
  };
}

export function newFurniture(plan: FloorPlan, type: FurnitureType, x: number, z: number): Furniture {
  const spec = FURNITURE_CATALOG[type];
  const room = roomAt(plan.rooms, x, z) ?? plan.rooms[0];
  return { id: uid(type, allIds(plan)), type, roomId: room.id, position: [round(x), 0, round(z)], rotation: 0, size: [...spec.size], seats: spec.seats };
}

export function nextCode(prefix: "CAM" | "SNS", codes: string[]) {
  const max = codes.reduce((m, c) => Math.max(m, Number(c.split("-")[1]) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** Nearest wall line to a point (for placing doors/windows). */
export function nearestWall(plan: FloorPlan, p: Vec2): { axis: "x" | "z"; x: number; z: number; dist: number } | null {
  let best: { axis: "x" | "z"; x: number; z: number; dist: number } | null = null;
  for (const w of plan.walls) {
    const axis: "x" | "z" = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? "x" : "z";
    let x: number;
    let z: number;
    if (axis === "x") {
      x = Math.min(Math.max(p[0], Math.min(w.a[0], w.b[0])), Math.max(w.a[0], w.b[0]));
      z = w.a[1];
    } else {
      x = w.a[0];
      z = Math.min(Math.max(p[1], Math.min(w.a[1], w.b[1])), Math.max(w.a[1], w.b[1]));
    }
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (!best || d < best.dist) best = { axis, x: round(x), z: round(z), dist: d };
  }
  return best;
}

/** Rooms sharing an edge segment with `room` (candidates for open-plan connections). */
export function adjacentRooms(plan: FloorPlan, room: Room): Room[] {
  const eps = 1e-6;
  return plan.rooms.filter((o) => {
    if (o.id === room.id) return false;
    const shareX = Math.min(room.x + room.w, o.x + o.w) - Math.max(room.x, o.x) > 0.05;
    const shareZ = Math.min(room.z + room.d, o.z + o.d) - Math.max(room.z, o.z) > 0.05;
    const touchZ = Math.abs(room.z + room.d - o.z) < eps || Math.abs(o.z + o.d - room.z) < eps;
    const touchX = Math.abs(room.x + room.w - o.x) < eps || Math.abs(o.x + o.w - room.x) < eps;
    return (shareX && touchZ) || (shareZ && touchX);
  });
}

// ───────────────────────────── validation ─────────────────────────────

export interface Issue {
  id: string;
  severity: "error" | "warning";
  category: "overlap" | "bounds" | "wall" | "clearance" | "circulation" | "hygiene";
  message: string;
  targets: SelItem[];
  at?: Vec2;
}

function doorSides(plan: FloorPlan, d: Door): [Room | undefined, Room | undefined] {
  const o = 0.25;
  return d.axis === "x" ? [roomAt(plan.rooms, d.x, d.z - o), roomAt(plan.rooms, d.x, d.z + o)] : [roomAt(plan.rooms, d.x - o, d.z), roomAt(plan.rooms, d.x + o, d.z)];
}

export function isExteriorDoor(plan: FloorPlan, d: Door) {
  const { width: W, length: L } = plan.dimensions;
  return d.axis === "x" ? Math.abs(d.z) < 1e-3 || Math.abs(d.z - L) < 1e-3 : Math.abs(d.x) < 1e-3 || Math.abs(d.x - W) < 1e-3;
}

/** Point 1.5 m outside an exterior door. */
export function doorOutside(plan: FloorPlan, d: Door): Vec2 {
  const cx = plan.dimensions.width / 2;
  const cz = plan.dimensions.length / 2;
  return d.axis === "x" ? [d.x, d.z + (d.z < cz ? -1.5 : 1.5)] : [d.x + (d.x < cx ? -1.5 : 1.5), d.z];
}

function clearanceRects(plan: FloorPlan, d: Door): Rect[] {
  const depth = 0.9;
  const half = d.width / 2;
  const ext = isExteriorDoor(plan, d);
  const cx = plan.dimensions.width / 2;
  const cz = plan.dimensions.length / 2;
  const rects: Rect[] = [];
  if (d.axis === "x") {
    const inwardPos = d.z < cz;
    if (!ext || inwardPos) rects.push({ x0: d.x - half, x1: d.x + half, z0: d.z, z1: d.z + depth });
    if (!ext || !inwardPos) rects.push({ x0: d.x - half, x1: d.x + half, z0: d.z - depth, z1: d.z });
  } else {
    const inwardPos = d.x < cx;
    if (!ext || inwardPos) rects.push({ x0: d.x, x1: d.x + depth, z0: d.z - half, z1: d.z + half });
    if (!ext || !inwardPos) rects.push({ x0: d.x - depth, x1: d.x, z0: d.z - half, z1: d.z + half });
  }
  return rects;
}

export function doorClearance(plan: FloorPlan, d: Door) {
  return clearanceRects(plan, d);
}

export interface ValidateOptions {
  circulation?: boolean;
  grid?: NavGrid;
}

export function validate(plan: FloorPlan, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, "id">) => issues.push({ ...i, id: `${i.category}:${i.targets.map((t) => t.id).join(",")}:${issues.length}` });
  const items = floorItems(plan);
  const { width: W, length: L } = plan.dimensions;

  // Overlaps
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const p = penetration(items[i].rect, items[j].rect);
      if (p && p.px > 0.03 && p.pz > 0.03)
        add({ severity: "error", category: "overlap", message: `${items[i].name} overlaps ${items[j].name}`, targets: [{ kind: items[i].kind, id: items[i].id }, { kind: items[j].kind, id: items[j].id }], at: [(Math.max(items[i].rect.x0, items[j].rect.x0) + Math.min(items[i].rect.x1, items[j].rect.x1)) / 2, (Math.max(items[i].rect.z0, items[j].rect.z0) + Math.min(items[i].rect.z1, items[j].rect.z1)) / 2] });
    }

  // Rooms must not overlap each other or leave the building footprint.
  for (let i = 0; i < plan.rooms.length; i++) {
    const a = plan.rooms[i];
    const ra = { x0: a.x, z0: a.z, x1: a.x + a.w, z1: a.z + a.d };
    if (ra.x0 < -0.01 || ra.z0 < -0.01 || ra.x1 > W + 0.01 || ra.z1 > L + 0.01)
      add({ severity: "error", category: "bounds", message: `Room "${a.name}" extends outside the building`, targets: [{ kind: "room", id: a.id }], at: [a.x + a.w / 2, a.z + a.d / 2] });
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const b = plan.rooms[j];
      const p = penetration(ra, { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d });
      if (p && p.px > 0.02 && p.pz > 0.02)
        add({ severity: "error", category: "bounds", message: `Rooms "${a.name}" and "${b.name}" overlap`, targets: [{ kind: "room", id: a.id }, { kind: "room", id: b.id }], at: [(Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2, (Math.max(a.z, b.z) + Math.min(a.z + a.d, b.z + b.d)) / 2] });
    }
  }

  // Bounds + wall crossing
  const all = [
    ...plan.equipment.map((e) => ({ id: e.id, kind: "equipment" as const, name: e.name, rect: itemRect(e), elevated: isElevated(e.type) })),
    ...plan.furniture.map((f) => ({ id: f.id, kind: "furniture" as const, name: FURNITURE_CATALOG[f.type].label, rect: itemRect(f), elevated: false })),
  ];
  for (const it of all) {
    const r = it.rect;
    if (r.x0 < -0.05 || r.z0 < -0.05 || r.x1 > W + 0.05 || r.z1 > L + 0.05) {
      add({ severity: "error", category: "bounds", message: `${it.name} is outside the building`, targets: [{ kind: it.kind, id: it.id }], at: [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2] });
      continue;
    }
    if (it.elevated) continue;
    for (const w of plan.walls) {
      if ((w.base ?? 0) > 0.5) continue;
      const axis = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? "x" : "z";
      const tol = 0.06;
      let crosses = false;
      if (axis === "x") {
        const along = Math.min(r.x1, Math.max(w.a[0], w.b[0])) - Math.max(r.x0, Math.min(w.a[0], w.b[0]));
        crosses = along > tol && r.z0 < w.a[1] - tol && r.z1 > w.a[1] + tol;
      } else {
        const along = Math.min(r.z1, Math.max(w.a[1], w.b[1])) - Math.max(r.z0, Math.min(w.a[1], w.b[1]));
        crosses = along > tol && r.x0 < w.a[0] - tol && r.x1 > w.a[0] + tol;
      }
      if (crosses) {
        add({ severity: "error", category: "wall", message: `${it.name} crosses a wall`, targets: [{ kind: it.kind, id: it.id }], at: [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2] });
        break;
      }
    }
  }

  // Door clearance
  for (const d of plan.doors) {
    const critical = d.kind === "emergency" || d.kind === "entrance";
    for (const c of clearanceRects(plan, d)) {
      const hit = items.find((it) => {
        const p = penetration(it.rect, c);
        return p && p.px > 0.05 && p.pz > 0.05;
      });
      if (hit) {
        add({ severity: critical ? "error" : "warning", category: "clearance", message: `${hit.name} blocks the 0.9 m clearance at ${d.name}`, targets: [{ kind: "door", id: d.id }, { kind: hit.kind, id: hit.id }], at: [d.x, d.z] });
        break;
      }
    }
  }

  // Hygiene zoning
  const typeOf = (r?: Room) => r?.type;
  for (const d of plan.doors) {
    const [a, b] = doorSides(plan, d);
    if (!a || !b) continue;
    const raw = a.hygieneZone === "raw" ? a : b.hygieneZone === "raw" ? b : null;
    const other = raw === a ? b : a;
    if (raw && (typeOf(other) === "packaging" || typeOf(other) === "dispatch"))
      add({ severity: "warning", category: "hygiene", message: `Raw zone "${raw.name}" opens directly into "${other.name}" — keep raw handling away from cooked packaging`, targets: [{ kind: "door", id: d.id }], at: [d.x, d.z] });
  }
  for (const [ia, ib] of plan.openings) {
    const a = plan.rooms.find((r) => r.id === ia);
    const b = plan.rooms.find((r) => r.id === ib);
    if (!a || !b) continue;
    const raw = a.hygieneZone === "raw" ? a : b.hygieneZone === "raw" ? b : null;
    const other = raw === a ? b : a;
    if (raw && other.hygieneZone !== "raw")
      add({ severity: other.type === "packaging" || other.type === "dispatch" ? "error" : "warning", category: "hygiene", message: `Raw zone "${raw.name}" is open-plan to "${other.name}" — raw handling should be enclosed`, targets: [{ kind: "room", id: raw.id }] });
  }
  for (const r of plan.rooms.filter((r) => r.hygieneZone === "raw")) {
    if (!plan.equipment.some((e) => e.type === "handwash" && e.roomId === r.id))
      add({ severity: "warning", category: "hygiene", message: `Raw prep room "${r.name}" has no handwash basin`, targets: [{ kind: "room", id: r.id }], at: [r.x + r.w / 2, r.z + r.d / 2] });
  }

  if (opts.circulation !== false) issues.push(...circulationIssues(plan, opts.grid ?? new NavGrid(plan)));
  return issues;
}

export function circulationIssues(plan: FloorPlan, grid: NavGrid): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, "id">) => issues.push({ ...i, id: `circ:${issues.length}:${i.message}` });
  const a = plan.anchors;
  if (!grid.findPath(a.outside, a.queueHead)) add({ severity: "error", category: "circulation", message: "Customers cannot reach the ordering queue from the street", targets: [], at: a.queueHead });
  if (!grid.findPath(a.queueHead, a.pickup)) add({ severity: "error", category: "circulation", message: "Customers cannot reach the collection point from the queue", targets: [], at: a.pickup });
  const rider = plan.doors.find((d) => d.kind === "delivery");
  if (rider && !grid.findPath(doorOutside(plan, rider), a.riderWait)) add({ severity: "error", category: "circulation", message: "Riders cannot reach the dispatch waiting point", targets: [{ kind: "door", id: rider.id }], at: a.riderWait });
  for (const ws of plan.workstations) {
    if (!grid.findPath(a.staffRest, ws.standPoint)) add({ severity: "error", category: "circulation", message: `Staff cannot reach ${ws.name}`, targets: ws.equipmentIds.map((id) => ({ kind: "equipment" as const, id })), at: ws.standPoint });
  }
  const exits = plan.doors.filter((d) => isExteriorDoor(plan, d)).map((d) => doorOutside(plan, d));
  for (const r of plan.rooms) {
    const c = grid.nearestFree(r.x + r.w / 2, r.z + r.d / 2, 20);
    if (!c) {
      add({ severity: "error", category: "circulation", message: `No free floor space in ${r.name}`, targets: [{ kind: "room", id: r.id }], at: [r.x + r.w / 2, r.z + r.d / 2] });
      continue;
    }
    const from = grid.toWorld(c[0], c[1]);
    if (!exits.some((e) => grid.findPath(from, e))) add({ severity: "error", category: "circulation", message: `${r.name} has no route to an exit`, targets: [{ kind: "room", id: r.id }], at: from });
  }
  return issues;
}

// ───────────────────────────── metrics ─────────────────────────────

const KITCHEN_TYPES = new Set(["kitchen", "pizza", "chicken", "rice", "packaging", "dispatch", "cold", "freezer", "dry", "wash", "counter"]);
const CUSTOMER_TYPES = new Set(["dining", "customer"]);

export interface LayoutMetrics {
  area: number;
  kitchenPct: number;
  customerPct: number;
  seats: number;
  flows: { pizza: number | null; chicken: number | null; rice: number | null };
  flowTotal: number;
  workstations: number;
  capacities: Partial<Record<WorkstationType, number>>;
  throughputPerHour: number;
  bottleneck: WorkstationType | null;
}

function pathLength(p: Vec2[] | null, from: Vec2): number | null {
  if (!p) return null;
  let d = 0;
  let prev = from;
  for (const q of p) {
    d += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return d;
}

function chainDistance(plan: FloorPlan, grid: NavGrid, chain: WorkstationType[]): number | null {
  const stations = chain.map((t) => plan.workstations.filter((w) => w.type === t));
  if (stations.some((s) => !s.length)) return null;
  let total = 0;
  let prev = stations[0][0];
  for (let i = 1; i < stations.length; i++) {
    // Nearest next station of the required type.
    let best: { d: number; ws: (typeof stations)[number][number] } | null = null;
    for (const ws of stations[i]) {
      const d = pathLength(grid.findPath(prev.standPoint, ws.standPoint), prev.standPoint);
      if (d !== null && (!best || d < best.d)) best = { d, ws };
    }
    if (!best) return null;
    total += best.d;
    prev = best.ws;
  }
  return Math.round(total * 10) / 10;
}

/** Average station-seconds demanded per order, from the menu mix and stage durations (simulation assumptions). */
export function stationLoadPerOrder(): Partial<Record<WorkstationType, number>> {
  const load: Partial<Record<WorkstationType, number>> = {};
  const totalW = MENU.reduce((s, m) => s + m.weight, 0);
  const avgLines = 1.6;
  const addL = (ws: WorkstationType, s: number) => (load[ws] = (load[ws] ?? 0) + s);
  for (const m of MENU) {
    const share = (m.weight / totalW) * avgLines;
    for (const u of m.units) {
      for (const st of stagesFor(u)) addL(st.ws, st.duration * share);
      if (u.kind === "chicken" && u.cut) {
        const batch = CHICKEN_BATCH[u.cut];
        const perPiece = (u.pieces ?? 1) / batch.pieces;
        for (const st of batch.stages) addL(st.ws, st.duration * perPiece * share);
      }
    }
    addL("packaging", (20 + 5 * m.units.length) * share / avgLines);
  }
  addL("order-counter", 42 * 0.55);
  return load;
}

export function layoutMetrics(plan: FloorPlan, grid: NavGrid = new NavGrid(plan)): LayoutMetrics {
  const area = plan.dimensions.width * plan.dimensions.length;
  const roomArea = (pred: (r: Room) => boolean) => plan.rooms.filter(pred).reduce((s, r) => s + r.w * r.d, 0);
  const flows = {
    pizza: chainDistance(plan, grid, ["pizza-prep", "oven", "qc", "packaging"]),
    chicken: chainDistance(plan, grid, ["chicken-prep", "fryer", "qc", "packaging"]),
    rice: chainDistance(plan, grid, ["rice", "packaging", "dispatch"]),
  };
  const capacities: Partial<Record<WorkstationType, number>> = {};
  for (const w of plan.workstations) capacities[w.type] = (capacities[w.type] ?? 0) + w.capacity;
  const load = stationLoadPerOrder();
  let worst = 0;
  let bottleneck: WorkstationType | null = null;
  for (const [ws, secs] of Object.entries(load) as Array<[WorkstationType, number]>) {
    const cap = capacities[ws];
    if (!cap) continue;
    const perOrder = secs / cap;
    if (perOrder > worst) {
      worst = perOrder;
      bottleneck = ws;
    }
  }
  return {
    area: round(area, 10),
    kitchenPct: roomArea((r) => KITCHEN_TYPES.has(r.type)) / area,
    customerPct: roomArea((r) => CUSTOMER_TYPES.has(r.type)) / area,
    seats: plan.furniture.reduce((s, f) => s + f.seats, 0),
    flows,
    flowTotal: round((flows.pizza ?? 0) + (flows.chicken ?? 0) + (flows.rice ?? 0), 10),
    workstations: plan.workstations.length,
    capacities,
    throughputPerHour: worst > 0 ? Math.round(3600 / worst) : 0,
    bottleneck,
  };
}

// ───────────────────────────── optimise ─────────────────────────────

export interface OptimiseResult {
  plan: FloorPlan;
  moved: string[];
}

function clampIntoRoom(item: { position: Vec3; size: Vec3; rotation: number }, room: Room | undefined) {
  if (!room) return;
  const { hw, hd } = footprint(item.size, item.rotation);
  if (room.w >= hw * 2) item.position[0] = Math.min(room.x + room.w - hw, Math.max(room.x + hw, item.position[0]));
  if (room.d >= hd * 2) item.position[2] = Math.min(room.z + room.d - hd, Math.max(room.z + hd, item.position[2]));
}

/**
 * Resolve overlapping floor items by nudging them apart along the axis of
 * smaller penetration, keep moved items inside their rooms and snap them.
 * Items that never overlap are left exactly where they are.
 */
export function optimise(input: FloorPlan, gridStep = 0.05): OptimiseResult {
  const plan = structuredClone(input);
  const moved = new Set<string>();
  const movable = () => [
    ...plan.equipment.filter((e) => !isElevated(e.type)).map((e) => ({ id: e.id, obj: e as { position: Vec3; size: Vec3; rotation: number; roomId: string } })),
    ...plan.furniture.map((f) => ({ id: f.id, obj: f as { position: Vec3; size: Vec3; rotation: number; roomId: string } })),
  ];
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  for (let iter = 0; iter < 80; iter++) {
    let changed = false;
    const items = movable();
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].obj;
        const b = items[j].obj;
        const p = penetration(itemRect(a), itemRect(b));
        if (!p || p.px <= 0.03 || p.pz <= 0.03) continue;
        // Move the item that has moved least so far (prefer keeping template positions); split otherwise.
        const target = moved.has(items[i].id) && !moved.has(items[j].id) ? items[i] : items[j];
        const other = target === items[j] ? items[i] : items[j];
        const t = target.obj;
        const o = other.obj;
        // Try all four push directions; keep the one leaving the least total overlap (then smallest move).
        const start: Vec3 = [...t.position];
        const tr = itemRect(t);
        const or = itemRect(o);
        const gap = 0.04;
        const candidates: Vec3[] = [
          [start[0] + (or.x1 - tr.x0 + gap), start[1], start[2]],
          [start[0] - (tr.x1 - or.x0 + gap), start[1], start[2]],
          [start[0], start[1], start[2] + (or.z1 - tr.z0 + gap)],
          [start[0], start[1], start[2] - (tr.z1 - or.z0 + gap)],
        ];
        // Prefer the natural direction (away from the other item, smaller penetration axis) on ties.
        const natural = p.px < p.pz ? (t.position[0] >= o.position[0] ? 0 : 1) : t.position[2] >= o.position[2] ? 2 : 3;
        let best: { pos: Vec3; score: number } | null = null;
        candidates.forEach((c, k) => {
          t.position = [...c];
          clampIntoRoom(t, rooms.get(t.roomId));
          t.position = [snap(t.position[0], gridStep), t.position[1], snap(t.position[2], gridStep)];
          const r = itemRect(t);
          let overlap = 0;
          for (const it of items) {
            if (it.obj === t) continue;
            const q = penetration(r, itemRect(it.obj));
            if (q && q.px > 0.03 && q.pz > 0.03) overlap += q.px * q.pz;
          }
          const moveDist = Math.hypot(t.position[0] - start[0], t.position[2] - start[2]);
          const score = overlap * 100 + moveDist + (k === natural ? 0 : 0.05);
          if (!best || score < best.score) best = { pos: [...t.position], score };
        });
        t.position = best!.pos;
        moved.add(target.id);
        changed = true;
      }
    if (!changed) break;
  }
  recompute(plan, { walls: false });
  return { plan, moved: [...moved] };
}

export function issueCounts(issues: Issue[]) {
  return { errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length };
}

/** Basic structural check for imported JSON. */
export function checkImportedPlan(data: unknown): { ok: true; plan: FloorPlan } | { ok: false; reason: string } {
  if (!data || typeof data !== "object") return { ok: false, reason: "Not a JSON object" };
  const p = data as Partial<FloorPlan>;
  if (p.schemaVersion !== 1) return { ok: false, reason: "Unsupported schemaVersion (expected 1)" };
  for (const k of ["rooms", "doors", "windows", "equipment", "furniture", "workstations", "cameras", "sensors"] as const) if (!Array.isArray(p[k])) return { ok: false, reason: `Missing array "${k}"` };
  if (!p.dimensions || typeof p.dimensions.width !== "number" || typeof p.dimensions.length !== "number") return { ok: false, reason: "Missing dimensions" };
  if (!p.anchors) return { ok: false, reason: "Missing anchors" };
  const plan = structuredClone(p) as FloorPlan;
  plan.openings ??= [];
  plan.workflow ??= [];
  plan.navigationPaths ??= [];
  plan.conceptual = true;
  return { ok: true, plan: recompute(plan) };
}
