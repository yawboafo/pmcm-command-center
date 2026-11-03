import type { BranchSimulation } from "./engine";
import { ROLE_LABEL } from "./engine";
import type { Alert } from "./types";
import { zoneStaff, zoneStatus, type ZoneId, type ZoneStatus } from "./zones";

/**
 * Operational alert rules — the conditions a restaurant owner wants to be told about,
 * each with a plain-language cause and a recommended action. A rule must hold for
 * `holdSec` before it opens an alert (no flapping), clears itself once the condition
 * has been gone for `clearSec`, and escalates while nobody acknowledges it.
 *
 * Food-safety threshold alerts (temperatures, oil) are still opened by the sensor
 * model in engine.ts; `enrichSensorAlert` gives those a zone, cause and action too.
 */
export interface RuleHit {
  cause: string;
  action: string;
  /** Distinguishes several simultaneous instances (e.g. two riders); default: the rule id. */
  key?: string;
  severity?: Alert["severity"];
}

export interface Rule {
  id: string;
  zoneId: ZoneId;
  title: string;
  severity: Alert["severity"];
  holdSec: number;
  clearSec: number;
  check: (sim: BranchSimulation, z: ZoneStatus) => RuleHit | null;
}

export const ESCALATE_1_SEC = 3 * 60;
export const ESCALATE_2_SEC = 8 * 60;

const metric = (z: ZoneStatus, key: string) => z.metrics.find((m) => m.key === key)?.value ?? null;
const mm = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const mins = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;
const first = (name: string) => name.split(" ")[0];

/** A staff member who could be moved: not a cashier, not on break, idle or on a low-priority task, nearest first. */
function spareStaff(sim: BranchSimulation, excludeZone?: ZoneId) {
  const list = sim.agents.filter((a) => a.kind === "staff" && !a.gone && !a.breakUntil && a.role !== "cashier");
  const exclude = excludeZone ? new Set(zoneStaff(sim, excludeZone).map((s) => s.agent.id)) : new Set<string>();
  const idle = list.filter((a) => !a.taskId && !exclude.has(a.id));
  const pick = idle[0] ?? list.find((a) => !exclude.has(a.id) && sim.tasks.get(a.taskId ?? "")?.kind === "clean") ?? null;
  if (!pick) return null;
  const room = sim.roomAtPoint(pick.pos)?.name ?? "the kitchen";
  return { agent: pick, room, role: pick.role ? ROLE_LABEL[pick.role] : "staff" };
}

export const RULES: Rule[] = [
  {
    id: "queue-long",
    zoneId: "front-counter",
    title: "Queue building at the counter",
    severity: "warning",
    holdSec: 60,
    clearSec: 90,
    check: (sim, z) => {
      const q = metric(z, "queue") ?? 0;
      const wait = metric(z, "frontWait") ?? 0;
      if (q < 6 && wait < 300) return null;
      const tills = z.metrics.find((m) => m.key === "tills");
      const at = tills?.value ?? 0;
      const total = Number(tills?.display.split(" of ")[1] ?? at);
      const spare = spareStaff(sim, "front-counter");
      const onBreak = zoneStaff(sim, "front-counter").find((s) => s.onBreak);
      const cause = `Queue ${q} deep, longest wait ${mm(wait)}, ${at} of ${total} tills staffed${onBreak ? ` (${first(onBreak.agent.name)} on break)` : ""}.`;
      const action = at < total && spare ? `Move ${first(spare.agent.name)} from ${spare.room} to till ${at + 1}.` : spare ? `Open a second till with ${first(spare.agent.name)}.` : "Call the manager to the counter and start taking orders from the queue.";
      return { cause, action, severity: q >= 9 || wait >= 420 ? "critical" : "warning" };
    },
  },
  {
    id: "till-unstaffed",
    zoneId: "front-counter",
    title: "No one at the till",
    severity: "critical",
    holdSec: 45,
    clearSec: 30,
    check: (sim, z) => {
      const tills = z.metrics.find((m) => m.key === "tills");
      const at = tills?.value ?? 0;
      const total = Number(tills?.display.split(" of ")[1] ?? 0);
      const q = metric(z, "queue") ?? 0;
      if (total === 0 || at > 0 || q === 0) return null;
      const away = zoneStaff(sim, "front-counter").filter((s) => !s.atPost);
      const who = away.map((s) => `${first(s.agent.name)} (${s.onBreak ? "on break" : `away ${mins(s.awaySec)}`})`).join(", ");
      const spare = spareStaff(sim, "front-counter");
      return { cause: `${q} customers waiting and no cashier at the till — ${who}.`, action: spare ? `Send ${first(spare.agent.name)} to the till now and call ${first(away[0]?.agent.name ?? "the cashier")} back.` : `Call ${first(away[0]?.agent.name ?? "the cashier")} back to the till now.` };
    },
  },
  {
    id: "staff-off-post",
    zoneId: "kitchen",
    title: "Cook away from the line",
    severity: "warning",
    holdSec: 180,
    clearSec: 60,
    check: (sim, z) => {
      const away = zoneStaff(sim, "kitchen").filter((s) => !s.atPost && !s.onBreak && s.awaySec >= 180);
      if (!away.length) return null;
      const tickets = metric(z, "tickets") ?? 0;
      if (tickets < 3) return null;
      const s = away[0];
      return { cause: `${first(s.agent.name)} (${s.agent.role ? ROLE_LABEL[s.agent.role] : "cook"}) has been off the line for ${mins(s.awaySec)} with ${tickets} orders in the kitchen.`, action: `Call ${first(s.agent.name)} back to the ${s.agent.role === "chicken" ? "fryers" : s.agent.role === "pizza" ? "pizza line" : "line"}.`, key: `staff-off-post:${s.agent.id}` };
    },
  },
  {
    id: "ticket-overdue",
    zoneId: "kitchen",
    title: "Order over 12 minutes in the kitchen",
    severity: "warning",
    holdSec: 30,
    clearSec: 60,
    check: (sim, z) => {
      const oldest = (metric(z, "oldest") ?? 0) * 60;
      if (oldest < 12 * 60) return null;
      const tickets = metric(z, "tickets") ?? 0;
      const pending = [...sim.tasks.values()].filter((t) => t.state === "pending" && t.kind === "stage");
      const byWs = new Map<string, number>();
      for (const t of pending) byWs.set(t.ws, (byWs.get(t.ws) ?? 0) + 1);
      const hot = [...byWs].sort((a, b) => b[1] - a[1])[0];
      const station = hot ? ({ fryer: "fryers", "chicken-prep": "breading station", "pizza-prep": "pizza line", oven: "oven", rice: "rice station", qc: "pass", packaging: "packing" } as Record<string, string>)[hot[0]] ?? hot[0] : "kitchen";
      const spare = spareStaff(sim, "kitchen");
      const oldestOrder = z.metrics.find((m) => m.key === "oldest")?.display.split("· ")[1] ?? "";
      return { cause: `Oldest order ${oldestOrder} at ${mins(oldest)}, ${tickets} in the kitchen. ${hot ? `${hot[1]} items queued at the ${station}.` : ""}`.trim(), action: spare ? `Move ${first(spare.agent.name)} to the ${station} and tell the customer the wait.` : `Prioritise ${oldestOrder || "the oldest order"} at the ${station} and tell the customer the wait.`, severity: oldest >= 18 * 60 ? "critical" : "warning" };
    },
  },
  {
    id: "lamp-too-long",
    zoneId: "pass",
    title: "Food waiting too long under the lamp",
    severity: "warning",
    holdSec: 30,
    clearSec: 60,
    check: (sim, z) => {
      const longest = metric(z, "lampTime") ?? 0;
      if (longest < 8 * 60) return null;
      const n = metric(z, "underLamp") ?? 0;
      const ready = [...sim.orders.values()].filter((o) => o.status === "READY");
      const delivery = ready.filter((o) => o.fulfilment === "delivery").length;
      return { cause: `${n} packed orders at the pass, oldest ${mm(longest)}${delivery ? ` (${delivery} waiting for riders)` : ""}.`, action: delivery ? "Call the next riders in and hand over the oldest bags first." : "Call the waiting customers to the pickup counter by order number.", severity: longest >= 12 * 60 ? "critical" : "warning" };
    },
  },
  {
    id: "rider-waiting",
    zoneId: "pickup-bay",
    title: "Rider waiting too long",
    severity: "warning",
    holdSec: 30,
    clearSec: 60,
    check: (sim, z) => {
      const longest = metric(z, "riderWait") ?? 0;
      if (longest < 8 * 60) return null;
      const riders = metric(z, "riders") ?? 0;
      const orders = [...sim.orders.values()].filter((o) => o.fulfilment === "delivery" && o.riderId && sim.agents.some((a) => a.id === o.riderId && !a.gone && a.phase === "waiting"));
      const inKitchen = orders.filter((o) => o.status !== "READY");
      const nums = inKitchen.slice(0, 3).map((o) => `#${o.number}`).join(", ");
      return { cause: `${riders} rider${riders > 1 ? "s" : ""} waiting, longest ${mm(longest)}. Their orders ${nums ? `(${nums}) ` : ""}are still in the kitchen.`, action: `Prioritise ${nums || "the riders' orders"} at the pass and tell the rider the wait.`, severity: longest >= 12 * 60 ? "critical" : "warning" };
    },
  },
  {
    id: "orders-waiting-riders",
    zoneId: "pickup-bay",
    title: "Orders packed but no rider",
    severity: "warning",
    holdSec: 120,
    clearSec: 60,
    check: (_sim, z) => {
      const n = metric(z, "ordersWaiting") ?? 0;
      if (n < 3) return null;
      return { cause: `${n} delivery orders packed with no rider collecting.`, action: "Call the delivery partner for more riders, or send the branch rider now." };
    },
  },
  {
    id: "drawer-open-no-sale",
    zoneId: "front-counter",
    title: "Till drawer open with no sale",
    severity: "critical",
    holdSec: 45,
    clearSec: 10,
    check: (sim) => {
      const till = sim.till;
      if (!till.drawerOpen || !till.openNoSale) return null;
      const open = sim.t - till.since;
      const cashier = zoneStaff(sim, "front-counter").find((s) => s.atPost);
      return { cause: `Till drawer has been open for ${mm(open)} with no sale rung up${cashier ? ` — ${first(cashier.agent.name)} at the till` : ""}.`, action: "Ask the manager to check the till now and count the drawer." };
    },
  },
  {
    id: "cold-door-open",
    zoneId: "cold-room",
    title: "Cold room door left open",
    severity: "warning",
    holdSec: 0,
    clearSec: 10,
    check: (sim, z) => {
      const open = metric(z, "door") ?? 0;
      if (open < 90) return null;
      const temp = metric(z, "temp");
      const near = zoneStaff(sim, "cold-room");
      const who = near[0]?.agent.name;
      return { cause: `Cold room door open for ${mins(open)}${temp !== null ? `, temperature ${temp.toFixed(1)} °C` : ""}.`, action: who ? `Ask ${first(who)} to shut the cold room door and check the seal.` : "Send someone to shut the cold room door and check the seal.", severity: open >= 240 || (temp !== null && temp > sim.safety.chilledMaxC) ? "critical" : "warning" };
    },
  },
  {
    id: "back-door-after-hours",
    zoneId: "back-door",
    title: "Back door opened after hours",
    severity: "critical",
    holdSec: 5,
    clearSec: 30,
    check: (sim, z) => {
      const open = (metric(z, "door") ?? 0) > 0;
      if (!open || sim.isOpen()) return null;
      return { cause: "Back door opened while the branch is closed.", action: "Check the camera and call the branch manager now." };
    },
  },
  {
    id: "back-door-open-long",
    zoneId: "back-door",
    title: "Back door left open",
    severity: "warning",
    holdSec: 0,
    clearSec: 20,
    check: (sim) => {
      const cam = sim.zoneCameras.find((c) => c.zoneId === "back-door");
      const d = cam?.doorId ? sim.doors.get(cam.doorId) : undefined;
      if (!d?.open || !sim.isOpen()) return null;
      const open = sim.t - d.since;
      if (open < 120) return null;
      return { cause: `Back door has been open for ${mins(open)} during service.`, action: "Have the nearest staff member close the back door; check nothing is propping it." };
    },
  },
  {
    id: "spill-uncleaned",
    zoneId: "dining",
    title: "Spill not cleaned",
    severity: "warning",
    holdSec: 240,
    clearSec: 5,
    check: (sim) => {
      const s = sim.spills.filter((x) => !x.cleanedAt).sort((a, b) => a.since - b.since)[0];
      if (!s) return null;
      const age = sim.t - s.since;
      const room = sim.roomName(s.roomId);
      const spare = spareStaff(sim);
      return { cause: `Spill in the ${room.toLowerCase()} for ${mins(age)}; slip risk near the tables.`, action: spare ? `Send ${first(spare.agent.name)} with a mop and a wet-floor sign.` : "Send the nearest staff member with a mop and a wet-floor sign.", key: `spill-uncleaned:${s.id}`, severity: age >= 8 * 60 ? "critical" : "warning" };
    },
  },
  {
    id: "cleaning-overdue",
    zoneId: "dining",
    title: "Dining clean overdue",
    severity: "warning",
    holdSec: 600,
    clearSec: 30,
    check: (_sim, z) => {
      const due = metric(z, "cleaning");
      if (due === null || due > -10) return null;
      return { cause: `Dining area clean is ${Math.abs(due)} min overdue.`, action: "Run the dining cleaning checklist now (tables, floor, bins)." };
    },
  },
];

export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** Zone, cause and action for threshold alerts raised by the sensor model. */
export function enrichSensorAlert(sim: BranchSimulation, a: Alert) {
  const e = a.equipmentId ? sim.eqById.get(a.equipmentId) : undefined;
  if (!e) return;
  const name = e.name;
  if (/oil change/i.test(a.title)) {
    a.cause = `${name} oil quality ${a.peakValue ?? "?"}% — below the ${a.limit ?? sim.safety.oilQualityMinPct}% minimum.`;
    a.action = `Change the oil in ${name} before the next rush; filter the other fryers.`;
    return;
  }
  if (/connectivity/i.test(a.title)) {
    a.cause = a.issue;
    a.action = `Check the sensor and gateway on ${name}; use a hand probe until it reports again.`;
    return;
  }
  if (e.category === "refrigeration" || e.type === "walk-in-cold" || e.type === "walk-in-freezer") {
    a.cause = `${name} reading ${a.peakValue ?? "?"} °C, above the ${a.limit ?? sim.safety.chilledMaxC} °C limit.`;
    a.action = `Move stock to backup cold storage and call the refrigeration technician for ${name}.`;
    return;
  }
  if (e.type === "hot-holding" || e.type === "rice-warmer" || e.type === "qc-pass") {
    a.cause = `${name} at ${a.peakValue ?? "?"} °C, below the ${a.limit ?? sim.safety.hotHoldingMinC} °C hot-holding minimum.`;
    a.action = `Discard food held below temperature for over 2 h; check the ${name} thermostat.`;
    return;
  }
  a.cause = a.issue;
  a.action = `Inspect ${name} and record the corrective action.`;
}

/** Evaluate every rule for the current simulation state (called by the engine every few seconds). */
export function evaluateRules(sim: BranchSimulation) {
  const statuses = new Map<ZoneId, ZoneStatus>();
  const status = (id: ZoneId) => {
    let s = statuses.get(id);
    if (!s) statuses.set(id, (s = zoneStatus(sim, id)));
    return s;
  };
  const present = new Set(sim.zoneCameras.map((c) => c.zoneId));
  const seen = new Set<string>();
  for (const rule of RULES) {
    if (!present.has(rule.zoneId)) continue;
    const hit = rule.check(sim, status(rule.zoneId));
    const key = hit?.key ?? rule.id;
    if (hit) {
      seen.add(key);
      const st = sim.ruleState.get(key) ?? { since: sim.t };
      st.clearSince = undefined;
      sim.ruleState.set(key, st);
      if (sim.t - st.since >= rule.holdSec) sim.openRuleAlert(rule, key, hit);
    }
  }
  // Conditions that are no longer present: start (or finish) the clear timer.
  for (const [key, st] of sim.ruleState) {
    if (seen.has(key)) continue;
    st.clearSince ??= sim.t;
    const rule = RULE_BY_ID.get(key.split(":")[0]);
    if (rule && sim.t - st.clearSince >= rule.clearSec) {
      sim.autoResolveAlert(key);
      sim.ruleState.delete(key);
    }
  }
  // Escalate anything open and unacknowledged.
  for (const a of sim.alerts) {
    if (a.status !== "open") continue;
    const age = (sim.now() - a.openedAt) / 1000;
    const want: Alert["escalation"] = age >= ESCALATE_2_SEC ? 2 : age >= ESCALATE_1_SEC ? 1 : 0;
    if (want > a.escalation) {
      a.escalation = want;
      a.escalatedAt = sim.now();
      sim.log("safety", want === 2 ? "critical" : "warning", want === 2 ? `Unattended for ${Math.round(age / 60)} min — manager notified: ${a.title}` : `Still open after ${Math.round(age / 60)} min: ${a.title}`, { alertId: a.id, zoneId: a.zoneId, marker: "alert" });
      sim.version++;
    }
  }
}
