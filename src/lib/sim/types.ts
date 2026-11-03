import type { Vec2, WorkstationType } from "../floorplan/types";
import type { StorageClass } from "./catalog";
import type { StageSpec, UnitKind } from "./menu";

/**
 * Data provenance. "simulated" = generated in the browser simulation; "live" = a physical device or
 * system through the integration pipeline; "virtual" = simulated hardware through the same pipeline
 * (shown as SIM DEVICE, never as LIVE).
 */
export type DataSource = "simulated" | "live" | "virtual";

/** True when values come from a device through the ingestion pipeline (physical or virtual). */
export const isDeviceSource = (s: DataSource) => s !== "simulated";

export type Channel = "walk-in" | "online" | "chris-b-app" | "phone" | "delivery-partner" | "pos" | "demo";
export type Fulfilment = "pickup" | "dine-in" | "delivery";

export type OrderStatus =
  | "RECEIVED"
  | "ACCEPTED"
  | "KITCHEN_QUEUE"
  | "PREPARATION"
  | "COOKING"
  | "QUALITY_CHECK"
  | "PACKAGING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED"
  | "REFUNDED";

export const ORDER_FLOW: OrderStatus[] = ["RECEIVED", "ACCEPTED", "KITCHEN_QUEUE", "PREPARATION", "COOKING", "QUALITY_CHECK", "PACKAGING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];

export interface OrderLine {
  menuId: string;
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  number: number;
  channel: Channel;
  fulfilment: Fulfilment;
  lines: OrderLine[];
  total: number;
  status: OrderStatus;
  createdAt: number;
  acceptedAt?: number;
  readyAt?: number;
  completedAt?: number;
  /** Target minutes from acceptance to ready (demo SLA). */
  slaMin: number;
  delayed: boolean;
  customerId?: string;
  riderId?: string;
  unitIds: string[];
  history: Array<{ t: number; status: OrderStatus; note?: string }>;
  inventoryConsumed: boolean;
  delivery?: { status: "AWAITING_DISPATCH" | "RIDER_ASSIGNED" | "COLLECTED" | "IN_TRANSIT" | "DELIVERED" | "DELAYED"; eta?: number; collectedAt?: number; deliveredAt?: number; rider?: string };
  note?: string;
  /**
   * "live" when the order arrived from a connected physical POS / ordering system, "virtual" when it
   * came through the same pipeline from a simulated terminal; kitchen progress is still simulated.
   */
  source: DataSource;
  /** Order reference in the source system (live orders). */
  externalRef?: string;
  /** Latest status reported by the source system (live orders). */
  externalStatus?: string;
  /** Simulated payment step; undefined for live orders whose source does not report payment. */
  payment?: { method: PaymentMethod; paidAt: number };
}

export type PaymentMethod = "mobile-money" | "card" | "cash";

export interface Unit {
  id: string;
  orderId: string;
  kind: UnitKind;
  label: string;
  stages: StageSpec[];
  stageIndex: number;
  done: boolean;
  grams?: number;
  pieces?: number;
  cut?: "wing" | "drum";
  /** Where the item currently sits, for the 3D view. */
  atWorkstation?: string;
  slot?: number;
  recook?: boolean;
}

export type TaskKind = "serve" | "stage" | "pack" | "handoff" | "rice-batch" | "chicken-batch" | "clean" | "fetch";

export interface Task {
  id: string;
  kind: TaskKind;
  ws: WorkstationType;
  wsId?: string;
  slot?: number;
  orderId?: string;
  unitId?: string;
  label: string;
  duration: number;
  machine: boolean;
  state: "pending" | "assigned" | "working" | "machine" | "done";
  staffId?: string;
  createdAt: number;
  startedAt?: number;
  endsAt?: number;
  priority: number;
  /** Cleaning tasks target a point rather than a workstation. */
  target?: Vec2;
  roomId?: string;
  batch?: { cut: "wing" | "drum"; pieces: number; step: number };
  /** Clean-up tasks for a specific spill. */
  spillId?: string;
  /** Fetch tasks: the door the person goes through (opens while they are inside). */
  doorId?: string;
}

export type AgentKind = "staff" | "customer" | "rider";
export type Anim = "idle" | "walk" | "work" | "carry" | "sit" | "clean" | "wait";

export interface Agent {
  /** Set while a worn badge (RTLS) supplies this person's position instead of the simulation. */
  tracked?: {
    tagId: string;
    source: "live" | "virtual";
    technology: "uwb" | "ble";
    /** Calibrated floor-plan position of the latest fix. */
    target: [number, number];
    accuracy: number;
    /** Sim time (s) of the latest fix. */
    seenAt: number;
    battery?: number;
    lost: boolean;
    /** Where the simulated work for this person is happening (kitchen progress is still simulated without a KDS). */
    shadow: [number, number];
  };
  id: string;
  kind: AgentKind;
  name: string;
  role?: StaffRole;
  pos: Vec2;
  heading: number;
  path: Vec2[];
  speed: number;
  anim: Anim;
  carrying: UnitKind | "bag" | "box" | "crate" | null;
  look?: Vec2;
  /** Staff: current task. Customers/riders: linked order. */
  taskId?: string;
  orderId?: string;
  phase: string;
  timer: number;
  seed: number;
  seat?: number;
  arrivedAt: number;
  gone?: boolean;
  /** Staff on a break: sim time the break ends. */
  breakUntil?: number;
}

export type StaffRole = "cashier" | "pizza" | "chicken" | "rice" | "packer" | "supervisor";

export interface StaffMember {
  agentId: string;
  name: string;
  role: StaffRole;
  skills: WorkstationType[];
  shift: string;
  busySeconds: number;
  tasksDone: number;
  training: string[];
  homeWs?: WorkstationType;
  /** Sim time of the next scheduled break. */
  nextBreakAt?: number;
  /** Set while the person is away from their post without a task (sim time it started). */
  offPostSince?: number;
}

export type EquipStatus = "idle" | "active" | "fault" | "offline" | "cleaning";

export interface EquipmentState {
  id: string;
  status: EquipStatus;
  activeJobs: number;
  tempC?: number;
  oilQualityPct?: number;
  cycles: number;
  lastMaintenance: number;
  lastInspection: number;
  /** "reported" = fault reported by a live equipment controller. */
  fault?: { kind: "compressor" | "door-seal" | "thermostat" | "sensor-offline" | "reported"; since: number };
}

export interface SensorState {
  id: string;
  value: number | null;
  connected: boolean;
  status: "normal" | "warning" | "critical" | "offline";
  outOfRangeSince?: number;
  history: Array<{ t: number; v: number | null }>;
  lastCheck?: number;
  note?: string;
  /**
   * "live" once a bound physical device has reported, "virtual" once a simulated device has reported
   * through the real ingestion pipeline; the in-browser simulation then stops generating values.
   */
  source: DataSource;
  deviceId?: string;
  /** Epoch ms of the last live reading (device timestamp). */
  lastSeen?: number;
  expectedIntervalSec?: number;
}

export interface Alert {
  id: string;
  severity: "critical" | "warning";
  equipmentId?: string;
  sensorId?: string;
  title: string;
  issue: string;
  openedAt: number;
  status: "open" | "acknowledged" | "resolved";
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  correctiveActions: Array<{ t: number; by: string; text: string }>;
  resolvedAt?: number;
  resolvedBy?: string;
  peakValue?: number;
  limit?: number;
  /** Whether the alert was raised from a live device, a simulated device (via the pipeline) or the simulation. */
  source: DataSource;
  /** Rule id for operational (rule-based) alerts; undefined for sensor-threshold alerts. */
  kind?: string;
  /** Camera zone the alert belongs to. */
  zoneId?: string;
  /** Plain-language cause, e.g. "Queue 9 deep, 2 on till". */
  cause?: string;
  /** Recommended action, e.g. "Move Kofi from dining to till 2". */
  action?: string;
  /** 0 = new, 1 = unattended for 3 min, 2 = unattended for 8 min (manager notified). */
  escalation: 0 | 1 | 2;
  escalatedAt?: number;
  assignedTo?: string;
  /** Closed by the system because the condition cleared. */
  autoResolved?: boolean;
}

export interface InventoryItem {
  sku: string;
  name: string;
  unit: string;
  storage: StorageClass;
  locationId: string;
  locationName: string;
  qty: number;
  reorderLevel: number;
  unitCost: number;
  supplier: string;
  expiresAt: number;
  status: "OK" | "LOW" | "CRITICAL" | "EXPIRING" | "OUT";
  onOrder: number;
}

export interface LedgerEntry {
  id: string;
  key: string;
  t: number;
  sku: string;
  delta: number;
  reason: "order" | "production" | "receipt" | "waste" | "adjustment";
  ref?: string;
}

export interface Replenishment {
  id: string;
  sku: string;
  qty: number;
  requestedAt: number;
  etaAt: number;
  status: "requested" | "in-transit" | "received";
  source: string;
}

export interface SimEvent {
  id: string;
  t: number;
  type: "order" | "kitchen" | "safety" | "equipment" | "inventory" | "customer" | "delivery" | "staff" | "system";
  severity: "info" | "success" | "warning" | "critical";
  message: string;
  refs?: { orderId?: string; equipmentId?: string; alertId?: string; agentId?: string; sku?: string; zoneId?: string; scenario?: string; marker?: MarkerKind };
}

/** Timeline marker classes the camera timeline draws. */
export type MarkerKind = "alert" | "rush" | "shift" | "delivery" | "anomaly" | "incident";

export interface CleaningRecord {
  roomId: string;
  sensorId: string;
  lastDone: number;
  by?: string;
  dueAt: number;
}

export interface SimConfig {
  seed: number;
  /** Walk-in + remote orders per hour at the average demand level (demo setting). */
  arrivalRate: number;
  dineInShare: number;
  deliveryShare: number;
  autoFaults: boolean;
}

export interface BranchMetrics {
  ordersToday: number;
  completed: number;
  cancelled: number;
  sales: number;
  activeOrders: number;
  delayed: number;
  avgPrepMin: number;
  avgCustomerWaitMin: number;
  queueLength: number;
  lostCustomers: number;
  staffOnDuty: number;
  utilization: Partial<Record<WorkstationType, number>>;
  openAlerts: number;
  criticalAlerts: number;
  lowStock: number;
  equipmentIssues: number;
}

/* ───────────── camera-zone operational state ───────────── */

export interface DoorState {
  doorId: string;
  open: boolean;
  /** Sim time of the last change. */
  since: number;
  /** Openings since the simulation started. */
  opens: number;
  /** Held open (e.g. propped) until this sim time; undefined = closes when traffic clears. */
  heldUntil?: number;
  lastOpenedAt?: number;
  /** Openings while the branch was closed. */
  afterHoursOpens: number;
}

export interface TillState {
  drawerOpen: boolean;
  /** Sim time the drawer last opened or closed. */
  since: number;
  /** Sim time of the last recorded sale at this till. */
  lastSaleAt?: number;
  /** True while the drawer is open without a sale having been rung up. */
  openNoSale: boolean;
}

export interface Spill {
  id: string;
  roomId: string;
  pos: Vec2;
  since: number;
  cleanedAt?: number;
  by?: string;
}

/** Compact per-second record of what every person was doing, for timeline replay. */
export type HistoryPerson = [id: string, kind: AgentKind, role: StaffRole | undefined, x: number, z: number, heading: number, anim: Anim, carrying: Agent["carrying"], look: Vec2 | undefined, name: string, seed: number];

export interface HistoryFrame {
  /** Sim seconds. */
  t: number;
  people: HistoryPerson[];
  /** Zone status level and primary metric value at this second, keyed by zone id. */
  zones: Record<string, { level: "ok" | "watch" | "act"; primary: number | null; metrics: Record<string, number | null> }>;
  doors: Record<string, boolean>;
  drawerOpen: boolean;
  queue: number;
}
