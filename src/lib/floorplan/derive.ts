import { EQUIPMENT_CATALOG } from "./catalog";
import type {
  Equipment,
  FloorPlan,
  NavigationPath,
  Room,
  Sensor,
  SensorKind,
  Vec2,
  Vec3,
  VirtualCamera,
  Wall,
  Workstation,
} from "./types";

const CELL = 0.05;
const WALL_T = 0.15;
const EXT_WALL_T = 0.25;

/** Footprint half-extents after Y rotation (only right-angle rotations are snapped). */
export function footprint(size: Vec3, rotation: number): { hw: number; hd: number } {
  const quarter = Math.round(rotation / (Math.PI / 2)) % 2 !== 0;
  return quarter ? { hw: size[2] / 2, hd: size[0] / 2 } : { hw: size[0] / 2, hd: size[2] / 2 };
}

/** Point 0.55 m in front of an object's front face (where a person stands to use it). */
export function frontPoint(position: Vec3, size: Vec3, rotation: number, gap = 0.55): Vec2 {
  const dist = size[2] / 2 + gap;
  return [round(position[0] + Math.sin(rotation) * dist), round(position[2] + Math.cos(rotation) * dist)];
}

function round(n: number, p = 100) {
  return Math.round(n * p) / p;
}

function roomsOpen(a: Room, b: Room, open: Set<string>) {
  return open.has(`${a.id}|${b.id}`) || open.has(`${b.id}|${a.id}`);
}

/**
 * Derive wall segments from room rectangles.
 * Each room edge is sampled in 5 cm cells. A cell becomes wall unless it lies
 * between two rooms declared open to each other, or inside a door opening.
 * Window spans produce a sill segment and a head segment instead of a full wall.
 */
export function deriveWalls(plan: Pick<FloorPlan, "rooms" | "doors" | "windows" | "dimensions" | "openings">): Wall[] {
  const { rooms, doors, windows, dimensions } = plan;
  const open = new Set(plan.openings.map(([a, b]) => `${a}|${b}`));
  const H = dimensions.height;
  // key: "x@12.35" (line parallel to x axis at z=12.35) -> cell index -> rooms touching
  const lines = new Map<string, Map<number, Room[]>>();
  const add = (key: string, from: number, to: number, room: Room) => {
    let m = lines.get(key);
    if (!m) lines.set(key, (m = new Map()));
    for (let i = Math.round(from / CELL); i < Math.round(to / CELL); i++) {
      const arr = m.get(i) ?? [];
      arr.push(room);
      m.set(i, arr);
    }
  };
  for (const r of rooms) {
    add(`x@${round(r.z)}`, r.x, r.x + r.w, r);
    add(`x@${round(r.z + r.d)}`, r.x, r.x + r.w, r);
    add(`z@${round(r.x)}`, r.z, r.z + r.d, r);
    add(`z@${round(r.x + r.w)}`, r.z, r.z + r.d, r);
  }

  const walls: Wall[] = [];
  let n = 0;
  for (const [key, cells] of lines) {
    const axis = key[0] as "x" | "z";
    const c = parseFloat(key.slice(2));
    const exteriorLine =
      axis === "x" ? Math.abs(c) < 1e-6 || Math.abs(c - dimensions.length) < 1e-6 : Math.abs(c) < 1e-6 || Math.abs(c - dimensions.width) < 1e-6;
    // classify each cell: 0 none, 1 solid, 2 window
    const kinds = new Map<number, number>();
    for (const [i, rs] of cells) {
      const unique = [...new Map(rs.map((r) => [r.id, r])).values()];
      if (unique.length === 2 && roomsOpen(unique[0], unique[1], open)) continue;
      const t = (i + 0.5) * CELL;
      const inDoor = doors.some((d) => d.axis === axis && Math.abs((axis === "x" ? d.z : d.x) - c) < 0.02 && Math.abs((axis === "x" ? d.x : d.z) - t) < d.width / 2);
      if (inDoor) continue;
      const inWin = windows.some((w) => w.axis === axis && Math.abs((axis === "x" ? w.z : w.x) - c) < 0.02 && Math.abs((axis === "x" ? w.x : w.z) - t) < w.width / 2);
      kinds.set(i, inWin ? 2 : 1);
    }
    const idx = [...kinds.keys()].sort((a, b) => a - b);
    let start = -1;
    let prev = -1;
    let kind = 0;
    const flush = () => {
      if (start < 0) return;
      const a = start * CELL;
      const b = (prev + 1) * CELL;
      const pa: Vec2 = axis === "x" ? [round(a), c] : [c, round(a)];
      const pb: Vec2 = axis === "x" ? [round(b), c] : [c, round(b)];
      const thickness = exteriorLine ? EXT_WALL_T : WALL_T;
      if (kind === 1) {
        walls.push({ id: `wall-${++n}`, a: pa, b: pb, thickness, height: H, exterior: exteriorLine });
      } else {
        const w = windows.find((w) => w.axis === axis && Math.abs((axis === "x" ? w.x : w.z) - (a + b) / 2) < w.width / 2 + 0.05);
        const sill = w?.sill ?? 0.9;
        const head = Math.min(H, sill + (w?.height ?? 1.2));
        walls.push({ id: `wall-${++n}`, a: pa, b: pb, thickness, height: sill, exterior: exteriorLine });
        if (head < H) walls.push({ id: `wall-${++n}`, a: pa, b: pb, thickness, height: H - head, base: head, exterior: exteriorLine });
      }
    };
    for (const i of idx) {
      const k = kinds.get(i)!;
      if (start >= 0 && (i !== prev + 1 || k !== kind)) {
        flush();
        start = -1;
      }
      if (start < 0) {
        start = i;
        kind = k;
      }
      prev = i;
    }
    flush();
  }
  return walls;
}

/** Wall segments may carry a `base` elevation (window heads); default is floor level. */
export function wallBase(w: Wall): number {
  return w.base ?? 0;
}

export function roomAt(rooms: Room[], x: number, z: number): Room | undefined {
  return rooms.find((r) => x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6 && z >= r.z - 1e-6 && z <= r.z + r.d + 1e-6);
}

export function fillWorkstationStandPoints(plan: FloorPlan): void {
  const byId = new Map(plan.equipment.map((e) => [e.id, e]));
  for (const ws of plan.workstations) {
    const e = byId.get(ws.equipmentIds[0]);
    if (e) ws.standPoint = frontPoint(e.position, e.size, e.rotation);
  }
}

const CAMERA_ORDER: Array<{ match: (ws: Workstation) => boolean; name: string }> = [
  { match: (w) => w.type === "order-counter", name: "Customer Counter" },
  { match: (w) => w.type === "pizza-prep", name: "Pizza Preparation" },
  { match: (w) => w.type === "oven", name: "Pizza Oven" },
  { match: (w) => w.type === "chicken-prep", name: "Chicken Preparation" },
  { match: (w) => w.type === "fryer", name: "Frying Station" },
  { match: (w) => w.type === "rice", name: "Rice Preparation" },
  { match: (w) => w.type === "packaging", name: "Packaging Station" },
  { match: (w) => w.type === "dispatch", name: "Delivery Dispatch" },
];

/**
 * Generate the virtual camera network from floor plan data:
 * an exterior entrance view, room-corner cameras for public areas and
 * storage, and one camera per key workstation looking at its equipment.
 */
export function deriveCameras(plan: FloorPlan): VirtualCamera[] {
  const cams: VirtualCamera[] = [];
  const H = plan.dimensions.height;
  const camH = Math.min(H - 0.35, 2.85);
  const push = (name: string, roomId: string, position: Vec3, target: Vec3, workstationIds: string[] = [], fov = 62) => {
    const code = `CAM-${String(cams.length + 1).padStart(3, "0")}`;
    cams.push({ id: `cam-${cams.length + 1}`, code, name, roomId, position: position.map((v) => round(v)) as Vec3, target: target.map((v) => round(v)) as Vec3, fov, workstationIds });
  };
  const entrance = plan.doors.find((d) => d.kind === "entrance");
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  if (entrance) {
    const inside = roomAt(plan.rooms, entrance.x, entrance.z + 0.3);
    push("Restaurant Entrance", inside?.id ?? plan.rooms[0].id, [entrance.x + 1.2, camH, entrance.z + 0.4], [entrance.x - 0.4, 1.0, entrance.z - 1.8]);
  }
  const corner = (r: Room, name: string, wsIds: string[] = []) => {
    // Mount in the corner furthest from the entrance-side, looking at the room centre.
    const cx = r.x + r.w / 2;
    const cz = r.z + r.d / 2;
    const px = r.x + (cx < plan.dimensions.width / 2 ? r.w - 0.3 : 0.3);
    const pz = r.z + r.d - 0.3;
    push(name, r.id, [px, camH, pz], [cx, 0.6, cz], wsIds, 70);
  };
  const customer = plan.rooms.find((r) => r.type === "customer");
  if (customer) {
    push("Customer Waiting Area", customer.id, [customer.x + 0.3, camH, customer.z + 0.3], [customer.x + customer.w * 0.6, 0.8, customer.z + customer.d * 0.7], [], 72);
  }
  const dining = plan.rooms.find((r) => r.type === "dining");
  if (dining) push("Dining Area", dining.id, [dining.x + 0.3, camH, dining.z + 0.3], [dining.x + dining.w * 0.6, 0.6, dining.z + dining.d * 0.6], [], 75);

  const byId = new Map(plan.equipment.map((e) => [e.id, e]));
  for (const rule of CAMERA_ORDER) {
    const wss = plan.workstations.filter(rule.match);
    wss.forEach((ws, i) => {
      const e = byId.get(ws.equipmentIds[0]);
      if (!e) return;
      const room = rooms.get(ws.roomId);
      // Camera sits behind and above the operator, offset sideways, looking at the equipment.
      const [sx, sz] = frontPoint(e.position, e.size, e.rotation, 1.6);
      const side = 0.9;
      let px = sx + Math.cos(e.rotation) * side;
      let pz = sz - Math.sin(e.rotation) * side;
      if (room) {
        px = Math.min(room.x + room.w - 0.25, Math.max(room.x + 0.25, px));
        pz = Math.min(room.z + room.d - 0.25, Math.max(room.z + 0.25, pz));
      }
      const name = wss.length > 1 ? `${rule.name} ${i + 1}` : rule.name;
      push(name, ws.roomId, [px, camH, pz], [e.position[0], 0.95, e.position[2]], [ws.id], 60);
    });
  }
  const kitchen = plan.rooms.find((r) => r.type === "kitchen") ?? plan.rooms.find((r) => r.type === "pizza");
  if (kitchen) corner(kitchen, "Main Kitchen", plan.workstations.filter((w) => w.roomId === kitchen.id).map((w) => w.id));
  for (const r of plan.rooms.filter((r) => r.type === "dry")) corner(r, "Inventory Storage");
  for (const r of plan.rooms.filter((r) => r.type === "cold" || r.type === "freezer")) corner(r, r.type === "cold" ? "Cold Storage" : "Freezer Room");
  const raw = plan.rooms.find((r) => r.type === "chicken" && r.hygieneZone === "raw");
  if (raw && !cams.some((c) => c.roomId === raw.id)) corner(raw, "Raw Chicken Prep");
  return cams;
}

const SENSOR_RULES: Array<{ types: Equipment["type"][]; kind: SensorKind; unit: Sensor["unit"]; profile?: string; label: string }> = [
  { types: ["fridge", "walk-in-cold", "pizza-makeline", "drinks-fridge"], kind: "fridge-temp", unit: "°C", profile: "chilled", label: "Chilled Temp" },
  { types: ["freezer", "walk-in-freezer"], kind: "freezer-temp", unit: "°C", profile: "frozen", label: "Frozen Temp" },
  { types: ["hot-holding", "rice-warmer", "qc-pass"], kind: "hot-holding-temp", unit: "°C", profile: "hotHolding", label: "Hot-Holding Temp" },
  { types: ["fryer"], kind: "oil-quality", unit: "%", profile: "oilQuality", label: "Oil Quality" },
  { types: ["conveyor-oven", "deck-oven", "dishwasher", "hood"], kind: "equipment-health", unit: "status", label: "Equipment Health" },
  { types: ["handwash"], kind: "handwash-compliance", unit: "status", label: "Handwash Station" },
  { types: ["shelving"], kind: "storage-inspection", unit: "status", label: "Storage Inspection" },
];

/** Generate conceptual food-safety monitoring points from equipment and workstations. */
export function deriveSensors(plan: FloorPlan): Sensor[] {
  const sensors: Sensor[] = [];
  const add = (s: Omit<Sensor, "id" | "code">) => {
    const k = sensors.length + 1;
    sensors.push({ id: `sensor-${k}`, code: `SNS-${String(k).padStart(3, "0")}`, ...s });
  };
  const inspectedRooms = new Set<string>();
  for (const e of plan.equipment) {
    const rule = SENSOR_RULES.find((r) => r.types.includes(e.type));
    if (!rule) continue;
    if (rule.kind === "storage-inspection") {
      if (inspectedRooms.has(e.roomId)) continue;
      inspectedRooms.add(e.roomId);
    }
    add({
      name: `${e.name} — ${rule.label}`,
      kind: rule.kind,
      roomId: e.roomId,
      equipmentId: e.id,
      position: [e.position[0], e.position[1] + e.size[1] + 0.15, e.position[2]],
      unit: rule.unit,
      thresholdProfile: rule.profile,
    });
  }
  for (const ws of plan.workstations.filter((w) => w.type === "qc")) {
    add({ name: `${ws.name} — Cook Temp Verification`, kind: "cook-temp-check", roomId: ws.roomId, position: [ws.standPoint[0], 1.4, ws.standPoint[1]], unit: "°C", thresholdProfile: "cookCore" });
  }
  for (const r of plan.rooms.filter((r) => ["kitchen", "pizza", "chicken", "rice", "packaging", "wash"].includes(r.type))) {
    add({ name: `${r.name} — Cleaning Checklist`, kind: "cleaning-checklist", roomId: r.id, position: [r.x + 0.3, 1.5, r.z + 0.3], unit: "status" });
  }
  return sensors;
}

/** Reference paths for the 2D plan; agents path-find on the occupancy grid at runtime. */
export function deriveNavigationPaths(plan: FloorPlan): NavigationPath[] {
  const a = plan.anchors;
  const ws = (t: Workstation["type"]) => plan.workstations.find((w) => w.type === t)?.standPoint;
  const paths: NavigationPath[] = [
    { id: "path-customer", name: "Walk-in customer journey", kind: "customer", points: [a.outside, a.entrance, a.queueHead, a.waiting, a.pickup, a.entrance, a.outside] },
    { id: "path-rider", name: "Delivery rider collection", kind: "delivery", points: [[a.riderDoor[0], a.riderDoor[1] - 2], a.riderDoor, a.riderWait] },
  ];
  const pizza = [ws("pizza-prep"), ws("oven"), ws("qc"), ws("packaging")].filter(Boolean) as Vec2[];
  if (pizza.length > 1) paths.push({ id: "path-pizza", name: "Pizza product flow", kind: "staff", points: pizza });
  const chicken = [ws("chicken-prep"), ws("fryer"), ws("qc"), ws("packaging")].filter(Boolean) as Vec2[];
  if (chicken.length > 1) paths.push({ id: "path-chicken", name: "Chicken product flow", kind: "staff", points: chicken });
  const rice = [ws("rice"), ws("packaging"), ws("dispatch")].filter(Boolean) as Vec2[];
  if (rice.length > 1) paths.push({ id: "path-rice", name: "Rice product flow", kind: "staff", points: rice });
  for (const d of plan.doors.filter((d) => d.kind === "emergency" || d.kind === "entrance")) {
    const inside = d.axis === "x" ? (d.z < 1 ? [d.x, d.z + 1.2] : [d.x, d.z - 1.2]) : d.x < 1 ? [d.x + 1.2, d.z] : [d.x - 1.2, d.z];
    const outside = d.axis === "x" ? (d.z < 1 ? [d.x, d.z - 1.5] : [d.x, d.z + 1.5]) : d.x < 1 ? [d.x - 1.5, d.z] : [d.x + 1.5, d.z];
    paths.push({ id: `path-exit-${d.id}`, name: `Exit route — ${d.name}`, kind: "emergency", points: [inside as Vec2, [d.x, d.z], outside as Vec2] });
  }
  return paths;
}

/** Re-derive every computed layer after the rooms or equipment change. */
export function rebuildDerived(plan: FloorPlan): FloorPlan {
  plan.walls = deriveWalls(plan);
  fillWorkstationStandPoints(plan);
  plan.cameras = deriveCameras(plan);
  plan.sensors = deriveSensors(plan);
  plan.navigationPaths = deriveNavigationPaths(plan);
  return plan;
}

export function equipmentLabel(type: Equipment["type"]) {
  return EQUIPMENT_CATALOG[type].label;
}
