# Handover — Pizzaman Chickenman Operations Command Center (updated 2026-11-03, session 3)

Read `README.md`, `docs/AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/ASSETS.md`, then this file.

## Session 4 — platform, hardware simulation, staff badges, UX (branch `feat/ux-sim-hardware-artist`)
Builds on PR #2. The product is now **Operations Ops** (one line in `src/config/platform.ts`), with Pizzaman Chickenman as the tenant workspace. In this branch:
- **UX**: ⌘K command palette, keyboard shortcuts (`?`), network telemetry ribbon, readout primitives, critical-alert toasts, compact top bar; Light / Dark / Auto theme (token remap in `globals.css`, Settings → Appearance).
- **Branch entry** boots like a camera feed; **live 2D operations plan** (`V`).
- **Simulated hardware fleet** (`npm run hardware:sim`, `npm run camera:sim`): 55 virtual devices, 7 POS terminals, 6 MJPEG cameras through the real signed pipeline.
- **Staff badges (RTLS)**: `POST /api/ingest/location`, calibration, `npm run wearables:sim`, staff locator (`L`), follow camera, privacy gating (`view:staff-location`).
- **Prototype notice** on start-up with the integration checklist (`src/config/integrations.ts`); simulated data is not labelled in the UI (`UI_POLICY`), LIVE always is.
- **3D**: Blender-built people (instanced, ~25 draw calls for the crowd), food props, storefront branding, menu-board artwork.
- 68 tests; tsc and eslint clean. East Legon dollhouse: 58 FPS, 1,432 draw calls.

Known issue: at East Legon the cashiers' stand points are on the customer side of the POS counters (floor-plan template); fixing it means regenerating templates, which renumbers sensor codes used by device bindings.

## Session 3 — digital twin upgrade (branch `feat/digital-twin-upgrade`, uncommitted unless a later commit says otherwise)
Session 2 is in PR https://github.com/yawboafo/pmcm-command-center/pull/1 (`feat/command-center-prototype` → `main`). Session 3 follows the client's "elevate, don't rebuild" brief; the audit and what was delivered are in `docs/AUDIT.md`. In short:
- **Menu** priced only from `src/data/menu-catalogue.json` (199 published Chris B items, per-item source + date; refresh with `npx tsx scripts/import-menu.ts`; the Chris B server-action id is re-read from the site on each run). Settings → Menu & prices. A test fails if a simulated item drops out of the catalogue.
- **Orders**: status = least-advanced item; payment step (simulated, method mix is an assumption); recipe stock deducted at sale and returned on cancel-before-production; `estimateReadyAt()` (ESTIMATED badge); event trail + stock movements in the order inspector.
- **Provenance**: LIVE / SIMULATED / ESTIMATED / UNAVAILABLE badges (`primitives.tsx`).
- **Command center**: ranked priority queue (`lib/ops/priority.ts`), network status strip in the top bar, crisper panels.
- **3D**: 24 equipment + 5 furniture GLBs from the scripted Blender pipeline (`blender/`, contact sheet `blender/renders/contact-sheet.png`), loaded with procedural fallback; Settings switch; `?assets=procedural` URL flag. Measured: fewer draw calls than procedural, 57–60 FPS (table in AUDIT.md). The menu board stays procedural (it shows the real menu).
- **Cameras**: Stations & zones presets derived from each floor plan.
- **Perf probe**: `window.__opsPerf` in development. Headless GPU measurement script pattern: Playwright with `--use-angle=metal` (the built-in browser pane pauses rendering when hidden).
- 41 tests pass; tsc and eslint clean.

Next for the upgrade: rigged characters and branded storefront (artist work, list in `docs/ASSETS.md`); menu texture on the scripted menu board; a measured East Legon floor plan; KDS events for live orders. Research + sources: `docs/research/`.

## Standing requirement (from the client)
This prototype **will be connected to real IoT sensors, physical cameras, POS and every system a command center needs.** Build every layer swap-ready: UI must never depend on simulation internals for anything a device supplies; every value must show LIVE vs SIMULATED provenance. Floor plans are conceptual; operational data is simulated unless it came through the integration layer.

## State
- `npm run dev` (port 3000), `npm test` → **37/37 passing**, `npx tsc --noEmit -p .` clean, `npx eslint src scripts` clean (0 errors).
- Secrets live in `web/.env.local` (gitignored): `ANTHROPIC_API_KEY` (client should rotate it — it was pasted in chat), generated bench `DEVICE_KEYS`, and a generated `POS_WEBHOOK_SECRET`. Never commit or print them.
- Git: repo is `web/` → **https://github.com/yawboafo/pmcm-command-center** (private). Work is on `feat/command-center-prototype`; `main` holds only the scaffold. Session 2 changes are **uncommitted** unless a later commit says otherwise. Ask before pushing or merging; no PR opened yet.

## Done in session 2
| Item | Notes |
|---|---|
| Browser QA of the demo (map → East Legon fly-in → inside → demo order → fridge fault → camera grid → inventory → Kumasi/KNUST) | All scenes work. Bugs found and fixed below. |
| Fix: sidebar Ghana Network / Branches / Central Kitchens did nothing while inside a twin | `setSection` now leaves the twin for map sections (`src/store/app.ts`). |
| Fix: stale device readings replayed on page load flipped the console to the live clock | Fresh SSE subscribers only get the last 5 min (`FRESH_REPLAY_MS` in `hub.ts`); resume via Last-Event-ID still gets everything buffered. |
| Fix: restaurants opened empty | Registry warms each new sim for 20 simulated minutes (≈50 ms) — `WARMUP_SEC` in `src/store/sims.ts`. |
| Fix: demo fridge fault could target equipment a live device reports for | `Hud.tsx` skips live-bound equipment. |
| Inspector `room` selection | Already handled by `InspectRoom` — no change needed. |
| Settings → Integrations | `src/components/integration/IntegrationsPanel.tsx`: device table, stream/gateway/POS/AI flags, physical cameras, how-to-connect. Provenance text updated. |
| Live camera player (WHEP) | `LiveCameraPlayer.tsx`; "LIVE FEED" button on CCTV grid tiles whose virtual camera has a registered physical camera. Proxy route unit-tested (`whep.test.ts`); **not yet run against a real MediaMTX gateway.** |
| POS / ordering webhook | `POST /api/ingest/pos` (signed, idempotent, branch + menu id validation), `order` SSE events, `BranchSimulation.ingestOrderEvent`, LIVE badge on orders; bench tool `scripts/pos-sim.ts`. Verified end-to-end in the browser. |
| `docs/INTEGRATION.md` | Contracts, signing, MQTT topic, bindings, cameras, hardware, production path, Act 843 / CCTV obligations. |
| Shell: mobile | Below `md`: panels start folded, sidebar and inspector overlay, inspector opens on selection, compact top bar and map overlays. |
| Shell: supply runs | Three runs per branch spread over 24 h (same daily volume), so trucks are on the road at 12:15. |
| Shell: twin mount | TwinView chunk prefetched at flight start, scene mounted 2 s into the 2.8 s flight (`MainView.tsx`). |
| Engine: pickup orders without a customer | A collector arrives when the order is READY (`spawnCollector`). |
| Engine: agent avoidance | `separate()` — walkers sidestep each other; overlaps roughly halved, throughput unchanged across seeds. |
| Lint | Fixed the two pre-existing errors (Sidebar render reassignment, Assistant setState-in-effect). |

## Next, in order
1. Commit session 2 and open a PR `feat/command-center-prototype` → `main` (ask the client first).
2. Run the camera path against a real gateway: MediaMTX (Docker image `bluenviron/mediamtx`) + an `ffmpeg` test pattern pushed over RTSP, register a camera in `devices.json → cameras`, set `CAMERA_GATEWAY_URL`. Forward the WHEP `Location` header and add a DELETE route to close sessions explicitly.
3. Live orders: kitchen progress is still simulated. When a KDS / station system is available, add a contract for station events. Consider making READY/COMPLETED from the POS drive the order state directly.
4. Panel-level provenance: module headers (e.g. Live Orders) still say SIMULATED even when some rows are LIVE — switch to "SIMULATED + LIVE" when any live data is present.
5. Phone polish: the "Ask Ops AI" button overlaps the twin's "Skip intro" and sits above the open sidebar; the "Select a branch" card overlaps the national card on the map.
6. Backend phase per `docs/ARCHITECTURE.md` / `docs/INTEGRATION.md` (production pipeline, server-side alerting, auth + RBAC).

## Gotchas
- Next.js 16.4 with `cacheComponents`: route segment `export const dynamic` is **removed**; read `node_modules/next/dist/docs/` before using Next APIs. Route params are a Promise.
- HMR keeps the sim registry on `globalThis`; after editing engine **methods**, reload the browser page (old instances keep old methods — you will see "x is not a function" in the console until you do).
- Claude API: Opus 5.5 rejects nullable enums written as `type:[string,null]` in strict tool schemas (use `anyOf`); history must stay append-only (UI context rides inside user turns).
- Real-time clock: the first live event (reading or order) flips `sims().realtime` (wall clock, 1×, speed controls locked) and restarts running sims. Bench events older than 5 min are not replayed to a freshly loaded page.
- Order status follows the most advanced item, so an order with jollof (portioned from the warmer) shows QUALITY_CHECK almost immediately. That is existing engine behaviour, not a bug in live orders.
- Built-in browser testing: the Next.js dev-tools badge sits over the bottom-left "Expand sidebar" button on phone widths; click it via script.
