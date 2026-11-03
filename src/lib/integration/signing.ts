import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Request signing for device and webhook ingestion (server-side only).
 *
 *   x-pmcm-device:    device id (or webhook source id)
 *   x-pmcm-timestamp: unix epoch milliseconds when the request was signed
 *   x-pmcm-signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 * The timestamp window blocks replays of captured requests; message ids are
 * de-duplicated separately. Production devices should additionally use mTLS
 * (per-device X.509 certificates) on the MQTT broker or HTTPS edge.
 */
export const MAX_SKEW_MS = 5 * 60 * 1000;

export function sign(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" };

export function verify(secret: string, headers: { timestamp: string | null; signature: string | null }, rawBody: string, now = Date.now()): VerifyResult {
  if (!headers.timestamp || !headers.signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return { ok: false, reason: "stale_timestamp" };
  const expected = Buffer.from(sign(secret, ts, rawBody), "hex");
  const given = Buffer.from(headers.signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
