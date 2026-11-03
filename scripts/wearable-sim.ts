/**
 * Simulated staff badges (UWB RTLS): every badge in `devices.virtual.json → wearables` walks
 * its wearer between the stations their role works at, along walkable paths of the branch
 * floor plan, and posts signed position fixes to /api/ingest/location exactly as an RTLS
 * gateway would. Positions are sent in the RTLS site frame (offset from the floor plan) so
 * the server-side calibration is exercised. Everything shows as SIM DEVICE, never LIVE.
 *
 *   npm run wearables:sim -- [--branches branch-015] [--interval 1] [--speed 1] [--dropout 0.01] [--url http://localhost:3000] [--quiet]
 */
import { randomUUID } from "node:crypto";
import fleetJson from "../src/data/devices.virtual.json";
import modelA from "../src/data/floorplans/model-a.json";
import modelB from "../src/data/floorplans/model-b.json";
import modelC from "../src/data/floorplans/model-c.json";
import type { WearableBinding } from "../src/lib/integration/contracts";
import { deriveVirtualKey, FLEET_SECRET_MIN_LENGTH } from "../src/lib/integration/fleet";
import { sign } from "../src/lib/integration/signing";
import { NavGrid } from "../src/lib/floorplan/nav";
import type { FloorPlan, Vec2 } from "../src/lib/floorplan/types";
import { BRANCH_BY_ID } from "../src/lib/network/branches";
import { ROLE_SKILLS, ROSTER } from "../src/lib/sim/engine";
import { arg, envVar, flag } from "./lib/env";

const URL_BASE = (arg("url") ?? envVar("OPS_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const INTERVAL = Math.max(0.25, Number(arg("interval", "1")) || 1);
const SPEED = Math.max(0.1, Number(arg("speed", "1")) || 1);
const DROPOUT = Math.min(0.5, Math.max(0, Number(arg("dropout", "0.01")) || 0));
const QUIET = flag("quiet");
const only = arg("branches")?.split(",");

const secret = envVar("VIRTUAL_FLEET_SECRET");
if (!secret || secret.length < FLEET_SECRET_MIN_LENGTH) {
  console.error("VIRTUAL_FLEET_SECRET is not set (see .env.example)");
  process.exit(1);
}

const PLANS: Record<string, FloorPlan> = { A: modelA as unknown as FloorPlan, B: modelB as unknown as FloorPlan, C: modelC as unknown as FloorPlan };
const tags = ((fleetJson as { wearables?: WearableBinding[] }).wearables ?? []).filter((w) => !only || only.includes(w.branchId));
if (!tags.length) {
  console.error("No virtual wearables — run `npm run generate:fleet` first.");
  process.exit(1);
}

/** Box–Muller normal noise for UWB fix error. */
function gauss(sigma: number) {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()) * sigma;
}

interface Wearer {
  w: WearableBinding;
  plan: FloorPlan;
  grid: NavGrid;
  stops: Vec2[];
  pos: Vec2;
  path: Vec2[];
  dwell: number;
  speed: number;
  battery: number;
  /** Seconds of signal loss remaining (badge behind a cold-room wall, battery swap…). */
  outage: number;
}

const grids = new Map<string, NavGrid>();
const wearers: Wearer[] = tags.map((w) => {
  const b = BRANCH_BY_ID.get(w.branchId)!;
  const plan = PLANS[b.floorPlanType];
  let grid = grids.get(b.floorPlanType);
  if (!grid) grids.set(b.floorPlanType, (grid = new NavGrid(plan)));
  const role = ROSTER[b.floorPlanType][Number(w.staffId.replace("staff-", "")) - 1] ?? "packer";
  const stops = plan.workstations.filter((ws) => ROLE_SKILLS[role].includes(ws.type)).map((ws) => ws.standPoint);
  stops.push(plan.anchors.staffRest);
  const pos: Vec2 = [...stops[Math.floor(Math.random() * stops.length)]];
  return { w, plan, grid, stops, pos, path: [], dwell: Math.random() * 30, speed: 1.0 + Math.random() * 0.4, battery: 60 + Math.random() * 40, outage: 0 };
});

function step(p: Wearer, dt: number) {
  if (p.outage > 0) p.outage -= dt;
  else if (Math.random() < DROPOUT * dt) p.outage = 5 + Math.random() * 40;
  p.battery = Math.max(0, p.battery - dt * 0.0004);
  if (p.dwell > 0) {
    p.dwell -= dt;
    // Small working movements at a station.
    p.pos = [p.pos[0] + gauss(0.02), p.pos[1] + gauss(0.02)];
    return;
  }
  if (!p.path.length) {
    const next = p.stops[Math.floor(Math.random() * p.stops.length)];
    p.path = p.grid.findPath(p.pos, next) ?? [];
    if (!p.path.length) p.dwell = 5;
    return;
  }
  let remaining = p.speed * dt;
  while (remaining > 0 && p.path.length) {
    const [tx, tz] = p.path[0];
    const d = Math.hypot(tx - p.pos[0], tz - p.pos[1]);
    if (d <= remaining) {
      p.pos = [tx, tz];
      p.path.shift();
      remaining -= d;
    } else {
      p.pos = [p.pos[0] + ((tx - p.pos[0]) / d) * remaining, p.pos[1] + ((tz - p.pos[1]) / d) * remaining];
      remaining = 0;
    }
  }
  if (!p.path.length) p.dwell = 20 + Math.random() * 100;
}

let sent = 0;
let failed = 0;
async function report(p: Wearer) {
  if (p.outage > 0) return;
  const { offsetX, offsetZ } = p.w.transform;
  const accuracy = 0.12 + Math.random() * 0.2;
  // Plan → RTLS site frame (rotation 0, scale 1 in the generated bindings).
  const body = JSON.stringify({ v: 1, messageId: randomUUID(), tagId: p.w.tagId, ts: new Date().toISOString(), x: +(p.pos[0] + gauss(accuracy / 2) - offsetX).toFixed(3), y: +(p.pos[1] + gauss(accuracy / 2) - offsetZ).toFixed(3), accuracy_m: +accuracy.toFixed(2), battery_pct: +p.battery.toFixed(1), anchors: 4 + Math.floor(Math.random() * 3) });
  const ts = Date.now();
  try {
    const res = await fetch(`${URL_BASE}/api/ingest/location`, { method: "POST", headers: { "content-type": "application/json", "x-ops-device": p.w.tagId, "x-ops-timestamp": String(ts), "x-ops-signature": sign(deriveVirtualKey(secret!, p.w.tagId), ts, body) }, body });
    if (res.status >= 300) {
      failed++;
      if (!QUIET) console.error(`${p.w.tagId} → ${res.status} ${await res.text()}`);
    } else sent++;
  } catch (e) {
    failed++;
    if (!QUIET) console.error(`${p.w.tagId} → ${(e as Error).message}`);
  }
}

console.log(`Simulated staff badges → ${URL_BASE}/api/ingest/location`);
for (const id of [...new Set(wearers.map((p) => p.w.branchId))]) console.log(`  ${BRANCH_BY_ID.get(id)?.name}: ${wearers.filter((p) => p.w.branchId === id).length} badges (UWB)`);
console.log("  Positions show as SIM DEVICE in the console, never LIVE.");

setInterval(() => {
  for (const p of wearers) step(p, INTERVAL * SPEED);
  void Promise.all(wearers.map(report));
}, INTERVAL * 1000);
if (!QUIET) setInterval(() => console.log(`${new Date().toISOString()} fixes sent ${sent}, failed ${failed}`), 15_000);
