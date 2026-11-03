"use client";

import { useMemo } from "react";
import { allSnapshots } from "@/lib/network/network";
import { ARRIVAL_PRESETS, useApp } from "@/store/app";
import { sims } from "@/store/sims";

/** Re-render on the throttled simulation tick. */
export function useTick() {
  return useApp((s) => s.tick);
}

/** Full simulation for the entered branch (or null). Re-renders ≈4 Hz. */
export function useBranchSim() {
  useTick();
  const id = useApp((s) => s.enteredBranchId);
  return id ? sims().get(id) : null;
}

/** Network-wide snapshots for all 70 branches (simulated metrics). */
export function useSnapshots() {
  const tick = useTick();
  const preset = useApp((s) => s.arrivalPreset);
  // Recompute at most every ~2 s of wall time to keep the map cheap.
  const bucket = Math.floor(tick / 8);
  return useMemo(() => allSnapshots(sims().clock, ARRIVAL_PRESETS[preset] / 20, sims().seed, sims().sims), [bucket, preset]); // eslint-disable-line react-hooks/exhaustive-deps
}
