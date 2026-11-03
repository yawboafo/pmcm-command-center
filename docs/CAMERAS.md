# Camera centre — audit, gap list, data model and what Chris sees

The camera experience of the restaurant digital twin, upgraded to "ship it" quality for a
non-technical owner. Everything is still simulated (no real cameras or sensors are installed);
the result behaves like a real deployment and swaps to real sources through the adapter layer
without UI changes.

Screens: `docs/cameras/before/` (what existed) and `docs/cameras/after/` (this build). Visual
rules: `docs/STYLE-GUIDE.md`. Three-tap GIF: `docs/cameras/after/three-taps.gif`.

## 1. Audit of the previous camera implementation

| What | Finding |
|---|---|
| Cameras | 13–21 "virtual cameras" per branch, auto-placed one per workstation plus room corners, named like equipment ("CAM-012 Frying Station 2"). Too many, developer-oriented, no fixed owner meaning. |
| What each showed | A 3D viewpoint only. Tiles carried the code, name, room, clock and a hover "Go to camera". No metrics or overlays on any feed. |
| Data source | All numbers came from the one `BranchSimulation` (good: one state). But the camera UI exposed none of them; the Inspector listed nearby equipment and orders when a camera was selected. |
| Owner confusion | 1/4/9 grid with paging through 21 similar tiles; no status, no ordering, no way to tell which camera needed attention; "Go to camera" dropped the user into a 3D view with pan/tilt controls. |
| Static or fake | Fixed midday lighting (sun never moved; the exterior intro used a dusk texture); a pulsing red "REC" dot with no health behind it; only temperature/oil threshold alerts, no operational ones; alerts never cleared by themselves; no timeline, no replay, no comparison baseline; no weather, weekday, payday effects; staff never left their posts, doors never opened, the till never opened. |
| Developer-demo look | Bare tiles with amber "SIMULATED VIEW" chips, default-looking paging toolbar, mixed badge colours (amber, fuchsia, emerald) used decoratively, no empty / error / offline states. |

## 2. Gap list, ranked by impact on Chris's decisions

| # | Gap | Impact | Status |
|---|---|---|---|
| 1 | No zone answers: a camera could not say "queue 7, longest wait 5:40, 1 of 2 tills staffed" | Every one of Chris's ten questions | **Done** — 8 zones × 4–5 metrics (`zones.ts`) |
| 2 | No operational alerts (queue, ticket age, staff off post, riders, drawer, back door, spill, cold door) | Q1–Q8 | **Done** — 13 rules with cause + action, hold, auto-clear, escalation (`rules.ts`) |
| 3 | No "what happened" — no timeline, no replay | Q9 | **Done** — per-second history, scrubbable timeline, 1×/4×/16×, incident replay |
| 4 | No comparison to yesterday / last week | Q10 | **Done** — modelled baselines (`baseline.ts`), labelled as modelled |
| 5 | 21 generic cameras instead of 8 meaningful zones | Everything | **Done** — fixed owner zones derived per floor plan; old virtual cameras remain in the 3D view |
| 6 | Grid gave no status, no ordering, no alert count | First 60 seconds | **Done** — worst-first grid, status ring, headline, hero number, alert badge, last event |
| 7 | No way to save or share a moment | Follow-up | **Done** — snapshot, 30 s clip, share, flag, note; persisted; shown on the timeline |
| 8 | Fake-looking scene: fixed light, no weather, doors never move, staff never leave | Trust | **Done** — time-of-day sun/sky/interior lights, seeded rain, animated doors, breaks, stock runs |
| 9 | No phone or wall layout for cameras | Where Chris actually looks | **Done** — feed-first phone layout with tabs; wall layout at ≥1900 px |
| 10 | No scripted demo | Selling it | **Done** — two-minute lunch-rush story (`DemoDirector.tsx`) |
| 11 | Adapter for real cameras / sensors | Later | **Partly** — registry + LIVE player exist; zone feed swap documented below, not yet wired |
| 12 | Kitchen progress for live orders still simulated (KDS) | Later | Unchanged (see `docs/HANDOVER.md`) |

### Kept, changed, removed

- **Kept**: the one simulation state as the only source; the 3D twin, its virtual-camera list and pan/tilt view; the WebRTC/MJPEG player and camera registry; the LIVE / SIM DEVICE provenance system; the dark glass shell, Inter / Montserrat / Geist Mono, lucide icons.
- **Changed**: the Cameras section is now the camera centre (grid + zone screen) instead of the 1/4/9 overlay; `MultiViewRenderer` renders into registered DOM tiles instead of a fixed scissor grid; scene lighting follows the simulated clock; doors animate from door state; alerts carry zone, cause, action, escalation and auto-resolve; `resolveAlert` accepts operational alerts once their condition has passed or an action is recorded.
- **Removed**: the paging 1/4/9 overlay (`CctvOverlay`), "Go to camera" from tiles, the SIMULATED VIEW chip style (replaced by one small provenance chip), decorative badge colours in the camera UI.

## 3. The eight zones and what Chris sees

Each zone has a fixed camera derived from the floor plan (so edited layouts and all three
models get the same eight), 4–5 metrics, and its own alert rules. One primary metric is the
largest element after the feed.

| Zone | Camera mount | Primary | Also shown | Alerts |
|---|---|---|---|---|
| Front counter | Behind the tills, high, looking over the cashiers at the queue | **In queue** | Longest wait · Tills staffed · Avg service · Till drawer | Queue building · No one at the till · Drawer open with no sale |
| Kitchen & fryers | Fryer-room corner with clearance, looking down the line | **Orders in kitchen** | Oldest order (#) · Fryers busy · Fryer oil (lowest) · Cooks at post | Order over 12 min · Cook away from the line · Oil change due (sensor) |
| Heat lamp & pass | In front of the hot-holding / pass where the packers stand | **Orders waiting** at the pass | Longest under lamp · Hot holding °C · Cook checks passed · Chicken held | Food waiting too long under the lamp · Hot-holding below limit (sensor) |
| Dining area | Corner furthest from the entrance, wide lens | **Seats taken** | Waiting for food · Spills · Next clean | Spill not cleaned · Dining clean overdue |
| Pickup & rider bay | Dispatch-room corner, watching the rack and the riders' spot | **Riders waiting** | Longest rider wait · Orders waiting for riders · Avg hand-over | Rider waiting too long · Orders packed but no rider |
| Cold room & storage | Inside, corner opposite the door | **Cold room °C** | Door (open for) · Openings today · Stock lines low | Cold room door left open · Temperature above limit (sensor) · Sensor connectivity |
| Entrance & car park | On the facade above the door, looking at the forecourt | **Walk-ins last hour** | Last 10 min · Walked away · Weather · Door openings | — (feeds the counter rules) |
| Back door & staff exit | Inside, facing the staff / delivery / emergency exit | **Back door** state | After-hours openings · Last opened · Staff outside · Openings today | Back door opened after hours · Back door left open |

Overlays on every feed (toggleable layers, persisted): people boxes with role and
time-at-post / waited / waiting; the queue line with count and longest wait; order tags that
age green → amber → red (6 / 12 min); door and temperature badges anchored to the object; a
ten-minute occupancy heat map. All positions are projected through the zone camera each frame.

Chris's ten questions map as: 1 front counter · 2 kitchen · 3 every zone's "at post" plus the
kitchen/counter rules · 4 pass + kitchen oil · 5 pickup bay · 6 front counter drawer · 7 dining
spills/clean + hygiene checklists · 8 cold room · 9 timeline, markers and replay · 10 the
yesterday / last-weekday chips on every metric.

## 4. Data model

TypeScript (the source of truth for the prototype):

| Type | Where | Purpose |
|---|---|---|
| `ZoneId`, `ZoneDef`, `ZoneCamera` | `src/lib/sim/zones.ts` | Zone identity, question, rooms; derived camera pose, `doorId` |
| `Metric`, `ZoneStatus`, `Level` | `zones.ts` | Plain-language metrics (value, display, tone, hint, primary), headline, level |
| `Alert` (+ `kind`, `zoneId`, `cause`, `action`, `escalation`, `assignedTo`, `autoResolved`) | `src/lib/sim/types.ts` | One alert type for sensor and operational alerts |
| `DoorState`, `TillState`, `Spill` | `types.ts` | What the zone cameras watch |
| `HistoryFrame`, `HistoryPerson` | `types.ts` | One compact frame per simulated second (people, zone metrics, doors, drawer, queue) |
| `SimEvent.refs.marker` (`MarkerKind`) | `types.ts` | Timeline markers: alert, rush, shift, delivery, anomaly, incident |
| `Rule`, `RuleHit` | `src/lib/sim/rules.ts` | Condition → cause/action, hold and clear seconds |
| `Scenario` | `src/lib/sim/scenarios.ts` | Seeded, replayable anomalies |
| `Baseline` | `src/lib/sim/baseline.ts` | Modelled yesterday / last-week values |
| `Incident` | `src/lib/ops/incidents.ts` | Snapshot, clip, share, flag, note; pinned to simulated time; persisted |
| `TileReg`, `TileFrame`, `Replay`, `Layer` | `src/components/cameras/feedStore.ts` | Viewport registry, projection, replay and overlay state |

Production target (added to `prisma/schema.prisma`): `CameraZone`, `OperationalAlert`,
`ZoneMetricSample`, `Incident`. Simulation history stays in `SimulationEvent`.

### One source of truth

Every overlay, metric, alert, card and timeline value is a view over `BranchSimulation`:
`zoneStatus(sim, zone)` for live numbers, `sim.frameAt(t)` for replayed ones,
`sim.alerts` for cards, `sim.markers()` for the timeline. There is no second store. The
tests in `src/lib/sim/__tests__/zones.test.ts` assert the rules against the same state.

## 5. Simulation engine upgrade

- **Patterns**: hour curve × weekday (`WEEKDAY_FACTOR`) × payday (last three / first two days of
  the month) × seeded rain episodes (two rainy seasons) that move walk-ins to delivery
  (`calendar.ts`). The sun, sky and interior lights follow the simulated clock.
- **Behaviour**: natural staff breaks (inside or out through the back door), cold-room stock
  runs, door contacts on every door (proximity or held), till drawer on walk-in sales, rare
  spills with a noticing delay, rush start/end and shift-change markers.
- **Scenarios** (`scenarios.ts`): lunch rush, cashier away, kitchen backed up, cold room door
  propped, riders waiting, drawer open with no sale, back door after hours, fryer oil overdue,
  spill in dining. Three or four run on a seeded daily schedule; any can be rehearsed from the
  camera centre.
- **Alerts** (`rules.ts`): evaluated every 5 simulated seconds; must hold for `holdSec`; close
  themselves `clearSec` after the condition passes (`autoResolved`); escalate at 3 and 8 minutes
  while unacknowledged; `assign`, `acknowledge`, `resolve` as before.
- **History**: 3,600 frames (one hour) per branch; `frameAt(t)`; replay drives the 3D people
  and doors, the overlay, the metrics panel and the timeline snapshot together.

## 6. Adapter layer — replacing simulated sources

| Source | Today | Real deployment | Change needed |
|---|---|---|---|
| Camera picture | Zone camera rendered from the twin | Registered `PhysicalCamera` whose `virtualCameraId` is `zone-<zoneId>` plays in the tile via `LiveCameraPlayer` (WHEP/MJPEG), picture-in-picture over the twin feed | `FeedTile` already takes children; add the player branch (not yet wired) |
| Temperatures, oil | Sensor model | `ingestReading` (already LIVE-aware) | None — metrics read `sim.sensors` |
| Door contacts | Proximity model | `door_open` metric bound to a door: add `DeviceBinding.doorId` and set `sim.doors` from the reading | Small binding extension |
| Till drawer | Walk-in sale model | POS drawer events on the order webhook (`drawerOpened`, `saleRung`) → `sim.till` | Contract field |
| Staff at post | Simulated movement | RTLS badges (`ingestStaffLocation`, already built) | None |
| People boxes | Projected simulation positions | Camera analytics (person detections) in tile coordinates | Overlay takes detections instead of projections |
| Baselines | Modelled from demand | History store (TimescaleDB) | `baselineFor` swap |

## 7. Demo mode — the two-minute lunch-rush story

Trigger: Cameras → **Rehearse** → *Run the 2-minute lunch-rush story*. Steps narrate while the
simulation does the work; timings are elastic (each step ends on its condition or a cap).

| t | Step | What Chris sees | What happens underneath |
|---|---|---|---|
| 0:00 | The rush builds | Grid; the front-counter card climbs from green to amber | `queueSurge(7)` + `orderBurst(5)`, demand set high |
| ~1:00 | The alert fires | Card turns red, badge "1" | `queue-long` held 60 s → alert with cause "Queue 8 deep, longest wait 3:40, 2 of 2 tills staffed" and action "Open a second till with Kofi" |
| +0:05 | Chris opens the camera | Zone screen: queue line, each customer's wait, hero "In queue" | `openZone("front-counter")` |
| +0:07 | Replay the cause | Timeline jumps 15 s before the alert, scene and numbers rewind | `setReplay({ clip })` |
| +0:22 | Take the action | Back to live; a packer walks to the till; alert acknowledged (amber) | `coverStation("order-counter")`, `acknowledgeAlert` |
| +0:30 → ~2:00 | The queue clears | Longest wait falls; alert closes itself; card turns green | rule condition gone for 90 s → `autoResolveAlert` |

Spoken script (for a pitch): "It's twelve-fifteen at East Legon. Twelve orders land in two
minutes. Watch the counter card — amber, then red: *Queue building at the counter. Queue 8
deep, two tills, longest wait three forty. Open a second till with Kofi.* One tap and I'm on
the camera: every customer, how long they've waited. One more tap — fifteen seconds before the
alert; here's the queue forming while one till was busy. Back to live, I move Kofi to till two.
Two minutes later the queue is gone and the alert closed itself. Grid, camera, alert, action.
Three taps."

## 8. The three-tap path

1. Grid → tap the worst card (it is always top-left; or the header button *Open <zone>*).
2. Zone → tap *Jump to moment* on the alert card (replay) or *Acknowledge*.
3. *Resolve* (or let it clear) — the card calms red → amber → green.

Keyboard: `G` opens the centre, `Esc` back, `←` `→` between cameras, `Space` play/pause.

## 9. Known limitations

- Replay rewinds people and doors; equipment props (baskets, pizzas) stay live.
- Baselines are modelled, not stored; every chip says so.
- A real camera stream is not yet shown inside a zone tile (registry and players exist; see §6).
- Round-robin refresh means eight feeds share the GPU budget (each tile refreshes at frame rate ÷ 3);
  the plate shows the measured rate. Headless software rendering (used for the screenshots) runs
  at about one frame per second, which is why some tiles in `after/grid.png` show "No signal".
