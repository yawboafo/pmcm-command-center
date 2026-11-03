import { dayProfile } from "./calendar";
import type { BranchSimulation } from "./engine";
import { hashString, Rng } from "./rng";
import type { ZoneId } from "./zones";

/**
 * Anomaly scenarios: the things that go wrong in a branch, injected into the running
 * simulation so the camera alerts, replay and actions can be exercised and rehearsed.
 * Each is seeded and replayable; a few are scheduled automatically through the day so
 * the console never looks staged, and any can be triggered on demand from the UI.
 */
export interface Scenario {
  id: string;
  name: string;
  /** What the owner will see, in one line. */
  description: string;
  zoneId: ZoneId;
  /** Seconds until the alert normally fires after injection (for the demo script). */
  leadSec: number;
  run: (sim: BranchSimulation) => string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "lunch-rush",
    name: "Lunch rush",
    description: "A burst of walk-ins and app orders in two minutes — the queue and the kitchen back up.",
    zoneId: "front-counter",
    leadSec: 90,
    run: (sim) => {
      sim.queueSurge(7);
      sim.orderBurst(5);
      return "Lunch rush: 7 walk-ins and 5 app orders arrived together";
    },
  },
  {
    id: "staff-off-post",
    name: "Cashier away from the till",
    description: "A cashier leaves the counter during service and does not come back.",
    zoneId: "front-counter",
    leadSec: 120,
    run: (sim) => {
      const cashier = sim.agents.find((a) => a.kind === "staff" && a.role === "cashier" && !a.gone && !a.breakUntil);
      if (!cashier) return "No cashier on shift to send away";
      sim.sendOnBreak(cashier.id, 14, "outside");
      sim.queueSurge(4);
      return `${cashier.name} left the till for 14 minutes`;
    },
  },
  {
    id: "ticket-overdue",
    name: "Kitchen backed up",
    description: "Six chicken orders land at once and the fryers fall behind; an order passes 12 minutes.",
    zoneId: "kitchen",
    leadSec: 13 * 60,
    run: (sim) => {
      sim.orderBurst(6, ["ck-wings-10", "ck-bucket-5"]);
      return "Six chicken orders placed together — fryers backing up";
    },
  },
  {
    id: "cold-door-open",
    name: "Cold room door left open",
    description: "Someone props the cold room door; the temperature starts to climb.",
    zoneId: "cold-room",
    leadSec: 95,
    run: (sim) => {
      const cam = sim.zoneCameras.find((c) => c.zoneId === "cold-room");
      if (!cam?.doorId) return "No cold room door in this layout";
      sim.holdDoor(cam.doorId, 6 * 60);
      const cold = sim.plan.equipment.find((e) => e.type === "walk-in-cold");
      if (cold) sim.warmEquipment(cold.id, 0.02);
      return "Cold room door propped open";
    },
  },
  {
    id: "rider-waiting",
    name: "Riders waiting",
    description: "Three riders arrive for orders the kitchen has not finished.",
    zoneId: "pickup-bay",
    leadSec: 8 * 60 + 30,
    run: (sim) => {
      sim.spawnWaitingRiders(3);
      return "Three riders arrived early for app orders";
    },
  },
  {
    id: "drawer-open-no-sale",
    name: "Till drawer open, no sale",
    description: "The cash drawer is opened without a sale and stays open.",
    zoneId: "front-counter",
    leadSec: 50,
    run: (sim) => {
      sim.openDrawerNoSale(4 * 60);
      return "Till drawer opened with no sale";
    },
  },
  {
    id: "back-door-after-hours",
    name: "Back door after hours",
    description: "The back door opens while the branch is closed.",
    zoneId: "back-door",
    leadSec: 10,
    run: (sim) => {
      const cam = sim.zoneCameras.find((c) => c.zoneId === "back-door");
      if (!cam?.doorId) return "No back door in this layout";
      sim.holdDoor(cam.doorId, 3 * 60, { forceAfterHours: true });
      return "Back door opened";
    },
  },
  {
    id: "fryer-oil-overdue",
    name: "Fryer oil overdue",
    description: "Oil quality in a fryer drops below the change threshold.",
    zoneId: "kitchen",
    leadSec: 35,
    run: (sim) => {
      const f = sim.plan.equipment.find((e) => e.type === "fryer");
      if (!f) return "No fryer in this layout";
      sim.setOilQuality(f.id, sim.safety.oilQualityMinPct - 6);
      return `${f.name} oil quality dropped below the change threshold`;
    },
  },
  {
    id: "dining-spill",
    name: "Spill in dining",
    description: "A drink goes over in the dining area and nobody cleans it.",
    zoneId: "dining",
    leadSec: 4 * 60 + 10,
    run: (sim) => {
      sim.addSpill(undefined, 9 * 60);
      return "Spill reported in the dining area";
    },
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

/** Run a scenario now; logs an anomaly marker so it shows on the timeline. Returns the log line. */
export function runScenario(sim: BranchSimulation, id: string, auto = false): string | null {
  const s = SCENARIO_BY_ID.get(id);
  if (!s) return null;
  const line = s.run(sim);
  sim.log("system", "warning", `${auto ? "Scheduled scenario" : "Scenario"} — ${line}`, { zoneId: s.zoneId, scenario: s.id, marker: "anomaly" });
  sim.version++;
  return line;
}

/** Seeded daily schedule: three or four anomalies spread over service, never two in the same hour. */
export function scheduledScenarios(seed: number, epochMs: number, branchId: string): Array<{ hour: number; id: string }> {
  const p = dayProfile(epochMs, seed);
  const rng = new Rng(hashString(`${seed}:${p.dayKey}:${branchId}:scenarios`));
  const pool = SCENARIOS.filter((s) => s.id !== "lunch-rush" && s.id !== "back-door-after-hours").map((s) => s.id);
  const n = rng.chance(0.5) ? 4 : 3;
  const out: Array<{ hour: number; id: string }> = [];
  let hour = rng.range(10.2, 11.5);
  for (let i = 0; i < n && hour < 21.5; i++) {
    const id = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    out.push({ hour: Math.round(hour * 100) / 100, id });
    hour += rng.range(1.6, 3.2);
  }
  return out;
}
