import { BRANCH_BY_ID } from "../network/branches";
import type { BranchSnapshot } from "../network/network";
import type { BranchSimulation } from "../sim/engine";

/**
 * Attention ranking for the command center: turns alerts, delays, stock and hygiene
 * signals from every branch into one ordered queue, so operators see the few issues
 * that matter first instead of a wall of notifications.
 *
 * Score = base weight by kind (food safety and live-device problems first) + age
 * (older unresolved issues climb) + scale (more delayed orders / more SKUs short).
 * Branches without a full simulation only contribute their network-model issue,
 * at a lower weight, because it is a coarser signal.
 */
export type PriorityKind = "food-safety" | "equipment" | "device-offline" | "order-delays" | "stock" | "hygiene" | "network-model";

export interface PriorityItem {
  id: string;
  branchId: string;
  branchName: string;
  kind: PriorityKind;
  severity: "critical" | "warning";
  score: number;
  title: string;
  detail: string;
  /** Where the signal came from — a live device, simulated hardware through the pipeline, or the simulation. */
  provenance: "live" | "virtual" | "simulated";
  /** Epoch ms when the issue started (if known). */
  since?: number;
  target: { kind: "alert" | "order" | "equipment"; id: string } | null;
}

const BASE: Record<PriorityKind, number> = {
  "food-safety": 100,
  "device-offline": 80,
  equipment: 70,
  "order-delays": 55,
  stock: 40,
  hygiene: 30,
  "network-model": 20,
};

/** Minutes of age add up to +30 points, so a stale critical never sinks below a fresh warning. */
const agePoints = (sinceMs: number | undefined, nowMs: number) => (sinceMs === undefined ? 0 : Math.min(30, Math.max(0, (nowMs - sinceMs) / 60_000)));

export function rankPriorities(snaps: BranchSnapshot[], sims: Map<string, BranchSimulation>, nowMs: number, limit = 12): PriorityItem[] {
  const out: PriorityItem[] = [];
  for (const snap of snaps) {
    const name = BRANCH_BY_ID.get(snap.branchId)?.name ?? snap.branchId;
    const sim = sims.get(snap.branchId);
    if (!sim) {
      if (snap.issue && snap.status !== "normal" && snap.status !== "closed") {
        const critical = snap.status === "critical";
        out.push({ id: `${snap.branchId}:model`, branchId: snap.branchId, branchName: name, kind: "network-model", severity: critical ? "critical" : "warning", score: BASE["network-model"] + (critical ? 25 : 0), title: snap.issue, detail: "Network model — open the twin for detail", provenance: "simulated", target: null });
      }
      continue;
    }
    const at = (t: number) => sim.clockStart + t * 1000;
    for (const a of sim.alerts) {
      if (a.status === "resolved") continue;
      const sensor = a.sensorId ? sim.plan.sensors.find((s) => s.id === a.sensorId) : undefined;
      const offline = /connectivity lost/i.test(a.title);
      const safety = !!sensor && ["fridge-temp", "freezer-temp", "hot-holding-temp", "cook-temp-check"].includes(sensor.kind);
      const kind: PriorityKind = offline ? "device-offline" : safety ? "food-safety" : "equipment";
      const since = at(a.openedAt);
      // Acknowledged issues stay visible but drop below untouched ones.
      const ack = a.status === "acknowledged" ? -25 : 0;
      out.push({
        id: a.id,
        branchId: snap.branchId,
        branchName: name,
        kind,
        severity: a.severity,
        score: BASE[kind] + (a.severity === "critical" ? 20 : 0) + agePoints(since, nowMs) + ack,
        title: a.title,
        detail: a.status === "acknowledged" ? `Acknowledged${a.acknowledgedBy ? ` by ${a.acknowledgedBy}` : ""}` : a.issue,
        provenance: a.source,
        since,
        target: { kind: "alert", id: a.id },
      });
    }
    const delayed = [...sim.orders.values()].filter((o) => o.delayed && !o.readyAt && !["CANCELLED", "FAILED", "REFUNDED", "COMPLETED"].includes(o.status));
    if (delayed.length) {
      const oldest = delayed.reduce((x, y) => (x.createdAt < y.createdAt ? x : y));
      out.push({
        id: `${snap.branchId}:delays`,
        branchId: snap.branchId,
        branchName: name,
        kind: "order-delays",
        severity: delayed.length >= 3 ? "critical" : "warning",
        score: BASE["order-delays"] + Math.min(25, delayed.length * 5) + agePoints(at(oldest.createdAt), nowMs) / 2,
        title: `${delayed.length} order${delayed.length > 1 ? "s" : ""} over target time`,
        detail: `Oldest: #${oldest.number}`,
        provenance: delayed.some((o) => o.source === "live") ? "live" : delayed.some((o) => o.source === "virtual") ? "virtual" : "simulated",
        since: at(oldest.createdAt),
        target: { kind: "order", id: oldest.id },
      });
    }
    const short = sim.inventory.filter((i) => i.qty <= i.reorderLevel);
    if (short.length) {
      const out0 = short.filter((i) => i.qty <= 0);
      out.push({
        id: `${snap.branchId}:stock`,
        branchId: snap.branchId,
        branchName: name,
        kind: "stock",
        severity: out0.length ? "critical" : "warning",
        score: BASE.stock + Math.min(20, short.length * 4) + (out0.length ? 20 : 0),
        title: out0.length ? `Out of stock: ${out0[0].name}${out0.length > 1 ? ` +${out0.length - 1}` : ""}` : `Low stock: ${short[0].name}${short.length > 1 ? ` +${short.length - 1}` : ""}`,
        detail: `${short.length} SKU${short.length > 1 ? "s" : ""} at or below reorder level`,
        provenance: "simulated",
        target: null,
      });
    }
    const overdue = sim.cleaning.filter((c) => sim.t > c.dueAt);
    if (overdue.length) {
      out.push({ id: `${snap.branchId}:hygiene`, branchId: snap.branchId, branchName: name, kind: "hygiene", severity: "warning", score: BASE.hygiene + overdue.length * 3, title: `${overdue.length} cleaning checklist${overdue.length > 1 ? "s" : ""} overdue`, detail: overdue.map((c) => sim.plan.rooms.find((r) => r.id === c.roomId)?.name ?? c.roomId).join(", "), provenance: "simulated", target: null });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
