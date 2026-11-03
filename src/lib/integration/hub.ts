import registry from "@/data/devices.json";
import { DeviceBinding, PhysicalCamera, type HubEvent, type NormalisedReading, type PosOrderEvent, type TelemetryMessage } from "./contracts";

/**
 * In-process telemetry hub (server-side). Prototype stand-in for the production
 * pipeline (MQTT broker → Redis Streams/Kafka → TimescaleDB): it de-duplicates
 * messages, applies bindings + calibration, keeps a short replay buffer for
 * resumable SSE streams (device readings and POS order events share one
 * sequence), and tracks device last-seen times.
 * Stored on globalThis so dev-server hot reloads don't drop state.
 */
interface HubState {
  seq: number;
  buffer: HubEvent[];
  seen: Map<string, number>;
  lastSeen: Map<string, { at: number; battery?: number; rssi?: number; firmware?: string }>;
  listeners: Set<(e: HubEvent) => void>;
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
      type: "reading",
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

export type OrderIngestResult = { status: "accepted"; seq: number } | { status: "duplicate" };

/** Buffer and broadcast a validated POS / ordering-system event (idempotent on its key). */
export function ingestOrder(sourceId: string, event: PosOrderEvent, now = Date.now()): OrderIngestResult {
  const key = `order:${sourceId}:${event.idempotencyKey}`;
  if (hub.seen.has(key)) return { status: "duplicate" };
  hub.seen.set(key, now);
  const e: HubEvent = { type: "order", seq: ++hub.seq, branchId: event.branchId, receivedAt: now, sourceId, event, source: "live" };
  hub.buffer.push(e);
  if (hub.buffer.length > BUFFER) hub.buffer.splice(0, hub.buffer.length - BUFFER);
  for (const l of hub.listeners) l(e);
  return { status: "accepted", seq: e.seq };
}

/** A brand-new subscriber only gets readings this recent, so stale data never looks live. */
export const FRESH_REPLAY_MS = 5 * 60 * 1000;

/**
 * Readings to replay to a subscriber. Resuming (`afterSeq` > 0, from Last-Event-ID) replays
 * everything still buffered after that id; a fresh connection gets only recent readings.
 */
export function backlog(branchId: string | null, afterSeq: number, now = Date.now()) {
  const minReceived = afterSeq > 0 ? 0 : now - FRESH_REPLAY_MS;
  return hub.buffer.filter((r) => r.seq > afterSeq && r.receivedAt >= minReceived && (!branchId || r.branchId === branchId));
}

export function subscribe(fn: (e: HubEvent) => void) {
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
