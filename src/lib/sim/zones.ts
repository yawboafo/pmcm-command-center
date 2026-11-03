import type { Door, Equipment, FloorPlan, Room, RoomType, Vec3 } from "../floorplan/types";
import type { BranchSimulation } from "./engine";
import type { Agent, Alert, HistoryFrame } from "./types";

/**
 * Camera zones — the eight places a restaurant owner actually watches. Each zone has a
 * fixed vantage point derived from the floor plan (so every layout, including edited
 * ones, gets the same eight cameras), the rooms it covers, and a small set of
 * plain-language metrics computed from the one simulation state the twin, panels and
 * dashboards already share. Nothing here is stored separately: a zone status is a
 * view over `BranchSimulation`.
 */
export type ZoneId = "front-counter" | "kitchen" | "pass" | "dining" | "pickup-bay" | "cold-room" | "entrance" | "back-door";

export type Level = "ok" | "watch" | "act";

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** The owner's question this camera answers. */
  question: string;
  /** Room types the zone covers (people and equipment inside count as "in zone"). */
  roomTypes: RoomType[];
  exterior?: boolean;
}

export const ZONES: ZoneDef[] = [
  { id: "front-counter", name: "Front counter", question: "Is the queue too long, and is the till being handled properly?", roomTypes: ["counter", "customer"] },
  { id: "kitchen", name: "Kitchen & fryers", question: "Is the kitchen keeping up?", roomTypes: ["kitchen", "chicken", "pizza", "rice"] },
  { id: "pass", name: "Heat lamp & pass", question: "Is food sitting too long under the lamp?", roomTypes: ["packaging", "kitchen", "chicken"] },
  { id: "dining", name: "Dining area", question: "Is the dining area clean and comfortable?", roomTypes: ["dining", "customer"] },
  { id: "pickup-bay", name: "Pickup & rider bay", question: "Are riders waiting for orders, or orders waiting for riders?", roomTypes: ["dispatch"] },
  { id: "cold-room", name: "Cold room & storage", question: "Is the cold room door shut and the temperature steady?", roomTypes: ["cold", "freezer", "dry"] },
  { id: "entrance", name: "Entrance & car park", question: "How busy is the front, and what is the weather doing to it?", roomTypes: [], exterior: true },
  { id: "back-door", name: "Back door & staff exit", question: "Is the back door opening when it should not?", roomTypes: ["staff", "corridor"], exterior: true },
];

export const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export interface ZoneCamera {
  id: string;
  zoneId: ZoneId;
  code: string;
  name: string;
  position: Vec3;
  target: Vec3;
  fov: number;
  roomIds: string[];
  exterior: boolean;
  /** Floor-plan door this camera watches (cold room, back door, entrance). */
  doorId?: string;
}

const EPS = 0.05;

function isExterior(plan: FloorPlan, d: Door) {
  const { width: W, length: L } = plan.dimensions;
  return (d.axis === "x" && (d.z < EPS || d.z > L - EPS)) || (d.axis === "z" && (d.x < EPS || d.x > W - EPS));
}

/** Inward unit normal of an exterior door. */
function inward(plan: FloorPlan, d: Door): [number, number] {
  const { width: W, length: L } = plan.dimensions;
  if (d.axis === "x") return [0, d.z < L / 2 ? 1 : -1];
  return [d.x < W / 2 ? 1 : -1, 0];
}

function onBoundary(r: Room, d: Door) {
  const t = 0.3;
  if (d.axis === "x") return d.x >= r.x - t && d.x <= r.x + r.w + t && (Math.abs(d.z - r.z) < t || Math.abs(d.z - (r.z + r.d)) < t);
  return d.z >= r.z - t && d.z <= r.z + r.d + t && (Math.abs(d.x - r.x) < t || Math.abs(d.x - (r.x + r.w)) < t);
}

/** Door of a room, preferring one that leads towards the kitchen side (where staff come from). */
export function roomDoor(plan: FloorPlan, room: Room): Door | undefined {
  return plan.doors.find((d) => onBoundary(room, d));
}

const clampIn = (r: Room, x: number, z: number, m = 0.3): [number, number] => [Math.min(r.x + r.w - m, Math.max(r.x + m, x)), Math.min(r.z + r.d - m, Math.max(r.z + m, z))];

/**
 * Mounting corner: the one furthest from the subject that is not blocked by tall equipment
 * within arm's reach (a camera jammed against a pass unit sees a steel wall).
 */
function cornerFurthest(r: Room, from: [number, number], plan?: FloorPlan): [number, number] {
  // Half a metre off each wall, so the lens never grazes the wall it is mounted on.
  const m = Math.min(0.55, r.w / 4, r.d / 4);
  const corners: Array<[number, number]> = [
    [r.x + m, r.z + m],
    [r.x + r.w - m, r.z + m],
    [r.x + m, r.z + r.d - m],
    [r.x + r.w - m, r.z + r.d - m],
  ];
  const tall = plan ? plan.equipment.filter((e) => e.roomId === r.id && e.position[1] + e.size[1] > 1.6 && e.type !== "hood") : [];
  const clear = (c: [number, number]) => tall.every((e) => Math.hypot(e.position[0] - c[0], e.position[2] - c[1]) > Math.max(e.size[0], e.size[2]) / 2 + 1.2);
  const ranked = [...corners].sort((a, b) => Math.hypot(b[0] - from[0], b[1] - from[1]) - Math.hypot(a[0] - from[0], a[1] - from[1]));
  return ranked.find(clear) ?? ranked[0];
}

export function zoneRooms(plan: FloorPlan, zoneId: ZoneId): Room[] {
  const def = ZONE_BY_ID.get(zoneId)!;
  if (zoneId === "dining") {
    const dining = plan.rooms.filter((r) => r.type === "dining");
    return dining.length ? dining : plan.rooms.filter((r) => r.type === "customer");
  }
  if (zoneId === "pass") {
    const ids = new Set(plan.equipment.filter((e) => e.type === "hot-holding" || e.type === "qc-pass").map((e) => e.roomId));
    return plan.rooms.filter((r) => ids.has(r.id));
  }
  return plan.rooms.filter((r) => def.roomTypes.includes(r.type));
}

/**
 * One fixed camera per zone, mounted where a real installer would put it: high in a
 * corner or on a wall, looking at the thing the owner asks about.
 */
export function deriveZoneCameras(plan: FloorPlan): ZoneCamera[] {
  const out: ZoneCamera[] = [];
  const H = plan.dimensions.height;
  const camH = Math.min(H - 0.3, 2.8);
  const n = () => `ZC-${String(out.length + 1).padStart(2, "0")}`;
  const push = (zoneId: ZoneId, position: [number, number, number], target: [number, number, number], fov: number, roomIds: string[], extra: Partial<ZoneCamera> = {}) => {
    const def = ZONE_BY_ID.get(zoneId)!;
    out.push({ id: `zone-${zoneId}`, zoneId, code: n(), name: def.name, position: position.map((v) => Math.round(v * 100) / 100) as Vec3, target: target.map((v) => Math.round(v * 100) / 100) as Vec3, fov, roomIds, exterior: !!def.exterior, ...extra });
  };
  const eq = (type: Equipment["type"]) => plan.equipment.filter((e) => e.type === type);
  const centre = (items: Equipment[]): [number, number] => [items.reduce((a, e) => a + e.position[0], 0) / items.length, items.reduce((a, e) => a + e.position[2], 0) / items.length];

  // Front counter: behind the tills, high, looking over the cashiers at the queue.
  const pos = eq("pos-counter");
  if (pos.length) {
    const [cx, cz] = centre(pos);
    const rot = pos[0].rotation;
    const nx = Math.sin(rot);
    const nz = Math.cos(rot);
    const room = plan.rooms.find((r) => r.id === pos[0].roomId);
    let px = cx - nx * 1.4;
    let pz = cz - nz * 1.4;
    if (room) [px, pz] = clampIn(room, px, pz);
    const q = plan.anchors.queueHead;
    push("front-counter", [px, camH, pz], [(q[0] + cx) / 2, 1.0, q[1] + plan.anchors.queueDir[1] * 1.2], 72, zoneRooms(plan, "front-counter").map((r) => r.id));
  }

  // Kitchen: corner of the fryer room furthest from the fryers, looking down the line.
  const fryers = eq("fryer");
  if (fryers.length) {
    const [cx, cz] = centre(fryers);
    const room = plan.rooms.find((r) => r.id === fryers[0].roomId)!;
    const [px, pz] = cornerFurthest(room, [cx, cz], plan);
    push("kitchen", [px, camH, pz], [cx, 0.9, cz], 68, zoneRooms(plan, "kitchen").map((r) => r.id));
  }

  // Pass: in front of the hot-holding / pass, where the packers stand, looking at the lamp.
  const pass = [...eq("hot-holding"), ...eq("qc-pass")];
  if (pass.length) {
    const anchor = eq("hot-holding")[0] ?? pass[0];
    const [cx, cz] = centre(pass.filter((e) => e.roomId === anchor.roomId));
    const rot = anchor.rotation;
    const room = plan.rooms.find((r) => r.id === anchor.roomId);
    let px = cx + Math.sin(rot) * 2.6 + Math.cos(rot) * 0.8;
    let pz = cz + Math.cos(rot) * 2.6 - Math.sin(rot) * 0.8;
    if (room) [px, pz] = clampIn(room, px, pz);
    push("pass", [px, camH, pz], [cx, 1.05, cz], 60, [...new Set(pass.map((e) => e.roomId))]);
  }

  // Dining: corner furthest from the entrance, wide lens.
  const dining = zoneRooms(plan, "dining");
  if (dining.length) {
    const r = dining.reduce((a, b) => (a.w * a.d > b.w * b.d ? a : b));
    const ent = plan.doors.find((d) => d.kind === "entrance") ?? plan.doors[0];
    const [px, pz] = cornerFurthest(r, [ent.x, ent.z], plan);
    push("dining", [px, camH, pz], [r.x + r.w / 2, 0.7, r.z + r.d / 2], 82, dining.map((x) => x.id));
  }

  // Pickup / rider bay: watches the dispatch rack and the riders' waiting spot.
  const dispatch = plan.rooms.filter((r) => r.type === "dispatch");
  if (dispatch.length) {
    const r = dispatch[0];
    const rack = eq("dispatch-rack")[0];
    const wait = plan.anchors.riderWait;
    const rider = plan.doors.find((d) => d.kind === "delivery");
    const [px, pz] = cornerFurthest(r, rider ? [rider.x, rider.z] : wait, plan);
    const tx = rack ? (rack.position[0] + wait[0]) / 2 : wait[0];
    const tz = rack ? (rack.position[2] + wait[1]) / 2 : wait[1];
    push("pickup-bay", [px, camH, pz], [tx, 0.9, tz], 76, dispatch.map((x) => x.id), { doorId: rider?.id });
  }

  // Cold room: inside, corner opposite the door, so the door and shelving are in frame.
  const cold = plan.rooms.filter((r) => r.type === "cold");
  if (cold.length) {
    const r = cold.reduce((a, b) => (a.w * a.d > b.w * b.d ? a : b));
    const door = roomDoor(plan, r);
    const from: [number, number] = door ? [door.x, door.z] : [r.x + r.w / 2, r.z];
    const [px, pz] = cornerFurthest(r, from);
    push("cold-room", [px, Math.min(H - 0.3, 2.6), pz], [from[0], 0.9, from[1]], 78, zoneRooms(plan, "cold-room").map((x) => x.id), { doorId: door?.id });
  }

  // Entrance & car park: on the facade above the door, looking out over the forecourt.
  const entrance = plan.doors.find((d) => d.kind === "entrance" && d.z < EPS) ?? plan.doors.find((d) => d.kind === "entrance");
  if (entrance) {
    const out0 = plan.anchors.outside;
    // Below the fascia and clear of the canopy, so the sign never blocks the picture.
    push("entrance", [entrance.x + 1.3, Math.min(H - 0.6, 2.9), -1.1], [out0[0] - 0.5, 0.3, out0[1] - 3], 74, [], { doorId: entrance.id });
  }

  // Back door: inside, a few metres from the staff / delivery / emergency exit, facing it.
  const back = plan.doors.filter((d) => isExterior(plan, d) && d.kind !== "entrance").sort((a, b) => rank(a) - rank(b))[0];
  if (back) {
    const [ix, iz] = inward(plan, back);
    const room = plan.rooms.find((r) => onBoundary(r, back)) ?? plan.rooms.find((r) => r.x <= back.x + ix * 0.5 && back.x + ix * 0.5 <= r.x + r.w && r.z <= back.z + iz * 0.5 && back.z + iz * 0.5 <= r.z + r.d);
    let px = back.x + ix * 2.6 - iz * 0.6;
    let pz = back.z + iz * 2.6 + ix * 0.6;
    if (room) [px, pz] = clampIn(room, px, pz);
    push("back-door", [px, camH, pz], [back.x, 1.0, back.z], 70, room ? [room.id] : [], { doorId: back.id });
  }
  return out;
}

const rank = (d: Door) => ({ staff: 0, delivery: 1, emergency: 2, internal: 3, entrance: 4 })[d.kind];

export function zoneForRoom(plan: FloorPlan, roomId: string | undefined): ZoneId | undefined {
  if (!roomId) return undefined;
  const r = plan.rooms.find((x) => x.id === roomId);
  if (!r) return undefined;
  for (const z of ["cold-room", "pickup-bay", "front-counter", "dining", "kitchen", "back-door"] as ZoneId[]) if (zoneRooms(plan, z).some((x) => x.id === r.id)) return z;
  return undefined;
}

export function zoneForEquipment(plan: FloorPlan, e: Equipment): ZoneId | undefined {
  if (e.type === "hot-holding" || e.type === "qc-pass") return "pass";
  if (e.type === "pos-counter" || e.type === "pickup-counter" || e.type === "drinks-fridge") return "front-counter";
  if (e.type === "dispatch-rack") return "pickup-bay";
  return zoneForRoom(plan, e.roomId);
}

/* ───────────── metrics ───────────── */

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit?: string;
  /** Formatted for display, e.g. "5:40" or "12 / 36". */
  display: string;
  tone: Level;
  primary?: boolean;
  /** One short line of context: what it is and how it was measured. */
  hint?: string;
  /** Lower is better (true) or higher is better (false); undefined = neither. */
  lowerIsBetter?: boolean;
}

export interface ZoneStatus {
  zoneId: ZoneId;
  level: Level;
  /** One sentence, plain language. */
  headline: string;
  metrics: Metric[];
  alerts: Alert[];
  people: Agent[];
}

const KITCHEN_STATUSES = new Set(["KITCHEN_QUEUE", "PREPARATION", "COOKING", "QUALITY_CHECK", "PACKAGING"]);
const worst = (levels: Level[]): Level => (levels.includes("act") ? "act" : levels.includes("watch") ? "watch" : "ok");
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const minutes = (sec: number) => (sec < 60 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`);
const tiered = (v: number, watch: number, act: number): Level => (v >= act ? "act" : v >= watch ? "watch" : "ok");

export function inRooms(plan: FloorPlan, rooms: Room[], p: [number, number]) {
  return rooms.some((r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.z && p[1] <= r.z + r.d);
}

/** People the zone camera sees. */
export function zonePeople(sim: BranchSimulation, zoneId: ZoneId): Agent[] {
  const plan = sim.plan;
  const live = sim.agents.filter((a) => !a.gone);
  if (zoneId === "entrance") return live.filter((a) => a.pos[1] < 0.6);
  if (zoneId === "back-door") {
    const cam = sim.zoneCameras.find((c) => c.zoneId === "back-door");
    const d = cam?.doorId ? plan.doors.find((x) => x.id === cam.doorId) : undefined;
    if (!d) return [];
    return live.filter((a) => Math.hypot(a.pos[0] - d.x, a.pos[1] - d.z) < 4);
  }
  const rooms = zoneRooms(plan, zoneId);
  return live.filter((a) => inRooms(plan, rooms, a.pos));
}

/** Staff whose home station is in the zone, with where they are now. */
export function zoneStaff(sim: BranchSimulation, zoneId: ZoneId) {
  const plan = sim.plan;
  const rooms = zoneRooms(plan, zoneId);
  const out: Array<{ agent: Agent; atPost: boolean; awaySec: number; onBreak: boolean }> = [];
  for (const a of sim.agents) {
    if (a.kind !== "staff" || a.gone) continue;
    const m = sim.staff.get(a.id);
    if (!m) continue;
    const home = plan.workstations.find((w) => w.type === m.homeWs);
    if (!home || !rooms.some((r) => r.id === home.roomId)) continue;
    const atPost = inRooms(plan, rooms, a.pos) && !a.breakUntil;
    out.push({ agent: a, atPost, awaySec: m.offPostSince !== undefined ? sim.t - m.offPostSince : 0, onBreak: !!a.breakUntil });
  }
  return out;
}

export function zoneAlerts(sim: BranchSimulation, zoneId: ZoneId) {
  return sim.alerts.filter((a) => a.status !== "resolved" && a.zoneId === zoneId);
}

export function zoneStatus(sim: BranchSimulation, zoneId: ZoneId): ZoneStatus {
  const plan = sim.plan;
  const t = sim.t;
  const metrics: Metric[] = [];
  const alerts = zoneAlerts(sim, zoneId);
  const people = zonePeople(sim, zoneId);
  let headline = "";
  const push = (m: Omit<Metric, "display"> & { display?: string }) => metrics.push({ display: m.value === null ? "—" : String(m.value), ...m });

  switch (zoneId) {
    case "front-counter": {
      const q = sim.queue.map((id) => sim.agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
      const longest = q.length ? Math.max(...q.map((a) => t - a.arrivedAt)) : 0;
      const staff = zoneStaff(sim, "front-counter").filter((s) => s.agent.role === "cashier");
      const at = staff.filter((s) => s.atPost).length;
      const serve = sim.serveTimes.slice(-10);
      const avgServe = serve.length ? serve.reduce((a, b) => a + b, 0) / serve.length : null;
      push({ key: "queue", label: "In queue", value: q.length, display: String(q.length), tone: tiered(q.length, 4, 7), primary: true, hint: "Customers between the door and the till right now", lowerIsBetter: true });
      push({ key: "frontWait", label: "Longest wait", value: Math.round(longest), unit: "s", display: mmss(longest), tone: tiered(longest, 180, 300), hint: "How long the customer who has waited longest has been in the queue", lowerIsBetter: true });
      push({ key: "tills", label: "Tills staffed", value: at, display: `${at} of ${staff.length}`, tone: staff.length && at === 0 ? "act" : at < staff.length && q.length >= 4 ? "watch" : "ok", hint: "Cashiers at their till (not on break or away)" });
      push({ key: "service", label: "Avg service", value: avgServe === null ? null : Math.round(avgServe), unit: "s", display: avgServe === null ? "—" : mmss(avgServe), tone: avgServe !== null && avgServe > 60 ? "watch" : "ok", hint: "Mean time to take the last 10 orders", lowerIsBetter: true });
      const dOpen = sim.till.drawerOpen;
      push({ key: "drawer", label: "Till drawer", value: dOpen ? 1 : 0, display: dOpen ? (sim.till.openNoSale ? `Open, no sale · ${minutes(t - sim.till.since)}` : "Open · sale") : "Closed", tone: dOpen && sim.till.openNoSale && t - sim.till.since > 45 ? "act" : dOpen && sim.till.openNoSale ? "watch" : "ok", hint: "Cash drawer state from the POS" });
      headline = q.length === 0 ? "No queue. Tills covered." : `${q.length} in queue, longest wait ${mmss(longest)}. ${at} of ${staff.length} tills staffed.`;
      break;
    }
    case "kitchen": {
      const inKitchen = [...sim.orders.values()].filter((o) => KITCHEN_STATUSES.has(o.status) && o.acceptedAt !== undefined);
      const oldest = inKitchen.length ? Math.max(...inKitchen.map((o) => t - o.acceptedAt!)) : 0;
      const oldestOrder = inKitchen.find((o) => t - o.acceptedAt! === oldest);
      const fryers = plan.equipment.filter((e) => e.type === "fryer");
      const busy = fryers.filter((e) => (sim.equipment.get(e.id)?.activeJobs ?? 0) > 0).length;
      const oils = fryers.map((e) => sim.equipment.get(e.id)?.oilQualityPct).filter((v): v is number => v !== undefined);
      const oilMin = oils.length ? Math.min(...oils) : null;
      const cooks = zoneStaff(sim, "kitchen");
      const at = cooks.filter((c) => c.atPost).length;
      push({ key: "tickets", label: "Orders in kitchen", value: inKitchen.length, display: String(inKitchen.length), tone: tiered(inKitchen.length, Math.round(8 * scale(plan)), Math.round(13 * scale(plan))), primary: true, hint: "Accepted orders not yet ready", lowerIsBetter: true });
      push({ key: "oldest", label: "Oldest order", value: Math.round(oldest / 60), unit: "min", display: oldest ? `${minutes(oldest)}${oldestOrder ? ` · #${oldestOrder.number}` : ""}` : "—", tone: tiered(oldest, 8 * 60, 12 * 60), hint: "Time since the longest-running order was accepted", lowerIsBetter: true });
      push({ key: "fryers", label: "Fryers busy", value: busy, display: `${busy} of ${fryers.length}`, tone: "ok", hint: "Fryer wells with a basket down" });
      const lim = sim.safety.oilQualityMinPct;
      push({ key: "oil", label: "Fryer oil", value: oilMin === null ? null : Math.round(oilMin), unit: "%", display: oilMin === null ? "—" : `${Math.round(oilMin)}%`, tone: oilMin === null ? "ok" : oilMin < lim ? "act" : oilMin < lim + 10 ? "watch" : "ok", hint: `Lowest oil quality across fryers · change below ${lim}%` });
      push({ key: "cooks", label: "Cooks at post", value: at, display: `${at} of ${cooks.length}`, tone: cooks.length && at < cooks.length - 1 ? "watch" : "ok", hint: "Kitchen staff at their stations" });
      headline = inKitchen.length ? `${inKitchen.length} orders in the kitchen, oldest ${minutes(oldest)}.` : "Kitchen clear.";
      break;
    }
    case "pass": {
      const ready = [...sim.orders.values()].filter((o) => o.status === "READY" && o.readyAt !== undefined);
      const longest = ready.length ? Math.max(...ready.map((o) => t - o.readyAt!)) : 0;
      const temps = plan.sensors.filter((s) => s.kind === "hot-holding-temp").map((s) => sim.sensors.get(s.id)?.value).filter((v): v is number => v !== null && v !== undefined);
      const hold = temps.length ? Math.min(...temps) : null;
      const checks = sim.cookChecks.slice(-20);
      const pass = checks.length ? checks.filter((c) => c.pass).length / checks.length : null;
      const held = sim.chickenStock.wing + sim.chickenStock.drum;
      const target = sim.chickenTarget.wing + sim.chickenTarget.drum;
      push({ key: "underLamp", label: "Orders waiting", value: ready.length, display: String(ready.length), tone: tiered(ready.length, 4, 7), primary: true, hint: "Packed orders at the pass not yet collected", lowerIsBetter: true });
      push({ key: "lampTime", label: "Longest under lamp", value: Math.round(longest), unit: "s", display: ready.length ? mmss(longest) : "—", tone: tiered(longest, 5 * 60, 10 * 60), hint: "Time the oldest packed order has waited for collection", lowerIsBetter: true });
      const min = sim.safety.hotHoldingMinC;
      push({ key: "holdTemp", label: "Hot holding", value: hold, unit: "°C", display: hold === null ? "—" : `${hold.toFixed(1)} °C`, tone: hold === null ? "ok" : hold < min ? "act" : hold < min + 3 ? "watch" : "ok", hint: `Lowest hot-holding cabinet · must stay ≥ ${min} °C` });
      push({ key: "qc", label: "Cook checks passed", value: pass === null ? null : Math.round(pass * 100), unit: "%", display: pass === null ? "—" : `${Math.round(pass * 100)}%`, tone: pass !== null && pass < 0.9 ? "watch" : "ok", hint: "Last 20 core-temperature checks" });
      push({ key: "held", label: "Chicken held", value: held, display: `${held} pcs`, tone: held < target * 0.4 ? "watch" : "ok", hint: `Pieces in hot holding · target ${target}` });
      headline = ready.length ? `${ready.length} orders at the pass, longest ${mmss(longest)}.` : "Pass clear, nothing waiting.";
      break;
    }
    case "dining": {
      const rooms = zoneRooms(plan, "dining");
      const seated = sim.agents.filter((a) => !a.gone && a.kind === "customer" && a.phase === "sitting").length;
      const waiting = sim.agents.filter((a) => !a.gone && a.kind === "customer" && a.phase === "waiting").length;
      const spills = sim.spills.filter((s) => !s.cleanedAt && rooms.some((r) => r.id === s.roomId));
      const oldestSpill = spills.length ? Math.max(...spills.map((s) => t - s.since)) : 0;
      const rec = sim.cleaning.find((c) => rooms.some((r) => r.id === c.roomId));
      const due = rec ? rec.dueAt - t : null;
      push({ key: "occupancy", label: "Seats taken", value: seated, display: `${seated} / ${sim.seats.length}`, tone: "ok", primary: true, hint: "Customers seated now" });
      push({ key: "waiting", label: "Waiting for food", value: waiting, display: String(waiting), tone: tiered(waiting, 6, 10), hint: "Customers who have ordered and are waiting in the hall", lowerIsBetter: true });
      push({ key: "spills", label: "Spills", value: spills.length, display: spills.length ? `${spills.length} · ${minutes(oldestSpill)}` : "None", tone: spills.length ? (oldestSpill > 4 * 60 ? "act" : "watch") : "ok", hint: "Reported spills not yet cleaned", lowerIsBetter: true });
      push({ key: "cleaning", label: "Next clean", value: due === null ? null : Math.round(due / 60), unit: "min", display: due === null ? "—" : due < 0 ? `Overdue ${minutes(-due)}` : `in ${minutes(due)}`, tone: due === null ? "ok" : due < 0 ? "watch" : "ok", hint: "Cleaning checklist schedule for this area" });
      headline = spills.length ? `Spill on the floor for ${minutes(oldestSpill)}.` : `${seated} seated, ${waiting} waiting for food.`;
      break;
    }
    case "pickup-bay": {
      const riders = sim.agents.filter((a) => !a.gone && a.kind === "rider" && (a.phase === "waiting" || a.phase === "to-wait"));
      const longest = riders.length ? Math.max(...riders.map((a) => t - a.arrivedAt)) : 0;
      const awaitingRider = [...sim.orders.values()].filter((o) => o.fulfilment === "delivery" && o.status === "READY" && !sim.agents.some((a) => a.id === o.riderId && !a.gone && (a.phase === "to-rack" || a.phase === "collect")));
      const hand = sim.handoverTimes.slice(-10);
      const avgHand = hand.length ? hand.reduce((a, b) => a + b, 0) / hand.length : null;
      push({ key: "riders", label: "Riders waiting", value: riders.length, display: String(riders.length), tone: tiered(riders.length, 3, 5), primary: true, hint: "Riders at the bay without a bag in hand", lowerIsBetter: true });
      push({ key: "riderWait", label: "Longest rider wait", value: Math.round(longest), unit: "s", display: riders.length ? mmss(longest) : "—", tone: tiered(longest, 5 * 60, 8 * 60), hint: "Time the longest-waiting rider has been here", lowerIsBetter: true });
      push({ key: "ordersWaiting", label: "Orders waiting for riders", value: awaitingRider.length, display: String(awaitingRider.length), tone: tiered(awaitingRider.length, 2, 4), hint: "Packed delivery orders with no rider collecting", lowerIsBetter: true });
      push({ key: "handover", label: "Avg hand-over", value: avgHand === null ? null : Math.round(avgHand), unit: "s", display: avgHand === null ? "—" : mmss(avgHand), tone: avgHand !== null && avgHand > 180 ? "watch" : "ok", hint: "Ready → collected, last 10 deliveries", lowerIsBetter: true });
      headline = riders.length ? `${riders.length} riders waiting, longest ${mmss(longest)}.` : awaitingRider.length ? `${awaitingRider.length} orders waiting for a rider.` : "Bay clear.";
      break;
    }
    case "cold-room": {
      const cam = sim.zoneCameras.find((c) => c.zoneId === "cold-room");
      const door = cam?.doorId ? sim.doors.get(cam.doorId) : undefined;
      const sensor = plan.sensors.find((s) => s.kind === "fridge-temp" && plan.equipment.find((e) => e.id === s.equipmentId)?.type === "walk-in-cold") ?? plan.sensors.find((s) => s.kind === "fridge-temp" && zoneRooms(plan, "cold-room").some((r) => r.id === s.roomId));
      const st = sensor ? sim.sensors.get(sensor.id) : undefined;
      const temp = st?.value ?? null;
      const limit = sim.safety.chilledMaxC;
      const openFor = door?.open ? t - door.since : 0;
      const opens = door ? door.opens : 0;
      const low = sim.inventory.filter((i) => (i.storage === "chilled" || i.storage === "frozen") && i.status !== "OK").length;
      push({ key: "temp", label: "Cold room", value: temp, unit: "°C", display: temp === null ? "Sensor offline" : `${temp.toFixed(1)} °C`, tone: temp === null ? "watch" : temp > limit ? "act" : temp > limit - 1 ? "watch" : "ok", primary: true, hint: `Air temperature · must stay ≤ ${limit} °C` });
      push({ key: "door", label: "Door", value: door?.open ? Math.round(openFor) : 0, unit: "s", display: door ? (door.open ? `Open · ${minutes(openFor)}` : "Closed") : "—", tone: door?.open ? (openFor > 90 ? "act" : openFor > 30 ? "watch" : "ok") : "ok", hint: "Door contact state and how long it has been open", lowerIsBetter: true });
      push({ key: "opens", label: "Openings today", value: opens, display: String(opens), tone: "ok", hint: "Door openings since the start of the day" });
      push({ key: "stockLow", label: "Stock lines low", value: low, display: String(low), tone: low ? "watch" : "ok", hint: "Chilled and frozen items below reorder level", lowerIsBetter: true });
      headline = door?.open && openFor > 60 ? `Door open for ${minutes(openFor)}${temp !== null ? `, ${temp.toFixed(1)} °C` : ""}.` : temp === null ? "Temperature sensor offline." : `${temp.toFixed(1)} °C, door ${door?.open ? "open" : "closed"}.`;
      break;
    }
    case "entrance": {
      const hour = sim.arrivalLog.filter((x) => t - x <= 3600).length;
      const ten = sim.arrivalLog.filter((x) => t - x <= 600).length;
      const lost = sim.walkoutLog.filter((x) => t - x <= 3600).length;
      const w = sim.weather();
      const door = sim.zoneCameras.find((c) => c.zoneId === "entrance")?.doorId;
      const ds = door ? sim.doors.get(door) : undefined;
      push({ key: "footfall", label: "Walk-ins last hour", value: hour, display: String(hour), tone: "ok", primary: true, hint: "Customers who came through the front door in the last 60 min" });
      push({ key: "arrivals10", label: "Last 10 min", value: ten, display: String(ten), tone: "ok", hint: "Arrivals in the last ten minutes" });
      push({ key: "walkouts", label: "Walked away", value: lost, display: String(lost), tone: lost >= 3 ? "act" : lost ? "watch" : "ok", hint: "Customers who left because the queue was too long (last hour)", lowerIsBetter: true });
      push({ key: "weather", label: "Weather", value: Math.round(w.intensity * 100), unit: "%", display: w.label + (w.changesInMin !== undefined ? ` · ${w.rain ? "clears" : "rain"} in ${w.changesInMin} min` : ""), tone: "ok", hint: "Rain moves walk-ins to delivery" });
      push({ key: "doorActivity", label: "Door openings", value: ds?.opens ?? 0, display: String(ds?.opens ?? 0), tone: "ok", hint: "Front door openings today" });
      headline = `${hour} walk-ins in the last hour · ${w.label.toLowerCase()}${lost ? ` · ${lost} walked away` : ""}.`;
      break;
    }
    case "back-door": {
      const cam = sim.zoneCameras.find((c) => c.zoneId === "back-door");
      const door = cam?.doorId ? sim.doors.get(cam.doorId) : undefined;
      const openFor = door?.open ? t - door.since : 0;
      const afterHours = !sim.isOpen();
      const d = cam?.doorId ? plan.doors.find((x) => x.id === cam.doorId) : undefined;
      const outside = d ? sim.agents.filter((a) => !a.gone && a.kind === "staff" && !inRooms(plan, plan.rooms, a.pos) && Math.hypot(a.pos[0] - d.x, a.pos[1] - d.z) < 5).length : 0;
      const lastOpen = door?.lastOpenedAt !== undefined ? t - door.lastOpenedAt : null;
      push({ key: "door", label: "Back door", value: door?.open ? 1 : 0, display: door ? (door.open ? `Open · ${minutes(openFor)}` : "Closed") : "—", tone: door?.open ? (afterHours ? "act" : openFor > 120 ? "watch" : "ok") : "ok", primary: true, hint: afterHours ? "Branch is closed: any opening needs a reason" : "Door contact state" });
      push({ key: "afterHours", label: "After-hours openings", value: door?.afterHoursOpens ?? 0, display: String(door?.afterHoursOpens ?? 0), tone: (door?.afterHoursOpens ?? 0) > 0 ? "act" : "ok", hint: "Openings while the branch was closed, today", lowerIsBetter: true });
      push({ key: "lastOpen", label: "Last opened", value: lastOpen === null ? null : Math.round(lastOpen / 60), unit: "min", display: lastOpen === null ? "Not today" : `${minutes(lastOpen)} ago`, tone: "ok", hint: "Time since the door last opened" });
      push({ key: "outside", label: "Staff outside", value: outside, display: String(outside), tone: outside > 1 ? "watch" : "ok", hint: "Staff within a few metres outside the back door" });
      push({ key: "opens", label: "Openings today", value: door?.opens ?? 0, display: String(door?.opens ?? 0), tone: "ok", hint: "All openings since the start of the day" });
      headline = door?.open ? `Back door open for ${minutes(openFor)}${afterHours ? " after hours" : ""}.` : `Back door closed${lastOpen !== null ? `, last opened ${minutes(lastOpen)} ago` : ""}.`;
      break;
    }
  }
  const alertLevel: Level = alerts.some((a) => a.severity === "critical" || a.escalation >= 1) ? "act" : alerts.length ? "watch" : "ok";
  const level = worst([...metrics.map((m) => m.tone), alertLevel]);
  return { zoneId, level, headline, metrics, alerts, people };
}

/** Branch size factor for thresholds (Model C runs about twice Model A's volume). */
function scale(plan: FloorPlan) {
  return plan.format === "C" ? 1.6 : plan.format === "A" ? 0.7 : 1;
}

/** Everything the history frame keeps for every zone at one instant. */
export function zoneSnapshots(sim: BranchSimulation): HistoryFrame["zones"] {
  const out: HistoryFrame["zones"] = {};
  for (const cam of sim.zoneCameras) {
    const z = zoneStatus(sim, cam.zoneId);
    const metrics: Record<string, number | null> = {};
    for (const m of z.metrics) metrics[m.key] = m.value;
    out[cam.zoneId] = { level: z.level, primary: z.metrics.find((m) => m.primary)?.value ?? null, metrics };
  }
  return out;
}

export const LEVEL_LABEL: Record<Level, string> = { ok: "Running right", watch: "Watch", act: "Act now" };
