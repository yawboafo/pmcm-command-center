/**
 * Launch flow: the cinematic intro and the access gate shown before anything else.
 *
 * The access key is checked on the server (src/lib/auth/session.ts), which is also where its hash
 * lives, so this file stays safe to bundle for the browser. See docs/LAUNCH.md to change the key or
 * swap in real sign-in (the `GateProvider` interface in src/lib/auth/gate.ts).
 */
export const LAUNCH = {
  intro: {
    enabled: true,
    /** "before-login" plays the intro on every cold launch, then the gate; "after-login" shows the gate first. */
    when: "before-login" as "before-login" | "after-login",
    /** Seconds; the drawing, the camera path and the score are timed against this. */
    durationSec: 14,
    /** Seconds before the Skip control appears. */
    skipAfterSec: 3,
  },
  gate: {
    maxAttempts: 5,
    cooldownSec: 30,
    /** "Keep me signed in" session length. */
    sessionDays: 7,
    keepSignedInDefault: true,
  },
} as const;
