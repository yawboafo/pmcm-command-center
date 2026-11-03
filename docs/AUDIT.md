# Audit and upgrade plan — digital twin platform (2026-11-03)

Phase 1 of the upgrade brief: what the existing application is, what to keep, and the
highest-impact improvements. The rule throughout is **elevate, don't rebuild** — every
change below extends the existing code.

## 1. What exists

| Area | Implementation | Verdict |
|---|---|---|
| Frontend | Next.js 16 (App Router, client-only app shell), React 19, TypeScript, Tailwind 4, Zustand | Keep |
| 3D engine | three.js 0.187 via React Three Fiber 9 + drei + postprocessing (bloom, ACES, SMAA) | Keep — no engine migration needed; glTF assets drop straight in |
| Map | MapLibre GL 6 with OpenFreeMap tiles; clustered branch markers; cinematic fly-in to a 3D building extrusion | Keep |
| Branch data | 70 branches from the official outlet directory (verified 2026-11-03, `docs/research`) | Keep |
| Menu data | ~26 items hand-typed in `src/lib/sim/menu.ts`, prices from the public Chris B catalogue | **Upgrade**: prices and names belong in a refreshable, source-tracked data file |
| Floor plans | Schema + three conceptual templates (A/B/C), derived walls/cameras/sensors, A* nav grid, editor | Keep; layouts stay labelled conceptual |
| Simulation | Deterministic engine per opened branch: orders, staged kitchen production, staff/customers/riders, equipment temperatures, alerts, inventory ledger; lightweight model for the other branches | Keep — it is already the single source for the twin, panels and dashboards |
| Integration | Signed device + POS ingestion, SSE stream, device/camera registry, WHEP camera proxy, LIVE/SIMULATED provenance | Keep |
| Cameras | Orbit, free, first-person walk (collision), top, dollhouse, tour, follow-order, virtual CCTV grid, click-to-focus | Keep; add station/zone presets |
| 3D assets | All equipment, furniture, building and people are procedural three.js primitives (boxes, cylinders) | **Upgrade**: scripted Blender → glTF pipeline for equipment and furniture |

## 2. Findings

**Data accuracy**
- Menu prices are correct as of the 2026-11-03 research, but they are code constants with no
  per-item source URL or verification date, and a price change needs a code change.
- No way to mark a value as estimated or unavailable — only LIVE vs SIMULATED.

**Operational model**
- Order status jumped to the most advanced item (an order with jollof showed QUALITY_CHECK
  seconds after acceptance while its pizza was still on the make-line).
- No payment step; inventory was deducted only on completion, so stock lagged sales by the
  whole preparation time; no estimated ready time.
- The twin, panels and national dashboard already read the same engine state — the
  "one underlying model" requirement is structurally met; the gaps were in what the model
  expressed, not in duplicated state.

**Command center UX**
- Alerts were a flat list ("Needs attention") with no ranking or reason.
- No at-a-glance network status in the header.
- No direct way to jump to a kitchen station or zone in the 3D view.

**3D realism**
- Equipment and furniture read as blocky placeholders at close range; no LODs; geometry is
  built per instance at runtime.

**Performance** (measured / reviewed)
- Full simulations run only for opened branches; a 20-minute warm-up costs ≈50 ms.
- Panels re-render at ≈4 Hz; the 3D layer reads engine state in `useFrame` without React work.
- Many small procedural meshes per equipment item → high draw-call count in large layouts;
  glTF assets with merged meshes reduce this.

## 3. Upgrades delivered in this pass

| Brief phase | Change | Where |
|---|---|---|
| 2 Command center | Ranked **priority queue** (food safety and live-device issues first, age and scale raise priority, acknowledged items drop) on the national summary and per branch | `src/lib/ops/priority.ts`, `src/components/ops/PriorityQueue.tsx` |
| 2 | **Network status strip** in the top bar (critical / warning / nominal / closed, live sources) | `TopBar.tsx` |
| 2 | Crisper panel surfaces, tabular numerals | `globals.css` |
| 3 Real data | **Source-backed menu catalogue** with source URL, verification date, regular/promo/delivery/branch prices, unverified flag, refresh script | `src/data/menu-catalogue.json`, `scripts/import-menu.ts`, `docs/research/MENU-SOURCES.md` |
| 3 | Provenance taxonomy: **LIVE / SIMULATED / ESTIMATED / UNAVAILABLE** badges | `primitives.tsx` |
| 4 3D | Scripted **Blender → glTF** pipeline: 24 equipment + 5 furniture models (meshopt-compressed, 764 KB in all, 6 with distance LODs), contact sheet for visual QA; loader with procedural fallback, furniture kept instanced; Settings switch between models and procedural | `blender/`, `public/models/`, `docs/ASSETS.md`, `modelAssets.tsx`, `furniture.tsx` |
| 5 Twins | Order status follows the **least-advanced item**; **payment** step; recipe stock deducted **at the moment of sale** (returned if cancelled before production); **estimated ready time** that reacts to station queues; per-order **event trail** and stock movements | `engine.ts`, `InspectOrder.tsx` |
| 7 Performance | Dev performance probe (`window.__pmcmPerf`: FPS, draw calls, triangles) and `?assets=procedural` for side-by-side checks | `PerfProbe.tsx` |
| 6 Interaction | **Station & zone camera presets** derived from each floor plan (pizza line, fry station, rice, QC & packing, dispatch, front counter, kitchen, cold storage, dining); selecting a station opens its tasks and workload | `StationViews.tsx` |

### Measured: Blender models vs procedural (East Legon, Model C, 1600×950, Apple GPU via headless Chromium)

| View | Procedural: calls / triangles / FPS | Blender models: calls / triangles / FPS |
|---|---|---|
| Dollhouse (whole building) | 2,270 / 111k / 60 | **1,644** / 284k / 57 |
| Kitchen overview | 1,477 / 72k / 60 | **1,056** / 249k / 59 |
| Fry station | 1,036 / 46k / 60 | **791** / 161k / 59 |
| Front counter | 1,055 / 54k / 60 | **822** / 181k / 60 |
| Dining room | 1,003 / 44k / 60 | **799** / 175k / 60 |

The models cut draw calls by 23–28% (merged meshes per material) while carrying 2.5–4× the
triangles, and the frame rate stays at the 60 FPS display cap on this hardware. Draw calls
include the shadow pass. Lower-end GPUs should use Settings → Graphics → Low (no shadows),
which roughly halves the calls.

## 4. What scripted work cannot do (needs a human in Blender)

See `docs/ASSETS.md` for the per-asset list. In short: hard-surface equipment and furniture
can be generated by script with correct proportions, bevels and PBR materials. Branded
storefronts and interiors matching real branches, food, and rigged staff/customer characters
need an artist, reference photos and (for branches) site surveys. Those stay as the current
procedural stand-ins and are labelled conceptual.

## 5. Next steps

0. The Blender menu board is not used: the procedural one renders the real menu text. Give the
   scripted `SCREEN` node the menu texture, then drop the exception in `modelAssets.tsx`.
1. Replace the procedural people with rigged, animated low-poly characters (artist work).
2. Site-survey one real branch (East Legon) and replace its conceptual layout with a measured plan.
3. KDS / station-level live events so live orders' kitchen progress is real, not simulated.
4. Instanced rendering for repeated furniture; KTX2 textures once textured assets arrive.
5. Server-side event store (the production pipeline in `docs/INTEGRATION.md`).
