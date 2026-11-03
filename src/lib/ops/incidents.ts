"use client";

import { create } from "zustand";
import type { ZoneId } from "../sim/zones";

/**
 * Saved moments from the camera centre: snapshots, 30-second clips, shares, flags and notes.
 * Persisted in the browser (localStorage) for the prototype; the production store is the
 * incidents table in prisma/schema.prisma. Every incident is pinned to simulated time so it
 * sits on the timeline and can be replayed.
 */
export type IncidentKind = "snapshot" | "clip" | "share" | "flag" | "note";

export interface Incident {
  id: string;
  branchId: string;
  zoneId: ZoneId;
  kind: IncidentKind;
  /** Simulated time (epoch ms) the incident refers to. */
  atMs: number;
  /** Simulated seconds (engine clock) for timeline placement and replay. */
  atSimS: number;
  createdAt: number;
  by: string;
  note?: string;
  /** JPEG data URL thumbnail (snapshots and clips). */
  image?: string;
  clip?: { fromSimS: number; toSimS: number };
  alertId?: string;
  sharedWith?: string;
}

const KEY = "ops.cameras.incidents.v1";
const MAX = 120;

function load(): Incident[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persist(list: Incident[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota or private mode: keep in memory */
  }
}

interface IncidentState {
  incidents: Incident[];
  add: (i: Omit<Incident, "id" | "createdAt">) => Incident;
  remove: (id: string) => void;
}

export const useIncidents = create<IncidentState>((set, get) => ({
  incidents: load(),
  add: (i) => {
    const inc: Incident = { ...i, id: `inc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() };
    const list = [inc, ...get().incidents].slice(0, MAX);
    persist(list);
    set({ incidents: list });
    return inc;
  },
  remove: (id) => {
    const list = get().incidents.filter((x) => x.id !== id);
    persist(list);
    set({ incidents: list });
  },
}));

export const INCIDENT_LABEL: Record<IncidentKind, string> = { snapshot: "Snapshot", clip: "30 s clip", share: "Shared", flag: "Flagged", note: "Note" };
