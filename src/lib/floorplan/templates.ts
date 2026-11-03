import { EQUIPMENT_CATALOG, FURNITURE_CATALOG } from "./catalog";
import { rebuildDerived } from "./derive";
import type {
  Door,
  Equipment,
  EquipmentType,
  FloorPlan,
  FloorPlanFormat,
  Furniture,
  FurnitureType,
  Room,
  Vec2,
  WindowOpening,
  Workstation,
  WorkstationType,
} from "./types";

const PI = Math.PI;
/** Rotation shorthands: the direction the equipment's front faces. */
const N = 0;
const S = PI;
const E = PI / 2;
const W = -PI / 2;

const PROVENANCE =
  "Conceptual layout generated from commercial quick-service kitchen design principles and publicly observable brand characteristics. " +
  "Not a surveyed or official Pizzaman Chickenman floor plan. Must be reviewed by a qualified architect and food-safety professional before any real-world use.";

class PlanBuilder {
  rooms: Room[] = [];
  openings: Array<[string, string]> = [];
  doors: Door[] = [];
  windows: WindowOpening[] = [];
  equipment: Equipment[] = [];
  furniture: Furniture[] = [];
  workstations: Workstation[] = [];
  private counts = new Map<string, number>();

  private next(prefix: string) {
    const n = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, n);
    return `${prefix}-${n}`;
  }

  room(id: string, name: string, type: Room["type"], hygieneZone: Room["hygieneZone"], x: number, z: number, w: number, d: number) {
    this.rooms.push({ id, name, type, hygieneZone, x, z, w, d });
    return id;
  }

  open(...pairs: Array<[string, string]>) {
    this.openings.push(...pairs);
  }

  door(name: string, x: number, z: number, width: number, axis: Door["axis"], kind: Door["kind"] = "internal") {
    this.doors.push({ id: this.next("door"), name, x, z, width, axis, kind });
  }

  win(x: number, z: number, width: number, axis: WindowOpening["axis"], sill = 0.45, height = 2.1) {
    this.windows.push({ id: this.next("win"), x, z, width, axis, sill, height });
  }

  eq(type: EquipmentType, roomId: string, x: number, z: number, rotation: number, opts: { name?: string; width?: number } = {}) {
    const spec = EQUIPMENT_CATALOG[type];
    const id = this.next(type);
    const size: Equipment["size"] = [opts.width ?? spec.size[0], spec.size[1], spec.size[2]];
    const n = this.equipment.filter((e) => e.type === type).length + 1;
    this.equipment.push({
      id,
      type,
      name: opts.name ?? `${spec.label} ${String(n).padStart(2, "0")}`,
      category: spec.category,
      roomId,
      position: [x, spec.elevation ?? 0, z],
      rotation,
      size,
      operational: {
        powered: true,
        setpointC: spec.setpointC,
        capacity: spec.capacity,
        maintenanceIntervalDays: spec.maintenanceIntervalDays,
      },
      interaction: { inspect: spec.inspect, focusDistance: Math.max(2.2, size[0] * 1.6) },
    });
    return id;
  }

  furn(type: FurnitureType, roomId: string, x: number, z: number, rotation = 0) {
    const spec = FURNITURE_CATALOG[type];
    this.furniture.push({ id: this.next(type), type, roomId, position: [x, 0, z], rotation, size: [...spec.size], seats: spec.seats });
  }

  /** Lay out a grid of tables inside a rectangle while keeping exclusion zones clear. */
  tableGrid(roomId: string, type: FurnitureType, x0: number, z0: number, x1: number, z1: number, stepX: number, stepZ: number, keepClear: Array<[number, number, number, number]>) {
    const size = FURNITURE_CATALOG[type].size;
    for (let z = z0; z <= z1 + 1e-6; z += stepZ) {
      for (let x = x0; x <= x1 + 1e-6; x += stepX) {
        const hw = size[0] / 2 + 0.3;
        const hd = size[2] / 2 + 0.3;
        const blocked = keepClear.some(([cx0, cz0, cx1, cz1]) => x + hw > cx0 && x - hw < cx1 && z + hd > cz0 && z - hd < cz1);
        if (!blocked) this.furn(type, roomId, Math.round(x * 100) / 100, Math.round(z * 100) / 100);
      }
    }
  }

  ws(type: WorkstationType, name: string, equipmentIds: string[], capacity?: number) {
    const first = this.equipment.find((e) => e.id === equipmentIds[0]);
    if (!first) throw new Error(`workstation ${name}: missing equipment ${equipmentIds[0]}`);
    const id = this.next(`ws-${type}`);
    for (const eid of equipmentIds) {
      const e = this.equipment.find((x) => x.id === eid);
      if (e) e.workstationId = id;
    }
    this.workstations.push({ id, name, type, roomId: first.roomId, equipmentIds, standPoint: [0, 0], capacity: capacity ?? first.operational.capacity ?? 1 });
    return id;
  }

  build(meta: { restaurantId: string; name: string; format: FloorPlanFormat; width: number; length: number; height: number; anchors: FloorPlan["anchors"] }): FloorPlan {
    const plan: FloorPlan = {
      schemaVersion: 1,
      restaurantId: meta.restaurantId,
      name: meta.name,
      format: meta.format,
      conceptual: true,
      provenance: PROVENANCE,
      dimensions: { width: meta.width, length: meta.length, height: meta.height },
      frontage: "south",
      rooms: this.rooms,
      openings: this.openings,
      walls: [],
      doors: this.doors,
      windows: this.windows,
      equipment: this.equipment,
      furniture: this.furniture,
      workstations: this.workstations,
      cameras: [],
      sensors: [],
      navigationPaths: [],
      workflow: [
        { from: "order-counter", to: "pizza-prep", flow: "pizza" },
        { from: "pizza-prep", to: "oven", flow: "pizza" },
        { from: "oven", to: "qc", flow: "pizza" },
        { from: "order-counter", to: "chicken-prep", flow: "chicken" },
        { from: "chicken-prep", to: "fryer", flow: "chicken" },
        { from: "fryer", to: "qc", flow: "chicken" },
        { from: "order-counter", to: "rice", flow: "rice" },
        { from: "qc", to: "packaging", flow: "all" },
        { from: "rice", to: "packaging", flow: "rice" },
        { from: "packaging", to: "pickup", flow: "all" },
        { from: "packaging", to: "dispatch", flow: "all" },
      ],
      anchors: meta.anchors,
    };
    return rebuildDerived(plan);
  }
}

/**
 * MODEL A — Compact takeaway branch, 11 m × 10 m ≈ 110 m².
 * Street-facing customer area, separate rider door, open service counter,
 * single hot line, raw chicken prep isolated beside cold storage.
 */
export function modelA(): FloorPlan {
  const b = new PlanBuilder();
  const cust = b.room("a-customer", "Customer & Waiting Area", "customer", "public", 0, 0, 7, 3);
  const disp = b.room("a-dispatch", "Delivery Pickup", "dispatch", "support", 7, 0, 4, 3);
  const ctr = b.room("a-counter", "Service Counter", "counter", "cooked", 0, 3, 7, 1.4);
  const pack = b.room("a-pack", "Packaging", "packaging", "cooked", 7, 3, 4, 2.2);
  const kit = b.room("a-kitchen", "Kitchen — Hot Line", "kitchen", "cooked", 0, 4.4, 7, 5.6);
  const raw = b.room("a-raw", "Raw Chicken Prep", "chicken", "raw", 7, 5.2, 4, 1.8);
  const cold = b.room("a-cold", "Cold Storage", "cold", "storage", 7, 7, 2.2, 1.6);
  const dry = b.room("a-dry", "Dry Store", "dry", "storage", 9.2, 7, 1.8, 1.6);
  const staff = b.room("a-staff", "Staff Room & Cleaning", "staff", "support", 7, 8.6, 2.4, 1.4);
  const wc = b.room("a-wc", "Staff WC", "toilet", "support", 9.4, 8.6, 1.6, 1.4);
  b.open([cust, ctr], [ctr, kit], [ctr, pack]);

  b.door("Main Entrance", 3.0, 0, 1.8, "x", "entrance");
  b.door("Rider Door", 9.0, 0, 1.2, "x", "delivery");
  b.door("Dispatch Hatch", 9.0, 3, 1.0, "x");
  b.door("Kitchen ↔ Raw Prep", 7, 6.1, 0.9, "z");
  b.door("Kitchen ↔ Cold Store", 7, 7.8, 0.9, "z");
  b.door("Raw Prep ↔ Cold Store", 7.6, 7, 0.9, "x");
  b.door("Raw Prep ↔ Dry Store", 10.1, 7, 0.9, "x");
  b.door("Kitchen ↔ Staff", 7, 9.3, 0.9, "z", "staff");
  b.door("Staff WC", 9.4, 9.3, 0.8, "z");
  b.door("Rear Emergency Exit", 8.2, 10, 1.0, "x", "emergency");
  b.win(1.0, 0, 1.4, "x");
  b.win(5.4, 0, 2.4, "x");
  b.win(10.4, 0, 0.8, "x", 1.0, 1.2);

  // Service counter
  const pos = b.eq("pos-counter", ctr, 2.2, 3.35, S, { name: "Ordering Counter" });
  const pick = b.eq("pickup-counter", ctr, 5.6, 3.3, S, { name: "Collection Counter" });
  b.eq("menu-board", ctr, 2.2, 4.3, S, { name: "Digital Menu Board" });
  b.eq("drinks-fridge", cust, 6.6, 1.6, W, { name: "Drinks Fridge" });
  b.furn("waiting-bench", cust, 0.3, 1.6, E);
  b.furn("stool-bar", cust, 5.4, 0.5, N);
  b.furn("plant", cust, 6.7, 2.6);

  // Hot line: west wall make-line + oven, north wall fryers + rice
  const makeline = b.eq("pizza-makeline", kit, 0.4, 5.7, E, { name: "Pizza Make-Line" });
  const oven = b.eq("conveyor-oven", kit, 0.5, 7.9, E, { name: "Conveyor Oven 01" });
  b.eq("fridge", kit, 0.4, 9.4, E, { name: "Kitchen Reach-in Fridge" });
  b.eq("hood", kit, 0.55, 7.9, E, { name: "Oven Hood", width: 2.2 });
  const fr1 = b.eq("fryer", kit, 1.6, 9.6, S, { name: "Fryer 01" });
  const fr2 = b.eq("fryer", kit, 2.5, 9.6, S, { name: "Fryer 02" });
  const stove = b.eq("rice-stove", kit, 3.9, 9.6, S, { name: "Jollof & Fried Rice Stove" });
  b.eq("hood", kit, 2.95, 9.45, S, { name: "Fry & Rice Hood", width: 3.7 });
  b.eq("sink", kit, 5.5, 9.67, S, { name: "Pot-Wash Sink" });
  const cut = b.eq("prep-table", kit, 2.3, 7.9, W, { name: "Pizza Cut Table" });
  const hold = b.eq("hot-holding", kit, 3.6, 6.4, S, { name: "Chicken Hot-Holding" });
  const qc = b.eq("qc-pass", kit, 3.4, 4.75, S, { name: "QC Pass" });
  const warmer = b.eq("rice-warmer", kit, 5.2, 4.75, S, { name: "Rice Warmer" });
  b.eq("handwash", kit, 6.77, 5.2, W, { name: "Kitchen Handwash" });

  // Packaging & dispatch
  const packT = b.eq("packaging-table", pack, 9.6, 4.8, S, { name: "Packaging Table" });
  b.eq("shelving", pack, 10.75, 4.0, W, { name: "Packaging Supplies" });
  const rack = b.eq("dispatch-rack", disp, 10.75, 1.6, W, { name: "Dispatch Rack" });
  b.furn("bench", disp, 7.3, 1.5, E);

  // Raw prep + storage
  const bread = b.eq("breading-station", raw, 9.6, 5.58, N, { name: "Chicken Breading Station" });
  b.eq("handwash", raw, 10.77, 6.5, W, { name: "Raw Prep Handwash" });
  b.eq("fridge", cold, 8.8, 7.45, W, { name: "Cold Store Fridge 01" });
  b.eq("freezer", cold, 8.8, 8.2, W, { name: "Chicken Freezer 01" });
  b.eq("shelving", dry, 10.75, 7.8, W, { name: "Dry Store Shelf 01" });
  b.eq("shelving", dry, 9.9, 8.35, S, { name: "Dry Store Shelf 02" });
  b.eq("lockers", staff, 8.2, 8.85, N, { name: "Staff Lockers", width: 0.6 });
  b.eq("toilet", wc, 10.7, 9.65, S, { name: "Staff WC" });
  b.eq("handwash", wc, 10.77, 8.95, W, { name: "WC Handwash" });
  b.eq("mop-sink", disp, 7.35, 2.65, E, { name: "Cleaning Store" });

  b.ws("order-counter", "Ordering Counter", [pos], 2);
  b.ws("pizza-prep", "Pizza Make-Line", [makeline], 2);
  b.ws("oven", "Pizza Oven", [oven], 4);
  b.ws("chicken-prep", "Chicken Prep", [bread], 2);
  b.ws("fryer", "Fryers", [fr1, fr2], 4);
  b.ws("rice", "Rice Station", [warmer, stove], 3);
  b.ws("qc", "Quality Check", [qc, cut, hold], 3);
  b.ws("packaging", "Packaging", [packT], 2);
  b.ws("pickup", "Collection Counter", [pick], 4);
  b.ws("dispatch", "Delivery Dispatch", [rack], 8);

  return b.build({
    restaurantId: "template-A",
    name: "Model A — Compact Takeaway",
    format: "A",
    width: 11,
    length: 10,
    height: 3.2,
    anchors: {
      outside: [2.0, -4.5],
      entrance: [3.0, 0.8],
      queueHead: [2.2, 2.35],
      queueDir: [0, -1],
      waiting: [1.2, 1.4],
      pickup: [5.6, 2.45],
      riderDoor: [9.0, 0.6],
      riderWait: [9.4, 2.3],
      staffRest: [8.0, 9.6],
    },
  });
}

/**
 * MODEL B — Standard restaurant, 16 m × 13 m ≈ 208 m².
 * Dining room plus ordering hall, separate pizza and chicken/rice kitchens,
 * packaging & dispatch with its own rider door, walk-in cold room.
 */
export function modelB(): FloorPlan {
  const b = new PlanBuilder();
  const din = b.room("b-dining", "Dining Room", "dining", "public", 0, 0, 11.5, 6);
  const ord = b.room("b-order", "Ordering Hall", "customer", "public", 11.5, 0, 4.5, 6);
  const ctr = b.room("b-counter", "Service & Collection Counter", "counter", "cooked", 7.5, 6, 8.5, 1.4);
  const disp = b.room("b-dispatch", "Delivery Dispatch", "dispatch", "support", 0, 6, 3.5, 4.5);
  const pack = b.room("b-pack", "Packaging & QC", "packaging", "cooked", 3.5, 6, 4, 4.5);
  const piz = b.room("b-pizza", "Pizza Kitchen", "pizza", "cooked", 7.5, 7.4, 5, 3.1);
  const chk = b.room("b-chicken", "Chicken & Rice Hot Line", "kitchen", "cooked", 12.5, 7.4, 3.5, 3.1);
  const staff = b.room("b-staff", "Staff Room & Manager", "staff", "support", 0, 10.5, 2.2, 2.5);
  const wc = b.room("b-wc", "Staff WC", "toilet", "support", 2.2, 10.5, 1.3, 2.5);
  const dry = b.room("b-dry", "Dry Store", "dry", "storage", 3.5, 10.5, 2.2, 2.5);
  const wash = b.room("b-wash", "Dishwash", "wash", "support", 5.7, 10.5, 1.8, 2.5);
  const cold = b.room("b-cold", "Walk-in Cold Room", "cold", "storage", 7.5, 10.5, 5, 2.5);
  const raw = b.room("b-raw", "Raw Chicken Prep", "chicken", "raw", 12.5, 10.5, 3.5, 2.5);
  b.open([din, ord], [ord, ctr], [din, ctr], [ctr, piz], [ctr, chk], [piz, chk], [ctr, pack], [pack, piz]);

  b.door("Main Entrance", 13.75, 0, 1.8, "x", "entrance");
  b.door("Dining Emergency Exit", 0, 3.0, 1.2, "z", "emergency");
  b.door("Rider Door", 0, 8.25, 1.2, "z", "delivery");
  b.door("Dispatch Pass", 3.5, 8.25, 1.2, "z");
  b.door("Staff ↔ Dispatch", 1.1, 10.5, 0.9, "x", "staff");
  b.door("Rear Emergency Exit", 1.1, 13, 1.0, "x", "emergency");
  b.door("Staff WC", 2.2, 11.75, 0.8, "z");
  b.door("Dry Store", 4.6, 10.5, 0.9, "x");
  b.door("Dishwash", 6.6, 10.5, 0.9, "x");
  b.door("Pizza ↔ Cold Room", 8.0, 10.5, 1.0, "x");
  b.door("Cold Room ↔ Raw Prep", 12.5, 11.2, 0.9, "z");
  b.door("Raw Prep ↔ Hot Line", 15.2, 10.5, 0.9, "x");
  for (const x of [1.9, 5.2, 8.5]) b.win(x, 0, 2.4, "x");
  b.win(15.2, 0, 1.2, "x");
  b.win(16, 2.5, 2.4, "z");

  const pos = b.eq("pos-counter", ctr, 13.8, 6.35, S, { name: "Ordering Counter", width: 3.6 });
  const pick = b.eq("pickup-counter", ctr, 10.4, 6.3, S, { name: "Collection Counter", width: 2.0 });
  b.eq("menu-board", ctr, 13.8, 7.35, S, { name: "Digital Menu Board 01" });
  b.eq("menu-board", ctr, 10.4, 7.35, S, { name: "Digital Menu Board 02", width: 2.0 });
  b.eq("drinks-fridge", ord, 15.6, 2.0, W, { name: "Drinks Fridge" });
  b.furn("waiting-bench", ord, 11.8, 2.6, E);
  b.tableGrid(din, "table-4", 1.6, 1.4, 10.0, 4.6, 2.6, 3.2, [[0, 2.2, 1.6, 3.8]]);
  b.furn("plant", din, 11.1, 0.4);
  b.furn("plant", din, 0.4, 5.6);

  // Packaging, QC, dispatch
  const packT1 = b.eq("packaging-table", pack, 5.0, 6.4, N, { name: "Packaging Table 01" });
  const packT2 = b.eq("packaging-table", pack, 5.4, 8.25, N, { name: "Packaging Table 02" });
  const qc = b.eq("qc-pass", pack, 7.2, 8.8, W, { name: "QC Pass" });
  b.eq("shelving", pack, 3.75, 9.6, E, { name: "Packaging Supplies" });
  b.eq("handwash", pack, 3.73, 6.6, E, { name: "Packaging Handwash" });
  const rack = b.eq("dispatch-rack", disp, 1.75, 6.25, N, { name: "Dispatch Rack" });
  b.furn("bench", disp, 2.65, 10.2, S);

  // Pizza kitchen
  const makeline = b.eq("pizza-makeline", piz, 9.5, 10.1, S, { name: "Pizza Make-Line", width: 1.9 });
  const oven = b.eq("conveyor-oven", piz, 11.5, 10.0, S, { name: "Conveyor Oven 01" });
  b.eq("hood", piz, 11.5, 9.95, S, { name: "Oven Hood", width: 2.2 });
  const cut = b.eq("prep-table", piz, 11.4, 8.0, N, { name: "Pizza Cut Table" });
  b.eq("dough-table", piz, 8.9, 8.0, N, { name: "Dough Table" });

  // Chicken & rice hot line
  const fr1 = b.eq("fryer", chk, 15.6, 8.1, W, { name: "Fryer 01" });
  const fr2 = b.eq("fryer", chk, 15.6, 9.0, W, { name: "Fryer 02" });
  b.eq("hood", chk, 15.45, 8.55, W, { name: "Fryer Hood", width: 2.0 });
  const stove = b.eq("rice-stove", chk, 13.4, 10.1, S, { name: "Jollof & Fried Rice Stove" });
  b.eq("hood", chk, 13.4, 9.95, S, { name: "Rice Hood", width: 1.8 });
  const warmer = b.eq("rice-warmer", chk, 13.3, 7.8, N, { name: "Rice Warmer" });
  const hold = b.eq("hot-holding", chk, 14.0, 9.0, E, { name: "Chicken Hot-Holding" });

  // Storage, raw prep, wash, staff
  b.eq("walk-in-cold", cold, 10.0, 12.65, S, { name: "Cold Room Evaporator" });
  b.eq("shelving", cold, 8.7, 12.75, S, { name: "Cold Room Shelf 01" });
  b.eq("shelving", cold, 10.1, 12.75, S, { name: "Cold Room Shelf 02" });
  b.eq("shelving", cold, 11.5, 12.75, S, { name: "Cold Room Shelf 03" });
  b.eq("freezer", cold, 7.9, 12.0, E, { name: "Chicken Freezer 01" });
  const bread = b.eq("breading-station", raw, 14.25, 12.62, S, { name: "Chicken Breading Station" });
  b.eq("sink", raw, 12.83, 12.3, E, { name: "Raw Prep Sink" });
  b.eq("handwash", raw, 15.77, 12.6, W, { name: "Raw Prep Handwash" });
  b.eq("shelving", dry, 4.6, 12.75, S, { name: "Dry Store Shelf 01" });
  b.eq("shelving", dry, 3.75, 11.9, E, { name: "Dry Store Shelf 02" });
  b.eq("dishwasher", wash, 6.2, 12.62, S, { name: "Dishwasher" });
  b.eq("sink", wash, 7.17, 12.0, W, { name: "Wash Sink" });
  b.eq("desk", staff, 0.3, 11.2, E, { name: "Manager Workstation" });
  b.eq("lockers", staff, 0.25, 12.4, E, { name: "Staff Lockers" });
  b.eq("toilet", wc, 2.85, 12.6, S, { name: "Staff WC" });
  b.eq("handwash", wc, 2.43, 11.0, E, { name: "WC Handwash" });

  b.ws("order-counter", "Ordering Counter", [pos], 3);
  b.ws("pizza-prep", "Pizza Make-Line", [makeline], 2);
  b.ws("oven", "Pizza Oven", [oven], 5);
  b.ws("chicken-prep", "Chicken Prep", [bread], 2);
  b.ws("fryer", "Fryers", [fr1, fr2], 4);
  b.ws("rice", "Rice Station", [warmer, stove], 3);
  b.ws("qc", "Quality Check", [qc, cut, hold], 3);
  b.ws("packaging", "Packaging", [packT1, packT2], 3);
  b.ws("pickup", "Collection Counter", [pick], 5);
  b.ws("dispatch", "Delivery Dispatch", [rack], 10);

  return b.build({
    restaurantId: "template-B",
    name: "Model B — Standard Restaurant",
    format: "B",
    width: 16,
    length: 13,
    height: 3.4,
    anchors: {
      outside: [13.75, -5],
      entrance: [13.75, 0.9],
      queueHead: [13.8, 5.3],
      queueDir: [0, -1],
      waiting: [12.2, 1.6],
      pickup: [10.4, 5.4],
      riderDoor: [0.6, 8.25],
      riderWait: [1.6, 7.6],
      staffRest: [1.1, 11.9],
    },
  });
}

/**
 * MODEL C — Flagship, 24 m × 17 m ≈ 408 m².
 * Large dining room, two ordering points, dedicated pizza, chicken and rice
 * production, walk-in cold and freezer rooms, raw chicken prep with its own
 * waste route, manager office and staff changing.
 */
export function modelC(): FloorPlan {
  const b = new PlanBuilder();
  const din = b.room("c-dining", "Dining Hall", "dining", "public", 0, 0, 15, 8);
  const ord = b.room("c-order", "Ordering Hall", "customer", "public", 15, 0, 9, 6);
  const ctr = b.room("c-counter", "Ordering & Collection Counters", "counter", "cooked", 15, 6, 9, 2);
  const disp = b.room("c-dispatch", "Delivery Dispatch", "dispatch", "support", 0, 8, 4, 4.5);
  const pack = b.room("c-pack", "Packaging & Quality Control", "packaging", "cooked", 4, 8, 5, 4.5);
  const piz = b.room("c-pizza", "Pizza Production", "pizza", "cooked", 9, 8, 7, 4.5);
  const chk = b.room("c-chicken", "Chicken Production", "kitchen", "cooked", 16, 8, 8, 4.5);
  const chg = b.room("c-changing", "Staff Changing", "staff", "support", 0, 12.5, 3, 2.5);
  const wc = b.room("c-wc", "Staff WCs", "toilet", "support", 0, 15, 3, 2);
  const off = b.room("c-office", "Manager Office", "office", "support", 3, 12.5, 3, 4.5);
  const rice = b.room("c-rice", "Rice Kitchen", "rice", "cooked", 6, 12.5, 5, 4.5);
  const dry = b.room("c-dry", "Dry Store", "dry", "storage", 11, 12.5, 3.5, 2.5);
  const wash = b.room("c-wash", "Dishwash & Sanitation", "wash", "support", 11, 15, 3.5, 2);
  const cold = b.room("c-cold", "Walk-in Cold Room", "cold", "storage", 14.5, 12.5, 3.5, 4.5);
  const raw = b.room("c-raw", "Raw Chicken Prep", "chicken", "raw", 18, 12.5, 3.5, 4.5);
  const frz = b.room("c-freezer", "Freezer Room", "freezer", "storage", 21.5, 12.5, 2.5, 2.5);
  const waste = b.room("c-waste", "Waste Management", "waste", "support", 21.5, 15, 2.5, 2);
  b.open([din, ord], [ord, ctr], [din, ctr], [ctr, piz], [ctr, chk], [piz, chk], [pack, piz], [rice, pack], [rice, piz]);

  b.door("Main Entrance", 20, 0, 2.4, "x", "entrance");
  b.door("Dining Entrance", 6, 0, 2.0, "x", "entrance");
  b.door("Dining Emergency Exit", 0, 4, 1.4, "z", "emergency");
  b.door("Rider Door", 0, 10.25, 1.2, "z", "delivery");
  b.door("Dispatch Pass", 4, 10.25, 1.4, "z");
  b.door("Staff ↔ Dispatch", 1.5, 12.5, 0.9, "x", "staff");
  b.door("Rear Emergency Exit", 0, 13.75, 1.0, "z", "emergency");
  b.door("Staff WCs", 1.5, 15, 0.9, "x");
  b.door("Manager Office", 5.4, 12.5, 0.9, "x");
  b.door("Dry Store", 12.75, 12.5, 0.9, "x");
  b.door("Dishwash ↔ Rice Kitchen", 11, 16, 0.9, "z");
  b.door("Pizza ↔ Cold Room", 15.2, 12.5, 1.0, "x");
  b.door("Cold Room ↔ Raw Prep", 18, 14, 0.9, "z");
  b.door("Raw Prep ↔ Chicken Production", 19.75, 12.5, 1.0, "x");
  b.door("Raw Prep ↔ Freezer", 21.5, 13.75, 0.9, "z");
  b.door("Raw Prep ↔ Waste", 21.5, 15.55, 0.9, "z");
  b.door("Waste Yard Door", 24, 16, 1.2, "z", "staff");
  for (const x of [2.0, 10.0, 13.2]) b.win(x, 0, 2.6, "x");
  b.win(16.6, 0, 2.2, "x");
  b.win(23.0, 0, 1.6, "x");
  b.win(24, 3.0, 3.0, "z");

  const pos1 = b.eq("pos-counter", ctr, 18.0, 6.35, S, { name: "Ordering Counter 01" });
  const pos2 = b.eq("pos-counter", ctr, 21.6, 6.35, S, { name: "Ordering Counter 02" });
  const pick = b.eq("pickup-counter", ctr, 15.35, 7.0, W, { name: "Collection Counter", width: 2.0 });
  b.eq("menu-board", ctr, 18.0, 7.9, S, { name: "Digital Menu Board 01" });
  b.eq("menu-board", ctr, 21.6, 7.9, S, { name: "Digital Menu Board 02" });
  b.eq("drinks-fridge", ord, 23.6, 1.6, W, { name: "Drinks Fridge 01" });
  b.eq("drinks-fridge", ord, 23.6, 2.4, W, { name: "Drinks Fridge 02" });
  b.furn("waiting-bench", ord, 15.4, 2.2, E);
  b.furn("waiting-bench", ord, 15.4, 4.2, E);
  b.tableGrid(din, "table-4", 2.0, 1.6, 13.0, 6.4, 2.6, 2.4, [[4.6, 0, 7.4, 2.0], [0, 3.0, 1.8, 5.0]]);
  b.furn("booth-4", din, 14.1, 4.6, W);
  b.furn("plant", din, 0.4, 0.4);
  b.furn("plant", din, 14.6, 0.4);

  // Packaging & dispatch
  const packT1 = b.eq("packaging-table", pack, 5.4, 8.4, N, { name: "Packaging Table 01" });
  const packT2 = b.eq("packaging-table", pack, 7.4, 8.4, N, { name: "Packaging Table 02" });
  const qc = b.eq("qc-pass", pack, 8.7, 10.75, W, { name: "QC & Labelling Pass" });
  b.eq("shelving", pack, 4.25, 11.7, E, { name: "Packaging Supplies" });
  b.eq("handwash", pack, 4.23, 8.9, E, { name: "Packaging Handwash" });
  const rack1 = b.eq("dispatch-rack", disp, 1.2, 8.25, N, { name: "Dispatch Rack 01" });
  b.eq("dispatch-rack", disp, 3.0, 8.25, N, { name: "Dispatch Rack 02" });
  b.furn("bench", disp, 0.25, 11.7, E);

  // Pizza production
  const ml1 = b.eq("pizza-makeline", piz, 10.2, 8.4, N, { name: "Pizza Make-Line 01" });
  const ml2 = b.eq("pizza-makeline", piz, 12.4, 8.4, N, { name: "Pizza Make-Line 02" });
  const ov1 = b.eq("conveyor-oven", piz, 10.3, 10.6, S, { name: "Conveyor Oven 01" });
  const ov2 = b.eq("conveyor-oven", piz, 12.6, 10.6, S, { name: "Conveyor Oven 02" });
  b.eq("hood", piz, 11.45, 10.6, S, { name: "Oven Hood", width: 4.8 });
  const cut = b.eq("prep-table", piz, 14.9, 10.4, S, { name: "Pizza Cut Table" });
  b.eq("handwash", piz, 15.77, 9.0, W, { name: "Pizza Handwash" });

  // Chicken production
  const fryers = [9.0, 9.9, 10.8, 11.7].map((z, i) => b.eq("fryer", chk, 23.6, z, W, { name: `Fryer 0${i + 1}` }));
  b.eq("hood", chk, 23.45, 10.35, W, { name: "Fryer Hood", width: 4.0 });
  const hold1 = b.eq("hot-holding", chk, 19.0, 8.35, N, { name: "Chicken Hot-Holding 01" });
  b.eq("hot-holding", chk, 20.5, 8.35, N, { name: "Chicken Hot-Holding 02" });
  const qc2 = b.eq("qc-pass", chk, 17.5, 10.3, E, { name: "Chicken QC Pass" });
  b.eq("handwash", chk, 21.0, 12.27, S, { name: "Chicken Handwash" });

  // Rice kitchen
  const st1 = b.eq("rice-stove", rice, 7.2, 16.6, S, { name: "Jollof Rice Stove" });
  b.eq("rice-stove", rice, 9.0, 16.6, S, { name: "Fried Rice Stove" });
  b.eq("hood", rice, 8.1, 16.45, S, { name: "Rice Hood", width: 3.8 });
  const warmer = b.eq("rice-warmer", rice, 10.65, 13.8, W, { name: "Rice Warmer 01" });
  b.eq("prep-table", rice, 7.6, 14.0, N, { name: "Protein Allocation Table" });

  // Storage & raw prep
  b.eq("walk-in-cold", cold, 16.25, 16.65, S, { name: "Cold Room Evaporator" });
  b.eq("shelving", cold, 15.3, 16.75, S, { name: "Cold Room Shelf 01" });
  b.eq("shelving", cold, 16.6, 16.75, S, { name: "Cold Room Shelf 02" });
  b.eq("shelving", cold, 14.75, 15.0, E, { name: "Cold Room Shelf 03" });
  b.eq("shelving", cold, 17.75, 15.6, W, { name: "Cold Room Shelf 04" });
  b.eq("walk-in-freezer", frz, 22.75, 14.7, S, { name: "Freezer Room Evaporator" });
  b.eq("shelving", frz, 23.75, 13.75, W, { name: "Freezer Shelf 01" });
  b.eq("freezer", frz, 22.4, 12.9, N, { name: "Chicken Freezer 01" });
  const br1 = b.eq("breading-station", raw, 19.0, 16.62, S, { name: "Breading Station 01" });
  const br2 = b.eq("breading-station", raw, 20.6, 16.62, S, { name: "Breading Station 02" });
  b.eq("sink", raw, 18.33, 15.3, E, { name: "Raw Prep Sink" });
  b.eq("handwash", raw, 21.27, 14.6, W, { name: "Raw Prep Handwash" });
  b.eq("waste-bins", waste, 22.4, 16.7, S, { name: "Segregated Waste Bins" });
  b.eq("shelving", dry, 11.7, 14.75, S, { name: "Dry Store Shelf 01" });
  b.eq("shelving", dry, 14.25, 13.9, W, { name: "Dry Store Shelf 02" });
  b.eq("shelving", dry, 11.25, 13.4, E, { name: "Dry Store Shelf 03" });
  b.eq("dishwasher", wash, 13.6, 16.62, S, { name: "Dishwasher" });
  b.eq("sink", wash, 12.5, 16.67, S, { name: "Wash Sink" });
  b.eq("mop-sink", wash, 14.15, 15.4, W, { name: "Cleaning Store" });
  b.eq("desk", off, 4.5, 16.6, S, { name: "Manager Workstation" });
  b.eq("shelving", off, 5.75, 15.0, W, { name: "Office Files" });
  b.eq("lockers", chg, 2.75, 14.0, W, { name: "Staff Lockers" });
  b.eq("toilet", wc, 0.6, 16.6, S, { name: "Staff WC 01" });
  b.eq("toilet", wc, 2.4, 16.6, S, { name: "Staff WC 02" });
  b.eq("handwash", wc, 1.5, 16.77, S, { name: "WC Handwash" });

  b.ws("order-counter", "Ordering Counter 01", [pos1], 2);
  b.ws("order-counter", "Ordering Counter 02", [pos2], 2);
  b.ws("pizza-prep", "Pizza Make-Line 01", [ml1], 2);
  b.ws("pizza-prep", "Pizza Make-Line 02", [ml2], 2);
  b.ws("oven", "Pizza Oven 01", [ov1], 5);
  b.ws("oven", "Pizza Oven 02", [ov2], 5);
  b.ws("chicken-prep", "Chicken Prep 01", [br1], 2);
  b.ws("chicken-prep", "Chicken Prep 02", [br2], 2);
  b.ws("fryer", "Fryer Bank A", [fryers[0], fryers[1]], 4);
  b.ws("fryer", "Fryer Bank B", [fryers[2], fryers[3]], 4);
  b.ws("rice", "Rice Station", [warmer, st1], 4);
  b.ws("qc", "Pizza QC", [cut], 3);
  b.ws("qc", "Chicken QC", [qc2, hold1], 3);
  b.ws("qc", "Packaging QC", [qc], 3);
  b.ws("packaging", "Packaging 01", [packT1], 2);
  b.ws("packaging", "Packaging 02", [packT2], 2);
  b.ws("pickup", "Collection Counter", [pick], 6);
  b.ws("dispatch", "Delivery Dispatch", [rack1], 12);

  return b.build({
    restaurantId: "template-C",
    name: "Model C — Flagship Restaurant",
    format: "C",
    width: 24,
    length: 17,
    height: 3.6,
    anchors: {
      outside: [20, -6],
      entrance: [20, 1.0],
      queueHead: [18.0, 5.3],
      queueDir: [0, -1],
      waiting: [16.0, 3.2],
      pickup: [14.2, 7.0],
      riderDoor: [0.6, 10.25],
      riderWait: [1.8, 9.6],
      staffRest: [1.5, 13.6],
    },
  });
}

export const TEMPLATE_FACTORIES = { A: modelA, B: modelB, C: modelC } as const;

export function anchorList(plan: FloorPlan): Vec2[] {
  return Object.values(plan.anchors);
}
