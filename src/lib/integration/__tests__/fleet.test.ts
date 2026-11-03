import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as posRoute } from "@/app/api/ingest/pos/route";
import { POST as simulatorRoute } from "@/app/api/ingest/simulator/route";
import { POST as telemetryRoute } from "@/app/api/ingest/telemetry/route";
import virtualFleet from "@/data/devices.virtual.json";
import { modelC } from "../../floorplan/templates";
import { rankPriorities } from "../../ops/priority";
import { BranchSimulation } from "../../sim/engine";
import type { NormalisedOrderEvent, NormalisedReading } from "../contracts";
import { deriveVirtualKey, SIMULATOR_ID, virtualKey } from "../fleet";
import { __resetHub, backlog, BINDINGS, deviceSecret, deviceStatus, isVirtualDevice, posSecret, simulatorStatus, terminalStatus } from "../hub";
import { sign } from "../signing";

const FLEET = "fleet-secret-0123456789abcdef-0123456789abcdef";
const WALK_IN = "v-eastlegon-walk-in-cold-1-temp";
const TERMINAL = "vpos-eastlegon-01";

function telemetry(deviceId: string, value: number, { messageId = randomUUID(), key = deriveVirtualKey(FLEET, deviceId), ts = new Date().toISOString(), metric = "temperature_c" } = {}) {
  const raw = JSON.stringify({ v: 1, messageId, deviceId, ts, readings: [{ metric, value }], battery_pct: 88, rssi_dbm: -97, firmware: "lw-ct-3.4.1" });
  const t = Date.now();
  return telemetryRoute(new Request("http://localhost/api/ingest/telemetry", { method: "POST", body: raw, headers: { "x-pmcm-device": deviceId, "x-pmcm-timestamp": String(t), "x-pmcm-signature": sign(key, t, raw) } }));
}

function posEvent(status: string, { source = TERMINAL, key = deriveVirtualKey(FLEET, source), branchId = "branch-015", idempotencyKey = randomUUID() } = {}) {
  const raw = JSON.stringify({ v: 1, idempotencyKey, branchId, externalRef: "01-261103-0001", channel: "walk-in", fulfilment: "pickup", status, lines: [{ menuId: "pz-chicken-l", qty: 1, unitPriceGhs: 150 }], ts: new Date().toISOString() });
  const t = Date.now();
  return posRoute(new Request("http://localhost/api/ingest/pos", { method: "POST", body: raw, headers: { "x-pmcm-source": source, "x-pmcm-timestamp": String(t), "x-pmcm-signature": sign(key, t, raw) } }));
}

const readings = () => backlog(null, 0).filter((e): e is NormalisedReading => e.type === "reading");

beforeEach(() => {
  __resetHub();
  vi.stubEnv("VIRTUAL_FLEET_SECRET", FLEET);
});
afterEach(() => vi.unstubAllEnvs());

describe("virtual fleet registry", () => {
  it("is loaded alongside the physical registry and binds the three demo branches", () => {
    const branches = new Set(virtualFleet.devices.map((d) => d.branchId));
    expect([...branches].sort()).toEqual(["branch-015", "branch-033", "branch-046"]);
    expect(BINDINGS.filter((b) => b.virtual).length).toBe(virtualFleet.devices.length);
    expect(BINDINGS.some((b) => b.deviceId === "bench-coldroom-01" && !b.virtual)).toBe(true);
    // Every device id is unique and every binding names equipment or a sensor code.
    expect(new Set(virtualFleet.devices.map((d) => d.deviceId)).size).toBe(virtualFleet.devices.length);
  });

  it("binds every virtual device to equipment or a sensor that exists in the branch floor plan", () => {
    const plan = modelC();
    for (const d of virtualFleet.devices.filter((x) => x.branchId === "branch-015")) {
      const ok = "equipmentId" in d && d.equipmentId ? plan.equipment.some((e) => e.id === d.equipmentId) : plan.sensors.some((s) => s.code === (d as { sensorCode?: string }).sensorCode);
      expect(ok, d.deviceId).toBe(true);
    }
  });
});

describe("virtual device keys", () => {
  it("derives a per-device key as HMAC(VIRTUAL_FLEET_SECRET, id)", () => {
    expect(deriveVirtualKey(FLEET, WALK_IN)).toBe(createHmac("sha256", FLEET).update(WALK_IN).digest("hex"));
    expect(deriveVirtualKey(FLEET, WALK_IN)).not.toBe(deriveVirtualKey(FLEET, "v-eastlegon-freezer-1-temp"));
    expect(virtualKey(WALK_IN)).toBe(deriveVirtualKey(FLEET, WALK_IN));
    expect(deviceSecret(WALK_IN)).toBe(deriveVirtualKey(FLEET, WALK_IN));
    expect(posSecret(TERMINAL)).toBe(deriveVirtualKey(FLEET, TERMINAL));
  });

  it("has no key without a long enough fleet secret, and never accepts DEVICE_KEYS for a virtual id", () => {
    vi.stubEnv("DEVICE_KEYS", JSON.stringify({ [WALK_IN]: "a-physical-key-0123456789" }));
    vi.stubEnv("VIRTUAL_FLEET_SECRET", "too-short");
    expect(virtualKey(WALK_IN)).toBeNull();
    expect(deviceSecret(WALK_IN)).toBeNull();
    expect(deviceStatus().find((d) => d.deviceId === WALK_IN)?.keyConfigured).toBe(false);
  });

  it("rejects a virtual device signed with another device's key or the wrong fleet secret", async () => {
    expect((await telemetry(WALK_IN, 3.1, { key: deriveVirtualKey(FLEET, "v-eastlegon-freezer-1-temp") })).status).toBe(401);
    expect((await telemetry(WALK_IN, 3.1, { key: deriveVirtualKey("another-fleet-secret-0123456789abcdef", WALK_IN) })).status).toBe(401);
    expect(readings()).toHaveLength(0);
  });
});

describe("virtual provenance end to end", () => {
  it("stamps readings from virtual devices origin=virtual, and physical ones origin=physical", async () => {
    expect((await telemetry(WALK_IN, 3.1)).status).toBe(202);
    const [r] = readings();
    expect(r).toMatchObject({ deviceId: WALK_IN, branchId: "branch-015", equipmentId: "walk-in-cold-1", origin: "virtual", source: "virtual" });
    // The registry's calibration offset is applied server-side.
    const offset = virtualFleet.devices.find((d) => d.deviceId === WALK_IN)!.calibrationOffset;
    expect(r.value).toBeCloseTo(3.1 + offset, 2);
    expect(isVirtualDevice(WALK_IN)).toBe(true);

    vi.stubEnv("DEVICE_KEYS", JSON.stringify({ "bench-coldroom-01": "bench-secret-0123456789" }));
    expect((await telemetry("bench-coldroom-01", 3.0, { key: "bench-secret-0123456789" })).status).toBe(202);
    expect(readings().find((x) => x.deviceId === "bench-coldroom-01")).toMatchObject({ origin: "physical", source: "live" });
  });

  it("hub → engine: a virtual reading turns the sensor SIM DEVICE and its alerts carry source virtual", async () => {
    const start = Date.now();
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: start, config: { seed: 1, arrivalRate: 10, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
    const feed = async (value: number) => {
      __resetHub();
      expect((await telemetry(WALK_IN, value)).status).toBe(202);
      const [r] = readings();
      // The engine runs ahead of the wall clock here; place the device timestamp on its timeline.
      return sim.ingestReading({ ...r, ts: sim.now() })!;
    };
    const id = await feed(3.0);
    const st = sim.sensors.get(id)!;
    expect(st.source).toBe("virtual");
    expect(st.deviceId).toBe(WALK_IN);
    for (let i = 0; i < 14; i++) {
      sim.advance(30, 1e6);
      await feed(8.5);
    }
    const alert = sim.alerts.find((a) => a.sensorId === id)!;
    expect(alert.source).toBe("virtual");
    expect(alert.issue).toMatch(/^Simulated-device reading/);
    // The priority queue keeps the provenance: SIM DEVICE, never LIVE.
    const items = rankPriorities([{ branchId: "branch-015", status: "critical" } as never], new Map([["branch-015", sim]]), sim.now());
    expect(items.find((x) => x.id === alert.id)?.provenance).toBe("virtual");
    // In-browser simulation must not overwrite device values.
    sim.advance(60, 1e6);
    expect(st.value).toBe(Math.round((8.5 + virtualFleet.devices.find((d) => d.deviceId === WALK_IN)!.calibrationOffset) * 10) / 10);
  });

  it("raises a SIM DEVICE connectivity alert when a virtual device goes silent", async () => {
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: Date.now(), config: { seed: 1, arrivalRate: 10, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
    await telemetry(WALK_IN, 3.0, { ts: new Date(sim.now()).toISOString() });
    const id = sim.ingestReading(readings()[0])!;
    sim.advance(400, 1e6);
    const a = sim.alerts.find((x) => x.sensorId === id)!;
    expect(a.title).toMatch(/connectivity lost/);
    expect(a.source).toBe("virtual");
  });

  it("applies a controller status on equipment without a health sensor (fryers)", () => {
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: Date.now(), config: { seed: 1, arrivalRate: 0, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
    const r = { equipmentId: "fryer-1", metric: "status", value: 0, ts: sim.now(), deviceId: "v-eastlegon-fryer-1-ctl", expectedIntervalSec: 120, origin: "virtual" as const };
    expect(sim.ingestReading(r)).toBe("equipment:fryer-1");
    expect(sim.equipment.get("fryer-1")?.fault?.kind).toBe("reported");
    sim.ingestReading({ ...r, value: 1 });
    expect(sim.equipment.get("fryer-1")?.fault).toBeUndefined();
  });

  it("virtual POS terminals: derived key, origin virtual, SIM DEVICE order in the engine", async () => {
    expect((await posEvent("RECEIVED")).status).toBe(202);
    const e = backlog(null, 0).find((x): x is NormalisedOrderEvent => x.type === "order")!;
    expect(e).toMatchObject({ sourceId: TERMINAL, origin: "virtual", source: "virtual" });
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: Date.now(), config: { seed: 1, arrivalRate: 0, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
    const o = sim.ingestOrderEvent({ ...e.event, origin: e.origin })!;
    expect(o.source).toBe("virtual");
    expect(o.payment).toBeUndefined();
    // A later event from the same terminal updates the same order.
    expect(sim.ingestOrderEvent({ ...e.event, status: "ACCEPTED", origin: "virtual" })).toBe(o);
    expect(terminalStatus().find((t) => t.sourceId === TERMINAL)?.orders).toBe(1);
  });

  it("refuses a virtual terminal signed with the POS secret, or reporting another branch", async () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "pos-secret-0123456789abcdef");
    expect((await posEvent("RECEIVED", { key: "pos-secret-0123456789abcdef" })).status).toBe(401);
    expect((await posEvent("RECEIVED", { branchId: "branch-033" })).status).toBe(422);
    // Unregistered senders keep using the shared POS secret and stay physical.
    expect((await posEvent("RECEIVED", { source: "chris-b", key: "pos-secret-0123456789abcdef" })).status).toBe(202);
    expect(backlog(null, 0).find((x) => x.type === "order")).toMatchObject({ origin: "physical", source: "live" });
  });
});

describe("de-duplication of retried messages", () => {
  it("acknowledges a retried telemetry message once and counts the duplicate", async () => {
    const messageId = randomUUID();
    expect((await telemetry(WALK_IN, 3.2, { messageId })).status).toBe(202);
    expect((await telemetry(WALK_IN, 3.2, { messageId })).status).toBe(200);
    expect((await telemetry(WALK_IN, 3.2, { messageId })).status).toBe(200);
    expect(readings()).toHaveLength(1);
    expect(deviceStatus().find((d) => d.deviceId === WALK_IN)).toMatchObject({ messages: 1, duplicates: 2 });
  });

  it("accepts buffered catch-up readings with their original timestamps and counts them as late", async () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    expect((await telemetry(WALK_IN, 3.4, { ts: old })).status).toBe(202);
    expect(readings()[0].ts).toBe(Date.parse(old));
    expect(deviceStatus().find((d) => d.deviceId === WALK_IN)?.late).toBe(1);
  });

  it("rejects future-dated readings (device clock skew) and counts the rejection", async () => {
    const res = await telemetry(WALK_IN, 3.4, { ts: new Date(Date.now() + 5 * 60_000).toISOString() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "clock_skew" });
    expect(deviceStatus().find((d) => d.deviceId === WALK_IN)?.rejected).toBe(1);
  });

  it("de-duplicates retried POS events from a virtual terminal", async () => {
    const idempotencyKey = randomUUID();
    expect((await posEvent("RECEIVED", { idempotencyKey })).status).toBe(202);
    expect((await posEvent("RECEIVED", { idempotencyKey })).status).toBe(200);
    expect(backlog(null, 0)).toHaveLength(1);
    expect(terminalStatus().find((t) => t.sourceId === TERMINAL)).toMatchObject({ orders: 1, duplicates: 1 });
  });
});

describe("simulator heartbeat", () => {
  const report = { v: 1, startedAt: new Date().toISOString(), speed: 10, branches: ["branch-015"], devices: 27, terminals: 3, faults: [{ deviceId: WALK_IN, kind: "compressor", since: new Date().toISOString(), injected: true }], offline: [] };
  const call = (key: string, body = JSON.stringify(report)) => {
    const t = Date.now();
    return simulatorRoute(new Request("http://localhost/api/ingest/simulator", { method: "POST", body, headers: { "x-pmcm-device": SIMULATOR_ID, "x-pmcm-timestamp": String(t), "x-pmcm-signature": sign(key, t, body) } }));
  };
  it("accepts a signed report and exposes the simulated faults", async () => {
    expect((await call(deriveVirtualKey(FLEET, SIMULATOR_ID))).status).toBe(202);
    expect(simulatorStatus()).toMatchObject({ running: true, speed: 10, faults: [{ deviceId: WALK_IN, kind: "compressor" }] });
  });
  it("refuses unsigned or malformed reports", async () => {
    expect((await call(deriveVirtualKey(FLEET, WALK_IN))).status).toBe(401);
    expect((await call(deriveVirtualKey(FLEET, SIMULATOR_ID), JSON.stringify({ v: 2 }))).status).toBe(400);
    expect(simulatorStatus()).toBeNull();
  });
});
