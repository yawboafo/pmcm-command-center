import { NavGrid } from "../floorplan/nav";
import { roomAt } from "../floorplan/derive";
import type { Equipment, FloorPlan, Sensor, Vec2, Workstation, WorkstationType } from "../floorplan/types";
import { DEFAULT_SAFETY_PROFILE, INGREDIENTS, INGREDIENT_BY_SKU, type SafetyProfile, type StorageClass } from "./catalog";
import { CHICKEN_BATCH, MENU, MENU_BY_ID, stagesFor } from "./menu";
import { Rng, hashString } from "./rng";
import {
  ORDER_FLOW,
  type Agent,
  type Alert,
  type BranchMetrics,
  type Channel,
  type CleaningRecord,
  type EquipmentState,
  type Fulfilment,
  type InventoryItem,
  type LedgerEntry,
  type Order,
  type OrderStatus,
  type Replenishment,
  type SensorState,
  type SimConfig,
  type SimEvent,
  type StaffMember,
  type StaffRole,
  type Task,
  type Unit,
} from "./types";

export const STEP = 0.25;
const DAY = 86400;

const STAFF_NAMES = ["Kwame", "Ama", "Kofi", "Akosua", "Yaw", "Efua", "Kojo", "Abena", "Kwesi", "Esi", "Kwabena", "Adwoa", "Fiifi", "Selorm", "Elikem", "Naa", "Nii", "Afia", "Kobby", "Dzifa"];
const SURNAMES = ["Mensah", "Owusu", "Boateng", "Asante", "Agyeman", "Addo", "Tetteh", "Quaye", "Darko", "Ofori", "Amoah", "Lartey", "Nkansah", "Appiah", "Sarpong"];

const ROLE_SKILLS: Record<StaffRole, WorkstationType[]> = {
  cashier: ["order-counter", "pickup"],
  pizza: ["pizza-prep", "oven", "qc"],
  chicken: ["chicken-prep", "fryer", "qc"],
  rice: ["rice", "qc", "packaging", "pickup"],
  packer: ["packaging", "pickup", "dispatch", "qc"],
  supervisor: ["qc", "packaging", "pizza-prep", "chicken-prep", "rice", "pickup", "dispatch"],
};

const ROLE_LABEL: Record<StaffRole, string> = {
  cashier: "Cashier",
  pizza: "Pizza Cook",
  chicken: "Chicken Cook",
  rice: "Rice & Sides Cook",
  packer: "Packer / Dispatcher",
  supervisor: "Kitchen Supervisor",
};

export function roleLabel(r: StaffRole) {
  return ROLE_LABEL[r];
}

const ROSTER: Record<string, StaffRole[]> = {
  A: ["cashier", "pizza", "chicken", "rice", "packer"],
  B: ["cashier", "cashier", "pizza", "pizza", "chicken", "rice", "packer", "supervisor"],
  C: ["cashier", "cashier", "pizza", "pizza", "pizza", "chicken", "chicken", "rice", "rice", "packer", "packer", "supervisor"],
};

/** Relative demand by hour of day (lunch and dinner peaks). Demo assumption. */
export function demandFactor(hour: number): number {
  const curve = [0.15, 0.1, 0.08, 0.05, 0.05, 0.08, 0.15, 0.3, 0.45, 0.55, 0.7, 1.0, 1.6, 1.7, 1.25, 0.95, 1.0, 1.3, 1.75, 1.9, 1.7, 1.2, 0.7, 0.35];
  const h = Math.floor(hour) % 24;
  const f = hour - Math.floor(hour);
  return curve[h] * (1 - f) + curve[(h + 1) % 24] * f;
}

export interface BranchSimOptions {
  branchId: string;
  branchName: string;
  plan: FloorPlan;
  config: SimConfig;
  /** Epoch ms of simulation start (Africa/Accra = UTC+0). */
  clockStart: number;
  safety?: SafetyProfile;
  baseline?: { ordersToday: number; completed: number; sales: number };
  isOpen?: (epochMs: number) => boolean;
}

/**
 * Deterministic, event-driven simulation of one restaurant branch.
 * The engine mutates its own state in fixed 0.25 s steps; the UI reads it
 * directly (3D) or via `version` (panels). A fixed seed + fixed step count
 * always reproduces the same run.
 */
export class BranchSimulation {
  readonly branchId: string;
  readonly branchName: string;
  readonly plan: FloorPlan;
  readonly grid: NavGrid;
  readonly config: SimConfig;
  safety: SafetyProfile;
  readonly clockStart: number;
  t = 0;
  version = 0;
  private acc = 0;
  private rng: Rng;
  private seq = 0;
  private orderNo = 1000;
  private isOpenFn: (ms: number) => boolean;
  baseline: { ordersToday: number; completed: number; sales: number };

  orders = new Map<string, Order>();
  units = new Map<string, Unit>();
  tasks = new Map<string, Task>();
  agents: Agent[] = [];
  staff = new Map<string, StaffMember>();
  equipment = new Map<string, EquipmentState>();
  sensors = new Map<string, SensorState>();
  alerts: Alert[] = [];
  inventory: InventoryItem[] = [];
  ledger: LedgerEntry[] = [];
  private ledgerKeys = new Set<string>();
  replenishments: Replenishment[] = [];
  events: SimEvent[] = [];
  cleaning: CleaningRecord[] = [];
  cookChecks: Array<{ t: number; unitId: string; orderId: string; valueC: number; pass: boolean }> = [];
  riceStockKg: number;
  /** Cooked chicken pieces held hot, by cut. */
  chickenStock = { wing: 0, drum: 0 };
  /** Hot-holding target pieces by cut (fryers batch to keep stock at or above this). */
  chickenTarget = { wing: 24, drum: 16 };
  queue: string[] = [];
  private seatsTaken = new Set<number>();
  seats: Vec2[] = [];
  private slots = new Map<string, Array<string | null>>();
  private wsBusy = new Map<string, number>();
  private nextArrival: number;
  private nextSensor = 0;
  private lostCustomers = 0;
  private prepTimes: number[] = [];
  private waitTimes: number[] = [];
  private lastFaultCheck = 0;
  readonly wsById: Map<string, Workstation>;
  readonly eqById: Map<string, Equipment>;
  private sensorById: Map<string, Sensor>;

  constructor(opts: BranchSimOptions) {
    this.branchId = opts.branchId;
    this.branchName = opts.branchName;
    this.plan = opts.plan;
    this.config = { ...opts.config };
    this.safety = opts.safety ?? DEFAULT_SAFETY_PROFILE;
    this.clockStart = opts.clockStart;
    this.baseline = opts.baseline ?? { ordersToday: 0, completed: 0, sales: 0 };
    this.isOpenFn = opts.isOpen ?? (() => true);
    this.rng = new Rng(opts.config.seed ^ hashString(opts.branchId));
    this.grid = new NavGrid(opts.plan);
    this.wsById = new Map(opts.plan.workstations.map((w) => [w.id, w]));
    this.eqById = new Map(opts.plan.equipment.map((e) => [e.id, e]));
    this.sensorById = new Map(opts.plan.sensors.map((s) => [s.id, s]));
    for (const ws of opts.plan.workstations) {
      this.slots.set(ws.id, new Array(Math.max(1, ws.capacity)).fill(null));
      this.wsBusy.set(ws.id, 0);
    }
    this.riceStockKg = opts.plan.format === "C" ? 14 : opts.plan.format === "B" ? 10 : 7;
    const k = opts.plan.format === "C" ? 1.6 : opts.plan.format === "A" ? 0.7 : 1;
    this.chickenTarget = { wing: Math.round(28 * k), drum: Math.round(18 * k) };
    this.chickenStock = { wing: Math.round(this.chickenTarget.wing * 0.8), drum: Math.round(this.chickenTarget.drum * 0.8) };
    this.initEquipment();
    this.initSensors();
    this.initInventory();
    this.initSeats();
    this.initStaff();
    this.nextArrival = this.rng.exp(this.arrivalRatePerSec()) * 0.5;
    this.log("system", "info", `Simulation started for ${this.branchName} (${opts.plan.name}). All activity is simulated demo data.`);
  }

  // ───────────────────────────── clock ─────────────────────────────
  now() {
    return this.clockStart + this.t * 1000;
  }
  hour() {
    const d = new Date(this.now());
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  }
  isOpen() {
    return this.isOpenFn(this.now());
  }

  /** Advance by `simSeconds` using fixed steps (deterministic for a given total). */
  advance(simSeconds: number, maxSteps = 400) {
    this.acc += simSeconds;
    let n = 0;
    while (this.acc >= STEP && n < maxSteps) {
      this.step(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === maxSteps) this.acc = 0;
    if (n) this.version++;
  }

  private step(dt: number) {
    this.t += dt;
    this.arrivals();
    this.updateOrders();
    this.schedule();
    for (const a of this.agents) if (!a.gone) this.updateAgent(a, dt);
    this.updateMachines();
    this.accumulateUtilization(dt);
    if (this.t >= this.nextSensor) {
      this.nextSensor = this.t + 30;
      this.updateSensors(30);
      this.updateInventoryStatus();
      this.updateCleaning();
      this.updateDeliveries();
      this.maybeRandomFault();
    }
    this.maintainRice();
    if (Math.floor(this.t / STEP) % 8 === 0) this.maintainChicken();
    if (this.agents.length > 120) this.agents = this.agents.filter((a) => !a.gone);
  }

  // ───────────────────────────── init ─────────────────────────────
  private initEquipment() {
    for (const e of this.plan.equipment) {
      const sp = e.operational.setpointC;
      this.equipment.set(e.id, {
        id: e.id,
        status: "idle",
        activeJobs: 0,
        tempC: sp !== undefined ? sp + (sp < 10 ? this.rng.range(-0.6, 0.6) : this.rng.range(-4, 2)) : undefined,
        oilQualityPct: e.type === "fryer" ? this.rng.range(55, 96) : undefined,
        cycles: 0,
        lastMaintenance: this.t - this.rng.range(2, 40) * DAY,
        lastInspection: this.t - this.rng.range(0.5, 4) * 3600,
      });
    }
  }

  private initSensors() {
    for (const s of this.plan.sensors) {
      this.sensors.set(s.id, { id: s.id, value: null, connected: true, status: "normal", history: [], source: "simulated" });
      if (s.kind === "cleaning-checklist") {
        const last = this.t - this.rng.range(10, this.safety.cleaningIntervalMin - 15) * 60;
        this.cleaning.push({ roomId: s.roomId, sensorId: s.id, lastDone: last, dueAt: last + this.safety.cleaningIntervalMin * 60 });
      }
    }
    // Pre-roll an hour of history so charts are populated on first open.
    for (let i = 0; i < 120; i++) this.updateSensors(30, this.t - (120 - i) * 30);
  }

  private storageLocation(cls: StorageClass): Equipment | undefined {
    const eq = this.plan.equipment;
    const inRoomType = (types: string[]) => (e: Equipment) => types.includes(this.plan.rooms.find((r) => r.id === e.roomId)?.type ?? "");
    switch (cls) {
      case "chilled":
        return eq.find((e) => e.type === "walk-in-cold") ?? eq.find((e) => e.type === "fridge" && inRoomType(["cold"])(e)) ?? eq.find((e) => e.type === "fridge");
      case "frozen":
        return eq.find((e) => e.type === "walk-in-freezer") ?? eq.find((e) => e.type === "freezer");
      case "dry":
        return eq.find((e) => e.type === "shelving" && inRoomType(["dry"])(e));
      case "packaging":
        return eq.find((e) => e.type === "shelving" && inRoomType(["packaging"])(e)) ?? eq.find((e) => e.type === "shelving" && inRoomType(["dry"])(e));
      case "drinks":
        return eq.find((e) => e.type === "drinks-fridge");
    }
  }

  private initInventory() {
    const scale = this.plan.format === "C" ? 1.6 : this.plan.format === "A" ? 0.6 : 1;
    const lowSku = this.rng.pick(["CHS-001", "CHK-WNG", "DGH-001", "PKG-PZ-M", "OIL-001"]);
    for (const d of INGREDIENTS) {
      const loc = this.storageLocation(d.storage);
      const reorder = Math.round(d.reorderLevel * scale * 10) / 10;
      let qty = Math.round(d.opening * scale * this.rng.range(0.75, 1.05) * 10) / 10;
      // One item starts just above its reorder level so a low-stock warning appears during the demo.
      if (d.sku === lowSku) qty = Math.round(reorder * 1.12 * 10) / 10;
      this.inventory.push({
        sku: d.sku,
        name: d.name,
        unit: d.unit,
        storage: d.storage,
        locationId: loc?.id ?? "unassigned",
        locationName: loc?.name ?? "Unassigned",
        qty,
        reorderLevel: reorder,
        unitCost: d.unitCost,
        supplier: d.supplier,
        expiresAt: this.now() + d.shelfLifeDays * DAY * 1000 * this.rng.range(0.25, 1),
        status: "OK",
        onOrder: 0,
      });
    }
    this.updateInventoryStatus();
  }

  private initSeats() {
    for (const f of this.plan.furniture) {
      if (!f.seats) continue;
      const c = Math.cos(f.rotation);
      const s = Math.sin(f.rotation);
      const offs: Vec2[] =
        f.type === "table-4" || f.type === "booth-4"
          ? [[-0.35, -0.62], [0.35, -0.62], [-0.35, 0.62], [0.35, 0.62]]
          : f.type === "table-2"
            ? [[0, -0.55], [0, 0.55]]
            : f.type === "stool-bar"
              ? [[-0.85, 0.55], [-0.3, 0.55], [0.3, 0.55], [0.85, 0.55]]
              : [[-0.5, 0], [0, 0], [0.5, 0]];
      for (const [ox, oz] of offs) this.seats.push([f.position[0] + ox * c + oz * s, f.position[2] - ox * s + oz * c]);
    }
  }

  private initStaff() {
    const roster = ROSTER[this.plan.format] ?? ROSTER.B;
    const used = new Set<string>();
    roster.forEach((role, i) => {
      let name = "";
      do name = `${this.rng.pick(STAFF_NAMES)} ${this.rng.pick(SURNAMES)}`;
      while (used.has(name));
      used.add(name);
      const home = this.homePoint(role, i);
      const id = `staff-${i + 1}`;
      this.agents.push({ id, kind: "staff", name, role, pos: [...home], heading: 0, path: [], speed: 1.25, anim: "idle", carrying: null, phase: "idle", timer: 0, seed: this.rng.int(0, 1e6), arrivedAt: this.t });
      this.staff.set(id, {
        agentId: id,
        name,
        role,
        skills: ROLE_SKILLS[role],
        shift: this.hour() < 15 ? "Morning 08:00–16:00" : "Evening 15:00–23:00",
        busySeconds: 0,
        tasksDone: 0,
        training: ["Food hygiene basics", role === "chicken" ? "Fryer safety" : role === "pizza" ? "Oven operation" : "Customer service"].concat(i % 3 === 0 ? ["Fire safety"] : []),
        homeWs: ROLE_SKILLS[role][0],
      });
    });
  }

  private homePoint(role: StaffRole, i: number): Vec2 {
    const ws = this.plan.workstations.filter((w) => w.type === ROLE_SKILLS[role][0]);
    const w = ws[i % Math.max(1, ws.length)];
    if (!w) return [...this.plan.anchors.staffRest];
    const off = (i % 2 ? 0.5 : -0.5) * (role === "cashier" ? 1.4 : 0.6);
    const e = this.eqById.get(w.equipmentIds[0]);
    const rot = e?.rotation ?? 0;
    return [w.standPoint[0] + Math.cos(rot) * off, w.standPoint[1] - Math.sin(rot) * off];
  }

  // ───────────────────────────── events ─────────────────────────────
  log(type: SimEvent["type"], severity: SimEvent["severity"], message: string, refs?: SimEvent["refs"]) {
    this.events.push({ id: `${this.branchId}-ev-${++this.seq}`, t: this.now(), type, severity, message, refs });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // ───────────────────────────── demand ─────────────────────────────
  arrivalRatePerSec() {
    return (this.config.arrivalRate / 3600) * demandFactor(this.hour());
  }

  private arrivals() {
    if (this.t < this.nextArrival) return;
    this.nextArrival = this.t + this.rng.exp(Math.max(this.arrivalRatePerSec(), 0.2 / 3600));
    if (!this.isOpen()) return;
    if (this.rng.chance(this.config.deliveryShare)) {
      const channel = this.rng.weighted<Channel>([["chris-b-app", 45], ["online", 20], ["phone", 15], ["delivery-partner", 20]]);
      this.createOrder(this.randomLines(), channel, "delivery");
    } else {
      this.spawnCustomer();
    }
  }

  randomLines() {
    const n = this.rng.weighted([[1, 55], [2, 32], [3, 13]] as const);
    const lines = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const m = this.rng.weighted(MENU.map((x) => [x.id, x.weight] as const));
      lines.set(m, (lines.get(m) ?? 0) + 1);
    }
    return [...lines].map(([menuId, qty]) => ({ menuId, qty }));
  }

  // ───────────────────────────── orders ─────────────────────────────
  createOrder(lines: Array<{ menuId: string; qty: number }>, channel: Channel, fulfilment: Fulfilment, customerId?: string): Order {
    const id = `${this.branchId}-ord-${++this.orderNo}`;
    const ol = lines.map((l) => {
      const m = MENU_BY_ID.get(l.menuId)!;
      return { menuId: m.id, name: m.name, qty: l.qty, price: m.price };
    });
    const order: Order = {
      id,
      number: this.orderNo,
      channel,
      fulfilment,
      lines: ol,
      total: ol.reduce((s, l) => s + l.qty * l.price, 0),
      status: "RECEIVED",
      createdAt: this.t,
      slaMin: fulfilment === "delivery" ? 22 : 18,
      delayed: false,
      customerId,
      unitIds: [],
      history: [{ t: this.t, status: "RECEIVED" }],
      inventoryConsumed: false,
    };
    if (fulfilment === "delivery") order.delivery = { status: "AWAITING_DISPATCH" };
    this.orders.set(id, order);
    this.log("order", "info", `Order #${order.number} received via ${channelLabel(channel)} — ${ol.map((l) => `${l.qty}× ${l.name}`).join(", ")}`, { orderId: id });
    if (channel === "walk-in" || channel === "pos" || channel === "demo") this.accept(order);
    return order;
  }

  /** Manually inject an order (used by the demo "new order" control and the AI assistant). */
  placeOrder(lines: Array<{ menuId: string; qty: number }>, channel: Channel = "demo", fulfilment: Fulfilment = "delivery") {
    const o = this.createOrder(lines, channel, fulfilment);
    this.version++;
    return o;
  }

  private accept(order: Order) {
    this.setStatus(order, "ACCEPTED");
    order.acceptedAt = this.t;
    for (const l of order.lines) {
      const m = MENU_BY_ID.get(l.menuId)!;
      for (let q = 0; q < l.qty; q++)
        for (const spec of m.units) {
          const u: Unit = { id: `${order.id}-u${order.unitIds.length + 1}`, orderId: order.id, kind: spec.kind, label: spec.label, stages: stagesFor(spec), stageIndex: 0, done: false, grams: spec.grams, pieces: spec.pieces, cut: spec.cut };
          this.units.set(u.id, u);
          order.unitIds.push(u.id);
        }
    }
    this.setStatus(order, "KITCHEN_QUEUE");
    for (const uid of order.unitIds) this.advanceUnit(this.units.get(uid)!);
    this.checkOrderUnitsDone(order);
  }

  private setStatus(order: Order, s: OrderStatus, note?: string) {
    const terminal = ["COMPLETED", "CANCELLED", "FAILED", "REFUNDED"];
    if (terminal.includes(order.status) && s !== "REFUNDED") return;
    if (!terminal.includes(s) && ORDER_FLOW.indexOf(s) <= ORDER_FLOW.indexOf(order.status)) return;
    order.status = s;
    order.history.push({ t: this.t, status: s, note });
  }

  private updateOrders() {
    for (const o of this.orders.values()) {
      if (o.status === "RECEIVED" && this.t - o.createdAt > 25) this.accept(o);
      if (!o.delayed && o.acceptedAt !== undefined && !o.readyAt && ["KITCHEN_QUEUE", "PREPARATION", "COOKING", "QUALITY_CHECK", "PACKAGING"].includes(o.status) && this.t - o.acceptedAt > o.slaMin * 60) {
        o.delayed = true;
        this.log("order", "warning", `Order #${o.number} is delayed (> ${o.slaMin} min in kitchen)`, { orderId: o.id });
      }
    }
  }

  private advanceUnit(u: Unit) {
    const stage = u.stages[u.stageIndex];
    if (!stage) {
      u.done = true;
      return;
    }
    this.addTask({ kind: "stage", ws: stage.ws, orderId: u.orderId, unitId: u.id, label: `${stage.name} — ${u.label}`, duration: stage.duration * this.rng.range(0.9, 1.15), machine: stage.machine, priority: this.orders.get(u.orderId)!.createdAt });
  }

  private addTask(t: Omit<Task, "id" | "state" | "createdAt">) {
    const id = `${this.branchId}-task-${++this.seq}`;
    const task: Task = { ...t, id, state: "pending", createdAt: this.t };
    this.tasks.set(id, task);
    return task;
  }

  private checkOrderUnitsDone(order: Order) {
    if (!["KITCHEN_QUEUE", "PREPARATION", "COOKING", "QUALITY_CHECK"].includes(order.status)) return;
    const units = order.unitIds.map((id) => this.units.get(id)!);
    if (units.every((u) => u.done)) {
      this.setStatus(order, "PACKAGING");
      this.addTask({ kind: "pack", ws: "packaging", orderId: order.id, label: `Pack order #${order.number}`, duration: 20 + 5 * units.length, machine: false, priority: order.createdAt - 30 });
    }
  }

  cancelOrder(orderId: string, reason = "Cancelled by manager") {
    const o = this.orders.get(orderId);
    if (!o || ["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status)) return false;
    for (const t of this.tasks.values()) if (t.orderId === orderId && t.state !== "done") this.releaseTask(t, true);
    this.setStatus(o, "CANCELLED", reason);
    o.note = reason;
    this.log("order", "warning", `Order #${o.number} cancelled — ${reason}`, { orderId });
    const c = this.agents.find((a) => a.id === o.customerId);
    if (c) this.sendHome(c);
    this.version++;
    return true;
  }

  refundOrder(orderId: string) {
    const o = this.orders.get(orderId);
    if (!o || !["COMPLETED", "CANCELLED", "FAILED"].includes(o.status)) return false;
    this.setStatus(o, "REFUNDED", "Refund issued (simulated)");
    this.log("order", "info", `Order #${o.number} refunded (simulated)`, { orderId });
    this.version++;
    return true;
  }

  private completeOrder(o: Order) {
    this.setStatus(o, "COMPLETED");
    o.completedAt = this.t;
    if (o.acceptedAt !== undefined && o.readyAt !== undefined) this.prepTimes.push((o.readyAt - o.acceptedAt) / 60);
    this.consumeForOrder(o);
    this.log("order", "success", `Order #${o.number} completed (${fulfilmentLabel(o.fulfilment)})`, { orderId: o.id });
  }

  // ───────────────────────────── scheduling ─────────────────────────────
  private freeSlot(wsId: string): number {
    return this.slots.get(wsId)?.indexOf(null) ?? -1;
  }

  private releaseTask(t: Task, cancel = false) {
    if (t.wsId !== undefined && t.slot !== undefined) {
      const s = this.slots.get(t.wsId);
      if (s && s[t.slot] === t.id) s[t.slot] = null;
    }
    if (t.staffId) {
      const a = this.agents.find((x) => x.id === t.staffId);
      if (a && a.taskId === t.id) {
        a.taskId = undefined;
        a.phase = "idle";
        a.carrying = null;
      }
    }
    t.state = "done";
    if (cancel) this.tasks.delete(t.id);
  }

  private stationFor(task: Task, near: Vec2): Workstation | undefined {
    let best: Workstation | undefined;
    let bestD = Infinity;
    // Prefer the station where the product currently sits (e.g. QC nearest to the oven it came out of).
    const unit = task.unitId ? this.units.get(task.unitId) : undefined;
    const from = unit?.atWorkstation ? this.wsById.get(unit.atWorkstation)?.standPoint : undefined;
    for (const ws of this.plan.workstations) {
      if (ws.type !== task.ws || this.freeSlot(ws.id) < 0) continue;
      const ref = from ?? near;
      const d = Math.hypot(ws.standPoint[0] - ref[0], ws.standPoint[1] - ref[1]) + (this.slots.get(ws.id)!.filter(Boolean).length * 1.5);
      if (d < bestD) {
        bestD = d;
        best = ws;
      }
    }
    return best;
  }

  private schedule() {
    const idle = this.agents.filter((a) => a.kind === "staff" && !a.taskId && !a.gone);
    if (!idle.length) return;
    const pending = [...this.tasks.values()].filter((t) => t.state === "pending").sort((a, b) => a.priority - b.priority);
    for (const task of pending) {
      if (!idle.length) break;
      if (task.kind === "stage" && task.ws === "rice") {
        const u = this.units.get(task.unitId!);
        if (u?.grams && this.riceStockKg * 1000 < u.grams) continue;
      }
      if (task.kind === "stage" && task.unitId) {
        const u = this.units.get(task.unitId);
        if (u?.cut && u.pieces && this.chickenStock[u.cut] < u.pieces) continue;
      }
      const candidates = idle.filter((a) => {
        const m = this.staff.get(a.id)!;
        if (task.kind === "clean") return m.role !== "cashier" || task.ws === "order-counter";
        return m.skills.includes(task.ws);
      });
      if (!candidates.length) continue;
      // Prefer specialists whose primary station matches, then the nearest.
      candidates.sort((a, b) => {
        const pa = this.staff.get(a.id)!.skills.indexOf(task.ws);
        const pb = this.staff.get(b.id)!.skills.indexOf(task.ws);
        if (pa !== pb) return (pa < 0 ? 9 : pa) - (pb < 0 ? 9 : pb);
        return dist(a.pos, task.target ?? a.pos) - dist(b.pos, task.target ?? b.pos);
      });
      const agent = candidates[0];
      let dest: Vec2;
      if (task.kind === "clean") {
        dest = task.target!;
      } else {
        const ws = this.stationFor(task, agent.pos);
        if (!ws) continue;
        const slot = this.freeSlot(ws.id);
        this.slots.get(ws.id)![slot] = task.id;
        task.wsId = ws.id;
        task.slot = slot;
        dest = this.slotPoint(ws, slot);
      }
      task.state = "assigned";
      task.staffId = agent.id;
      agent.taskId = task.id;
      agent.phase = "to-task";
      const unit = task.unitId ? this.units.get(task.unitId) : undefined;
      agent.carrying = task.kind === "pack" ? "box" : task.kind === "handoff" ? "bag" : task.kind === "rice-batch" ? "crate" : task.kind === "chicken-batch" && task.batch!.step > 0 ? "chicken" : unit && unit.stageIndex > 0 ? unit.kind : null;
      this.goTo(agent, dest);
      idle.splice(idle.indexOf(agent), 1);
      const order = task.orderId ? this.orders.get(task.orderId) : undefined;
      if (order && task.kind === "stage") this.setStatus(order, "PREPARATION");
    }
  }

  /** Standing point for a workstation slot: spread operators along the equipment front. */
  slotPoint(ws: Workstation, slot: number): Vec2 {
    const e = this.eqById.get(ws.equipmentIds[slot % ws.equipmentIds.length]) ?? this.eqById.get(ws.equipmentIds[0]);
    if (!e) return ws.standPoint;
    const rot = e.rotation;
    const dist = e.size[2] / 2 + 0.5;
    const base: Vec2 = [e.position[0] + Math.sin(rot) * dist, e.position[2] + Math.cos(rot) * dist];
    const perSide = Math.floor(slot / ws.equipmentIds.length);
    const off = perSide === 0 ? 0 : (perSide % 2 ? 1 : -1) * Math.min(e.size[0] / 2 - 0.2, 0.55);
    return [base[0] + Math.cos(rot) * off, base[1] - Math.sin(rot) * off];
  }

  private startWork(agent: Agent, task: Task) {
    task.state = "working";
    task.startedAt = this.t;
    const loadOnly = task.machine ? 8 : task.duration;
    task.endsAt = this.t + loadOnly;
    agent.phase = "working";
    agent.anim = task.kind === "clean" ? "clean" : "work";
    const ws = task.wsId ? this.wsById.get(task.wsId) : undefined;
    const e = ws ? this.eqById.get(ws.equipmentIds[(task.slot ?? 0) % ws.equipmentIds.length]) : undefined;
    agent.look = e ? [e.position[0], e.position[2]] : task.target;
    if (task.unitId) {
      const u = this.units.get(task.unitId)!;
      u.atWorkstation = task.wsId;
      u.slot = task.slot;
    }
    agent.carrying = null;
    if (task.machine && e) {
      const st = this.equipment.get(e.id);
      if (st) st.activeJobs++;
    }
    const order = task.orderId ? this.orders.get(task.orderId) : undefined;
    if (order && task.unitId) {
      const phase = this.units.get(task.unitId)!.stages[this.units.get(task.unitId)!.stageIndex]?.phase;
      if (phase) this.setStatus(order, phase);
    }
  }

  private finishWork(agent: Agent, task: Task) {
    const member = this.staff.get(agent.id);
    if (member) member.tasksDone++;
    agent.taskId = undefined;
    agent.phase = "idle";
    agent.anim = "idle";
    if (task.machine) {
      task.state = "machine";
      task.endsAt = this.t + task.duration;
      task.staffId = undefined;
      return;
    }
    this.completeTask(task, agent);
  }

  private updateMachines() {
    for (const task of this.tasks.values()) {
      if (task.state === "machine" && this.t >= task.endsAt!) {
        const ws = this.wsById.get(task.wsId!);
        const e = ws ? this.eqById.get(ws.equipmentIds[(task.slot ?? 0) % ws.equipmentIds.length]) : undefined;
        if (e) {
          const st = this.equipment.get(e.id)!;
          st.activeJobs = Math.max(0, st.activeJobs - 1);
          st.cycles++;
          if (st.oilQualityPct !== undefined) st.oilQualityPct = Math.max(0, st.oilQualityPct - 0.35);
        }
        this.completeTask(task);
      }
    }
  }

  private completeTask(task: Task, agent?: Agent) {
    // Free the slot; machine-stage products stay visually at the station until collected.
    if (task.wsId !== undefined && task.slot !== undefined) {
      const s = this.slots.get(task.wsId);
      if (s && s[task.slot] === task.id) s[task.slot] = null;
    }
    task.state = "done";
    this.tasks.delete(task.id);
    const order = task.orderId ? this.orders.get(task.orderId) : undefined;
    switch (task.kind) {
      case "stage": {
        const u = this.units.get(task.unitId!)!;
        const stage = u.stages[u.stageIndex];
        if (stage?.ws === "rice" && u.grams) this.riceStockKg = Math.max(0, this.riceStockKg - u.grams / 1000);
        if (u.cut && u.pieces) this.chickenStock[u.cut] = Math.max(0, this.chickenStock[u.cut] - u.pieces);
        u.stageIndex++;
        if (u.stageIndex >= u.stages.length) {
          u.done = true;
          if (order) this.checkOrderUnitsDone(order);
        } else this.advanceUnit(u);
        break;
      }
      case "pack": {
        if (!order) break;
        for (const uid of order.unitIds) {
          const u = this.units.get(uid);
          if (u) u.atWorkstation = task.wsId;
        }
        const ws = order.fulfilment === "delivery" ? "dispatch" : "pickup";
        this.addTask({ kind: "handoff", ws, orderId: order.id, label: `Take order #${order.number} to ${ws === "dispatch" ? "dispatch rack" : "collection counter"}`, duration: 4, machine: false, priority: order.createdAt - 60 });
        if (order.fulfilment === "delivery" && !order.riderId) this.spawnRider(order);
        break;
      }
      case "serve":
        // The waiting customer notices the task is gone and places the order.
        break;
      case "handoff": {
        if (!order) break;
        for (const uid of order.unitIds) {
          const u = this.units.get(uid);
          if (u) u.atWorkstation = task.wsId;
        }
        order.readyAt = this.t;
        this.setStatus(order, "READY");
        this.log("kitchen", "success", `Order #${order.number} ready for ${order.fulfilment === "delivery" ? "dispatch" : "collection"}`, { orderId: order.id });
        break;
      }
      case "rice-batch": {
        this.riceStockKg += 8;
        this.consume(`batch:${task.id}`, { "RIC-001": 3.6, "JLB-001": 1.8, "OIL-001": 0.8, "SPC-001": 0.05 }, "production", task.id);
        this.log("kitchen", "info", `Rice batch cooked — warmer now holds ${this.riceStockKg.toFixed(1)} kg`);
        break;
      }
      case "chicken-batch": {
        const b = task.batch!;
        const spec = CHICKEN_BATCH[b.cut];
        const stage = spec.stages[b.step];
        if (stage.ws === "qc") {
          const pass = !this.rng.chance(0.03);
          const valueC = pass ? this.rng.range(77, 91) : this.rng.range(70.5, 74.5);
          this.recordCookCheck(task, valueC, pass);
          if (!pass) {
            this.log("safety", "warning", `Core temperature ${valueC.toFixed(1)} °C below ${this.safety.cookCoreMinC} °C on ${b.cut} batch — returned to fryer`);
            this.addBatchStep(b.cut, b.pieces, b.step - 1, task.priority);
            break;
          }
          this.chickenStock[b.cut] += b.pieces;
          this.log("kitchen", "info", `${b.pieces} ${b.cut === "wing" ? "wings" : "drumsticks"} passed core-temp check (${valueC.toFixed(1)} °C) → hot-holding`);
        } else this.addBatchStep(b.cut, b.pieces, b.step + 1, task.priority);
        break;
      }
      case "clean": {
        const rec = this.cleaning.find((c) => c.roomId === task.roomId);
        if (rec) {
          rec.lastDone = this.t;
          rec.dueAt = this.t + this.safety.cleaningIntervalMin * 60;
          rec.by = agent?.name;
        }
        const room = this.plan.rooms.find((r) => r.id === task.roomId);
        this.log("safety", "info", `Cleaning checklist completed — ${room?.name ?? "area"}${agent ? ` by ${agent.name}` : ""}`);
        break;
      }
    }
  }

  private recordCookCheck(task: Task, valueC: number, pass: boolean) {
    this.cookChecks.push({ t: this.now(), unitId: task.id, orderId: task.orderId ?? "", valueC, pass });
    if (this.cookChecks.length > 200) this.cookChecks.shift();
    const roomId = task.wsId ? this.wsById.get(task.wsId)?.roomId : undefined;
    const sensor = this.plan.sensors.find((s) => s.kind === "cook-temp-check" && s.roomId === roomId) ?? this.plan.sensors.find((s) => s.kind === "cook-temp-check");
    if (!sensor) return;
    const st = this.sensors.get(sensor.id)!;
    st.value = round1(valueC);
    st.history.push({ t: this.now(), v: st.value });
    if (st.history.length > 240) st.history.shift();
    st.status = pass ? "normal" : "warning";
  }

  private addBatchStep(cut: "wing" | "drum", pieces: number, step: number, priority: number) {
    const stage = CHICKEN_BATCH[cut].stages[step];
    this.addTask({ kind: "chicken-batch", ws: stage.ws, label: stage.name, duration: stage.duration * this.rng.range(0.92, 1.1), machine: stage.machine, priority, batch: { cut, pieces, step } });
  }

  /** Keep hot-holding topped up: held stock + batches in progress must cover the target plus waiting demand. */
  private maintainChicken() {
    for (const cut of ["wing", "drum"] as const) {
      let inflight = 0;
      for (const t of this.tasks.values()) if (t.kind === "chicken-batch" && t.batch!.cut === cut) inflight += t.batch!.pieces;
      let demand = 0;
      for (const t of this.tasks.values()) {
        if (t.state !== "pending" || !t.unitId) continue;
        const u = this.units.get(t.unitId);
        if (u?.cut === cut) demand += u.pieces ?? 0;
      }
      if (this.chickenStock[cut] + inflight < this.chickenTarget[cut] + demand) {
        // Waiting orders raise batch priority so fryers serve the queue first.
        this.addBatchStep(cut, CHICKEN_BATCH[cut].pieces, 0, demand > 0 ? this.t - 900 : this.t + 300);
      }
    }
  }

  private maintainRice() {
    if (this.riceStockKg > 3.5) return;
    if ([...this.tasks.values()].some((t) => t.kind === "rice-batch")) return;
    if (!this.plan.workstations.some((w) => w.type === "rice")) return;
    this.addTask({ kind: "rice-batch", ws: "rice", label: "Cook jollof / fried rice batch (≈8 kg)", duration: 900, machine: true, priority: this.t - 600 });
  }

  // ───────────────────────────── agents ─────────────────────────────
  private goTo(a: Agent, dest: Vec2) {
    a.path = this.grid.findPath(a.pos, dest) ?? [dest];
  }

  private move(a: Agent, dt: number): boolean {
    if (!a.path.length) return true;
    let remaining = a.speed * dt;
    while (remaining > 0 && a.path.length) {
      const [tx, tz] = a.path[0];
      const dx = tx - a.pos[0];
      const dz = tz - a.pos[1];
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) {
        a.path.shift();
        continue;
      }
      a.heading = Math.atan2(dx, dz);
      if (remaining >= d) {
        a.pos = [tx, tz];
        a.path.shift();
        remaining -= d;
      } else {
        a.pos = [a.pos[0] + (dx / d) * remaining, a.pos[1] + (dz / d) * remaining];
        remaining = 0;
      }
    }
    a.anim = a.path.length ? (a.carrying ? "carry" : "walk") : a.anim === "walk" || a.anim === "carry" ? "idle" : a.anim;
    return a.path.length === 0;
  }

  private updateAgent(a: Agent, dt: number) {
    if (a.kind === "staff") return this.updateStaff(a, dt);
    if (a.kind === "customer") return this.updateCustomer(a, dt);
    return this.updateRider(a, dt);
  }

  private updateStaff(a: Agent, dt: number) {
    const task = a.taskId ? this.tasks.get(a.taskId) : undefined;
    if (a.taskId && !task) {
      a.taskId = undefined;
      a.phase = "idle";
    }
    const m = this.staff.get(a.id)!;
    switch (a.phase) {
      case "to-task":
        if (this.move(a, dt) && task) this.startWork(a, task);
        break;
      case "working":
        m.busySeconds += dt;
        if (task && this.t >= task.endsAt!) this.finishWork(a, task);
        break;
      default: {
        // Idle: drift back to home station and face it.
        if (!a.path.length) {
          const home = this.homePoint(m.role, Number(a.id.split("-")[1]) - 1);
          if (dist(a.pos, home) > 0.4) this.goTo(a, home);
          else a.anim = "idle";
        }
        this.move(a, dt);
      }
    }
  }

  private spawnCustomer() {
    if (this.queue.length >= 9) {
      this.lostCustomers++;
      this.log("customer", "warning", "Walk-in customer left — queue too long");
      return;
    }
    const out = this.plan.anchors.outside;
    const id = `${this.branchId}-cust-${++this.seq}`;
    const a: Agent = { id, kind: "customer", name: `Customer ${this.seq}`, pos: [out[0] + this.rng.range(-2, 2), out[1] + this.rng.range(-1, 0.5)], heading: 0, path: [], speed: this.rng.range(0.95, 1.2), anim: "walk", carrying: null, phase: "to-queue", timer: 0, seed: this.rng.int(0, 1e6), arrivedAt: this.t };
    this.agents.push(a);
    this.queue.push(id);
    this.goTo(a, this.queueSlot(this.queue.length - 1));
  }

  private queueSlot(i: number): Vec2 {
    const { queueHead: h, queueDir: d } = this.plan.anchors;
    return [h[0] + d[0] * i * 0.75 + (i % 2 ? 0.12 : -0.12), h[1] + d[1] * i * 0.75];
  }

  private sendHome(a: Agent) {
    a.phase = "leave";
    this.queue = this.queue.filter((q) => q !== a.id);
    if (a.seat !== undefined) this.seatsTaken.delete(a.seat);
    const out = this.plan.anchors.outside;
    this.goTo(a, [out[0] + this.rng.range(-3, 3), out[1] - 1.5]);
  }

  private updateCustomer(a: Agent, dt: number) {
    const order = a.orderId ? this.orders.get(a.orderId) : undefined;
    switch (a.phase) {
      case "to-queue":
      case "queue": {
        const idx = this.queue.indexOf(a.id);
        const slot = this.queueSlot(idx);
        if (dist(a.path.at(-1) ?? a.pos, slot) > 0.3) this.goTo(a, slot);
        const arrived = this.move(a, dt);
        if (arrived) {
          a.phase = "queue";
          a.anim = "wait";
          a.look = [slot[0] - this.plan.anchors.queueDir[0], slot[1] - this.plan.anchors.queueDir[1]];
          if (idx === 0 && !a.taskId) {
            const t = this.addTask({ kind: "serve", ws: "order-counter", label: `Take walk-in order (${a.name})`, duration: this.rng.range(30, 55), machine: false, priority: -1e9 + this.t });
            a.taskId = t.id;
            a.phase = "ordering";
          }
        }
        break;
      }
      case "ordering": {
        const t = a.taskId ? this.tasks.get(a.taskId) : undefined;
        if (!t) {
          // Cashier finished: the order is created now.
          const fulfil: Fulfilment = this.seats.length && this.rng.chance(this.config.dineInShare) ? "dine-in" : "pickup";
          const o = this.createOrder(this.randomLines(), "walk-in", fulfil, a.id);
          a.orderId = o.id;
          a.taskId = undefined;
          this.queue = this.queue.filter((q) => q !== a.id);
          a.phase = "waiting";
          const w = this.plan.anchors.waiting;
          this.goTo(a, [w[0] + this.rng.range(-0.9, 0.9), w[1] + this.rng.range(-0.7, 0.7)]);
        }
        break;
      }
      case "waiting": {
        if (this.move(a, dt)) a.anim = "wait";
        if (order?.status === "READY") {
          a.phase = "to-pickup";
          const p = this.plan.anchors.pickup;
          this.goTo(a, [p[0] + this.rng.range(-0.5, 0.5), p[1]]);
        } else if (!order || order.status === "CANCELLED") this.sendHome(a);
        break;
      }
      case "to-pickup":
        if (this.move(a, dt)) {
          a.phase = "collect";
          a.timer = 6;
          a.anim = "work";
          a.look = [this.plan.anchors.pickup[0], this.plan.anchors.pickup[1] + 1];
        }
        break;
      case "collect":
        a.timer -= dt;
        if (a.timer <= 0 && order) {
          a.carrying = "bag";
          this.waitTimes.push((this.t - a.arrivedAt) / 60);
          this.completeOrder(order);
          const free = order.fulfilment === "dine-in" ? this.seats.findIndex((_, i) => !this.seatsTaken.has(i)) : -1;
          if (free >= 0) {
            a.seat = free;
            this.seatsTaken.add(free);
            a.phase = "to-seat";
            this.goTo(a, this.seats[free]);
          } else this.sendHome(a);
        }
        break;
      case "to-seat":
        if (this.move(a, dt)) {
          a.phase = "sitting";
          a.anim = "sit";
          a.carrying = null;
          a.timer = this.rng.range(8, 16) * 60;
          const s = this.seats[a.seat!];
          const table = this.plan.furniture.reduce((best, f) => (dist([f.position[0], f.position[2]], s) < dist([best.position[0], best.position[2]], s) ? f : best), this.plan.furniture[0]);
          a.look = [table.position[0], table.position[2]];
        }
        break;
      case "sitting":
        a.timer -= dt;
        if (a.timer <= 0) this.sendHome(a);
        break;
      case "leave":
        if (this.move(a, dt)) a.gone = true;
        break;
    }
  }

  private riderSpawnPoint(): Vec2 {
    const door = this.plan.doors.find((d) => d.kind === "delivery") ?? this.plan.doors[0];
    const cx = this.plan.dimensions.width / 2;
    const cz = this.plan.dimensions.length / 2;
    return door.axis === "x" ? [door.x, door.z + (door.z < cz ? -4 : 4)] : [door.x + (door.x < cx ? -4 : 4), door.z];
  }

  private spawnRider(order: Order) {
    const id = `${this.branchId}-rider-${++this.seq}`;
    const start = this.riderSpawnPoint();
    const a: Agent = { id, kind: "rider", name: `Rider ${this.seq}`, pos: start, heading: 0, path: [], speed: 1.3, anim: "walk", carrying: null, orderId: order.id, phase: "to-wait", timer: 0, seed: this.rng.int(0, 1e6), arrivedAt: this.t };
    this.agents.push(a);
    order.riderId = id;
    order.delivery = { ...order.delivery!, status: "RIDER_ASSIGNED", rider: order.channel === "delivery-partner" ? "Partner courier (simulated)" : "Branch dispatch rider (simulated)" };
    const w = this.plan.anchors.riderWait;
    this.goTo(a, [w[0] + this.rng.range(-0.4, 0.4), w[1] + this.rng.range(-0.4, 0.4)]);
  }

  private updateRider(a: Agent, dt: number) {
    const order = a.orderId ? this.orders.get(a.orderId) : undefined;
    switch (a.phase) {
      case "to-wait":
        if (this.move(a, dt)) {
          a.phase = "waiting";
          a.anim = "wait";
        }
        break;
      case "waiting":
        if (order?.status === "READY") {
          const rack = this.plan.workstations.find((w) => w.type === "dispatch");
          a.phase = "to-rack";
          this.goTo(a, rack ? rack.standPoint : this.plan.anchors.riderWait);
        } else if (!order || order.status === "CANCELLED") {
          a.phase = "leave";
          this.goTo(a, this.riderSpawnPoint());
        }
        break;
      case "to-rack":
        if (this.move(a, dt)) {
          a.phase = "collect";
          a.timer = 6;
          a.anim = "work";
        }
        break;
      case "collect":
        a.timer -= dt;
        if (a.timer <= 0 && order) {
          a.carrying = "bag";
          this.setStatus(order, "OUT_FOR_DELIVERY");
          // COLLECTED until the rider leaves the premises, then IN_TRANSIT (see updateRider "leave").
          order.delivery = { ...order.delivery!, status: "COLLECTED", collectedAt: this.t, eta: this.t + this.rng.range(12, 32) * 60 };
          this.log("delivery", "info", `Order #${order.number} collected by ${order.delivery.rider}`, { orderId: order.id });
          a.phase = "leave";
          this.goTo(a, this.riderSpawnPoint());
        }
        break;
      case "leave":
        if (this.move(a, dt)) {
          a.gone = true;
          if (order?.delivery?.status === "COLLECTED") order.delivery.status = "IN_TRANSIT";
        }
        break;
    }
  }

  private updateDeliveries() {
    for (const o of this.orders.values()) {
      const d = o.delivery;
      if (!d || o.status !== "OUT_FOR_DELIVERY" || d.eta === undefined) continue;
      if (this.t >= d.eta) {
        d.status = "DELIVERED";
        d.deliveredAt = this.t;
        this.completeOrder(o);
      } else if (d.status !== "DELAYED" && this.t - o.createdAt > 50 * 60) {
        d.status = "DELAYED";
        this.log("delivery", "warning", `Delivery for order #${o.number} running late`, { orderId: o.id });
      }
    }
  }

  // ───────────────────────────── utilisation ─────────────────────────────
  private accumulateUtilization(dt: number) {
    for (const [wsId, s] of this.slots) {
      const used = s.filter(Boolean).length;
      if (used) this.wsBusy.set(wsId, (this.wsBusy.get(wsId) ?? 0) + (used / s.length) * dt);
    }
    for (const e of this.equipment.values()) {
      e.status = e.fault ? (e.fault.kind === "sensor-offline" ? "offline" : "fault") : e.activeJobs > 0 ? "active" : "idle";
    }
    // Staffed (non-machine) stations count as active while someone is working there.
    for (const t of this.tasks.values()) {
      if (t.state !== "working" || !t.wsId) continue;
      const ws = this.wsById.get(t.wsId)!;
      const e = this.equipment.get(ws.equipmentIds[(t.slot ?? 0) % ws.equipmentIds.length]);
      if (e && e.status === "idle") e.status = "active";
    }
  }

  // ───────────────────────────── safety ─────────────────────────────
  private limitFor(sensor: Sensor): { kind: "max" | "min"; value: number; severity: Alert["severity"] } | null {
    switch (sensor.thresholdProfile) {
      case "chilled":
        return { kind: "max", value: this.safety.chilledMaxC, severity: "critical" };
      case "frozen":
        return { kind: "max", value: this.safety.frozenMaxC, severity: "critical" };
      case "hotHolding":
        return { kind: "min", value: this.safety.hotHoldingMinC, severity: "critical" };
      case "oilQuality":
        return { kind: "min", value: this.safety.oilQualityMinPct, severity: "warning" };
      default:
        return null;
    }
  }

  private updateSensors(dt: number, at?: number) {
    const tNow = at ?? this.t;
    const ms = this.clockStart + tNow * 1000;
    for (const s of this.plan.sensors) {
      const st = this.sensors.get(s.id)!;
      const e = s.equipmentId ? this.eqById.get(s.equipmentId) : undefined;
      const es = e ? this.equipment.get(e.id) : undefined;
      if (st.source === "live") {
        if (at === undefined) this.evaluateLiveSensor(s, st, tNow);
        continue;
      }
      if (es?.fault?.kind === "sensor-offline") {
        st.connected = false;
        st.value = null;
        st.status = "offline";
        st.history.push({ t: ms, v: null });
        if (st.history.length > 240) st.history.shift();
        continue;
      }
      st.connected = true;
      if (es && es.tempC !== undefined && e?.operational.setpointC !== undefined && ["fridge-temp", "freezer-temp", "hot-holding-temp"].includes(s.kind)) {
        const sp = e.operational.setpointC;
        if (es.fault?.kind === "compressor" || es.fault?.kind === "door-seal") {
          const rate = es.fault.kind === "compressor" ? 0.012 : 0.006;
          es.tempC = Math.min(sp + (s.kind === "freezer-temp" ? 16 : 11), es.tempC + rate * dt + this.rng.gauss() * 0.05);
        } else if (es.fault?.kind === "thermostat") {
          es.tempC = Math.max(sp - 18, es.tempC - 0.01 * dt);
        } else {
          es.tempC += (sp - es.tempC) * 0.15 + this.rng.gauss() * (sp > 30 ? 0.6 : 0.15);
          if (s.kind === "fridge-temp" && this.rng.chance(0.03)) es.tempC += this.rng.range(0.6, 1.4);
        }
        st.value = round1(es.tempC);
      } else if (s.kind === "oil-quality" && es?.oilQualityPct !== undefined) {
        st.value = Math.round(es.oilQualityPct);
      } else if (s.kind === "cleaning-checklist") {
        const rec = this.cleaning.find((c) => c.sensorId === s.id);
        st.status = rec && tNow > rec.dueAt ? "warning" : "normal";
        st.note = rec ? (tNow > rec.dueAt ? "Overdue" : "Up to date") : undefined;
      } else if (s.kind === "equipment-health") {
        st.status = es?.fault ? "critical" : "normal";
      }
      if (st.value !== null && !["cleaning-checklist", "cook-temp-check"].includes(s.kind)) {
        st.history.push({ t: ms, v: st.value });
        if (st.history.length > 240) st.history.shift();
      }
      this.evaluateLimits(s, st, tNow, at);
    }
  }

  /** Same rules for simulated and live readings: out of range for ≥ alertDelayMin opens an alert. */
  private evaluateLimits(s: Sensor, st: SensorState, tNow: number, at?: number) {
    const lim = this.limitFor(s);
    if (!lim || st.value === null) return;
    const out = lim.kind === "max" ? st.value > lim.value : st.value < lim.value;
    if (out) {
      st.outOfRangeSince ??= tNow;
      const longEnough = tNow - st.outOfRangeSince >= this.safety.alertDelayMin * 60;
      st.status = longEnough ? lim.severity : "warning";
      if (longEnough && at === undefined) this.openAlert(s, st, lim);
      const open = this.alerts.find((x) => x.sensorId === s.id && x.status !== "resolved");
      if (open) open.peakValue = lim.kind === "max" ? Math.max(open.peakValue ?? st.value, st.value) : Math.min(open.peakValue ?? st.value, st.value);
    } else {
      st.outOfRangeSince = undefined;
      st.status = "normal";
    }
  }

  /** Live sensors: flag the device offline after 3 missed intervals, otherwise apply the normal limits. */
  private evaluateLiveSensor(s: Sensor, st: SensorState, tNow: number) {
    const stale = st.lastSeen === undefined || this.now() - st.lastSeen > (st.expectedIntervalSec ?? 60) * 3000;
    if (stale) {
      if (st.connected) {
        st.connected = false;
        st.status = "offline";
        this.openConnectivityAlert(s, st);
      }
      return;
    }
    this.evaluateLimits(s, st, tNow);
  }

  private openConnectivityAlert(s: Sensor, st: SensorState) {
    if (this.alerts.some((a) => a.sensorId === s.id && a.status !== "resolved")) return;
    const e = s.equipmentId ? this.eqById.get(s.equipmentId) : undefined;
    const alert: Alert = {
      id: `${this.branchId}-alert-${++this.seq}`,
      severity: "warning",
      equipmentId: s.equipmentId,
      sensorId: s.id,
      title: `${e?.name ?? s.name}: sensor connectivity lost`,
      issue: `Device ${st.deviceId ?? "?"} has not reported for over ${Math.round(((st.expectedIntervalSec ?? 60) * 3) / 60)} min — readings are not being monitored`,
      openedAt: this.now(),
      status: "open",
      correctiveActions: [],
      source: "live",
    };
    this.alerts.unshift(alert);
    this.log("safety", "warning", `WARNING — ${alert.title}`, { alertId: alert.id, equipmentId: s.equipmentId });
  }

  /**
   * Apply a reading from a physical device (already authenticated, de-duplicated and
   * calibrated server-side). The bound sensor switches to live mode permanently for
   * this session. Returns the floor-plan sensor id, or null if the plan has no match.
   */
  ingestReading(r: { equipmentId?: string; sensorCode?: string; metric: string; value: number; ts: number; deviceId: string; expectedIntervalSec: number }): string | null {
    const kindFor: Record<string, Sensor["kind"][]> = {
      temperature_c: ["fridge-temp", "freezer-temp", "hot-holding-temp"],
      oil_quality_pct: ["oil-quality"],
      probe_temperature_c: ["cook-temp-check"],
      status: ["equipment-health"],
      door_open: ["fridge-temp", "freezer-temp"],
    };
    const kinds = kindFor[r.metric] ?? [];
    const s = r.sensorCode ? this.plan.sensors.find((x) => x.code === r.sensorCode) : this.plan.sensors.find((x) => x.equipmentId === r.equipmentId && kinds.includes(x.kind));
    if (!s) return null;
    const st = this.sensors.get(s.id)!;
    const es = s.equipmentId ? this.equipment.get(s.equipmentId) : undefined;
    const firstLive = st.source !== "live";
    st.source = "live";
    st.deviceId = r.deviceId;
    st.lastSeen = Math.max(st.lastSeen ?? 0, r.ts);
    st.expectedIntervalSec = r.expectedIntervalSec;
    st.connected = true;
    if (st.status === "offline") st.status = "normal";
    if (firstLive) {
      // Drop simulated history so charts never mix simulated and real values.
      st.history = [];
      st.outOfRangeSince = undefined;
      if (es?.fault && es.fault.kind !== "reported") es.fault = undefined;
      this.log("system", "info", `Live device ${r.deviceId} connected to ${s.name}`);
    }
    if (r.metric === "door_open") {
      st.note = r.value ? "Door open" : "Door closed";
    } else if (r.metric === "status") {
      if (es) es.fault = r.value ? (es.fault?.kind === "reported" ? undefined : es.fault) : { kind: "reported", since: this.t };
      st.status = r.value ? "normal" : "critical";
      st.value = r.value;
    } else {
      st.value = round1(r.value);
      st.history.push({ t: r.ts, v: st.value });
      if (st.history.length > 240) st.history.shift();
      if (es && r.metric === "temperature_c") es.tempC = r.value;
      if (es && r.metric === "oil_quality_pct") es.oilQualityPct = r.value;
      if (r.metric === "probe_temperature_c") {
        const pass = r.value >= this.safety.cookCoreMinC;
        this.cookChecks.push({ t: r.ts, unitId: `live:${r.deviceId}`, orderId: "", valueC: st.value, pass });
        if (this.cookChecks.length > 200) this.cookChecks.shift();
        st.status = pass ? "normal" : "warning";
        if (!pass) this.log("safety", "warning", `LIVE probe ${st.value} °C below ${this.safety.cookCoreMinC} °C at ${s.name} — re-cook required`);
      } else this.evaluateLimits(s, st, this.t);
    }
    this.version++;
    return s.id;
  }

  private openAlert(s: Sensor, st: SensorState, lim: { kind: "max" | "min"; value: number; severity: Alert["severity"] }) {
    if (this.alerts.some((a) => a.sensorId === s.id && a.status !== "resolved")) return;
    const e = s.equipmentId ? this.eqById.get(s.equipmentId) : undefined;
    const isOil = s.kind === "oil-quality";
    const alert: Alert = {
      id: `${this.branchId}-alert-${++this.seq}`,
      severity: lim.severity,
      equipmentId: s.equipmentId,
      sensorId: s.id,
      title: isOil ? `${e?.name}: oil change due` : `${e?.name ?? s.name}: temperature ${lim.kind === "max" ? "above" : "below"} configured limit`,
      issue: isOil
        ? `${st.source === "live" ? "Live" : "Simulated"} oil quality ${st.value}% below configured minimum ${lim.value}%`
        : `${st.source === "live" ? "Live" : "Simulated"} reading ${st.value} °C ${lim.kind === "max" ? ">" : "<"} limit ${lim.value} °C for ≥ ${this.safety.alertDelayMin} min`,
      openedAt: this.now(),
      status: "open",
      correctiveActions: [],
      peakValue: st.value ?? undefined,
      limit: lim.value,
      source: st.source,
    };
    this.alerts.unshift(alert);
    this.log("safety", lim.severity === "critical" ? "critical" : "warning", `${lim.severity === "critical" ? "CRITICAL" : "WARNING"} — ${alert.title}`, { alertId: alert.id, equipmentId: s.equipmentId });
  }

  acknowledgeAlert(id: string, by: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (!a || a.status !== "open") return false;
    a.status = "acknowledged";
    a.acknowledgedAt = this.now();
    a.acknowledgedBy = by;
    this.log("safety", "info", `Alert acknowledged by ${by} — still requires corrective action and resolution`, { alertId: id });
    this.version++;
    return true;
  }

  addCorrectiveAction(id: string, text: string, by: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (!a || a.status === "resolved" || !text.trim()) return false;
    a.correctiveActions.push({ t: this.now(), by, text: text.trim() });
    this.log("safety", "info", `Corrective action recorded: ${text.trim()}`, { alertId: id });
    this.version++;
    return true;
  }

  /** Resolution requires a recorded corrective action and a reading back within limits. */
  resolveAlert(id: string, by: string): { ok: boolean; reason?: string } {
    const a = this.alerts.find((x) => x.id === id);
    if (!a) return { ok: false, reason: "Alert not found" };
    if (a.status === "resolved") return { ok: false, reason: "Already resolved" };
    if (!a.correctiveActions.length) return { ok: false, reason: "Record at least one corrective action first" };
    const st = a.sensorId ? this.sensors.get(a.sensorId) : undefined;
    if (st && st.status !== "normal") return { ok: false, reason: "Reading is still outside the configured limit" };
    a.status = "resolved";
    a.resolvedAt = this.now();
    a.resolvedBy = by;
    this.log("safety", "success", `Alert resolved by ${by}: ${a.title}`, { alertId: id });
    this.version++;
    return { ok: true };
  }

  /**
   * Inject a simulated equipment fault. `preRollMin` replays that many minutes
   * of the fault through the same sensor model so a demo alert appears promptly.
   */
  injectFault(equipmentId: string, kind?: NonNullable<EquipmentState["fault"]>["kind"], preRollMin = 0) {
    const e = this.eqById.get(equipmentId);
    const st = this.equipment.get(equipmentId);
    if (!e || !st) return false;
    const k = kind ?? (e.category === "refrigeration" ? "compressor" : ["hot-holding", "rice-warmer", "qc-pass"].includes(e.type) ? "thermostat" : "sensor-offline");
    st.fault = { kind: k, since: this.t };
    this.log("equipment", "warning", `Simulated fault injected: ${e.name} (${k})`, { equipmentId });
    if (preRollMin > 0) {
      const sensor = this.plan.sensors.find((s) => s.equipmentId === equipmentId && s.unit === "°C");
      if (sensor) {
        for (let i = 0; i < preRollMin * 2; i++) this.updateSensors(30, this.t - (preRollMin * 2 - i) * 30);
        const sState = this.sensors.get(sensor.id)!;
        if (sState.outOfRangeSince !== undefined) sState.outOfRangeSince = Math.min(sState.outOfRangeSince, this.t - this.safety.alertDelayMin * 60);
        this.updateSensors(1);
      }
    }
    this.version++;
    return true;
  }

  /** Demo-only: clear a simulated fault (stands in for a technician repair). */
  clearFault(equipmentId: string) {
    const st = this.equipment.get(equipmentId);
    if (!st?.fault) return false;
    st.fault = undefined;
    st.lastMaintenance = this.t;
    this.log("equipment", "info", `Simulated fault cleared: ${this.eqById.get(equipmentId)?.name} — readings will recover gradually`, { equipmentId });
    this.version++;
    return true;
  }

  recordInspection(equipmentId: string, by: string) {
    const st = this.equipment.get(equipmentId);
    if (!st) return;
    st.lastInspection = this.t;
    this.log("safety", "info", `Inspection recorded for ${this.eqById.get(equipmentId)?.name} by ${by}`, { equipmentId });
    this.version++;
  }

  changeOil(equipmentId: string) {
    const st = this.equipment.get(equipmentId);
    if (st?.oilQualityPct === undefined) return;
    st.oilQualityPct = 100;
    st.lastMaintenance = this.t;
    this.consume(`oil:${equipmentId}:${Math.floor(this.t)}`, { "OIL-001": 12 }, "production", equipmentId);
    this.log("equipment", "success", `Oil changed: ${this.eqById.get(equipmentId)?.name}`, { equipmentId });
    this.version++;
  }

  private maybeRandomFault() {
    if (!this.config.autoFaults || this.t - this.lastFaultCheck < 600) return;
    this.lastFaultCheck = this.t;
    if (!this.rng.chance(0.04)) return;
    const pool = this.plan.equipment.filter((e) => e.category === "refrigeration" || e.type === "hot-holding");
    const e = this.rng.pick(pool);
    if (e && !this.equipment.get(e.id)?.fault) this.injectFault(e.id, this.rng.chance(0.25) ? "sensor-offline" : undefined);
  }

  private updateCleaning() {
    for (const c of this.cleaning) {
      if (this.t < c.dueAt - 300) continue;
      if ([...this.tasks.values()].some((t) => t.kind === "clean" && t.roomId === c.roomId)) continue;
      const room = this.plan.rooms.find((r) => r.id === c.roomId);
      if (!room) continue;
      const target = this.grid.nearestFree(room.x + room.w / 2, room.z + room.d / 2);
      if (!target) continue;
      this.addTask({ kind: "clean", ws: "dish", label: `Cleaning checklist — ${room.name}`, duration: 90, machine: false, priority: this.t + 1200, target: this.grid.toWorld(target[0], target[1]), roomId: room.id });
    }
  }

  // ───────────────────────────── inventory ─────────────────────────────
  private consume(key: string, recipe: Record<string, number>, reason: LedgerEntry["reason"], ref?: string) {
    if (this.ledgerKeys.has(key)) return false;
    this.ledgerKeys.add(key);
    for (const [sku, q] of Object.entries(recipe)) {
      if (!q) continue;
      const item = this.inventory.find((i) => i.sku === sku);
      if (!item) continue;
      item.qty = Math.max(0, Math.round((item.qty - q) * 1000) / 1000);
      this.ledger.push({ id: `${this.branchId}-led-${++this.seq}`, key, t: this.now(), sku, delta: -q, reason, ref });
    }
    if (this.ledger.length > 1500) this.ledger.splice(0, this.ledger.length - 1500);
    return true;
  }

  /** Deduct recipe quantities once per order (idempotent via the ledger key). */
  consumeForOrder(o: Order) {
    if (o.inventoryConsumed) return false;
    const total: Record<string, number> = { "PKG-BAG": 1 };
    for (const l of o.lines) {
      const m = MENU_BY_ID.get(l.menuId);
      if (!m) continue;
      for (const u of m.units) for (const [sku, q] of Object.entries(u.recipe)) total[sku] = (total[sku] ?? 0) + q * l.qty;
    }
    const ok = this.consume(`order:${o.id}`, total, "order", o.id);
    o.inventoryConsumed = true;
    return ok;
  }

  private updateInventoryStatus() {
    const nowMs = this.now();
    for (const i of this.inventory) {
      const prev = i.status;
      i.status = i.qty <= 0 ? "OUT" : i.qty < i.reorderLevel * 0.5 ? "CRITICAL" : i.qty < i.reorderLevel ? "LOW" : i.expiresAt - nowMs < DAY * 1000 ? "EXPIRING" : "OK";
      if (prev !== i.status && i.status !== "OK") this.log("inventory", i.status === "LOW" || i.status === "EXPIRING" ? "warning" : "critical", `${i.name}: ${i.status} (${i.qty.toFixed(1)} ${i.unit}, reorder level ${i.reorderLevel})`, { sku: i.sku });
      if ((i.status === "LOW" || i.status === "CRITICAL" || i.status === "OUT") && i.onOrder === 0) this.requestReplenishment(i);
    }
    for (const r of this.replenishments) {
      if (r.status === "received" || this.t < r.etaAt) continue;
      r.status = "received";
      const item = this.inventory.find((i) => i.sku === r.sku);
      if (!item) continue;
      item.qty = Math.round((item.qty + r.qty) * 100) / 100;
      item.onOrder = 0;
      const def = INGREDIENT_BY_SKU.get(r.sku);
      if (def) item.expiresAt = nowMs + def.shelfLifeDays * DAY * 1000;
      this.ledger.push({ id: `${this.branchId}-led-${++this.seq}`, key: `receipt:${r.id}`, t: nowMs, sku: r.sku, delta: r.qty, reason: "receipt", ref: r.id });
      this.log("inventory", "success", `Replenishment received: ${r.qty} ${item.unit} ${item.name} from ${r.source}`, { sku: r.sku });
    }
  }

  /** Record waste/spoilage: deducts stock with its own ledger entry. */
  recordWaste(sku: string, qty: number, reason: string, by: string) {
    const item = this.inventory.find((i) => i.sku === sku);
    if (!item || !(qty > 0)) return false;
    const q = Math.min(qty, item.qty);
    this.consume(`waste:${sku}:${++this.seq}`, { [sku]: q }, "waste", reason);
    this.log("inventory", "warning", `Waste recorded by ${by}: ${q} ${item.unit} ${item.name} — ${reason}`, { sku });
    this.updateInventoryStatus();
    this.version++;
    return true;
  }

  requestReplenishment(item: InventoryItem, qty?: number) {
    const def = INGREDIENT_BY_SKU.get(item.sku);
    const scale = this.plan.format === "C" ? 1.6 : this.plan.format === "A" ? 0.6 : 1;
    const raw = qty ?? Math.max(item.reorderLevel * 2, (def?.opening ?? 10) * scale - item.qty);
    const q = item.unit === "pcs" ? Math.ceil(raw) : Math.round(raw * 10) / 10;
    const r: Replenishment = { id: `${this.branchId}-rep-${++this.seq}`, sku: item.sku, qty: q, requestedAt: this.t, etaAt: this.t + this.rng.range(1.5, 4) * 3600, status: "in-transit", source: def?.supplier ?? "Supplier" };
    this.replenishments.push(r);
    item.onOrder = q;
    this.log("inventory", "info", `Replenishment requested: ${q} ${item.unit} ${item.name} (ETA ${Math.round((r.etaAt - this.t) / 60)} min)`, { sku: item.sku });
    return r;
  }

  // ───────────────────────────── queries ─────────────────────────────
  metrics(): BranchMetrics {
    const orders = [...this.orders.values()];
    const active = orders.filter((o) => !["COMPLETED", "CANCELLED", "FAILED", "REFUNDED", "OUT_FOR_DELIVERY"].includes(o.status));
    const util: BranchMetrics["utilization"] = {};
    const elapsed = Math.max(this.t, 1);
    for (const ws of this.plan.workstations) {
      const v = (this.wsBusy.get(ws.id) ?? 0) / elapsed;
      util[ws.type] = Math.max(util[ws.type] ?? 0, Math.min(1, v));
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const completedSales = orders.filter((o) => o.status !== "CANCELLED" && o.status !== "REFUNDED").reduce((s, o) => s + o.total, 0);
    return {
      ordersToday: this.baseline.ordersToday + orders.length,
      completed: this.baseline.completed + orders.filter((o) => o.status === "COMPLETED").length,
      cancelled: orders.filter((o) => o.status === "CANCELLED").length,
      sales: this.baseline.sales + completedSales,
      activeOrders: active.length,
      delayed: active.filter((o) => o.delayed).length,
      avgPrepMin: avg(this.prepTimes.slice(-50)),
      avgCustomerWaitMin: avg(this.waitTimes.slice(-50)),
      queueLength: this.queue.length,
      lostCustomers: this.lostCustomers,
      staffOnDuty: this.staff.size,
      utilization: util,
      openAlerts: this.alerts.filter((a) => a.status !== "resolved").length,
      criticalAlerts: this.alerts.filter((a) => a.status !== "resolved" && a.severity === "critical").length,
      lowStock: this.inventory.filter((i) => i.status !== "OK").length,
      equipmentIssues: [...this.equipment.values()].filter((e) => e.fault).length,
    };
  }

  activeOrders() {
    return [...this.orders.values()].filter((o) => !["COMPLETED", "CANCELLED", "FAILED", "REFUNDED"].includes(o.status));
  }

  tasksFor(orderId: string) {
    return [...this.tasks.values()].filter((t) => t.orderId === orderId);
  }

  /** Workstations currently working on an order (for highlighting in 3D). */
  activeWorkstations(): Map<string, { jobs: number; orderIds: Set<string> }> {
    const m = new Map<string, { jobs: number; orderIds: Set<string> }>();
    for (const t of this.tasks.values()) {
      if (!t.wsId || (t.state !== "working" && t.state !== "machine")) continue;
      const v = m.get(t.wsId) ?? { jobs: 0, orderIds: new Set() };
      v.jobs++;
      if (t.orderId) v.orderIds.add(t.orderId);
      m.set(t.wsId, v);
    }
    return m;
  }

  /** Where each order's products are right now (for the "follow order" camera). */
  orderLocation(orderId: string): Vec2 | null {
    const o = this.orders.get(orderId);
    if (!o) return null;
    const task = this.tasksFor(orderId).find((t) => t.state === "working" || t.state === "machine" || t.state === "assigned");
    if (task?.wsId) return this.wsById.get(task.wsId)!.standPoint;
    for (const uid of o.unitIds) {
      const u = this.units.get(uid);
      if (u?.atWorkstation) return this.wsById.get(u.atWorkstation)?.standPoint ?? null;
    }
    if (o.status === "READY") {
      const ws = this.plan.workstations.find((w) => w.type === (o.fulfilment === "delivery" ? "dispatch" : "pickup"));
      return ws?.standPoint ?? null;
    }
    const counter = this.plan.workstations.find((w) => w.type === "order-counter");
    return counter?.standPoint ?? null;
  }

  roomName(roomId: string) {
    return this.plan.rooms.find((r) => r.id === roomId)?.name ?? roomId;
  }

  roomAtPoint(p: Vec2) {
    return roomAt(this.plan.rooms, p[0], p[1]);
  }

  utilizationByWorkstation() {
    const elapsed = Math.max(this.t, 1);
    return this.plan.workstations.map((w) => ({ id: w.id, name: w.name, type: w.type, utilization: Math.min(1, (this.wsBusy.get(w.id) ?? 0) / elapsed), busySlots: this.slots.get(w.id)!.filter(Boolean).length, capacity: w.capacity }));
  }

  /** Demo optimisation: rebalance which roles cover which stations based on current queue pressure. */
  rebalanceStaff(): string[] {
    const pending = [...this.tasks.values()].filter((t) => t.state === "pending");
    const byWs = new Map<WorkstationType, number>();
    for (const t of pending) byWs.set(t.ws, (byWs.get(t.ws) ?? 0) + 1);
    const changes: string[] = [];
    const hot = [...byWs].sort((a, b) => b[1] - a[1])[0];
    if (!hot || hot[1] < 2) return ["Kitchen queues are balanced — no change needed."];
    for (const m of this.staff.values()) {
      if (m.role === "cashier" || m.skills.includes(hot[0])) continue;
      const loadOwn = m.skills.reduce((s, k) => s + (byWs.get(k) ?? 0), 0);
      if (loadOwn <= 1) {
        m.skills = [hot[0], ...m.skills];
        changes.push(`${m.name} (${roleLabel(m.role)}) now also covers ${hot[0]}`);
      }
    }
    if (!changes.length) changes.push(`Bottleneck at ${hot[0]} (${hot[1]} waiting) but no free staff to reassign.`);
    for (const c of changes) this.log("staff", "info", `Optimise: ${c}`);
    this.version++;
    return changes;
  }

  restoreRoles() {
    for (const m of this.staff.values()) m.skills = ROLE_SKILLS[m.role];
  }
}

export function channelLabel(c: Channel) {
  return { "walk-in": "Walk-in", online: "Website", "chris-b-app": "Chris B app", phone: "Call centre", "delivery-partner": "Delivery partner", pos: "POS", demo: "Demo injection" }[c];
}

export function fulfilmentLabel(f: Fulfilment) {
  return { pickup: "takeaway pickup", "dine-in": "dine-in", delivery: "delivery" }[f];
}

function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
