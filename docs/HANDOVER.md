# Handover — Pizzaman Chickenman Operations Command Center (2026-11-03)

Read `README.md`, `docs/ARCHITECTURE.md`, then this file. Research + sources: `docs/research/`.

## Standing requirement (from the client)
This prototype **will be connected to real IoT sensors, physical cameras, POS and every system a command center needs.** Build every layer swap-ready: UI must never depend on simulation internals for anything a device supplies; every value must show LIVE vs SIMULATED provenance. Floor plans are conceptual; operational data is simulated unless it came through the integration layer.

## State
- `npm run dev` (port 3000 is running from the previous session), `npm test` → **26/26 passing**, `npx tsc --noEmit -p .` → clean.
- Secrets live in `web/.env.local` (gitignored): `ANTHROPIC_API_KEY` (client should rotate it — it was pasted in chat) and generated bench `DEVICE_KEYS`. Never commit or print them.
- Git: repo is `web/` → **https://github.com/yawboafo/pmcm-command-center** (private). Work is on branch `feat/command-center-prototype` (pushed); `main` holds only the scaffold. No PR opened yet. Ask before pushing or merging.

## Built and verified
| Area | Where | Notes |
|---|---|---|
| Floor plan schema, A/B/C templates, derived walls/cameras/sensors/paths, A* nav grid | `src/lib/floorplan`, `scripts/generate-floorplans.ts` | Templates pass the editor validator with 0 errors/warnings (enforced by test). Regenerate JSON + SVGs: `npx tsx scripts/generate-floorplans.ts --svg docs/floorplans` |
| Simulation engine (orders, kitchen batch-fry/rice, staff/customers/riders, sensors, alerts, inventory ledger) | `src/lib/sim` | Deterministic; live-sensor ingestion via `ingestReading()`; same limit rules for live + simulated |
| Network model (70 verified branches), supply hubs | `src/lib/network` | Branch data from `scripts/import-branches.py` |
| Shell, store, sim registry (HMR-safe, real-time clock mode) | `src/components/shell`, `src/store` | |
| Ghana map, directory (revenue per branch), analytics, central kitchens | `src/components/map`, `src/components/analytics` | |
| 3D twin (8 camera modes, CCTV grid, intro, post-processing) | `src/components/twin` | `RestaurantModel` is shared with the editor |
| Panels/inspector (KDS, orders, safety, inventory, staff, customers, delivery) | `src/components/panels` | Uses `SourceBadge` for LIVE/SIMULATED |
| Floor plan editor | `src/components/editor` | Save → `plans().save` + `sims().restart` |
| AI assistant (Claude `claude-opus-5-5`, client-executed tools, offline fallback) | `src/app/api/assistant`, `src/lib/assistant`, `src/components/assistant` | Verified live call works |
| **Integration layer** | `src/lib/integration`, `src/app/api/{ingest,stream,integration,cameras}` | Signed HMAC device ingestion → hub (dedupe, calibration, bindings by stable equipmentId) → SSE stream (Last-Event-ID resume) → browser `liveClient` → engine. **Verified end-to-end** with `npx tsx scripts/device-sim.ts --device bench-coldroom-01 --value 3.2 --drift 0.5 --interval 2` (202s, SSE delivery, forged/unknown → 401). WHEP camera proxy route written, untested (needs a MediaMTX gateway). |
| Prisma target schema, docker-compose (PostGIS, Redis) | `prisma/schema.prisma` | Validated; backend not built |

## Not done yet — do next, in order
1. **Full browser QA of the demo** (scenes 1–10 in the client brief) with screenshots: map → East Legon fly-in → exterior → inside → demo order → fridge fault → camera grid → inventory low stock → Kumasi branch. Screenshot helper: `node /private/tmp/.../scratchpad/pw/shot.mjs <url> <out.png> <waitMs> 1600 950 [clickSelector|js:code|wait:ms…]` (Playwright is installed in that scratchpad; recreate if missing). The map fix just added (`deferUntilStyleReady` in `GhanaMap.tsx`) still needs a browser check.
2. **Inspector must handle `selection.kind === "room"`** (twin sends it) — check `src/components/panels/Inspector.tsx`.
3. **Settings → Integrations section**: device table from `useIntegrationStatus()` (`src/lib/integration/useStatus.ts`), cameras, how-to-connect; plus a `LiveCameraPlayer` (WHEP client: RTCPeerConnection recvonly → POST SDP to `/api/cameras/{id}/whep`) shown as a separate, clearly labelled LIVE player, and an optional "physical camera" tile in the twin CCTV grid (`src/components/twin/CctvGrid.tsx`) for cameras with `virtualCameraId`.
4. **`docs/INTEGRATION.md`**: contracts (`contracts.ts`), MQTT topic `pmcm/v1/{branchCode}/{deviceId}/telemetry`, signing headers, binding file `src/data/devices.json`, recommended hardware (wireless temperature probes/LoRaWAN or Wi-Fi with gateway, food probes, fryer oil sensors, ONVIF/RTSP IP cameras + MediaMTX), NTP time sync, calibration offsets, offline buffering on devices, production path (MQTT broker with mTLS → Redis Streams/Kafka → TimescaleDB → NestJS WebSocket gateway), privacy/legal (Ghana Data Protection Act 2012, Act 843 — confirm registration duties with counsel; CCTV signage/retention), and POS webhook contract (`PosOrderEvent`, route not yet written: `/api/ingest/pos`).
5. Map-agent shell requests: (a) mobile — below `md`, overlay/collapse sidebar + 340 px inspector; (b) `lib/network/supply.ts` spread runs across the day (currently 04–07h, 13–16h, so the 12:15 demo shows no trucks); (c) delay `TwinView` mount until the map flight is nearly done (`MainView.tsx`).
6. Engine/panel small gaps: injected pickup orders have no customer to collect them (composer is delivery-only); agents don't avoid each other.
7. Update `README.md` / `docs/ARCHITECTURE.md` phase table with the integration layer; offer to open a PR into `main`.

## Gotchas
- Next.js 16.4 with `cacheComponents`: route segment `export const dynamic` is **removed**; read `node_modules/next/dist/docs/` before using Next APIs. Route params are a Promise.
- HMR keeps the sim registry on `globalThis`; after editing engine **methods**, reload the browser page (old instances keep old methods).
- Claude API: Opus 5.5 rejects nullable enums written as `type:[string,null]` in strict tool schemas (use `anyOf`); history must stay append-only (UI context rides inside user turns).
- Real-time clock: the first live reading flips `sims().realtime` (wall clock, 1×, speed controls locked) and restarts running sims.
