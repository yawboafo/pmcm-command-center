import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { LAUNCH } from "@/config/launch";
import { verifyKey } from "./gate";

/**
 * Server side of the access gate: the only place the access key is checked. A correct key earns
 * a signed, HttpOnly session cookie that server routes require (see /api/assistant).
 * This module must stay out of client code: importing it would ship the key hash to the browser.
 */
export const SESSION_COOKIE = "ops_session";

/** SHA-256 of the normalised access key. See docs/LAUNCH.md to change it. */
const DEFAULT_ACCESS_KEY_HASH = "bf810ba8aee44513b72236680ead4d845b23a8bf9ad0b4621e69707c9db5e2ef";
const SECRET_MIN_LENGTH = 32;
/** Failed keys per minute across all callers: holds even if a caller rotates or spoofs its address. */
const GLOBAL_FAILURES_PER_MIN = 60;
const DAY = 86_400_000;

// On globalThis because each route is bundled separately and must see the same secret and counters.
interface SessionState {
  secret: string;
  failures: Map<string, { count: number; lockUntil: number }>;
  recentFailures: number[];
}
const store = globalThis as typeof globalThis & { __opsSession?: SessionState };
const state: SessionState = (store.__opsSession ??= { secret: randomBytes(32).toString("hex"), failures: new Map(), recentFailures: [] });

/** Without SESSION_SECRET, sessions last until the server restarts and people unlock again. */
function secret() {
  const configured = process.env.SESSION_SECRET;
  return configured && configured.length >= SECRET_MIN_LENGTH ? configured : state.secret;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export const checkAccessKey = (input: string) => verifyKey(input, process.env.ACCESS_KEY_HASH || DEFAULT_ACCESS_KEY_HASH);

export function issueSession(now = Date.now()) {
  const payload = `${randomUUID()}.${now + LAUNCH.gate.sessionDays * DAY}`;
  return `${payload}.${sign(payload)}`;
}

/** The verified session on this request, or null if it is missing, tampered with or expired. */
export function sessionFromRequest(req: Request, now = Date.now()): { sid: string; exp: number } | null {
  const token = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === SESSION_COOKIE)?.[1];
  const [sid, expRaw, signature] = token?.split(".") ?? [];
  if (!sid || !expRaw || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(`${sid}.${expRaw}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(expRaw);
  return exp > now ? { sid, exp } : null;
}

export function sessionCookie(req: Request, token: string, maxAgeSec: number | null) {
  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return [`${SESSION_COOKIE}=${token}`, "Path=/api", "HttpOnly", "SameSite=Strict", ...(maxAgeSec === null ? [] : [`Max-Age=${maxAgeSec}`]), ...(https ? ["Secure"] : [])].join("; ");
}

export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "local";

/** Seconds this caller must wait before another key attempt; 0 when it may try now. */
export function attemptWait(ip: string, now = Date.now()) {
  state.recentFailures = state.recentFailures.filter((t) => now - t < 60_000);
  if (state.recentFailures.length >= GLOBAL_FAILURES_PER_MIN) return Math.max(1, Math.ceil((state.recentFailures[0] + 60_000 - now) / 1000));
  const lockUntil = state.failures.get(ip)?.lockUntil ?? 0;
  return lockUntil > now ? Math.ceil((lockUntil - now) / 1000) : 0;
}

export function recordKeyFailure(ip: string, now = Date.now()) {
  state.recentFailures.push(now);
  // Spoofed addresses must not be able to grow this without limit.
  if (state.failures.size > 10_000) state.failures.clear();
  const count = (state.failures.get(ip)?.count ?? 0) + 1;
  const locked = count >= LAUNCH.gate.maxAttempts;
  state.failures.set(ip, { count: locked ? 0 : count, lockUntil: locked ? now + LAUNCH.gate.cooldownSec * 1000 : 0 });
}

export const clearKeyFailures = (ip: string) => void state.failures.delete(ip);

/** Test helper: forget every counter. */
export function resetSessionLimits() {
  state.failures.clear();
  state.recentFailures = [];
}
