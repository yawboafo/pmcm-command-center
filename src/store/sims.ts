import modelAJson from "@/data/floorplans/model-a.json";
import modelBJson from "@/data/floorplans/model-b.json";
import modelCJson from "@/data/floorplans/model-c.json";
import type { FloorPlan } from "@/lib/floorplan/types";
import { BRANCH_BY_ID, isBranchOpen } from "@/lib/network/branches";
import { liteSnapshot } from "@/lib/network/network";
import type { SafetyProfile } from "@/lib/sim/catalog";
import { BranchSimulation } from "@/lib/sim/engine";

export const TEMPLATES: Record<"A" | "B" | "C", FloorPlan> = {
  A: modelAJson as unknown as FloorPlan,
  B: modelBJson as unknown as FloorPlan,
  C: modelCJson as unknown as FloorPlan,
};

const PLAN_KEY = "pmcm.floorplans.v1";

export interface PlanVersion {
  savedAt: number;
  by: string;
  note: string;
  plan: FloorPlan;
}

/** Branch floor plans: template copy unless an administrator saved a custom layout. */
class PlanRepository {
  private versions: Record<string, PlanVersion[]> = {};
  constructor() {
    try {
      if (typeof window !== "undefined") this.versions = JSON.parse(window.localStorage.getItem(PLAN_KEY) ?? "{}");
    } catch {
      this.versions = {};
    }
  }
  private persist() {
    try {
      window.localStorage.setItem(PLAN_KEY, JSON.stringify(this.versions));
    } catch {
      /* storage unavailable — keep in memory */
    }
  }
  get(branchId: string): FloorPlan {
    const v = this.versions[branchId];
    if (v?.length) return structuredClone(v[v.length - 1].plan);
    const b = BRANCH_BY_ID.get(branchId);
    const tpl = TEMPLATES[b?.floorPlanType ?? "B"];
    const plan = structuredClone(tpl);
    plan.restaurantId = branchId;
    plan.name = `${b?.name ?? branchId} — ${tpl.name}`;
    return plan;
  }
  history(branchId: string) {
    return this.versions[branchId] ?? [];
  }
  save(branchId: string, plan: FloorPlan, by: string, note: string) {
    const list = (this.versions[branchId] ??= []);
    list.push({ savedAt: Date.now(), by, note, plan: structuredClone({ ...plan, format: plan.format === "custom" ? "custom" : plan.format }) });
    if (list.length > 20) list.shift();
    this.persist();
  }
  rollback(branchId: string, index: number) {
    const list = this.versions[branchId];
    if (!list?.[index]) return;
    list.push({ ...list[index], savedAt: Date.now(), note: `Rollback to version ${index + 1}` });
    this.persist();
  }
  resetToTemplate(branchId: string) {
    delete this.versions[branchId];
    this.persist();
  }
  isCustom(branchId: string) {
    return !!this.versions[branchId]?.length;
  }
}

let repo: PlanRepository | null = null;
export function plans() {
  return (repo ??= new PlanRepository());
}

/**
 * Registry of running branch simulations. Only branches the user has opened
 * get a full simulation (lazy), so we never run 70 kitchens at once.
 */
class SimRegistry {
  readonly sims = new Map<string, BranchSimulation>();
  seed = 20261103;
  arrivalRate = 20;
  safety?: SafetyProfile;
  /** Shared simulated wall clock (epoch ms). */
  clock = SimRegistry.initialClock();
  /**
   * Real-time mode: the clock follows the actual wall clock at 1×. Enabled automatically
   * when the first live device reading arrives, so live and simulated timelines never mix.
   */
  realtime = false;

  static initialClock() {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 15);
  }

  get(branchId: string): BranchSimulation {
    let sim = this.sims.get(branchId);
    if (!sim) {
      const b = BRANCH_BY_ID.get(branchId)!;
      const lite = liteSnapshot(b, this.clock, this.arrivalRate / 20, this.seed);
      sim = new BranchSimulation({
        branchId,
        branchName: b.name,
        plan: plans().get(branchId),
        clockStart: this.clock,
        config: { seed: this.seed, arrivalRate: (this.arrivalRate * { A: 0.7, B: 1, C: 1.5 }[b.floorPlanType]), dineInShare: 0.3, deliveryShare: 0.45, autoFaults: true },
        baseline: { ordersToday: lite.ordersToday, completed: Math.max(0, lite.ordersToday - lite.activeOrders), sales: lite.salesToday },
        isOpen: (ms) => isBranchOpen(b, ms),
        safety: this.safety,
      });
      this.sims.set(branchId, sim);
    }
    return sim;
  }

  peek(branchId: string) {
    return this.sims.get(branchId);
  }

  restart(branchId: string) {
    this.sims.delete(branchId);
    return this.get(branchId);
  }

  restartAll() {
    const ids = [...this.sims.keys()];
    this.sims.clear();
    this.clock = this.realtime ? Date.now() : SimRegistry.initialClock();
    for (const id of ids) this.get(id);
  }

  advance(simSeconds: number) {
    this.clock += simSeconds * 1000;
    for (const s of this.sims.values()) s.advance(simSeconds);
  }

  /** Called every animation frame by the SimDriver. */
  tick(realDtSec: number, speed: number, paused: boolean) {
    if (this.realtime) {
      const behind = (Date.now() - this.clock) / 1000;
      if (behind > 0) this.advance(Math.min(behind, 5));
      return;
    }
    if (!paused) this.advance(realDtSec * speed);
  }

  /** Switch to the real wall clock; running simulations restart on the real timeline. */
  enableRealtime() {
    if (this.realtime) return;
    this.realtime = true;
    const ids = [...this.sims.keys()];
    this.sims.clear();
    this.clock = Date.now();
    for (const id of ids) this.get(id);
  }

  setArrivalRate(rate: number) {
    this.arrivalRate = rate;
    for (const s of this.sims.values()) {
      const b = BRANCH_BY_ID.get(s.branchId)!;
      s.config.arrivalRate = rate * { A: 0.7, B: 1, C: 1.5 }[b.floorPlanType];
    }
  }

  setSafety(profile: SafetyProfile) {
    this.safety = profile;
    for (const s of this.sims.values()) s.safety = profile;
  }
}

// Kept on globalThis so development hot reloads don't wipe running simulations.
const g = globalThis as unknown as { __pmcmSims?: SimRegistry };
export function sims() {
  return (g.__pmcmSims ??= new SimRegistry());
}
