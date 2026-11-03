"use client";

import type { BranchSimulation } from "@/lib/sim/engine";
import type { Agent, HistoryFrame } from "@/lib/sim/types";
import { useFeed } from "./feedStore";

/**
 * Timeline replay: while the playhead is off "live", the 3D people are drawn from the
 * recorded history frame instead of the running simulation. Agent objects are reused per
 * id so the renderer's per-person smoothing keeps working across scrubs.
 */
const pool = new Map<string, Agent>();
let current: { frame: HistoryFrame | null; agents: Agent[] } = { frame: null, agents: [] };

export function replayAgentsFor(sim: BranchSimulation, t: number): Agent[] {
  const frame = sim.frameAt(t);
  if (!frame) return [];
  if (frame === current.frame) return current.agents;
  const list: Agent[] = [];
  for (const p of frame.people) {
    const [id, kind, role, x, z, heading, anim, carrying, look, name, seed] = p;
    let a = pool.get(id);
    if (!a) {
      a = { id, kind, role, name, pos: [x, z], heading, path: [], speed: 1, anim, carrying, look, phase: "replay", timer: 0, seed, arrivedAt: 0 };
      pool.set(id, a);
    } else {
      a.pos = [x, z];
      a.heading = heading;
      a.anim = anim;
      a.carrying = carrying;
      a.look = look;
      a.gone = false;
    }
    list.push(a);
  }
  if (pool.size > 400) for (const id of pool.keys()) if (!list.some((a) => a.id === id)) pool.delete(id);
  current = { frame, agents: list };
  return list;
}

/** Agents to draw right now: the replay frame's people, or null for the live simulation. */
export function drawnAgents(sim: BranchSimulation): Agent[] | null {
  const t = useFeed.getState().replay.t;
  if (t === null) return null;
  return replayAgentsFor(sim, t);
}

/** Door states to draw right now (replay frame or live). */
export function drawnDoorOpen(sim: BranchSimulation, doorId: string): boolean {
  const t = useFeed.getState().replay.t;
  if (t === null) return sim.doors.get(doorId)?.open ?? false;
  const f = sim.frameAt(t);
  return !!f?.doors[doorId];
}
