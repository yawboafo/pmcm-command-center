/**
 * Simulated hardware fleet — runs every virtual device and POS terminal in
 * src/data/devices.virtual.json as one process, sending signed messages to the REAL
 * ingestion endpoints exactly like installed hardware would:
 *
 *   sensors / controllers → POST /api/ingest/telemetry   (TelemetryMessage, HMAC-signed)
 *   POS terminals / app   → POST /api/ingest/pos         (PosOrderEvent, HMAC-signed)
 *   simulator heartbeat   → POST /api/ingest/simulator   (active faults, for Settings → Integrations)
 *
 * The server marks everything from these ids `origin: "virtual"`, so the console shows
 * SIM DEVICE, never LIVE. Physically plausible behaviour: thermostat duty cycles and
 * defrost, door openings that follow the demand curve, slow sensor drift, fryer oil
 * degradation per cooking load with oil changes, battery drain, RSSI noise, packet loss
 * with retries (duplicate ids exercise de-duplication), offline gaps and gateway outages
 * with buffered catch-up, and occasional device clock skew (rejected, then NTP resync).
 *
 *   npm run hardware:sim -- [--url http://localhost:3000] [--branches eastlegon,spintex,knust]
 *        [--speed 1] [--fault <deviceId>:<kind>]... [--chaos 1] [--no-pos] [--no-devices]
 *        [--list] [--quiet]
 *
 * --speed scales simulated physics and order flow (timestamps stay real wall-clock time, as
 * the server rejects future-dated readings). --chaos multiplies the random fault/outage rates.
 * Fault kinds: compressor, heater, door-ajar, drift, stuck, oil-overdue, trip, undercook,
 * offline, battery, skew, dupes (see --list for which apply to which device).
 *
 * Keys: each device signs with HMAC(VIRTUAL_FLEET_SECRET, deviceId) — set the secret in the
 * server environment / .env.local (never printed).
 */
import { randomUUID } from "node:crypto";
import fleetJson from "../src/data/devices.virtual.json";
import { deriveVirtualKey, FLEET_SECRET_MIN_LENGTH, SIMULATOR_ID } from "../src/lib/integration/fleet";
import { sign } from "../src/lib/integration/signing";
import { BRANCH_BY_ID, isBranchOpen } from "../src/lib/network/branches";
import { demandFactor } from "../src/lib/sim/engine";
import { MENU } from "../src/lib/sim/menu";
import { hashString, Rng } from "../src/lib/sim/rng";
import { arg, args, envVar, flag } from "./lib/env";
import type { HardwareKind, VirtualDeviceEntry, VirtualFleetFile, VirtualTerminalEntry } from "./lib/fleet-spec";

const fleet = fleetJson as unknown as VirtualFleetFile;

// ───────────────────────────── configuration ─────────────────────────────

const BASE_URL = (arg("url") ?? envVar("OPS_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const SPEED = Math.min(1000, Math.max(0.1, Number(arg("speed", "1")) || 1));
const CHAOS = Math.max(0, Number(arg("chaos", "1")) || 0);
const QUIET = flag("quiet");
const TICK_MS = 1000;
/** Peak of the demand curve, used to normalise door/oil/order rates. */
const PEAK = 1.9;

const FAULTS_FOR: Record<HardwareKind, string[]> = {
  "cold-air": ["compressor", "door-ajar", "drift", "stuck"],
  "frozen-air": ["compressor", "door-ajar", "drift", "stuck"],
  "hot-air": ["heater", "drift", "stuck"],
  oil: ["oil-overdue", "drift"],
  door: ["door-ajar"],
  controller: ["trip"],
  "food-probe": ["undercook"],
};
const ANY_FAULTS = ["offline", "battery", "skew", "dupes"];
/** Faults that apply to a device (battery faults only on battery-powered devices). */
const faultsFor = (d: VirtualDeviceEntry) => [...FAULTS_FOR[d.hardware.kind], ...ANY_FAULTS.filter((k) => k !== "battery" || d.hardware.battery)];

function selectBranches(): string[] {
  const want = (arg("branches") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!want.length || want.includes("all")) return fleet.branches.map((b) => b.branchId);
  return want.map((w) => {
    const b = fleet.branches.find((x) => x.branchId === w || x.slug === w || x.name.toLowerCase() === w);
    if (!b) {
      console.error(`Unknown branch "${w}". Fleet branches: ${fleet.branches.map((x) => `${x.slug} (${x.branchId})`).join(", ")}`);
      process.exit(1);
    }
    return b.branchId;
  });
}

if (flag("list")) {
  for (const b of fleet.branches) {
    console.log(`\n${b.name} (${b.branchId}, ${b.floorPlan})`);
    for (const d of fleet.devices.filter((x) => x.branchId === b.branchId)) console.log(`  ${d.deviceId.padEnd(40)} ${d.metric.padEnd(20)} faults: ${faultsFor(d).join(", ")}`);
    for (const t of fleet.posTerminals.filter((x) => x.branchId === b.branchId)) console.log(`  ${t.sourceId.padEnd(40)} POS (${t.channels.join("/")})`);
  }
  process.exit(0);
}

const fleetSecret = envVar("VIRTUAL_FLEET_SECRET");
if (!fleetSecret || fleetSecret.length < FLEET_SECRET_MIN_LENGTH) {
  console.error(`VIRTUAL_FLEET_SECRET (≥${FLEET_SECRET_MIN_LENGTH} chars) is not set in the environment or .env.local.\nGenerate one with: echo "VIRTUAL_FLEET_SECRET=$(openssl rand -hex 32)" >> .env.local  (then restart the Next server)`);
  process.exit(1);
}
const keyFor = (id: string) => deriveVirtualKey(fleetSecret, id);

// ───────────────────────────── clocks & helpers ─────────────────────────────

const startedReal = Date.now();
/** Simulated clock (epoch ms): physics and demand run SPEED× faster than the wall clock. */
let simNow = startedReal;
const hourOf = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60; // Africa/Accra = UTC+0
};
const rng = new Rng(hashString(`hardware-sim:${startedReal}`));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg: string) => console.log(`${stamp()} ${msg}`);
const branchName = (id: string) => BRANCH_BY_ID.get(id)?.name ?? id;
const branchOpen = (id: string) => {
  const b = BRANCH_BY_ID.get(id);
  return b ? isBranchOpen(b, simNow) : true;
};
/** Relative activity 0…1 for a branch now (0.03 while closed: cleaning, deliveries). */
const activity = (branchId: string) => (branchOpen(branchId) ? demandFactor(hourOf(simNow)) / PEAK : 0.03);
/** Poisson event in a step: rate is per simulated hour. */
const happens = (ratePerHour: number, dtSec: number) => rng.chance(1 - Math.exp(-(ratePerHour * dtSec) / 3600));

const stats = { sent: 0, accepted: 0, duplicates: 0, lost: 0, skewRejected: 0, failed: 0, buffered: 0, orders: 0, posEvents: 0 };

interface Fault {
  kind: string;
  since: number;
  injected: boolean;
  /** Sim time when a technician fixes it (spontaneous faults only). */
  until?: number;
}

// ───────────────────────────── physical models ─────────────────────────────

/** A refrigerated or heated cabinet (shared by its air probe and door contact). */
class Cabinet {
  T: number;
  on = false;
  defrostUntil = 0;
  nextDefrostAt: number;
  doorOpenUntil = 0;
  compressorFaultSince: number | null = null;
  heaterFault = false;
  doorAjar = false;
  readonly sp: number;
  constructor(
    readonly key: string,
    readonly branchId: string,
    readonly d: VirtualDeviceEntry,
  ) {
    const th = d.hardware.thermal!;
    this.sp = d.hardware.setpointC ?? 3;
    this.T = this.sp + rng.range(-th.hysteresisC / 2, th.hysteresisC / 2);
    this.nextDefrostAt = simNow + rng.range(0.2, 1) * (th.defrost?.everyHours ?? 6) * 3600_000;
  }
  get hot() {
    return this.d.hardware.kind === "hot-air";
  }
  get doorOpen() {
    return this.doorAjar || simNow < this.doorOpenUntil;
  }
  get defrosting() {
    return simNow < this.defrostUntil;
  }
  /** Advance by dt simulated seconds. Returns true when the door changed state. */
  step(dt: number): boolean {
    const th = this.d.hardware.thermal!;
    const wasOpen = this.doorOpen;
    const act = activity(this.branchId);
    if (!this.doorOpen && th.doorOpensPerPeakHour > 0 && happens(th.doorOpensPerPeakHour * act, dt)) {
      const type = this.d.hardware.equipmentType;
      const dur = type.startsWith("walk-in") ? rng.range(15, 75) : type === "pizza-makeline" ? rng.range(4, 12) : type === "drinks-fridge" ? rng.range(3, 8) : rng.range(4, 18);
      this.doorOpenUntil = simNow + dur * 1000;
    }
    const h = th.hysteresisC / 2;
    if (this.hot) {
      if (this.T < this.sp - h) this.on = true;
      else if (this.T > this.sp + h) this.on = false;
      const drive = this.on && !this.heaterFault ? th.drivePerMin : 0;
      let dT = ((-th.leakPerMin * (this.T - th.ambientC) + drive) * dt) / 60;
      if (this.doorOpen) dT += th.doorGainPerSec * dt * ((this.T - th.ambientC) / Math.max(1, this.sp - th.ambientC));
      this.T += dT;
    } else {
      if (th.defrost && !this.defrosting && simNow >= this.nextDefrostAt && this.T <= this.sp - h + 0.4) {
        this.defrostUntil = simNow + th.defrost.minutes * 60_000;
        this.nextDefrostAt = simNow + th.defrost.everyHours * 3600_000;
      }
      if (this.defrosting) this.on = false;
      else if (this.T > this.sp + h) this.on = true;
      else if (this.T < this.sp - h) this.on = false;
      // A failing compressor loses capacity over ~40 minutes.
      const capacity = this.compressorFaultSince === null ? 1 : Math.max(0.1, 1 - (simNow - this.compressorFaultSince) / 2_400_000);
      let dTmin = th.leakPerMin * (th.ambientC - this.T) - (this.on ? th.drivePerMin * capacity : 0);
      if (this.defrosting && th.defrost) dTmin += th.defrost.heatPerMin;
      let dT = (dTmin * dt) / 60;
      // Warm air rushes in while the door is open; the effect shrinks as the cabinet approaches room temperature.
      if (this.doorOpen) dT += th.doorGainPerSec * dt * ((th.ambientC - this.T) / Math.max(1, th.ambientC - this.sp));
      this.T += dT;
    }
    return wasOpen !== this.doorOpen;
  }
}

/** A fryer: oil quality falls with each cooking load until the crew changes the oil. */
class Fryer {
  Q: number;
  changingUntil = 0;
  overdue = false;
  tripped = false;
  /** Set by the fryer's oil sensor (a controller alone does not model the oil). */
  oil: NonNullable<VirtualDeviceEntry["hardware"]["oil"]> | null = null;
  constructor(
    readonly key: string,
    readonly branchId: string,
    readonly name: string,
  ) {
    this.Q = rng.range(45, 95);
  }
  step(dt: number) {
    if (!this.oil) return;
    if (simNow < this.changingUntil) return;
    if (this.changingUntil && simNow >= this.changingUntil) {
      this.changingUntil = 0;
      this.Q = rng.range(98, 100);
      log(`OIL   ${branchName(this.branchId)} ${this.name}: fresh oil, quality ${r1(this.Q)}%`);
    }
    const act = activity(this.branchId);
    const loads = happens(this.oil.loadsPerPeakHour * act, dt) ? 1 : 0;
    // Each basket load degrades the oil; holding oil hot while open adds slow thermal breakdown.
    this.Q -= loads * this.oil.lossPerLoadPct * rng.range(0.8, 1.2) + (branchOpen(this.branchId) ? (0.012 * dt) / 60 : 0);
    this.Q = Math.max(0, this.Q);
    // Crew policy: change below ~40% in a quiet spell, or as soon as possible below the change point.
    const due = this.Q < this.oil.changeBelowPct ? happens(8, dt) : this.Q < 40 && act < 0.3 ? happens(2, dt) : false;
    if (due && !this.overdue) {
      this.changingUntil = simNow + rng.range(15, 25) * 60_000;
      log(`OIL   ${branchName(this.branchId)} ${this.name}: oil change started at ${r1(this.Q)}%`);
    }
  }
}

// ───────────────────────────── devices ─────────────────────────────

interface OutMsg {
  id: string;
  body: Record<string, unknown>;
  /** Clock skew the timestamp was taken with, so it can be corrected after an NTP resync. */
  skewMs: number;
  takenAt: number;
  attempts: number;
}

/** Network state per branch: a LoRaWAN gateway can drop out for the whole branch. */
const gatewayDownUntil = new Map<string, number>();

class Device {
  readonly rng: Rng;
  nextReportAt: number;
  battery: number | null;
  bias: number;
  driftPerMin = 0;
  stuckValue: number | null = null;
  clockSkewMs: number;
  offlineUntil = 0;
  dead = false;
  disabled = false;
  outbox: OutMsg[] = [];
  inflight = false;
  backoffUntil = 0;
  faults = new Map<string, Fault>();
  lastStatus: number | null = null;
  lastDoor: number | null = null;
  constructor(
    readonly d: VirtualDeviceEntry,
    /** The cabinet this device measures (door contacts share the temperature probe's cabinet). */
    public cabinet: Cabinet | null,
    readonly fryer: Fryer | null,
  ) {
    this.rng = new Rng(hashString(`${d.deviceId}:${startedReal}`));
    // Raw sensor bias is the negative of the certificate offset the server adds back.
    this.bias = -d.calibrationOffset + this.rng.gauss() * 0.03;
    this.battery = d.hardware.battery ? d.hardware.battery.startPct : null;
    this.clockSkewMs = this.rng.gauss() * 400;
    // Stagger first reports so the fleet does not report in lock-step.
    this.nextReportAt = simNow + this.rng.range(0.5, d.hardware.kind === "food-probe" ? 120 : Math.min(30, d.expectedIntervalSec)) * 1000;
  }
  get id() {
    return this.d.deviceId;
  }
  get kind() {
    return this.d.hardware.kind;
  }
  online() {
    if (this.dead || this.disabled || simNow < this.offlineUntil || this.faults.has("offline")) return false;
    if (this.d.hardware.radio === "lorawan" && simNow < (gatewayDownUntil.get(this.d.branchId) ?? 0)) return false;
    return true;
  }
  rssi() {
    const doorPenalty = this.cabinet && this.d.hardware.equipmentType.startsWith("walk-in") && !this.cabinet.doorOpen ? -2 : 0;
    return Math.round(clamp(this.d.hardware.rssiDbm + doorPenalty + this.rng.gauss() * 3, -139, -20));
  }
  setFault(kind: string, injected: boolean, until?: number) {
    if (this.faults.has(kind)) return;
    this.faults.set(kind, { kind, since: simNow, injected, until });
    if (kind === "compressor" && this.cabinet) this.cabinet.compressorFaultSince = simNow;
    if (kind === "heater" && this.cabinet) this.cabinet.heaterFault = true;
    if (kind === "door-ajar" && this.cabinet) this.cabinet.doorAjar = true;
    if (kind === "drift") this.driftPerMin = (this.rng.chance(0.75) ? 1 : -1) * this.rng.range(0.01, 0.025);
    if (kind === "stuck") this.stuckValue = null; // captured at the next reading
    if (kind === "oil-overdue" && this.fryer) this.fryer.overdue = true;
    if (kind === "trip" && this.fryer) this.fryer.tripped = true;
    if (kind === "skew") this.clockSkewMs = this.rng.range(3, 6) * 60_000;
    log(`FAULT ${injected ? "injected" : "occurred"} ${this.id}: ${kind}`);
  }
  clearFault(kind: string) {
    if (!this.faults.delete(kind)) return;
    if (kind === "compressor" && this.cabinet) this.cabinet.compressorFaultSince = null;
    if (kind === "heater" && this.cabinet) this.cabinet.heaterFault = false;
    if (kind === "door-ajar" && this.cabinet) this.cabinet.doorAjar = false;
    if (kind === "drift") {
      this.driftPerMin = 0;
      this.bias = -this.d.calibrationOffset; // recalibrated
    }
    if (kind === "stuck") this.stuckValue = null;
    if (kind === "trip" && this.fryer) this.fryer.tripped = false;
    log(`FIXED ${this.id}: ${kind} repaired by technician`);
  }

  /** Physics, faults and reporting for dt simulated seconds. */
  step(dt: number) {
    if (this.dead || this.disabled) return;
    // Battery drain (nominal life at this interval); a battery fault drains ~200× faster.
    if (this.battery !== null && this.d.hardware.battery) {
      const perSec = 100 / (this.d.hardware.battery.lifeDays * 86_400);
      this.battery -= perSec * dt * (this.faults.has("battery") ? 200 * 365 : 1);
      if (this.battery <= 0) {
        this.battery = 0;
        this.dead = true;
        log(`DEAD  ${this.id}: battery exhausted — device stopped reporting`);
        return;
      }
    }
    if (this.driftPerMin) this.bias += (this.driftPerMin * dt) / 60;
    for (const f of [...this.faults.values()]) if (f.until && simNow >= f.until) this.clearFault(f.kind);
    this.randomEvents(dt);

    // Event-driven messages: door changes and controller status changes are sent immediately.
    if (this.kind === "door" && this.cabinet) {
      const open = this.cabinet.doorOpen ? 1 : 0;
      if (open !== this.lastDoor && this.lastDoor !== null) this.enqueue([{ metric: "door_open", value: open }]);
      this.lastDoor = open;
    }
    if (this.kind === "controller") {
      const st = this.fryerTripped() ? 0 : 1;
      if (this.lastStatus !== null && st !== this.lastStatus) this.enqueue([{ metric: "status", value: st }]);
      this.lastStatus = st;
    }
    if (this.kind === "food-probe") {
      const act = activity(this.d.branchId);
      // QC checks follow cooking volume; one verification every ≤ 25 min keeps the probe in use while open.
      if (act > 0.05 && (happens(10 * act, dt) || simNow - this.nextReportAt > 25 * 60_000)) {
        this.nextReportAt = simNow;
        const under = this.faults.has("undercook") ? this.rng.chance(0.5) : this.rng.chance(0.02);
        const core = under ? this.rng.range(69, 74.5) : clamp(82 + this.rng.gauss() * 4, 75.6, 96);
        this.enqueue([{ metric: "probe_temperature_c", value: r1(core + this.bias) }]);
      }
      return;
    }
    if (simNow >= this.nextReportAt) {
      this.nextReportAt = simNow + this.d.expectedIntervalSec * 1000 * this.rng.range(0.97, 1.03);
      const reading = this.measure();
      if (reading) this.enqueue([reading]);
    }
  }

  private fryerTripped() {
    return this.fryer?.tripped ?? this.faults.has("trip");
  }

  private measure(): { metric: string; value: number } | null {
    switch (this.kind) {
      case "cold-air":
      case "frozen-air":
      case "hot-air": {
        let v = this.cabinet!.T + this.bias + this.rng.gauss() * 0.08;
        if (this.faults.has("stuck")) v = this.stuckValue ??= v;
        return { metric: "temperature_c", value: r1(v) };
      }
      case "oil": {
        let v = clamp(this.fryer!.Q + this.bias + this.rng.gauss() * 0.4, 0, 100);
        if (this.faults.has("stuck")) v = this.stuckValue ??= v;
        return { metric: "oil_quality_pct", value: Math.round(v * 2) / 2 };
      }
      case "door":
        return { metric: "door_open", value: this.cabinet!.doorOpen ? 1 : 0 };
      case "controller":
        return { metric: "status", value: this.fryerTripped() ? 0 : 1 };
      default:
        return null;
    }
  }

  private randomEvents(dt: number) {
    const k = CHAOS;
    if (!k) return;
    const radio = this.d.hardware.radio;
    // Offline gaps (interference, Wi-Fi roaming, a probe knocked behind stock).
    if (simNow >= this.offlineUntil && happens(k * ({ lorawan: 1.2, wifi: 0.8, ble: 0.4, ethernet: 0.2 }[radio] / 100), dt)) {
      this.offlineUntil = simNow + this.rng.range(3, 20) * 60_000;
      log(`DOWN  ${this.id}: link lost for ${Math.round((this.offlineUntil - simNow) / 60_000)} min (buffering)`);
    }
    // Device clock glitch: a few minutes ahead (rejected → NTP resync) or a small drift (accepted).
    if (happens(k * 0.004, dt)) this.clockSkewMs = this.rng.range(3, 6) * 60_000;
    else if (happens(k * 0.02, dt)) this.clockSkewMs = this.rng.range(20, 80) * 1000;
    const spont = (kind: string, perHour: number, minH: number, maxH: number) => {
      if (!this.faults.has(kind) && happens(k * perHour, dt)) this.setFault(kind, false, simNow + this.rng.range(minH, maxH) * 3600_000);
    };
    if (["cold-air", "frozen-air", "hot-air"].includes(this.kind)) {
      spont("drift", 0.0015, 2, 8);
      spont("stuck", 0.0004, 0.5, 2);
    }
    if (this.kind === "cold-air" || this.kind === "frozen-air") spont("compressor", 0.0005, 0.5, 3);
    if (this.kind === "hot-air") spont("heater", 0.0005, 0.5, 2);
    if (this.kind === "door") spont("door-ajar", 0.002 * (activity(this.d.branchId) + 0.1), 0.15, 0.5);
    if (this.kind === "controller") spont("trip", 0.002, 0.08, 0.5);
  }

  enqueue(readings: Array<{ metric: string; value: number }>) {
    const skew = this.clockSkewMs;
    const body: Record<string, unknown> = {
      v: 1,
      messageId: randomUUID(),
      deviceId: this.id,
      ts: new Date(Date.now() + skew).toISOString(),
      readings,
      ...(this.battery !== null ? { battery_pct: Math.round(this.battery) } : {}),
      rssi_dbm: this.rssi(),
      firmware: this.d.hardware.firmware,
    };
    this.outbox.push({ id: body.messageId as string, body, skewMs: skew, takenAt: Date.now(), attempts: 0 });
    // Devices keep ~12 h of readings in flash; the oldest are dropped beyond that.
    if (this.outbox.length > 720) this.outbox.shift();
    if (!this.online()) stats.buffered++;
  }
}

// ───────────────────────────── POS terminals ─────────────────────────────

type PosStatus = "RECEIVED" | "ACCEPTED" | "READY" | "COMPLETED" | "CANCELLED";
interface PosOut {
  body: Record<string, unknown>;
  attempts: number;
}
interface PendingEvent {
  at: number;
  status: PosStatus;
  order: { ref: string; channel: string; fulfilment: string; lines: Array<{ menuId: string; qty: number; unitPriceGhs: number }> };
}

const ORDERS_PER_HOUR: Record<string, number> = { "model-a": 15, "model-b": 22, "model-c": 34 };

class Terminal {
  outbox: PosOut[] = [];
  inflight = false;
  backoffUntil = 0;
  offlineUntil = 0;
  pending: PendingEvent[] = [];
  seq = 0;
  constructor(readonly t: VirtualTerminalEntry) {}
  get id() {
    return this.t.sourceId;
  }
  online() {
    return simNow >= this.offlineUntil;
  }
  newOrder() {
    const app = this.t.channels.includes("chris-b-app");
    const channel = app ? rng.weighted<string>([["chris-b-app", 45], ["online", 20], ["phone", 15], ["delivery-partner", 20]]) : rng.weighted<string>([["walk-in", 70], ["pos", 30]]);
    const fulfilment = app ? (channel === "delivery-partner" || rng.chance(0.85) ? "delivery" : "pickup") : rng.chance(0.6) ? "pickup" : "dine-in";
    const n = rng.weighted<number>([[1, 55], [2, 30], [3, 15]]);
    const lines = new Map<string, { menuId: string; qty: number; unitPriceGhs: number }>();
    for (let i = 0; i < n; i++) {
      const m = rng.weighted(MENU.map((x) => [x, x.weight] as const));
      const l = lines.get(m.id) ?? { menuId: m.id, qty: 0, unitPriceGhs: m.price };
      l.qty = Math.min(99, l.qty + rng.weighted<number>([[1, 80], [2, 17], [3, 3]]));
      lines.set(m.id, l);
    }
    this.seq++;
    stats.orders++;
    const day = new Date(simNow).toISOString().slice(2, 10).replace(/-/g, "");
    const ref = app ? `CB-${String(rng.int(100000, 999999))}` : `${this.id.split("-").pop()!.toUpperCase()}-${day}-${String(this.seq).padStart(4, "0")}`;
    const order = { ref, channel, fulfilment, lines: [...lines.values()] };
    const t0 = simNow;
    this.pending.push({ at: t0, status: "RECEIVED", order });
    if (rng.chance(0.05)) {
      this.pending.push({ at: t0 + rng.range(20, 120) * 1000, status: "CANCELLED", order });
      return;
    }
    const accepted = t0 + (app ? rng.range(15, 90) : rng.range(2, 10)) * 1000;
    this.pending.push({ at: accepted, status: "ACCEPTED", order });
    if (rng.chance(0.02)) {
      this.pending.push({ at: accepted + rng.range(1, 6) * 60_000, status: "CANCELLED", order });
      return;
    }
    const ready = accepted + rng.range(8, 22) * 60_000;
    this.pending.push({ at: ready, status: "READY", order });
    this.pending.push({ at: ready + (fulfilment === "delivery" ? rng.range(15, 40) : rng.range(1, 8)) * 60_000, status: "COMPLETED", order });
  }
  step(dt: number) {
    if (simNow >= this.offlineUntil && happens(CHAOS * 0.003, dt)) {
      this.offlineUntil = simNow + rng.range(2, 10) * 60_000;
      log(`DOWN  ${this.id}: POS offline for ${Math.round((this.offlineUntil - simNow) / 60_000)} min (store-and-forward)`);
    }
    const due = this.pending.filter((p) => p.at <= simNow).sort((a, b) => a.at - b.at);
    this.pending = this.pending.filter((p) => p.at > simNow);
    for (const p of due) {
      const body = {
        v: 1,
        idempotencyKey: randomUUID(),
        branchId: this.t.branchId,
        externalRef: p.order.ref,
        channel: p.order.channel,
        fulfilment: p.order.fulfilment,
        status: p.status,
        lines: p.order.lines,
        ts: new Date().toISOString(),
      };
      this.outbox.push({ body, attempts: 0 });
    }
  }
}

// ───────────────────────────── transport ─────────────────────────────

async function post(path: string, id: string, header: "x-ops-device" | "x-ops-source", body: string) {
  const ts = Date.now();
  return fetch(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", [header]: id, "x-ops-timestamp": String(ts), "x-ops-signature": sign(keyFor(id), ts, body) }, body });
}

async function flushDevice(dev: Device) {
  if (dev.inflight || !dev.outbox.length || !dev.online() || Date.now() < dev.backoffUntil) return;
  dev.inflight = true;
  try {
    while (dev.outbox.length && dev.online() && Date.now() >= dev.backoffUntil) {
      const m = dev.outbox[0];
      // Uplink lost on air: no ack, so the device retries the SAME message id after a back-off.
      const loss = dev.d.hardware.lossRate * CHAOS * (dev.rssi() < -110 ? 2 : 1);
      if (rng.chance(loss)) {
        stats.lost++;
        m.attempts++;
        dev.backoffUntil = Date.now() + rng.range(2, 8) * 1000;
        break;
      }
      const raw = JSON.stringify(m.body);
      const res = await post("/api/ingest/telemetry", dev.id, "x-ops-device", raw);
      stats.sent++;
      m.attempts++;
      const text = await res.text();
      if (res.status === 202 || res.status === 200) {
        if (res.status === 202) stats.accepted++;
        else stats.duplicates++;
        // Ack lost on the way back: the device resends the same message id; the server must de-duplicate it.
        if (res.status === 202 && rng.chance(dev.faults.has("dupes") ? 0.4 : 0.015 * CHAOS)) {
          const again = await post("/api/ingest/telemetry", dev.id, "x-ops-device", raw);
          stats.sent++;
          if (again.status === 200) stats.duplicates++;
          await again.text();
        }
        if (Date.now() - m.takenAt > dev.d.expectedIntervalSec * 2000 && !QUIET && dev.outbox.length === 1) log(`SYNC  ${dev.id}: buffered readings delivered after reconnect`);
        dev.outbox.shift();
      } else if (res.status === 400 && text.includes("clock_skew")) {
        // Rejected as future-dated: resync NTP and correct the buffered timestamps by the measured offset.
        stats.skewRejected++;
        log(`SKEW  ${dev.id}: rejected (clock ${Math.round(m.skewMs / 1000)} s ahead) — NTP resync, resending`);
        for (const o of dev.outbox) {
          o.body.ts = new Date(Date.parse(o.body.ts as string) - o.skewMs).toISOString();
          o.skewMs = 0;
        }
        if (dev.faults.get("skew")?.injected) dev.faults.delete("skew");
        dev.clockSkewMs = dev.rng.gauss() * 300;
      } else if (res.status === 401) {
        log(`AUTH  ${dev.id}: ${res.status} ${text} — is VIRTUAL_FLEET_SECRET the same on the server? Device disabled.`);
        dev.disabled = true;
        stats.failed++;
      } else if (res.status >= 400 && res.status < 500) {
        log(`DROP  ${dev.id}: ${res.status} ${text}`);
        dev.outbox.shift();
        stats.failed++;
      } else {
        dev.backoffUntil = Date.now() + 5000;
        break;
      }
    }
  } catch {
    // Server unreachable: keep the buffer and retry.
    dev.backoffUntil = Date.now() + 5000;
  } finally {
    dev.inflight = false;
  }
}

async function flushTerminal(t: Terminal) {
  if (t.inflight || !t.outbox.length || !t.online() || Date.now() < t.backoffUntil) return;
  t.inflight = true;
  try {
    while (t.outbox.length && t.online()) {
      const m = t.outbox[0];
      const raw = JSON.stringify(m.body);
      const res = await post("/api/ingest/pos", t.id, "x-ops-source", raw);
      m.attempts++;
      const text = await res.text();
      if (res.status === 202 || res.status === 200) {
        stats.posEvents++;
        if (res.status === 200) stats.duplicates++;
        // Webhook retry after a timeout: same idempotency key, must be de-duplicated.
        if (res.status === 202 && rng.chance(0.02 * CHAOS)) {
          const again = await post("/api/ingest/pos", t.id, "x-ops-source", raw);
          if (again.status === 200) stats.duplicates++;
          await again.text();
        }
        if (!QUIET && m.body.status === "RECEIVED") log(`ORDER ${t.id}: ${m.body.externalRef} ${m.body.channel}/${m.body.fulfilment} ${(m.body.lines as Array<{ menuId: string; qty: number }>).map((l) => `${l.qty}× ${l.menuId}`).join(", ")}`);
        t.outbox.shift();
      } else if (res.status >= 400 && res.status < 500) {
        log(`DROP  ${t.id}: ${res.status} ${text}`);
        stats.failed++;
        t.outbox.shift();
        if (res.status === 401) {
          t.backoffUntil = Date.now() + 60_000;
          break;
        }
      } else {
        t.backoffUntil = Date.now() + 5000;
        break;
      }
    }
  } catch {
    t.backoffUntil = Date.now() + 5000;
  } finally {
    t.inflight = false;
  }
}

// ───────────────────────────── build the fleet ─────────────────────────────

const branches = selectBranches();
const cabinets = new Map<string, Cabinet>();
const fryers = new Map<string, Fryer>();
const devices: Device[] = [];
const fleetDevices = flag("no-devices") ? [] : fleet.devices.filter((d) => branches.includes(d.branchId));
for (const d of fleetDevices) {
  const key = `${d.branchId}:${d.equipmentId ?? d.sensorCode}`;
  let cab: Cabinet | null = null;
  let fry: Fryer | null = null;
  if (d.hardware.thermal) cabinets.set(key, (cab = cabinets.get(key) ?? new Cabinet(key, d.branchId, d)));
  if (d.hardware.equipmentType === "fryer") {
    fry = fryers.get(key) ?? new Fryer(key, d.branchId, d.equipmentId ?? key);
    if (d.hardware.oil) fry.oil = d.hardware.oil;
    fryers.set(key, fry);
  }
  devices.push(new Device(d, cab, fry));
}
// Door contacts share the cabinet of the temperature probe on the same equipment.
for (const dev of devices) if (dev.kind === "door" && !dev.cabinet) dev.cabinet = cabinets.get(`${dev.d.branchId}:${dev.d.equipmentId}`) ?? null;
const terminals = flag("no-pos") ? [] : fleet.posTerminals.filter((t) => branches.includes(t.branchId)).map((t) => new Terminal(t));

for (const spec of args("fault")) {
  const i = spec.lastIndexOf(":");
  const [id, kind] = [spec.slice(0, i), spec.slice(i + 1)];
  const dev = devices.find((x) => x.id === id);
  if (!dev) {
    console.error(`--fault ${spec}: unknown device "${id}" (use --list to see device ids)`);
    process.exit(1);
  }
  const allowed = faultsFor(dev.d);
  if (!allowed.includes(kind)) {
    console.error(`--fault ${spec}: "${kind}" does not apply to a ${dev.kind} device. Use one of: ${allowed.join(", ")}`);
    process.exit(1);
  }
  dev.setFault(kind, true);
}

// ───────────────────────────── main loop ─────────────────────────────

const branchOrderAt = new Map(branches.map((b) => [b, simNow + rng.range(5, 40) * 1000]));
function stepWorld(dt: number) {
  // Integrate physics in ≤ 2 s substeps so short door openings are resolved at any speed.
  const n = Math.max(1, Math.ceil(dt / 2));
  const h = dt / n;
  const t0 = simNow;
  for (let i = 0; i < n; i++) {
    simNow = t0 + (i + 1) * h * 1000;
    for (const c of cabinets.values()) c.step(h);
    for (const f of fryers.values()) f.step(h);
    for (const d of devices) d.step(h);
    for (const b of branches) {
      if (CHAOS && simNow >= (gatewayDownUntil.get(b) ?? 0) && happens(CHAOS * 0.004, h) && devices.some((d) => d.d.branchId === b && d.d.hardware.radio === "lorawan")) {
        const until = simNow + rng.range(5, 25) * 60_000;
        gatewayDownUntil.set(b, until);
        log(`DOWN  ${branchName(b)} LoRaWAN gateway offline for ${Math.round((until - simNow) / 60_000)} min — probes buffering`);
      }
    }
    // Orders: Poisson arrivals following the demand curve, split across the branch's terminals.
    for (const b of branches) {
      if (!terminals.some((t) => t.t.branchId === b)) continue;
      if (simNow < branchOrderAt.get(b)!) continue;
      const fp = fleet.branches.find((x) => x.branchId === b)!.floorPlan;
      const rate = branchOpen(b) ? (ORDERS_PER_HOUR[fp] ?? 20) * demandFactor(hourOf(simNow)) : 0;
      if (rate > 0) {
        const ts = terminals.filter((t) => t.t.branchId === b);
        rng.weighted(ts.map((t) => [t, t.t.demandShare] as const)).newOrder();
      }
      branchOrderAt.set(b, simNow + rng.exp(Math.max(rate, 0.5) / 3600) * 1000);
    }
    for (const t of terminals) t.step(h);
  }
}

async function heartbeat() {
  const faults = devices.flatMap((d) => [...d.faults.values()].map((f) => ({ deviceId: d.id, kind: f.kind, since: new Date(startedReal + (f.since - startedReal) / SPEED).toISOString(), injected: f.injected })));
  for (const d of devices) if (d.dead) faults.push({ deviceId: d.id, kind: "battery-dead", since: new Date().toISOString(), injected: d.faults.has("battery") });
  const body = JSON.stringify({ v: 1, startedAt: new Date(startedReal).toISOString(), speed: SPEED, branches, devices: devices.length, terminals: terminals.length, faults: faults.slice(0, 500), offline: devices.filter((d) => !d.online()).map((d) => d.id) });
  try {
    const res = await post("/api/ingest/simulator", SIMULATOR_ID, "x-ops-device", body);
    if (res.status !== 202 && !QUIET) log(`HB    simulator heartbeat → ${res.status} ${await res.text()}`);
    else await res.text();
  } catch {
    /* server down: devices are buffering anyway */
  }
}

async function preflight() {
  try {
    const res = await fetch(`${BASE_URL}/api/integration/status`);
    if (res.ok) {
      const s = (await res.json()) as { virtualFleetConfigured?: boolean };
      if (!s.virtualFleetConfigured) console.warn(`! The server at ${BASE_URL} has no VIRTUAL_FLEET_SECRET — readings will be refused (401). Add it to .env.local and restart the server.`);
    }
  } catch {
    console.warn(`! ${BASE_URL} is not reachable yet — devices will buffer and retry.`);
  }
}

let lastTick = Date.now();
let lastSummary = Date.now();
async function main() {
  console.log(`Hardware simulator → ${BASE_URL}   speed ${SPEED}×   chaos ${CHAOS}`);
  for (const b of branches) console.log(`  ${branchName(b).padEnd(12)} ${devices.filter((d) => d.d.branchId === b).length} devices, ${terminals.filter((t) => t.t.branchId === b).length} POS sources${branchOpen(b) ? "" : " (closed now)"}`);
  console.log("  Everything sent is marked virtual by the server: SIM DEVICE in the console, never LIVE.\n");
  await preflight();
  await heartbeat();
  setInterval(heartbeat, 20_000);
  setInterval(() => {
    const now = Date.now();
    stepWorld(((now - lastTick) / 1000) * SPEED);
    lastTick = now;
    for (const d of devices) void flushDevice(d);
    for (const t of terminals) void flushTerminal(t);
    if (now - lastSummary >= 30_000) {
      lastSummary = now;
      const buffered = devices.reduce((s, d) => s + d.outbox.length, 0) + terminals.reduce((s, t) => s + t.outbox.length, 0);
      const offline = devices.filter((d) => !d.online()).length;
      log(`STATS sent ${stats.sent} · accepted ${stats.accepted} · duplicates ${stats.duplicates} · lost-retried ${stats.lost} · skew-rejected ${stats.skewRejected} · failed ${stats.failed} · orders ${stats.orders} (${stats.posEvents} events) · buffered ${buffered} · offline ${offline}/${devices.length} · sim ${new Date(simNow).toISOString().slice(11, 16)}Z`);
    }
  }, TICK_MS);
}

process.on("SIGINT", () => {
  console.log(`\nStopped. sent ${stats.sent}, accepted ${stats.accepted}, duplicates ${stats.duplicates}, orders ${stats.orders}.`);
  process.exit(0);
});

void main();
