import { demandFactor, type BranchSimulation } from "../sim/engine";
import { Rng, hashString } from "../sim/rng";
import { BRANCHES, isBranchOpen, type Branch } from "./branches";

export type BranchStatus = "normal" | "warning" | "critical" | "closed";

export interface BranchSnapshot {
  branchId: string;
  status: BranchStatus;
  open: boolean;
  live: boolean;
  activeOrders: number;
  ordersToday: number;
  salesToday: number;
  avgTicket: number;
  staffOnDuty: number;
  kitchenLoad: number;
  avgPrepMin: number;
  delayed: number;
  equipmentAlerts: number;
  safetyStatus: "ok" | "attention" | "critical";
  lowStock: number;
  issue?: string;
  /** Hourly simulated sales for today (index = hour). */
  hourlySales: number[];
}

const FORMAT_RATE = { A: 14, B: 22, C: 34 } as const;
const FORMAT_STAFF = { A: 5, B: 8, C: 12 } as const;
const ISSUES_WARN = ["Fryer oil change due", "Order delays above target", "Cleaning checklist overdue", "Hot-holding below target temperature", "Low stock: mozzarella"];
const ISSUES_CRIT = ["Cold room temperature above limit", "Freezer temperature above limit", "Oven offline"];

/**
 * Lightweight deterministic model for every branch that is not currently
 * running a full simulation. Values are SIMULATED demo metrics derived from
 * a seeded demand curve and the branch's published opening hours.
 */
export function liteSnapshot(b: Branch, epochMs: number, arrivalScale: number, seed: number): BranchSnapshot {
  const r = new Rng(hashString(b.id) ^ seed);
  const factor = r.range(0.65, 1.35);
  const ticket = r.range(98, 142);
  const rate = FORMAT_RATE[b.floorPlanType] * factor * arrivalScale;
  const d = new Date(epochMs);
  const nowH = d.getUTCHours() + d.getUTCMinutes() / 60;
  const hourly = new Array(24).fill(0);
  let orders = 0;
  for (let h = 0; h < Math.floor(nowH) + 1; h++) {
    const span = h === Math.floor(nowH) ? nowH - h : 1;
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 30);
    if (!isBranchOpen(b, t)) continue;
    const n = rate * demandFactor(h + 0.5) * span * new Rng(hashString(`${b.id}:${h}`) ^ seed).range(0.8, 1.2);
    orders += n;
    hourly[h] = Math.round(n * ticket);
  }
  const open = isBranchOpen(b, epochMs);
  const active = open ? Math.round(rate * demandFactor(nowH) * 0.32) : 0;
  // Seeded incidents in 2-hour windows so the national map shows realistic variety.
  const slot = Math.floor(epochMs / 7.2e6);
  const ir = new Rng(hashString(`${b.id}:inc:${slot}`) ^ seed);
  const roll = ir.next();
  let status: BranchStatus = open ? "normal" : "closed";
  let issue: string | undefined;
  if (open && roll < 0.035) {
    status = "critical";
    issue = ir.pick(ISSUES_CRIT);
  } else if (open && roll < 0.14) {
    status = "warning";
    issue = ir.pick(ISSUES_WARN);
  }
  return {
    branchId: b.id,
    status,
    open,
    live: false,
    activeOrders: active,
    ordersToday: Math.round(orders),
    salesToday: Math.round(orders * ticket),
    avgTicket: Math.round(ticket),
    staffOnDuty: open ? FORMAT_STAFF[b.floorPlanType] : 0,
    kitchenLoad: open ? Math.min(0.98, 0.25 + demandFactor(nowH) * 0.35 * factor) : 0,
    avgPrepMin: open ? Math.round((11 + demandFactor(nowH) * 4 * factor) * 10) / 10 : 0,
    delayed: status === "warning" && issue?.includes("delay") ? Math.max(1, Math.round(active * 0.2)) : 0,
    equipmentAlerts: status === "critical" ? 1 : status === "warning" && !issue?.includes("delay") ? 1 : 0,
    safetyStatus: status === "critical" ? "critical" : status === "warning" ? "attention" : "ok",
    lowStock: issue?.includes("stock") ? 1 : 0,
    issue,
    hourlySales: hourly,
  };
}

/** Snapshot for a branch that has a full simulation running. */
export function liveSnapshot(b: Branch, sim: BranchSimulation, lite: BranchSnapshot): BranchSnapshot {
  const m = sim.metrics();
  const critical = sim.alerts.find((a) => a.status !== "resolved" && a.severity === "critical");
  const warning = sim.alerts.find((a) => a.status !== "resolved" && a.severity === "warning");
  const open = sim.isOpen();
  const status: BranchStatus = !open ? "closed" : critical ? "critical" : warning || m.delayed > 2 || m.lowStock > 2 ? "warning" : "normal";
  const util = Object.values(m.utilization);
  const hourly = [...lite.hourlySales];
  const h = new Date(sim.now()).getUTCHours();
  hourly[h] = Math.max(hourly[h], Math.round(m.sales - lite.salesToday + (lite.hourlySales[h] ?? 0)));
  return {
    branchId: b.id,
    status,
    open,
    live: true,
    activeOrders: m.activeOrders,
    ordersToday: m.ordersToday,
    salesToday: Math.round(m.sales),
    avgTicket: m.ordersToday ? Math.round(m.sales / m.ordersToday) : lite.avgTicket,
    staffOnDuty: m.staffOnDuty,
    kitchenLoad: util.length ? Math.max(...util) : 0,
    avgPrepMin: Math.round(m.avgPrepMin * 10) / 10 || lite.avgPrepMin,
    delayed: m.delayed,
    equipmentAlerts: m.equipmentIssues + m.openAlerts,
    safetyStatus: critical ? "critical" : warning ? "attention" : "ok",
    lowStock: m.lowStock,
    issue: critical?.title ?? warning?.title ?? (m.delayed ? `${m.delayed} delayed orders` : undefined),
    hourlySales: hourly,
  };
}

export function allSnapshots(epochMs: number, arrivalScale: number, seed: number, live: Map<string, BranchSimulation>): BranchSnapshot[] {
  return BRANCHES.map((b) => {
    const lite = liteSnapshot(b, epochMs, arrivalScale, seed);
    const sim = live.get(b.id);
    return sim ? liveSnapshot(b, sim, lite) : lite;
  });
}
