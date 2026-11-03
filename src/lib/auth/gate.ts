/**
 * Access gate: hashed key check, attempt limiting with cooldown, and a per-device session.
 * Everything here is browser-side and is a product lock for the prototype, not authentication.
 *
 * To move to real auth, implement `GateProvider` against your identity service (the UI only
 * calls `verify`, `startSession`, `sessionValid` and `endSession`) and pass it to <Launch>.
 */
import { LAUNCH } from "../../config/launch";

export interface GateProvider {
  /** Resolves true when the entered key is accepted. */
  verify: (input: string) => Promise<boolean>;
  startSession: (keep: boolean, now?: number) => void;
  sessionValid: (now?: number) => boolean;
  endSession: () => void;
}

export const normaliseKey = (s: string) => s.trim().toLowerCase();

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash an access key the way the config stores it (normalised, SHA-256 hex). */
export const hashKey = (input: string) => sha256Hex(normaliseKey(input));

/** Constant-time comparison of two hex digests. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyKey(input: string, hash = LAUNCH.gate.accessKeyHash): Promise<boolean> {
  if (!input.trim()) return false;
  return same(await hashKey(input), hash);
}

/* ───────────── storage (localStorage with an in-memory fallback, injectable for tests) ───────────── */

export interface KV {
  get: (k: string) => string | null;
  set: (k: string, v: string) => void;
  remove: (k: string) => void;
}

const memory = new Map<string, string>();
const mem: KV = { get: (k) => memory.get(k) ?? null, set: (k, v) => void memory.set(k, v), remove: (k) => void memory.delete(k) };

function webStorage(which: "local" | "session"): KV {
  try {
    const s = which === "local" ? window.localStorage : window.sessionStorage;
    s.getItem("__probe");
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return mem;
  }
}

const SESSION_KEY = "ops.session.v1";
const ATTEMPTS_KEY = "ops.gate.attempts.v1";
const DAY = 86_400_000;

interface Session {
  exp: number;
  keep: boolean;
}
interface Attempts {
  count: number;
  lockUntil: number;
}

function read<T>(kv: KV, key: string): T | null {
  try {
    const raw = kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Session rules: "Keep me signed in" stores the session in localStorage for `sessionDays`;
 * otherwise it lives in sessionStorage (gone when the tab closes) with the same expiry cap.
 */
export function makeGate(opts: { local?: KV; session?: KV; hash?: string; maxAttempts?: number; cooldownSec?: number; sessionDays?: number } = {}): GateProvider & {
  lockState: (now?: number) => { locked: boolean; remainingSec: number; attemptsLeft: number };
  recordFailure: (now?: number) => { locked: boolean; remainingSec: number; attemptsLeft: number };
  resetAttempts: () => void;
} {
  const local = opts.local ?? (typeof window === "undefined" ? mem : webStorage("local"));
  const session = opts.session ?? (typeof window === "undefined" ? mem : webStorage("session"));
  const hash = opts.hash ?? LAUNCH.gate.accessKeyHash;
  const maxAttempts = opts.maxAttempts ?? LAUNCH.gate.maxAttempts;
  const cooldownSec = opts.cooldownSec ?? LAUNCH.gate.cooldownSec;
  const sessionDays = opts.sessionDays ?? LAUNCH.gate.sessionDays;

  const lockState = (now = Date.now()) => {
    const a = read<Attempts>(local, ATTEMPTS_KEY) ?? { count: 0, lockUntil: 0 };
    const locked = a.lockUntil > now;
    return { locked, remainingSec: locked ? Math.ceil((a.lockUntil - now) / 1000) : 0, attemptsLeft: locked ? 0 : Math.max(0, maxAttempts - a.count) };
  };
  const recordFailure = (now = Date.now()) => {
    const a = read<Attempts>(local, ATTEMPTS_KEY) ?? { count: 0, lockUntil: 0 };
    if (a.lockUntil > now) return lockState(now);
    // A lock that has expired resets the count.
    const count = a.lockUntil && a.lockUntil <= now ? 1 : a.count + 1;
    const lockUntil = count >= maxAttempts ? now + cooldownSec * 1000 : 0;
    local.set(ATTEMPTS_KEY, JSON.stringify({ count: lockUntil ? 0 : count, lockUntil }));
    return lockState(now);
  };
  const resetAttempts = () => local.remove(ATTEMPTS_KEY);

  return {
    verify: async (input) => {
      const ok = await verifyKey(input, hash);
      return ok;
    },
    startSession: (keep, now = Date.now()) => {
      const s: Session = { exp: now + sessionDays * DAY, keep };
      (keep ? local : session).set(SESSION_KEY, JSON.stringify(s));
      (keep ? session : local).remove(SESSION_KEY);
    },
    sessionValid: (now = Date.now()) => {
      const s = read<Session>(local, SESSION_KEY) ?? read<Session>(session, SESSION_KEY);
      return !!s && s.exp > now;
    },
    endSession: () => {
      local.remove(SESSION_KEY);
      session.remove(SESSION_KEY);
    },
    lockState,
    recordFailure,
    resetAttempts,
  };
}

let shared: ReturnType<typeof makeGate> | null = null;
/** The browser gate instance (one per page). */
export function gate() {
  return (shared ??= makeGate());
}

/**
 * Cold-launch the app again (full reload, so the launch flow runs from the top).
 * `forceIntro` plays the intro once even if "Don't show again" is set.
 */
export function relaunch(opts: { forceIntro?: boolean } = {}) {
  try {
    if (opts.forceIntro) window.sessionStorage.setItem(INTRO_FORCE_KEY, "1");
  } catch {
    /* not persisted */
  }
  window.location.reload();
}
const INTRO_FORCE_KEY = "ops.intro.force.v1";
/** True once per forced relaunch (the flag is consumed). */
export function introForced() {
  try {
    const v = window.sessionStorage.getItem(INTRO_FORCE_KEY) === "1";
    if (v) window.sessionStorage.removeItem(INTRO_FORCE_KEY);
    return v || new URLSearchParams(window.location.search).get("intro") === "play";
  } catch {
    return false;
  }
}

/* ───────────── intro preferences (per device) ───────────── */
const INTRO_SKIP_KEY = "ops.intro.skip.v1";
const INTRO_MUTE_KEY = "ops.intro.muted.v1";
export const introPrefs = {
  skipOnLaunch: () => {
    try {
      return window.localStorage.getItem(INTRO_SKIP_KEY) === "1";
    } catch {
      return false;
    }
  },
  setSkipOnLaunch: (b: boolean) => {
    try {
      window.localStorage.setItem(INTRO_SKIP_KEY, b ? "1" : "0");
    } catch {
      /* not persisted */
    }
  },
  muted: () => {
    try {
      return window.localStorage.getItem(INTRO_MUTE_KEY) === "1";
    } catch {
      return false;
    }
  },
  setMuted: (b: boolean) => {
    try {
      window.localStorage.setItem(INTRO_MUTE_KEY, b ? "1" : "0");
    } catch {
      /* not persisted */
    }
  },
};
