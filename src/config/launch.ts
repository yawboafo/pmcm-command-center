/**
 * Launch flow: the cinematic intro and the access gate shown before anything else.
 *
 * The access key is stored only as a SHA-256 hash of its normalised form (trimmed,
 * lower-cased). To change it: `node -e "console.log(require('crypto').createHash('sha256').update('new key'.trim().toLowerCase()).digest('hex'))"`
 * and paste the result into `accessKeyHash`, or set NEXT_PUBLIC_ACCESS_KEY_HASH at build time.
 * This gate is a product lock for the prototype, not authentication: see docs/LAUNCH.md for
 * swapping in real sign-in (the `GateProvider` interface in src/lib/auth/gate.ts).
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
    accessKeyHash: process.env.NEXT_PUBLIC_ACCESS_KEY_HASH ?? "bf810ba8aee44513b72236680ead4d845b23a8bf9ad0b4621e69707c9db5e2ef",
    maxAttempts: 5,
    cooldownSec: 30,
    /** "Keep me signed in" session length. */
    sessionDays: 7,
    keepSignedInDefault: true,
  },
} as const;
