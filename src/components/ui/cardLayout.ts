"use client";

import { create } from "zustand";

/**
 * Where the movable cards on the map and the camera screen sit, and which are hidden.
 * Kept per device, like the camera layers and the theme.
 */
export type CardAreaId = "map" | "camera";

export const CARDS: Record<CardAreaId, Array<{ id: string; title: string }>> = {
  map: [
    { id: "telemetry", title: "Network telemetry" },
    { id: "filters", title: "Search and filters" },
    { id: "legend", title: "Legend" },
  ],
  camera: [
    { id: "status", title: "Zone status" },
    { id: "alerts", title: "Alerts" },
    { id: "timeline", title: "Timeline" },
    { id: "actions", title: "Quick actions" },
    { id: "layers", title: "Feed layers" },
  ],
};

export interface Placement {
  x: number;
  y: number;
  w: number;
}
export interface CardState {
  hidden?: boolean;
  place?: Placement;
  z?: number;
}
type Box = { width: number; height: number };

const KEY = "ops.cards.v1";
const MARGIN = 12;

export const cardKey = (area: CardAreaId, id: string) => `${area}:${id}`;

/** Keeps a card inside its area. A card bigger than the area stays pinned to the top left. */
export function clampPlacement(p: { x: number; y: number }, card: Box, area: Box, margin = MARGIN) {
  const clamp = (v: number, size: number, room: number) => Math.max(margin, Math.min(v, room - size - margin));
  return { x: clamp(p.x, card.width, area.width), y: clamp(p.y, card.height, area.height) };
}

/** Saved layouts come from storage, so anything malformed is dropped rather than trusted. */
export function parseCards(raw: string | null): Record<string, CardState> {
  try {
    const out: Record<string, CardState> = {};
    for (const [k, v] of Object.entries(JSON.parse(raw ?? "{}") as Record<string, CardState>)) {
      const p = v?.place;
      const validPlace = !!p && [p.x, p.y, p.w].every((n) => typeof n === "number" && Number.isFinite(n));
      out[k] = { ...(v?.hidden === true ? { hidden: true } : {}), ...(validPlace ? { place: p } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

function stored() {
  if (typeof window === "undefined") return {};
  try {
    return parseCards(window.localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

interface CardLayoutState {
  cards: Record<string, CardState>;
  topZ: number;
  place: (key: string, place: Placement) => void;
  raise: (key: string) => void;
  setHidden: (key: string, hidden: boolean) => void;
  resetCard: (key: string) => void;
  resetArea: (area: CardAreaId) => void;
  save: () => void;
}

export const useCardLayout = create<CardLayoutState>((set, get) => ({
  cards: stored(),
  topZ: 0,
  place: (key, place) => set({ cards: { ...get().cards, [key]: { ...get().cards[key], place } } }),
  raise: (key) => {
    const z = get().topZ + 1;
    set({ topZ: z, cards: { ...get().cards, [key]: { ...get().cards[key], z } } });
  },
  setHidden: (key, hidden) => {
    set({ cards: { ...get().cards, [key]: { ...get().cards[key], hidden } } });
    get().save();
  },
  resetCard: (key) => {
    set({ cards: Object.fromEntries(Object.entries(get().cards).filter(([k]) => k !== key)) });
    get().save();
  },
  resetArea: (area) => {
    set({ cards: Object.fromEntries(Object.entries(get().cards).filter(([k]) => !k.startsWith(`${area}:`))) });
    get().save();
  },
  save: () => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(get().cards));
    } catch {
      /* not persisted */
    }
  },
}));
