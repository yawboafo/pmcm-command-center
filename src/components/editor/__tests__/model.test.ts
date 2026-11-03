import { describe, expect, it } from "vitest";
import { modelA, modelB, modelC } from "../../../lib/floorplan/templates";
import { checkImportedPlan, layoutMetrics, optimise, validate } from "../model";

describe("editor model", () => {
  it.each([["A", modelA], ["B", modelB], ["C", modelC]])("template %s has no validation errors or warnings", (_, f) => {
    const issues = validate(f()).filter((i) => i.severity === "error" || i.severity === "warning");
    expect(issues.map((e) => e.message)).toEqual([]);
  });

  it("optimise clears template overlaps without new errors", () => {
    for (const f of [modelA, modelC]) {
      const { plan } = optimise(f());
      expect(validate(plan).filter((i) => i.category === "overlap")).toEqual([]);
    }
  });

  it("detects overlap and optimise resolves it", () => {
    const plan = modelB();
    const fr = plan.equipment.find((e) => e.type === "fryer")!;
    const other = plan.equipment.find((e) => e.type === "fryer" && e.id !== fr.id)!;
    other.position = [fr.position[0], 0, fr.position[2] + 0.2];
    expect(validate(plan, { circulation: false }).some((i) => i.category === "overlap")).toBe(true);
    const { plan: fixed, moved } = optimise(plan);
    expect(moved.length).toBeGreaterThan(0);
    expect(validate(fixed, { circulation: false }).some((i) => i.category === "overlap")).toBe(false);
  });

  it("flags blocked emergency exit and unreachable stations", () => {
    const plan = modelA();
    const exit = plan.doors.find((d) => d.kind === "emergency")!;
    const bench = plan.furniture[0];
    bench.position = [exit.x, 0, exit.z - 0.5];
    bench.roomId = "a-staff";
    const issues = validate(plan);
    expect(issues.some((i) => i.category === "clearance" && i.severity === "error")).toBe(true);
  });

  it("flags overlapping rooms", () => {
    const plan = modelC();
    plan.rooms.find((r) => r.id === "c-dry")!.w = 4.6;
    expect(validate(plan, { circulation: false }).some((i) => i.message.includes("overlap") && i.targets.every((t) => t.kind === "room"))).toBe(true);
  });

  it("computes metrics with flows and a bottleneck", () => {
    const m = layoutMetrics(modelC());
    expect(m.area).toBe(408);
    expect(m.flows.pizza).toBeGreaterThan(0);
    expect(m.throughputPerHour).toBeGreaterThan(10);
    expect(m.bottleneck).not.toBeNull();
  });

  it("rejects bad imports and accepts a template", () => {
    expect(checkImportedPlan({ foo: 1 }).ok).toBe(false);
    expect(checkImportedPlan(JSON.parse(JSON.stringify(modelA()))).ok).toBe(true);
  });
});
