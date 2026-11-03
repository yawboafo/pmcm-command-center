"use client";

import { create } from "zustand";

/** UI state local to the 3D twin (not shared app state). */
interface TwinState {
  cctvPage: number;
  /** Per virtual camera zoom (fov delta) and yaw/pitch nudge, in degrees. */
  camAdjust: Record<string, { fov: number; yaw: number; pitch: number }>;
  fpsInput: { f: number; r: number; turn: number };
  fpsLocked: boolean;
  demoOpen: boolean;
  camListOpen: boolean;
  stationsOpen: boolean;
  setStationsOpen: (b: boolean) => void;
  staffOpen: boolean;
  setStaffOpen: (b: boolean) => void;
  setPage: (p: number) => void;
  adjust: (id: string, d: Partial<{ fov: number; yaw: number; pitch: number }>) => void;
  resetAdjust: (id: string) => void;
  setFps: (i: Partial<TwinState["fpsInput"]>) => void;
  setLocked: (b: boolean) => void;
  toggleDemo: (b?: boolean) => void;
  toggleCamList: () => void;
}

export const useTwin = create<TwinState>((set, get) => ({
  cctvPage: 0,
  camAdjust: {},
  fpsInput: { f: 0, r: 0, turn: 0 },
  fpsLocked: false,
  demoOpen: false,
  camListOpen: typeof window !== "undefined" && window.innerWidth > 1700,
  stationsOpen: false,
  setStationsOpen: (stationsOpen) => set({ stationsOpen, staffOpen: false }),
  staffOpen: false,
  setStaffOpen: (staffOpen) => set({ staffOpen, stationsOpen: false }),
  setPage: (cctvPage) => set({ cctvPage }),
  adjust: (id, d) => {
    const cur = get().camAdjust[id] ?? { fov: 0, yaw: 0, pitch: 0 };
    const next = { fov: clamp(cur.fov + (d.fov ?? 0), -35, 25), yaw: clamp(cur.yaw + (d.yaw ?? 0), -35, 35), pitch: clamp(cur.pitch + (d.pitch ?? 0), -20, 20) };
    set({ camAdjust: { ...get().camAdjust, [id]: next } });
  },
  resetAdjust: (id) => set({ camAdjust: { ...get().camAdjust, [id]: { fov: 0, yaw: 0, pitch: 0 } } }),
  setFps: (i) => set({ fpsInput: { ...get().fpsInput, ...i } }),
  setLocked: (fpsLocked) => set({ fpsLocked }),
  toggleDemo: (b) => set({ demoOpen: b ?? !get().demoOpen }),
  toggleCamList: () => set({ camListOpen: !get().camListOpen }),
}));

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
