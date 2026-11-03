import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ingest/location/route";
import { DEMO_USERS } from "../../auth/rbac";
import { modelC } from "../../floorplan/templates";
import { cameraFor, staffLabel } from "../../ops/staffLocation";
import { BranchSimulation } from "../../sim/engine";
import { WearableBinding } from "../contracts";
import { deriveVirtualKey } from "../fleet";
import { __resetHub, backlog, ingestLocation, toPlan, WEARABLES } from "../hub";
import { sign } from "../signing";

const SECRET = "f".repeat(64);
const tag = WEARABLES.find((w) => w.branchId === "branch-015" && w.staffId === "staff-1")!;
const fix = (over: Record<string, unknown> = {}) => ({ v: 1, messageId: `m-${Math.random().toString(36).slice(2, 12)}`, tagId: tag.tagId, ts: new Date().toISOString(), x: 4, y: 6, accuracy_m: 0.2, battery_pct: 80, ...over });

describe("staff wearables", () => {
  beforeEach(() => {
    __resetHub();
    vi.stubEnv("VIRTUAL_FLEET_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("calibrates the RTLS site frame to the floor plan", () => {
    const w = WearableBinding.parse({ ...tag, transform: { offsetX: 1, offsetZ: 2, rotationDeg: 90, scale: 2 } });
    // (1, 0) · 2 = (2, 0) → rotated 90° = (0, 2) → + offset = (1, 4)
    expect(toPlan(w, 1, 0)).toEqual([1, 4]);
    expect(toPlan(tag, 4, 6)).toEqual([4 + tag.transform.offsetX, 6 + tag.transform.offsetZ]);
  });

  it("de-duplicates fixes and streams them as SIM DEVICE for virtual badges", () => {
    const m = fix({ messageId: "msg-dup-0001" });
    expect(ingestLocation(m as never).status).toBe("accepted");
    expect(ingestLocation(m as never).status).toBe("duplicate");
    const [e] = backlog("branch-015", 0);
    expect(e.type === "location" && e.source).toBe("virtual");
    expect(e.type === "location" && e.staffId).toBe("staff-1");
  });

  it("accepts only correctly signed fixes from registered tags", async () => {
    const call = (body: object, key: string, tagId = tag.tagId) => {
      const raw = JSON.stringify(body);
      const ts = Date.now();
      return POST(new Request("http://localhost/api/ingest/location", { method: "POST", body: raw, headers: { "x-pmcm-device": tagId, "x-pmcm-timestamp": String(ts), "x-pmcm-signature": sign(key, ts, raw) } }));
    };
    const key = deriveVirtualKey(SECRET, tag.tagId);
    expect((await call(fix(), key)).status).toBe(202);
    expect((await call(fix(), "wrong-key-0123456789abcdef")).status).toBe(401);
    expect((await call(fix({ tagId: "vtag-unknown-99" }), key, "vtag-unknown-99")).status).toBe(401);
    expect((await call(fix({ accuracy_m: -1 }), key)).status).toBe(400);
  });

  it("shows the tracked person where the badge says while their simulated work continues", () => {
    const make = () => new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: Date.UTC(2026, 10, 3, 12, 0), config: { seed: 3, arrivalRate: 40, dineInShare: 0.3, deliveryShare: 0.45, autoFaults: false } });
    const sim = make();
    const target: [number, number] = [sim.plan.anchors.staffRest[0], sim.plan.anchors.staffRest[1]];
    // Badge every staff member (as the simulated fleet does) and keep them parked in the rest room.
    const badgeAll = () => {
      for (const s of sim.agents.filter((x) => x.kind === "staff")) sim.ingestStaffLocation({ staffId: s.id, tagId: `t-${s.id}`, x: target[0], z: target[1], accuracy: 0.2, technology: "uwb", source: "virtual" });
    };
    for (let i = 0; i < 120; i++) {
      badgeAll();
      sim.advance(15, 1e9);
    }
    const a = sim.agents.find((x) => x.id === "staff-1")!;
    expect(Math.hypot(a.pos[0] - target[0], a.pos[1] - target[1])).toBeLessThan(0.1);
    // The kitchen keeps producing even though everyone is "in the rest room" by badge.
    expect(sim.metrics().completed).toBeGreaterThan(10);
    // Silent badge: lost after 30 s, handed back to the simulation after 10 min.
    sim.advance(60, 1e9);
    expect(a.tracked?.lost).toBe(true);
    sim.advance(600, 1e9);
    expect(a.tracked).toBeUndefined();
    expect(sim.ingestStaffLocation({ staffId: "staff-99", tagId: "x", x: 0, z: 0, accuracy: 1, technology: "ble", source: "live" })).toBeNull();
  });

  it("anonymises staff for roles without staff-location access and finds a camera on them", () => {
    const sim = new BranchSimulation({ branchId: "branch-015", branchName: "East Legon", plan: modelC(), clockStart: Date.UTC(2026, 10, 3, 12, 0), config: { seed: 3, arrivalRate: 0, dineInShare: 0.3, deliveryShare: 0.45, autoFaults: false } });
    const a = sim.agents.find((x) => x.id === "staff-2")!;
    const viewer = DEMO_USERS.find((u) => u.role === "viewer")!;
    const manager = DEMO_USERS.find((u) => u.role === "branch-manager" || u.role === "national-ops")!;
    expect(staffLabel(viewer, a, "Cashier")).toBe("Staff #2 · Cashier");
    expect(staffLabel(manager, a, "Cashier")).toBe(a.name);
    const room = sim.roomAtPoint(a.pos);
    expect(cameraFor(sim.plan, a.pos[0], a.pos[1], room?.id)).not.toBeNull();
  });
});
