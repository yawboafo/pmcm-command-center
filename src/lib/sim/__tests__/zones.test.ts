import { describe, expect, it } from "vitest";
import { modelA, modelB, modelC } from "../../floorplan/templates";
import { baselineFor } from "../baseline";
import { dayProfile, weatherAt } from "../calendar";
import { BranchSimulation } from "../engine";
import { ESCALATE_1_SEC, ESCALATE_2_SEC } from "../rules";
import { runScenario, scheduledScenarios, SCENARIOS } from "../scenarios";
import { deriveZoneCameras, ZONES, zoneStatus } from "../zones";

const START = Date.UTC(2026, 10, 3, 12, 0); // Tuesday
const make = (plan = modelC(), seed = 11, opts: Partial<ConstructorParameters<typeof BranchSimulation>[0]> = {}) =>
  new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan, clockStart: START, config: { seed, arrivalRate: 24, dineInShare: 0.3, deliveryShare: 0.45, autoFaults: false }, ...opts });

const open = (sim: BranchSimulation, kind: string) => sim.alerts.find((a) => a.kind?.startsWith(kind) && a.status !== "resolved");

describe("zone cameras", () => {
  it.each([["A", modelA], ["B", modelB], ["C", modelC]])("model %s: every zone gets a fixed camera inside the building", (_, f) => {
    const plan = f();
    const cams = deriveZoneCameras(plan);
    const ids = cams.map((c) => c.zoneId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cams.length).toBeGreaterThanOrEqual(7);
    for (const c of cams) {
      if (c.exterior) continue;
      expect(c.position[0]).toBeGreaterThan(0);
      expect(c.position[0]).toBeLessThan(plan.dimensions.width);
      expect(c.position[2]).toBeGreaterThan(0);
      expect(c.position[2]).toBeLessThan(plan.dimensions.length);
      expect(c.position[1]).toBeLessThan(plan.dimensions.height);
    }
    expect(cams.find((c) => c.zoneId === "cold-room")?.doorId).toBeTruthy();
    expect(cams.find((c) => c.zoneId === "back-door")?.doorId).toBeTruthy();
  });

  it("every zone status has one primary metric, a headline and a level", () => {
    const sim = make();
    sim.advance(40 * 60, 1e9);
    for (const z of ZONES) {
      if (!sim.zoneCameras.some((c) => c.zoneId === z.id)) continue;
      const s = zoneStatus(sim, z.id);
      expect(s.metrics.filter((m) => m.primary)).toHaveLength(1);
      expect(s.headline.length).toBeGreaterThan(5);
      expect(["ok", "watch", "act"]).toContain(s.level);
      for (const m of s.metrics) expect(m.display.length).toBeGreaterThan(0);
    }
  });
});

describe("operational alerts", () => {
  it("queue surge opens a plain-language alert that clears itself once the queue is served", () => {
    const sim = make(modelC(), 3, { config: { seed: 3, arrivalRate: 0, dineInShare: 0, deliveryShare: 0, autoFaults: false } });
    sim.advance(60, 1e9);
    sim.queueSurge(8);
    sim.advance(90, 1e9);
    const a = open(sim, "queue-long")!;
    expect(a).toBeTruthy();
    expect(a.cause).toMatch(/Queue \d+ deep/);
    expect(a.action).toMatch(/till|counter|manager/i);
    expect(a.zoneId).toBe("front-counter");
    expect(sim.resolveAlert(a.id, "Chris").ok).toBe(false);
    sim.advance(30 * 60, 1e9);
    expect(a.status).toBe("resolved");
    expect(a.autoResolved).toBe(true);
  });

  it("a propped cold room door alerts after 90 s and clears after it shuts", () => {
    const sim = make();
    const door = sim.zoneCameras.find((c) => c.zoneId === "cold-room")!.doorId!;
    sim.holdDoor(door, 150);
    sim.advance(100, 1e9);
    const a = open(sim, "cold-door-open")!;
    expect(a).toBeTruthy();
    expect(a.action).toMatch(/shut the cold room door/i);
    expect(zoneStatus(sim, "cold-room").level).not.toBe("ok");
    sim.advance(120, 1e9);
    expect(a.status).toBe("resolved");
    expect(sim.doors.get(door)!.open).toBe(false);
  });

  it("a till drawer open without a sale is critical and escalates while nobody acknowledges it", () => {
    const sim = make(modelC(), 11, { config: { seed: 11, arrivalRate: 0, dineInShare: 0, deliveryShare: 0, autoFaults: false } });
    sim.openDrawerNoSale(20 * 60);
    sim.advance(50, 1e9);
    const a = open(sim, "drawer-open-no-sale")!;
    expect(a.severity).toBe("critical");
    expect(a.escalation).toBe(0);
    sim.advance(ESCALATE_1_SEC + 5, 1e9);
    expect(a.escalation).toBe(1);
    sim.advance(ESCALATE_2_SEC - ESCALATE_1_SEC + 5, 1e9);
    expect(a.escalation).toBe(2);
    expect(sim.acknowledgeAlert(a.id, "Chris")).toBe(true);
    expect(sim.addCorrectiveAction(a.id, "Manager counted the drawer", "Chris")).toBe(true);
    expect(sim.resolveAlert(a.id, "Chris").ok).toBe(true);
  });

  it("the back door opening after hours is reported within seconds", () => {
    const sim = make(modelC(), 5, { isOpen: () => false });
    const door = sim.zoneCameras.find((c) => c.zoneId === "back-door")!.doorId!;
    sim.holdDoor(door, 60, { forceAfterHours: true });
    sim.advance(12, 1e9);
    const a = open(sim, "back-door-after-hours")!;
    expect(a.severity).toBe("critical");
    expect(zoneStatus(sim, "back-door").level).toBe("act");
  });

  it("an unattended spill is raised after four minutes and cleared when cleaned", () => {
    const sim = make();
    sim.addSpill(undefined, 6 * 60);
    sim.advance(4 * 60 + 10, 1e9);
    const a = open(sim, "spill")!;
    expect(a).toBeTruthy();
    expect(a.action).toMatch(/mop/);
    sim.advance(12 * 60, 1e9);
    expect(sim.spills[0].cleanedAt).toBeDefined();
    expect(a.status).toBe("resolved");
  });

  it("assigning an alert acknowledges it", () => {
    const sim = make();
    sim.openDrawerNoSale(600);
    sim.advance(50, 1e9);
    const a = open(sim, "drawer-open-no-sale")!;
    expect(sim.assignAlert(a.id, "Kofi Mensah", "Chris")).toBe(true);
    expect(a.status).toBe("acknowledged");
    expect(a.assignedTo).toBe("Kofi Mensah");
  });
});

describe("history and scenarios", () => {
  it("records one frame per simulated second and finds the frame for any moment", () => {
    const sim = make();
    sim.advance(200, 1e9);
    expect(sim.history.length).toBeGreaterThanOrEqual(199);
    const f = sim.frameAt(100.4)!;
    expect(f.t).toBe(100);
    expect(f.people.length).toBeGreaterThan(5);
    expect(f.zones["front-counter"]).toBeDefined();
    sim.advance(3700, 1e9);
    expect(sim.history.length).toBe(3600);
  });

  it("every scenario runs and leaves an anomaly marker on the timeline", () => {
    for (const s of SCENARIOS) {
      const sim = make();
      sim.advance(30, 1e9);
      expect(runScenario(sim, s.id)).toBeTruthy();
      expect(sim.markers().some((e) => e.refs?.scenario === s.id)).toBe(true);
      sim.advance(s.leadSec + 30, 1e9);
    }
  });

  it("the daily scenario schedule is seeded and spread over service", () => {
    const a = scheduledScenarios(7, START, "branch-015");
    const b = scheduledScenarios(7, START, "branch-015");
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < a.length; i++) expect(a[i].hour - a[i - 1].hour).toBeGreaterThan(1.5);
    expect(scheduledScenarios(8, START, "branch-015")).not.toEqual(a);
  });

  it("natural breaks take staff off post and bring them back", () => {
    const sim = make();
    sim.advance(3 * 3600, 1e9);
    expect(sim.events.some((e) => /on a break/.test(e.message))).toBe(true);
    expect(sim.events.some((e) => /back from break/.test(e.message))).toBe(true);
    expect(sim.agents.filter((a) => a.kind === "staff" && a.breakUntil !== undefined).length).toBeLessThanOrEqual(3);
  });
});

describe("calendar and baselines", () => {
  it("weekends and paydays raise demand; rain is seeded per day", () => {
    const sat = Date.UTC(2026, 10, 7, 13, 0);
    const tue = Date.UTC(2026, 10, 3, 13, 0);
    expect(dayProfile(sat, 1).weekdayFactor).toBeGreaterThan(dayProfile(tue, 1).weekdayFactor);
    expect(dayProfile(Date.UTC(2026, 10, 29, 13, 0), 1).payday).toBe(true);
    expect(dayProfile(tue, 1).payday).toBe(false);
    expect(weatherAt(tue, 1)).toEqual(weatherAt(tue, 1));
    const rainy = Array.from({ length: 60 }, (_, i) => dayProfile(Date.UTC(2026, 4, 1 + (i % 28), 12, 0), i).rain.length).filter((n) => n > 0).length;
    expect(rainy).toBeGreaterThan(10);
  });

  it("baselines are deterministic and only exist for modelled metrics", () => {
    const b = baselineFor("front-counter", "queue", START, 1, "branch-015", "C");
    expect(b).toEqual(baselineFor("front-counter", "queue", START, 1, "branch-015", "C"));
    expect(b.yesterday).not.toBeNull();
    expect(b.basis).toBe("modelled");
    expect(baselineFor("front-counter", "drawer", START, 1, "branch-015", "C").yesterday).toBeNull();
  });
});
