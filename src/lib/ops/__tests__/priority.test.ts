import { describe, expect, it } from "vitest";
import { modelC } from "../../floorplan/templates";
import type { BranchSnapshot } from "../../network/network";
import { BranchSimulation } from "../../sim/engine";
import { rankPriorities } from "../priority";

const START = Date.UTC(2026, 10, 3, 12, 0);
const snap = (branchId: string, over: Partial<BranchSnapshot> = {}): BranchSnapshot => ({ branchId, status: "normal", open: true, live: false, activeOrders: 0, ordersToday: 0, salesToday: 0, avgTicket: 0, staffOnDuty: 0, kitchenLoad: 0, avgPrepMin: 0, delayed: 0, equipmentAlerts: 0, safetyStatus: "ok", lowStock: 0, hourlySales: [], ...over });

describe("priority queue", () => {
  it("puts a food-safety critical in a running twin above network-model warnings", () => {
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: START, config: { seed: 1, arrivalRate: 0, dineInShare: 0.3, deliveryShare: 0.4, autoFaults: false } });
    sim.injectFault("walk-in-cold-1", "compressor", 7);
    sim.advance(15 * 60, 1e9);
    const sims = new Map([["branch-015", sim]]);
    const items = rankPriorities([snap("branch-001", { status: "warning", issue: "Fryer oil change due" }), snap("branch-015", { live: true })], sims, sim.now());
    expect(items[0].branchId).toBe("branch-015");
    expect(items[0].kind).toBe("food-safety");
    expect(items[0].target?.kind).toBe("alert");
    expect(items.at(-1)?.kind).toBe("network-model");
    // Ranked strictly by score.
    expect(items.map((i) => i.score)).toEqual([...items.map((i) => i.score)].sort((a, b) => b - a));
  });

  it("ignores healthy and closed branches", () => {
    expect(rankPriorities([snap("branch-001"), snap("branch-002", { status: "closed", issue: "Closed" })], new Map(), START)).toEqual([]);
  });
});
