/**
 * Bench-test device: posts signed TelemetryMessages to the ingestion endpoint
 * exactly as a real sensor/gateway would (HTTPS + HMAC). Use it to verify the
 * live pipeline before installing hardware.
 *
 *   npx tsx scripts/device-sim.ts --device bench-coldroom-01 --metric temperature_c \
 *       --value 3.2 --drift 0.4 --interval 5 --count 0 [--url http://localhost:3000]
 *
 * --drift raises the value by that much per reading (simulate a failing compressor);
 * --count 0 runs until stopped. The device key is read from DEVICE_KEYS (env or .env.local).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sign } from "../src/lib/integration/signing";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function deviceKeys(): Record<string, string> {
  let raw = process.env.DEVICE_KEYS;
  if (!raw && existsSync(".env.local")) raw = readFileSync(".env.local", "utf8").match(/^DEVICE_KEYS=(.*)$/m)?.[1]?.replace(/^'|'$/g, "");
  return raw ? JSON.parse(raw) : {};
}

const deviceId = arg("device", "bench-coldroom-01")!;
const metric = arg("metric", "temperature_c")!;
const url = `${arg("url", "http://localhost:3000")}/api/ingest/telemetry`;
const interval = Number(arg("interval", "5"));
const count = Number(arg("count", "0"));
const drift = Number(arg("drift", "0"));
let value = Number(arg("value", "3.2"));
const secret = deviceKeys()[deviceId];
if (!secret) {
  console.error(`No key for ${deviceId} in DEVICE_KEYS`);
  process.exit(1);
}

let sent = 0;
async function send() {
  const body = JSON.stringify({ v: 1, messageId: randomUUID(), deviceId, ts: new Date().toISOString(), readings: [{ metric, value: Math.round((value + (Math.random() - 0.5) * 0.2) * 100) / 100 }], battery_pct: 87, rssi_dbm: -71, firmware: "bench-1.0" });
  const ts = Date.now();
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-pmcm-device": deviceId, "x-pmcm-timestamp": String(ts), "x-pmcm-signature": sign(secret, ts, body) }, body });
  console.log(`${new Date().toISOString()} ${deviceId} ${metric}=${value.toFixed(2)} → ${res.status} ${await res.text()}`);
  value += drift;
  if (count && ++sent >= count) process.exit(0);
}

send();
setInterval(send, interval * 1000);
