import type { DemoUser } from "../auth/rbac";
import { can } from "../auth/rbac";
import type { FloorPlan, VirtualCamera } from "../floorplan/types";
import type { BranchSimulation } from "../sim/engine";
import type { Agent } from "../sim/types";

/** Where a person's position comes from — badge (live or simulated device) or the simulation. */
export function locationProvenance(a: Agent): "live" | "virtual" | "simulated" {
  return a.tracked ? a.tracked.source : "simulated";
}

/** Badge status line for a tracked person, e.g. "UWB ±0.2 m · 4 s ago · 82%". */
export function badgeLine(a: Agent, simT: number): string | null {
  const t = a.tracked;
  if (!t) return null;
  const age = Math.max(0, Math.round(simT - t.seenAt));
  return `${t.technology.toUpperCase()} ±${t.accuracy.toFixed(1)} m · ${t.lost ? "signal lost" : `${age}s ago`}${t.battery !== undefined ? ` · ${Math.round(t.battery)}%` : ""}`;
}

/**
 * Virtual camera with the best view of a floor point: inside its horizontal field of view and
 * in the same room scores highest, then distance. Null if no camera covers the room.
 */
export function cameraFor(plan: FloorPlan, x: number, z: number, roomId: string | undefined): VirtualCamera | null {
  let best: VirtualCamera | null = null;
  let bestScore = -Infinity;
  for (const c of plan.cameras) {
    const dx = x - c.position[0];
    const dz = z - c.position[2];
    const dist = Math.hypot(dx, dz);
    const look = Math.atan2(c.target[0] - c.position[0], c.target[2] - c.position[2]);
    let off = Math.abs(Math.atan2(dx, dz) - look);
    if (off > Math.PI) off = 2 * Math.PI - off;
    const inView = off <= ((c.fov * 0.9) / 2) * (Math.PI / 180) * 1.25;
    const score = (c.roomId === roomId ? 100 : 0) + (inView ? 50 : 0) - dist;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best && bestScore > 0 ? best : null;
}

/** Staff name if this user may see named locations, otherwise an anonymised label. */
export function staffLabel(user: DemoUser, a: Agent, roleLabel: string): string {
  return can(user, "view:staff-location") ? a.name : `Staff ${a.id.replace("staff-", "#")} · ${roleLabel}`;
}

export function onShiftStaff(sim: BranchSimulation): Agent[] {
  return sim.agents.filter((a) => a.kind === "staff" && !a.gone);
}
