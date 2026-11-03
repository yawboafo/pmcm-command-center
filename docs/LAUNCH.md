# Launch flow — cinematic intro and access gate

Every cold launch of the app runs: **intro → access gate → app** (configurable to
**gate → intro → app**). Nothing in the app is reachable until the gate passes. Both screens
share one real-time 3D world: the East Legon twin, rendered live at the device's resolution.

Files: `src/config/launch.ts` (config), `src/lib/auth/gate.ts` (hashing, attempts, sessions),
`src/components/launch/` (scene, overlay, gate, controller, score), `public/intro/` (fallback
video), demo videos under `docs/launch/`.

## The intro (17 s, skippable after 3 s)

| t | Beat | What happens in the scene |
|---|---|---|
| 0–3 s | Black. A single light resolves | Fade from black; a key spotlight ramps up over the dark twin while a cage of 5,200 particles (sampled from every wall and equipment top) settles out of the void onto the building; wall edges draw in as steel wire. |
| 4.5 s | Fryer line ignites | Camera arrives low at the fry station; fryer glows pulse orange, the kitchen zone light comes on, the zone status ring pulses. |
| 7.5 s | Counter lights come on | Dolly to the front counter; the counter zone light rises, cashiers and the queue (the simulation was warmed with real orders) are in frame. |
| 10.5 s | Dining fills | Wide dining shot; diners and waiting customers; the dining ring pulses. |
| 13.2 s | Rider bay | Dispatch rack and the riders' door, which the simulation opens as the camera passes. |
| 12–16 s | Instrumentation rises | Queue count and longest wait, fryer oil, hot-holding temperature, cold-room temperature and an order tag rise out of the scene as thin instrument chips. |
| 15.8–17 s | Hero wide + title | Pull back to the hero wide; interior and ambient light complete; the platform name resolves with a light sweep and the tagline; riser and title hit in the score. |
| 17–18 s | Hold, dissolve | Fade to the gate, where the same world keeps idling. |

Chapter captions (lower-left, monospace) name each beat. The overlay is HTML, so it stays crisp on any screen.

### Technical

- **Real-time**: React Three Fiber + three.js, the same `RestaurantModel` as the twin, lit only by
  the intro's own lights (`environment={false}`, `lightsScale` brings interior lights up from 0).
  Camera path: Catmull-Rom through keyframes derived from the zone cameras (so any layout works),
  piecewise-linear in time so every beat lands on its second, with a hand-held breath.
- **Post-processing** (`@react-three/postprocessing`): bloom, depth of field (target on the hero
  point), film grain (soft-light noise), vignette, chromatic aberration (radial), ACES tone
  mapping, SMAA. Tiers: `cinema` (all), `standard` (no DoF / CA), `lite` (none), `video` (fallback).
  Chosen by `detectTier()` from cores, memory, coarse pointer, WebGL2 and reduced-motion;
  override with `?intro=cinema|standard|lite|video`.
- **Audio**: synthesised in the browser (`audio.ts`): sub drone, detuned pad, filtered air, zone
  pulses on each pass, riser into the title, title hit, unlock chord, deny thud. Starts only on
  the first pointer or key gesture (platform autoplay rule); the sound toggle persists per device.
- **Skip**: bottom-right after 3 s, with a progress ring; `Esc` / `Enter` / `Space` also skip.
  "Don't show again" is stored per device (`ops.intro.skip.v1`); Settings → Launch & access →
  *Play intro* and ⌘K → *Play the intro* force it (`/?intro=play`).
- **Fallback video**: `public/intro/intro-fallback.mp4` (H.264) rendered from the same scene at
  1280×720 by `scripts/render-intro.cjs`; `IntroVideo` drives the overlay timeline from the
  video clock. Missing file → the intro is skipped, not broken.
- **Dev hooks** (development builds only): `window.__opsLaunch.seek(t)` freezes the intro at a
  second, `.resume()`, `.phase("gate")`.

## The access gate

- One frosted card over the idling twin (slow orbit, breathing key light, status rings pulsing).
- Mark · "Enter access key" · key field with show / hide · **Unlock** · *Keep me signed in* (on by default).
- Correct key: rings flip green one by one, the camera dollies in, bloom lifts, the card lifts
  away, dissolve to the app. Wrong key: shake, field clears, "Incorrect password", attempts-left
  hint. Five failures: 30-second cooldown with a live countdown (the field and button disable).
- Sessions: *Keep me signed in* stores the session in `localStorage` for 7 days; off stores it in
  `sessionStorage` (tab lifetime). Expired or signed-out sessions show the gate again.
- A correct key also earns a signed, HttpOnly session cookie from `/api/session`. Server routes
  check that cookie; the browser-side session above only decides which screen to show. Today
  `/api/assistant` requires it, because it spends the Anthropic credential. If the session has
  ended, the assistant switches to offline mode and says so.
  Sign out: Settings → Launch & access → *Sign out*, or ⌘K → *Sign out*.
- Keyboard-safe on phones (`100dvh`, 16 px input to avoid zoom, `enterKeyHint="go"`), field
  auto-focused, labels and live regions for assistive tech, 44 px targets.

## Changing the password

The key is checked only on the server, and its hash never reaches the browser. The hash is the
SHA-256 of the normalised key (trimmed, lower-cased). To change it:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('new key'.trim().toLowerCase()).digest('hex'))"
```

Set the result as `ACCESS_KEY_HASH` on the server (no rebuild needed), or replace
`DEFAULT_ACCESS_KEY_HASH` in `src/lib/auth/session.ts`.

Set `SESSION_SECRET` (32+ characters) so sessions survive a restart or redeploy. Without it the
server makes a random secret at startup and everyone enters the key again after a restart.

Key attempts are limited on the server: `maxAttempts` failures from one address start a
`cooldownSec` lockout, and 60 failures a minute across all callers pause sign-in for everyone.

`LAUNCH.gate` also holds `maxAttempts`, `cooldownSec`, `sessionDays`, `keepSignedInDefault`.

## Swapping in real authentication

The gate UI only talks to a `GateProvider` (`src/lib/auth/gate.ts`): `verify(input)`,
`startSession(keep)`, `sessionValid()`, `endSession()`. `makeGate` checks one shared key through
`/api/session`, which exists for the prototype; a real deployment replaces it:

1. Implement `GateProvider` against your identity service (OIDC / SSO): `verify` posts the
   credential to the server (or redirects), `sessionValid` checks a server-issued session cookie,
   `endSession` revokes it. Keep the same UI; nothing else changes.
2. Replace the shared key and per-instance counters in `src/lib/auth/session.ts` (the local
   counter in the browser is a UX nicety, not a control).
3. The RBAC model for what each user may see is already in `src/lib/auth/rbac.ts`; map identity
   claims to `DemoUser` roles there.
4. Remove `DEFAULT_ACCESS_KEY_HASH` once the identity service owns credentials.

## Intro before or after login

`LAUNCH.intro.when`: `"before-login"` (default: intro on every cold launch, then the gate) or
`"after-login"` (gate first, intro once the key is accepted). `LAUNCH.intro.enabled` turns it off
globally; the per-device "Don't show again" turns it off locally.

## Proof

Captured from the real scene in headless Chromium (software GL, so the post stack is the
`cinema` tier at 1440×900 and iPhone 13 at 2×). Intro beats, then the gate states, then the app:

| Beat | Desktop | Phone |
|---|---|---|
| 0.8 s · black, one light | `desktop-intro-0_8s.png` | `phone-intro-0_8s.png` |
| 2.6 s · particles settle | `desktop-intro-2_6s.png` | `phone-intro-2_6s.png` |
| 5 s · fryer line | `desktop-intro-5s.png` | `phone-intro-5s.png` |
| 8 s · counter | `desktop-intro-8s.png` | `phone-intro-8s.png` |
| 11 s · dining | `desktop-intro-11s.png` | `phone-intro-11s.png` |
| 13.6 s · rider bay + instruments | `desktop-intro-13_6s.png` | `phone-intro-13_6s.png` |
| 16.6 s · hero + title | `desktop-intro-16_6s.png` | `phone-intro-16_6s.png` |
| Gate | `desktop-gate.png` | `phone-gate.png` |
| Wrong key | `desktop-gate-wrong.png` | `phone-gate-wrong.png` |
| Unlock | `desktop-unlock.png` | `phone-unlock.png` |
| App | `desktop-app.png` | `phone-app.png` |

Demo videos of the whole flow (intro → gate → wrong key → unlock → app):
`docs/launch/launch-desktop.mp4` and `docs/launch/launch-phone.mp4`. All files live in `docs/launch/`.
