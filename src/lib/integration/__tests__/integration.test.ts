import { beforeEach, describe, expect, it } from "vitest";
import { modelC } from "../../floorplan/templates";
import { BranchSimulation } from "../../sim/engine";
import { PosOrderEvent, TelemetryMessage, type HubEvent } from "../contracts";
import { __resetHub, backlog, deviceSecret, FRESH_REPLAY_MS, ingest, ingestOrder } from "../hub";
import { MAX_SKEW_MS, sign, verify } from "../signing";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("signing", () => {
  const body = '{"v":1}';
  it("accepts a valid signature and rejects tampering, staleness and missing headers", () => {
    const ts = Date.now();
    expect(verify(SECRET, { timestamp: String(ts), signature: sign(SECRET, ts, body) }, body).ok).toBe(true);
    expect(verify(SECRET, { timestamp: String(ts), signature: sign(SECRET, ts, body) }, '{"v":2}')).toEqual({ ok: false, reason: "bad_signature" });
    expect(verify("another-secret-that-is-long", { timestamp: String(ts), signature: sign(SECRET, ts, body) }, body)).toEqual({ ok: false, reason: "bad_signature" });
    const old = ts - MAX_SKEW_MS - 1000;
    expect(verify(SECRET, { timestamp: String(old), signature: sign(SECRET, old, body) }, body)).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(verify(SECRET, { timestamp: null, signature: null }, body)).toEqual({ ok: false, reason: "missing_headers" });
  });
});

describe("contracts", () => {
  it("rejects malformed telemetry", () => {
    expect(TelemetryMessage.safeParse({ v: 1, messageId: "short", deviceId: "x", ts: "yesterday", readings: [] }).success).toBe(false);
    expect(TelemetryMessage.safeParse({ v: 1, messageId: "msg-00000001", deviceId: "bench-coldroom-01", ts: new Date().toISOString(), readings: [{ metric: "temperature_c", value: Number.NaN }] }).success).toBe(false);
  });
});

const values = (es: HubEvent[]) => es.map((e) => (e.type === "reading" ? e.value : null));

describe("hub", () => {
  beforeEach(() => __resetHub());
  const msg = (id: string, value: number) => TelemetryMessage.parse({ v: 1, messageId: id, deviceId: "bench-coldroom-01", ts: new Date().toISOString(), readings: [{ metric: "temperature_c", value }] });

  it("binds, de-duplicates and buffers readings for resume", () => {
    expect(ingest(msg("msg-00000001", 3.1))).toEqual({ status: "accepted", readings: 1 });
    expect(ingest(msg("msg-00000001", 3.1))).toEqual({ status: "duplicate" });
    ingest(msg("msg-00000002", 3.3));
    const all = backlog("branch-015", 0);
    expect(values(all)).toEqual([3.1, 3.3]);
    expect(all[0].type === "reading" && all[0].equipmentId).toBe("walk-in-cold-1");
    expect(backlog("branch-015", all[0].seq).length).toBe(1);
    expect(backlog("branch-001", 0).length).toBe(0);
  });

  it("replays only recent readings to a fresh subscriber, but everything buffered on resume", () => {
    const t0 = Date.now();
    ingest(msg("msg-00000003", 3.0), t0);
    ingest(msg("msg-00000004", 3.1), t0);
    ingest(msg("msg-00000005", 3.2), t0 + FRESH_REPLAY_MS + 60_000);
    const later = t0 + FRESH_REPLAY_MS + 61_000;
    const [first] = backlog("branch-015", 0, t0);
    expect(values(backlog("branch-015", 0, later))).toEqual([3.2]);
    expect(values(backlog("branch-015", first.seq, later))).toEqual([3.1, 3.2]);
  });

  it("refuses unbound metrics and requires a configured key", () => {
    const m = TelemetryMessage.parse({ v: 1, messageId: "msg-00000009", deviceId: "bench-coldroom-01", ts: new Date().toISOString(), readings: [{ metric: "humidity_pct", value: 40 }] });
    expect(ingest(m).status).toBe("unbound");
    const prev = process.env.DEVICE_KEYS;
    process.env.DEVICE_KEYS = JSON.stringify({ "bench-coldroom-01": "short" });
    expect(deviceSecret("bench-coldroom-01")).toBeNull();
    process.env.DEVICE_KEYS = prev;
  });
});

describe("engine live sensors", () => {
  const start = Date.UTC(2026, 10, 3, 12, 0);
  const make = () => new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: start, config: { seed: 1, arrivalRate: 10, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
  const reading = (sim: BranchSimulation, value: number) => sim.ingestReading({ equipmentId: "walk-in-cold-1", metric: "temperature_c", value, ts: sim.now(), deviceId: "bench-coldroom-01", expectedIntervalSec: 30 });

  it("switches the sensor to live, uses the real value and opens a LIVE alert after the delay", () => {
    const sim = make();
    const id = reading(sim, 3.0)!;
    const st = sim.sensors.get(id)!;
    expect(st.source).toBe("live");
    expect(st.history).toEqual([{ t: sim.now(), v: 3 }]);
    for (let i = 0; i < 14; i++) {
      sim.advance(30, 1e6);
      reading(sim, 8.5);
    }
    const alert = sim.alerts.find((a) => a.sensorId === id)!;
    expect(alert.source).toBe("live");
    expect(alert.issue).toMatch(/^Live reading 8.5/);
    // The simulator must not overwrite live values.
    sim.advance(60, 1e6);
    expect(st.value).toBe(8.5);
  });

  it("flags a silent device offline with a connectivity alert", () => {
    const sim = make();
    const id = reading(sim, 3.0)!;
    sim.advance(200, 1e6);
    const st = sim.sensors.get(id)!;
    expect(st.status).toBe("offline");
    expect(sim.alerts.find((a) => a.sensorId === id)?.title).toMatch(/connectivity lost/);
    reading(sim, 3.1);
    expect(st.status).toBe("normal");
  });

  it("ignores bindings that do not exist in the floor plan", () => {
    expect(make().ingestReading({ equipmentId: "no-such-fridge", metric: "temperature_c", value: 3, ts: start, deviceId: "x", expectedIntervalSec: 30 })).toBeNull();
  });
});

describe("live POS orders", () => {
  beforeEach(() => __resetHub());
  const start = Date.UTC(2026, 10, 3, 12, 0);
  const pos = (status: string, key: string) =>
    PosOrderEvent.parse({ v: 1, idempotencyKey: key, branchId: "branch-015", externalRef: "CB-778812", channel: "chris-b-app", fulfilment: "delivery", status, lines: [{ menuId: "pz-chicken-l", qty: 1, unitPriceGhs: 155 }, { menuId: "not-on-menu", qty: 1, unitPriceGhs: 10 }], ts: new Date(start).toISOString() });

  it("de-duplicates on the idempotency key per source", () => {
    expect(ingestOrder("chris-b", pos("RECEIVED", "key-00000001")).status).toBe("accepted");
    expect(ingestOrder("chris-b", pos("RECEIVED", "key-00000001")).status).toBe("duplicate");
    expect(ingestOrder("other-pos", pos("RECEIVED", "key-00000001")).status).toBe("accepted");
    expect(backlog("branch-015", 0).every((e) => e.type === "order")).toBe(true);
  });

  it("creates a LIVE order with source prices, then applies later status events", () => {
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: start, config: { seed: 1, arrivalRate: 0, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
    const o = sim.ingestOrderEvent(pos("RECEIVED", "key-k0001"))!;
    expect(o.source).toBe("live");
    expect(o.lines).toHaveLength(1);
    expect(o.total).toBe(155);
    expect(sim.ingestOrderEvent(pos("ACCEPTED", "key-k0002"))).toBe(o);
    expect(o.status).not.toBe("RECEIVED");
    sim.ingestOrderEvent(pos("CANCELLED", "key-k0003"));
    expect(o.status).toBe("CANCELLED");
    expect(sim.ingestOrderEvent({ ...pos("READY", "key-k0004"), externalRef: "unknown" })).toBeNull();
  });
});
