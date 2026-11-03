# Launch flow — cinematic intro and access gate

Every cold launch of the app runs: **intro → access gate → app** (configurable to
**gate → intro → app**). Nothing in the app is reachable until the gate passes. Both screens
share one real-time world: the East Legon floor plan as line art, drawn live at the device's resolution.

Files: `src/config/launch.ts` (config), `src/lib/auth/gate.ts` (hashing, attempts, sessions),
`src/components/launch/` (scene, overlay, gate, controller, score), screenshots under `docs/launch/`.

## The intro (14 s, skippable after 3 s)

Line art, not a film: nothing is modelled, lit or peopled. The East Legon floor plan draws itself
out of black and the camera takes one slow move around it.

| t | Beat | What happens |
|---|---|---|
| 0–1 s | Black | Fade from black; a single point of light resolves at the centre of the plan. |
| 0.8–4.8 s | The plan draws | Walls draw themselves in thin steel lines, radiating out from the centre with a bright tip on every line; a faint 1 m grid comes up underneath; 3,200 particles settle out of the void onto the walls. |
| 4.8 s | Kitchen line | The kitchen's equipment outlines draw in one box after another; the kitchen status ring locks in and pulses. |
| 6.8 s | Front counter | Counter equipment draws; red flow dots start running the real customer, staff and rider paths. |
| 8.6 s | Dining | Table outlines draw; the dining ring locks. |
| 10.2 s | Rider bay | Dispatch rack and rider door draw; the bay ring locks. |
| 10.6–12 s | Live instruments | Queue and longest wait, fryer oil, cold-room temperature and an order tag rise out of the drawing as thin instrument chips (real numbers from the warmed simulation). |
| 12.6 s | Hero + title | Pull back to the hero angle; the platform name resolves with a light sweep and the tagline; riser and hit in the score. |
| 14–15 s | Dissolve | Fade to the gate, where the same drawing keeps idling. |

Chapter captions (upper-left, monospace) name each beat. The overlay is HTML, so it stays crisp on any screen.

### Technical

- **Real-time**: React Three Fiber + three.js. Walls, equipment and tables come straight from the
  floor plan (`plan.walls`, `plan.equipment`, `plan.furniture`), grouped by the zone whose cameras
  watch their room, so any branch layout draws correctly. Each line set is a `LineSegments` with a
  per-vertex draw order and a small shader that reveals the line up to the current progress with a
  glowing tip; flows follow `plan.navigationPaths`.
- **Camera**: Catmull-Rom path through keyframes placed outside each zone (looking across the plan
  at it), sampled by keyframe index so every beat lands on its second, with a hand-held breath.
- **Post-processing** (`@react-three/postprocessing`): bloom (the line tips and rings glow), film
  grain, vignette, SMAA; `cinema` adds a touch of chromatic aberration at full pixel ratio. Tiers:
  `cinema`, `standard`, `lite` (no post), `none` (no WebGL or reduced motion: the intro is skipped
  and the gate sits on a plain dark background). Chosen by `detectTier()`; override with
  `?intro=cinema|standard|lite|none`.
- **Palette**: one neutral steel for all line work, the brand red only for the flow dots and the
  skip ring, green / amber / red only on the zone status rings. Nothing else is coloured.
- **Audio**: synthesised in the browser (`audio.ts`): sub drone, detuned pad, filtered air, a pulse on
  each zone beat, riser into the title, title hit, unlock chord, deny thud. Starts only on the first
  pointer or key gesture (platform autoplay rule); the sound toggle persists per device.
- **Skip**: bottom-right after 3 s, with a progress ring; `Esc` / `Enter` / `Space` also skip.
  "Don't show again" is stored per device (`ops.intro.skip.v1`); Settings → Launch & access →
  *Play intro* and ⌘K → *Play the intro* force it (`/?intro=play`).
- **Dev hooks** (development builds only): `window.__opsLaunch.seek(t)` freezes the intro at a
  second, `.resume()`, `.phase("gate")`.

## The access gate

- One frosted card over the idling drawing (slow orbit, lines breathing, status rings pulsing).
- Mark · "Enter access key" · key field with show / hide · **Unlock** · *Keep me signed in* (on by default).
- Correct key: rings flip green one by one, the lines brighten, the camera dollies in, the card lifts
  away, dissolve to the app. Wrong key: shake, field clears, "Incorrect password", attempts-left
  hint. Five failures: 30-second cooldown with a live countdown (the field and button disable).
- Sessions: *Keep me signed in* stores the session in `localStorage` for 7 days; off stores it in
  `sessionStorage` (tab lifetime). Expired or signed-out sessions show the gate again.
  Sign out: Settings → Launch & access → *Sign out*, or ⌘K → *Sign out*.
- Keyboard-safe on phones (`100dvh`, 16 px input to avoid zoom, `enterKeyHint="go"`), field
  auto-focused, labels and live regions for assistive tech, 44 px targets.

## Changing the password

The key is never in the UI code: `LAUNCH.gate.accessKeyHash` holds the SHA-256 of the
normalised key (trimmed, lower-cased). To change it:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('new key'.trim().toLowerCase()).digest('hex'))"
```

Paste the result into `src/config/launch.ts`, or set `NEXT_PUBLIC_ACCESS_KEY_HASH` at build time.
`LAUNCH.gate` also holds `maxAttempts`, `cooldownSec`, `sessionDays`, `keepSignedInDefault`.

## Swapping in real authentication

The gate UI only talks to a `GateProvider` (`src/lib/auth/gate.ts`): `verify(input)`,
`startSession(keep)`, `sessionValid()`, `endSession()`. The browser-side implementation
(`makeGate`) exists for the prototype; a real deployment replaces it:

1. Implement `GateProvider` against your identity service (OIDC / SSO): `verify` posts the
   credential to the server (or redirects), `sessionValid` checks a server-issued session cookie,
   `endSession` revokes it. Keep the same UI; nothing else changes.
2. Move attempt limiting server-side (the local counter is a UX nicety, not a control).
3. The RBAC model for what each user may see is already in `src/lib/auth/rbac.ts`; map identity
   claims to `DemoUser` roles there.
4. Remove `accessKeyHash` from the config once the server owns credentials.

## Intro before or after login

`LAUNCH.intro.when`: `"before-login"` (default: intro on every cold launch, then the gate) or
`"after-login"` (gate first, intro once the key is accepted). `LAUNCH.intro.enabled` turns it off
globally; the per-device "Don't show again" turns it off locally.

## Proof

Captured from the real scene in headless Chromium (`cinema` tier at 1440×900, and iPhone 13 at 2×).
Intro beats, then the gate states, then the app, all under `docs/launch/`:

| Beat | Desktop | Phone |
|---|---|---|
| 0.6 s · black, one light | `desktop-intro-0_6s.png` | `phone-intro-0_6s.png` |
| 2.4 s · walls draw, particles settle | `desktop-intro-2_4s.png` | `phone-intro-2_4s.png` |
| 4.2 s · plan complete | `desktop-intro-4_2s.png` | `phone-intro-4_2s.png` |
| 6 s · kitchen line | `desktop-intro-6s.png` | `phone-intro-6s.png` |
| 7.8 s · counter, flows | `desktop-intro-7_8s.png` | `phone-intro-7_8s.png` |
| 9.6 s · dining | `desktop-intro-9_6s.png` | `phone-intro-9_6s.png` |
| 11.4 s · rider bay, instruments | `desktop-intro-11_4s.png` | `phone-intro-11_4s.png` |
| 13 s · hero + title | `desktop-intro-13s.png` | `phone-intro-13s.png` |
| Gate | `desktop-gate.png` | `phone-gate.png` |
| Wrong key | `desktop-gate-wrong.png` | `phone-gate-wrong.png` |
| Unlock | `desktop-unlock.png` | `phone-unlock.png` |
| App | `desktop-app.png` | `phone-app.png` |
