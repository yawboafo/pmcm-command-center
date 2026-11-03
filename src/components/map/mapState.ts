"use client";

import { create } from "zustand";
import { canSeeBranch, type DemoUser } from "@/lib/auth/rbac";
import { BRANCHES, type Branch } from "@/lib/network/branches";
import type { BranchSnapshot } from "@/lib/network/network";

/** Map-local filter state (region/status/search live in the app store). */
interface MapFilterState {
  format: "A" | "B" | "C" | null;
  pinkberry: "any" | "co-branded" | "standalone";
  regionalPerformance: boolean;
  dashboardOpen: boolean;
  setFormat: (f: "A" | "B" | "C" | null) => void;
  setPinkberry: (p: "any" | "co-branded" | "standalone") => void;
  toggleRegional: () => void;
  toggleDashboard: () => void;
}

export const useMapFilters = create<MapFilterState>((set, get) => ({
  format: null,
  pinkberry: "any",
  regionalPerformance: false,
  dashboardOpen: true,
  setFormat: (format) => set({ format }),
  setPinkberry: (pinkberry) => set({ pinkberry }),
  toggleRegional: () => set({ regionalPerformance: !get().regionalPerformance }),
  toggleDashboard: () => set({ dashboardOpen: !get().dashboardOpen }),
}));

export interface FilterInput {
  user: DemoUser;
  regionFilter: string | null;
  statusFilter: string | null;
  search: string;
  format: "A" | "B" | "C" | null;
  pinkberry: "any" | "co-branded" | "standalone";
}

/** Branches visible to this user after all map/directory filters. */
export function filterBranches(snaps: BranchSnapshot[], f: FilterInput): Array<{ b: Branch; s: BranchSnapshot }> {
  const q = f.search.trim().toLowerCase();
  const bySnap = new Map(snaps.map((s) => [s.branchId, s]));
  return BRANCHES.filter((b) => canSeeBranch(f.user, b))
    .filter((b) => !f.regionFilter || b.region === f.regionFilter)
    .filter((b) => !f.format || b.floorPlanType === f.format)
    .filter((b) => f.pinkberry === "any" || (f.pinkberry === "co-branded") === b.brand.includes("Pinkberry"))
    .filter((b) => !q || `${b.name} ${b.city} ${b.region} ${b.siteContext ?? ""}`.toLowerCase().includes(q))
    .map((b) => ({ b, s: bySnap.get(b.id)! }))
    .filter(({ s }) => s && (!f.statusFilter || s.status === f.statusFilter));
}

/** Tiny event bus so the directory (or others) can ask the map to fly somewhere. */
type FlyListener = (branchId: string) => void;
const listeners = new Set<FlyListener>();
export function requestFlyTo(branchId: string) {
  for (const l of listeners) l(branchId);
}
export function onFlyTo(l: FlyListener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const STATUS_LABEL = { normal: "Normal", warning: "Warning", critical: "Critical", closed: "Closed" } as const;
export const SAFETY_LABEL = { ok: "OK", attention: "Attention", critical: "Critical" } as const;
