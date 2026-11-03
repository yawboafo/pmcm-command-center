# Pizzaman Chickenman — Operations Command Center (prototype)

A browser-based 3D restaurant digital twin and operations simulation for Pizzaman Chickenman's
branch network in Ghana. Pick any of the 70 outlets on the Ghana map, fly into a procedurally
generated 3D restaurant, and watch a deterministic simulation of customers, staff, kitchen
stations, orders, food-safety sensors, inventory and deliveries.

> **Read this first — what is real and what is not**
> - Branch names, locations, regions, hours and menu prices come from the company's public
>   directory and Chris B catalogue (verified 2026-11-03, sources in `docs/research`).
> - **All floor plans are conceptual.** No public plans exist; layouts A/B/C are design assumptions.
> - **Operational data is simulated** (orders, sales, staff, temperatures, alerts, stock) unless it
>   is marked **LIVE**: bound IoT sensors and connected POS / ordering systems can feed the twin
>   through the integration layer (`docs/INTEGRATION.md`). None are installed yet; the bundled
>   `bench-*` devices are examples for testing.
> - Virtual cameras are 3D viewpoints, **not CCTV**. Physical cameras play only in a separate,
>   labelled LIVE player once registered and authorised. Rider GPS is not connected.

## Run it

```bash
cd web
npm install
cp .env.example .env.local   # optional: ANTHROPIC_API_KEY for the full AI assistant
npm run dev                  # http://localhost:3000
npm test                     # simulation, floor plan and integration tests
```

Bench-test the live paths (keys go in `.env.local`, see `.env.example`):

```bash
npx tsx scripts/device-sim.ts --device bench-coldroom-01 --value 3.2 --drift 0.5 --interval 2
npx tsx scripts/pos-sim.ts --branch branch-015
```

Without `ANTHROPIC_API_KEY` the assistant runs in a labelled offline mode (rule-based intents over
the same tools). The map uses OpenFreeMap tiles by default; set `NEXT_PUBLIC_MAPTILER_KEY` to use MapTiler.

## Demo walkthrough

1. **Ghana network** — markers coloured by simulated status; national KPIs; click a marker for
   today's simulated revenue, orders, staff, kitchen load and alerts.
2. **Restaurant Branches** — sortable table of all branches with simulated revenue per branch.
3. **Open digital twin** (East Legon → Model C flagship, Spintex → Model B, KNUST → Model A) —
   the map flies in, the exterior appears, the camera enters through the front door.
4. **Demo scenarios** (in the twin) — inject order #… (Large Chicken Pizza + PlayMan Jollof) and
   follow it through the kitchen; simulate a refrigerator compressor fault and handle the alert.
5. **Virtual Cameras** — 1/4/9 simultaneous views generated from the floor plan.
6. **Food Safety / Inventory / Staff / Delivery / Kitchen Operations** — live module panels.
7. **Floor Plan Editor** — move equipment, validate circulation, save, and see the twin update.
8. **Ops AI** — "Which branch is performing best?", "Take me to the pizza oven".
9. **Settings → Integrations** — device health, physical cameras and how to connect real equipment.

## Layout

```
src/lib/floorplan   schema, catalogue, wall/camera/sensor derivation, nav grid (A*), SVG export
src/lib/sim         deterministic engine, menu & recipes, inventory catalogue, safety profile
src/lib/network     verified branches, lightweight network model, conceptual supply hubs
src/lib/assistant   AI tool schemas + client-side tool executor
src/lib/integration contracts, signing, in-process hub, live client (devices, POS, cameras)
src/store           Zustand app store, simulation registry, versioned floor plan repository
src/components      shell · map · twin · panels · editor · analytics · assistant · integration
src/data            branches.json (from research), floorplans/model-{a,b,c}.json, devices.json
scripts             generate-floorplans.ts, import-branches.py, device-sim.ts, pos-sim.ts
prisma              target production schema (backend not yet built)
docs                ARCHITECTURE.md, INTEGRATION.md, HANDOVER.md, research/, floorplans/*.svg
```

See `docs/ARCHITECTURE.md` for the design, the production target and phase status.
