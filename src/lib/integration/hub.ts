import registry from "@/data/devices.json";
import { DeviceBinding, PhysicalCamera, type NormalisedReading, type TelemetryMessage } from "./contracts";

/**
 * In-process telemetry hub (server-side). Prototype stand-in for the production
 * pipeline (MQTT broker → Redis Streams/Kafka → TimescaleDB): it de-duplicates
 * messages, applies bindings + calibration, keeps a short replay buffer for
 * resumable SSE streams, and tracks device last-seen times.
 * Stored on globalThis so dev-server hot reloads don't drop state.
 */
interface HubState {
  seq: number;
  buffer: NormalisedReading[];
  seen: Map<string, number>;
  lastSeen: Map<string, { at: number; battery?: number; rssi?: number; firmware?: string }>;
  listeners: Set<(r: NormalisedReading) => void>;
}

const g = globalThis as unknown as { __pmcmHub?: HubState };
const hub: HubState = (g.__pmcmHub ??= { seq: 0, buffer: [], seen: new Map(), lastSeen: new Map(), listeners: new Set() });

const BUFFER = 2000;
const DEDUPE_TTL_MS = 24 * 3600 * 1000;

export const BINDINGS: DeviceBinding[] = registry.devices.map((d) => DeviceBinding.parse(d));
export const CAMERAS: PhysicalCamera[] = (registry.cameras as unknown[]).map((c) => PhysicalCamera.parse(c));

export function bindingsFor(deviceId: string) {
  return BINDINGS.filter((b) => b.deviceId === deviceId);
}

/** Per-device secrets from env: DEVICE_KEYS='{"bench-coldroom-01":"<secret>"}'. Production: secrets manager / mTLS. */
export function deviceSecret(deviceId: string): string | null {
  try {
    const keys = JSON.parse(process.env.DEVICE_KEYS ?? "{}") as Record<string, string>;
    return typeof keys[deviceId] === "string" && keys[deviceId].length >= 16 ? keys[deviceId] : null;
  } catch {
    return null;
  }
}

export type IngestResult = { status: "accepted"; readings: number } | { status: "duplicate" } | { status: "unbound"; metrics: string[] };

export function ingest(msg: TelemetryMessage, now = Date.now()): IngestResult {
  // Expire old de-duplication keys lazily.
  if (hub.seen.size > 50_000) for (const [k, t] of hub.seen) if (now - t > DEDUPE_TTL_MS) hub.seen.delete(k);
  const key = `${msg.deviceId}:${msg.messageId}`;
  if (hub.seen.has(key)) return { status: "duplicate" };
  hub.seen.set(key, now);
  hub.lastSeen.set(msg.deviceId, { at: now, battery: msg.battery_pct, rssi: msg.rssi_dbm, firmware: msg.firmware });

  const ts = Date.parse(msg.ts);
  const bindings = bindingsFor(msg.deviceId);
  let accepted = 0;
  const unbound: string[] = [];
  for (const r of msg.readings) {
    const b = bindings.find((x) => x.metric === r.metric && (x.channel ?? null) === (r.channel ?? null));
    if (!b) {
      unbound.push(r.metric);
      continue;
    }
    const reading: NormalisedReading = {
      seq: ++hub.seq,
      branchId: b.branchId,
      equipmentId: b.equipmentId,
      sensorCode: b.sensorCode,
      deviceId: msg.deviceId,
      metric: r.metric,
      value: Math.round((r.value + b.calibrationOffset) * 100) / 100,
      ts,
      receivedAt: now,
      expectedIntervalSec: b.expectedIntervalSec,
      source: "live",
    };
    hub.buffer.push(reading);
    accepted++;
    for (const l of hub.listeners) l(reading);
  }
  if (hub.buffer.length > BUFFER) hub.buffer.splice(0, hub.buffer.length - BUFFER);
  return accepted ? { status: "accepted", readings: accepted } : { status: "unbound", metrics: unbound };
}

/** Readings after `afterSeq` (for SSE resume via Last-Event-ID). */
export function backlog(branchId: string | null, afterSeq: number) {
  return hub.buffer.filter((r) => r.seq > afterSeq && (!branchId || r.branchId === branchId));
}

export function subscribe(fn: (r: NormalisedReading) => void) {
  hub.listeners.add(fn);
  return () => hub.listeners.delete(fn);
}

export function deviceStatus(now = Date.now()) {
  return BINDINGS.map((b) => {
    const seen = hub.lastSeen.get(b.deviceId);
    return {
      deviceId: b.deviceId,
      branchId: b.branchId,
      target: b.equipmentId ?? b.sensorCode,
      metric: b.metric,
      model: b.model ?? null,
      keyConfigured: deviceSecret(b.deviceId) !== null,
      lastSeenAt: seen?.at ?? null,
      online: !!seen && now - seen.at < b.expectedIntervalSec * 3 * 1000,
      battery: seen?.battery ?? null,
      rssi: seen?.rssi ?? null,
      firmware: seen?.firmware ?? null,
    };
  });
}

/** Test helper: reset hub state. */
export function __resetHub() {
  hub.seq = 0;
  hub.buffer = [];
  hub.seen.clear();
  hub.lastSeen.clear();
  hub.listeners.clear();
}
