# Operations Ops — restaurant operations platform (prototype)

**Operations Ops** is a restaurant operations platform: command center, 3D digital twin and
integration layer, offered as a service. **Pizzaman Chickenman** (Ghana) is the first tenant
workspace. The product name lives in `src/config/platform.ts` (one line to change); everything
about the tenant (name, branches, menu, signage) is tenant data.

This prototype is a browser-based 3D restaurant digital twin and operations simulation for
Pizzaman Chickenman's branch network in Ghana. Pick any of the 70 outlets on the Ghana map, fly into a procedurally
generated 3D restaurant, and watch a deterministic simulation of customers, staff, kitchen
stations, orders, food-safety sensors, inventory and deliveries.

> **Read this first — what is real and what is not**
> - Branch names, locations, regions and hours come from the company's public directory; menu
>   items and prices from the published Chris B catalogue, with a source URL and verification
>   date per item (`src/data/menu-catalogue.json`, `docs/research/MENU-SOURCES.md`).
> - **All floor plans are conceptual.** No public plans exist; layouts A/B/C are design assumptions.
> - **Operational data is simulated** (orders, sales, staff, temperatures, alerts, stock) unless it
>   is marked **LIVE**: bound IoT sensors and connected POS / ordering systems can feed the twin
>   through the integration layer (`docs/INTEGRATION.md`). None are installed yet; the bundled
>   `bench-*` devices are examples for testing.
> - Virtual cameras are 3D viewpoints, **not CCTV**. Physical cameras play only in a separate,
>   labelled LIVE player once registered and authorised. Rider GPS is not connected.
> - **Labelling policy:** the app opens with a prototype notice that says all of this once and lists
>   the systems and hardware still to connect (`src/config/integrations.ts`). After that, simulated
>   data is not badged in the UI (`UI_POLICY.showSimulatedLabels` in `src/config/platform.ts`);
>   provenance is still recorded on every value, and real data is always marked **LIVE**.

## Run it

```bash
cd web
npm install
cp .env.example .env.local   # optional: ANTHROPIC_API_KEY for the full AI assistant
npm run dev                  # http://localhost:3000
npm test                     # simulation, floor plan and integration tests
```

Refresh menu prices from the published Chris B catalogue (no code change needed):

```bash
npx tsx scripts/import-menu.ts
```

Rebuild the Blender equipment models (Blender 5.2+, see `blender/README.md` and `docs/ASSETS.md`):

```bash
blender -b --factory-startup --python blender/build_assets.py && python3 blender/postprocess.py
```

Simulated staff badges (UWB): staff walk their stations and the console can locate and follow them:

```bash
npm run wearables:sim
```

Bench-test the live paths (keys go in `.env.local`, see `.env.example`):

```bash
npx tsx scripts/device-sim.ts --device bench-coldroom-01 --value 3.2 --drift 0.5 --interval 2
npx tsx scripts/pos-sim.ts --branch branch-015
```

### Simulated hardware fleet (no real sensors yet)

Every hardware path can be exercised end to end with simulated hardware that talks to the **real**
ingestion endpoints. Its data is shown as **SIM DEVICE** / **SIM CAMERA**, never LIVE.

```bash
echo "VIRTUAL_FLEET_SECRET=$(openssl rand -hex 32)" >> .env.local     # once; restart npm run dev
echo "VIRTUAL_CAMERA_GATEWAY_URL=http://127.0.0.1:8090" >> .env.local # for the camera simulator

npm run hardware:sim                       # 55 sensors/controllers + 7 POS sources in East Legon, Spintex, KNUST
npm run hardware:sim -- --url http://localhost:3000 --speed 10 \
    --fault v-eastlegon-hot-holding-1-temp:heater --fault v-eastlegon-walk-in-cold-1-temp:dupes
npm run hardware:sim -- --list             # every device id and the faults it supports
npm run camera:sim                         # MJPEG gateway (ffmpeg) for the 6 East Legon simulated cameras
npm run generate:fleet                     # regenerate src/data/devices.virtual.json from the floor plans
```

Open the East Legon twin: sensors switch to SIM DEVICE, simulated POS orders appear in Live Orders,
an injected fault raises a SIM DEVICE alert after the configured delay, and the Virtual Cameras grid
offers **SIM CAMERA** on matching tiles. Fleet health is under Settings → Integrations. Details:
`docs/INTEGRATION.md` → Simulated hardware fleet.

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
9. **Settings → Integrations** — device and fleet health (physical vs simulated, per branch), POS
   sources, cameras (real and simulated) and how to connect real equipment.

## Layout

```
src/lib/floorplan   schema, catalogue, wall/camera/sensor derivation, nav grid (A*), SVG export
src/lib/sim         deterministic engine, menu & recipes, inventory catalogue, safety profile
src/lib/network     verified branches, lightweight network model, conceptual supply hubs
src/lib/assistant   AI tool schemas + client-side tool executor
src/lib/integration contracts, signing, in-process hub, live client (devices, POS, cameras)
src/store           Zustand app store, simulation registry, versioned floor plan repository
src/components      shell · map · twin · panels · editor · analytics · assistant · integration
src/data            branches.json (from research), floorplans/model-{a,b,c}.json, devices.json, devices.virtual.json
scripts             generate-floorplans.ts, import-branches.py, device-sim.ts, pos-sim.ts,
                    generate-fleet.ts, hardware-sim.ts, camera-sim.ts (simulated hardware)
prisma              target production schema (backend not yet built)
docs                ARCHITECTURE.md, AUDIT.md, ASSETS.md, INTEGRATION.md, HANDOVER.md, research/, floorplans/*.svg
blender             scripted Blender → glTF asset pipeline (output in public/models)
```

See `docs/ARCHITECTURE.md` for the design, the production target and phase status.
