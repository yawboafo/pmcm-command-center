import { describe, expect, it } from "vitest";
import { modelA, modelB, modelC } from "../../floorplan/templates";
import { NavGrid } from "../../floorplan/nav";
import { BranchSimulation } from "../engine";
import { MENU, MENU_UNPRICED } from "../menu";

const START = Date.UTC(2026, 10, 3, 11, 30);
const make = (plan = modelB(), seed = 42) =>
  new BranchSimulation({ branchId: "test", branchName: "Test", plan, clockStart: START, config: { seed, arrivalRate: 30, dineInShare: 0.3, deliveryShare: 0.45, autoFaults: false } });

describe("floor plans", () => {
  it.each([["A", modelA], ["B", modelB], ["C", modelC]])("model %s: every workstation reachable from staff area", (_, f) => {
    const plan = f();
    const grid = new NavGrid(plan);
    for (const ws of plan.workstations) expect(grid.findPath(plan.anchors.staffRest, ws.standPoint), ws.name).not.toBeNull();
    expect(plan.cameras.length).toBeGreaterThanOrEqual(10);
    expect(new Set(plan.equipment.map((e) => e.id)).size).toBe(plan.equipment.length);
  });
});

describe("menu", () => {
  it("prices every simulated item from the published catalogue", () => {
    expect(MENU_UNPRICED).toEqual([]);
    for (const m of MENU) {
      expect(m.price, m.id).toBeGreaterThan(0);
      expect(m.sourceUrl, m.id).toMatch(/^https:\/\/chrisb\.app\//);
    }
  });
});

describe("simulation", () => {
  it.each([["A", modelA], ["B", modelB], ["C", modelC]])("model %s: orders flow to completion", (_, f) => {
    const sim = make(f());
    sim.advance(2 * 3600, 1e9);
    const m = sim.metrics();
    expect(m.ordersToday).toBeGreaterThan(20);
    expect(m.completed).toBeGreaterThan(10);
    const stuck = sim.activeOrders().filter((o) => sim.t - o.createdAt > 3600);
    expect(stuck.map((o) => `${o.number}:${o.status}`)).toEqual([]);
  });

  it("is deterministic for a fixed seed", () => {
    const a = make(modelB(), 7);
    const b = make(modelB(), 7);
    a.advance(1800, 1e9);
    for (let i = 0; i < 1800; i++) b.advance(1, 1e9);
    expect(a.metrics()).toEqual(b.metrics());
    expect(a.agents.map((x) => x.pos)).toEqual(b.agents.map((x) => x.pos));
  });

  it("deducts inventory once per order", () => {
    const sim = make();
    sim.advance(3600, 1e9);
    const done = [...sim.orders.values()].find((o) => o.status === "COMPLETED")!;
    const before = sim.inventory.map((i) => i.qty);
    expect(sim.consumeForOrder(done)).toBe(false);
    done.inventoryConsumed = false;
    expect(sim.consumeForOrder(done)).toBe(false);
    expect(sim.inventory.map((i) => i.qty)).toEqual(before);
  });

  it("fridge fault raises an alert that cannot resolve without action and recovery", () => {
    const sim = make();
    const fridge = sim.plan.equipment.find((e) => e.type === "walk-in-cold" || e.type === "fridge")!;
    sim.injectFault(fridge.id, "compressor", 8);
    sim.advance(60, 1e9);
    const alert = sim.alerts.find((a) => a.equipmentId === fridge.id)!;
    expect(alert?.severity).toBe("critical");
    expect(sim.acknowledgeAlert(alert.id, "Tester")).toBe(true);
    expect(alert.status).toBe("acknowledged");
    expect(sim.resolveAlert(alert.id, "Tester").ok).toBe(false);
    sim.addCorrectiveAction(alert.id, "Moved stock to backup fridge", "Tester");
    expect(sim.resolveAlert(alert.id, "Tester").reason).toMatch(/outside/);
    sim.clearFault(fridge.id);
    sim.advance(900, 1e9);
    expect(sim.resolveAlert(alert.id, "Tester").ok).toBe(true);
  });

  it("demo order activates pizza and chicken stations", () => {
    const sim = make();
    const o = sim.placeOrder([{ menuId: "pz-chicken-l", qty: 1 }, { menuId: "rc-playman-jollof", qty: 1 }], "online");
    sim.advance(120, 1e9);
    const types = new Set(sim.tasksFor(o.id).map((t) => t.ws));
    expect([...types].some((t) => ["pizza-prep", "oven"].includes(t))).toBe(true);
    sim.advance(3600, 1e9);
    expect(["OUT_FOR_DELIVERY", "COMPLETED"]).toContain(sim.orders.get(o.id)!.status);
  });

  it.each([["pickup"], ["dine-in"]] as const)("injected %s order is collected by an arriving customer", (fulfilment) => {
    const sim = make(modelB(), 7);
    const o = sim.placeOrder([{ menuId: "pz-chicken-l", qty: 1 }], "online", fulfilment);
    sim.advance(3600, 1e9);
    expect(o.customerId).toBeDefined();
    expect(o.status).toBe("COMPLETED");
  });

  it("order status follows its least-advanced item, with payment and an estimated ready time", () => {
    const sim = make(modelB(), 5);
    const o = sim.placeOrder([{ menuId: "pz-chicken-l", qty: 1 }, { menuId: "rc-playman-jollof", qty: 1 }], "online", "pickup");
    expect(o.payment).toBeUndefined();
    // Even before acceptance the estimate must include the pizza bake.
    expect(sim.estimateReadyAt(o)! - sim.t).toBeGreaterThan(5 * 60);
    sim.advance(30, 1e9);
    expect(o.payment?.paidAt).toBeDefined();
    const eta0 = sim.estimateReadyAt(o)!;
    expect(eta0).toBeGreaterThan(sim.t + 5 * 60); // the pizza still has to bake
    // While the pizza is still on the make-line or in the oven, the order cannot be at QC,
    // even though the rice is portioned straight from the warmer.
    for (let i = 0; i < 40 && !o.readyAt; i++) {
      sim.advance(15, 1e9);
      const pizza = o.unitIds.map((u) => sim.units.get(u)!).find((u) => u.kind === "pizza")!;
      if (!pizza.done && pizza.stages[pizza.stageIndex]?.phase !== "QUALITY_CHECK") expect(o.status).not.toBe("QUALITY_CHECK");
    }
    sim.advance(1800, 1e9);
    expect(o.readyAt).toBeDefined();
    expect(sim.estimateReadyAt(o)).toBe(o.readyAt);
    expect(Math.abs(o.readyAt! - eta0)).toBeLessThan(6 * 60); // estimate within 6 min
  });
});
