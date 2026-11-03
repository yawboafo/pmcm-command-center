import { beforeEach, describe, expect, it } from "vitest";
import { modelC } from "../../floorplan/templates";
import { BranchSimulation } from "../../sim/engine";
import { TelemetryMessage } from "../contracts";
import { __resetHub, backlog, deviceSecret, ingest } from "../hub";
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

describe("hub", () => {
  beforeEach(() => __resetHub());
  const msg = (id: string, value: number) => TelemetryMessage.parse({ v: 1, messageId: id, deviceId: "bench-coldroom-01", ts: new Date().toISOString(), readings: [{ metric: "temperature_c", value }] });

  it("binds, de-duplicates and buffers readings for resume", () => {
    expect(ingest(msg("msg-00000001", 3.1))).toEqual({ status: "accepted", readings: 1 });
    expect(ingest(msg("msg-00000001", 3.1))).toEqual({ status: "duplicate" });
    ingest(msg("msg-00000002", 3.3));
    const all = backlog("branch-015", 0);
    expect(all.map((r) => r.value)).toEqual([3.1, 3.3]);
    expect(all[0].equipmentId).toBe("walk-in-cold-1");
    expect(backlog("branch-015", all[0].seq).length).toBe(1);
    expect(backlog("branch-001", 0).length).toBe(0);
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
