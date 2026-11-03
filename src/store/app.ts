"use client";

import { create } from "zustand";
import { DEMO_USERS, type DemoUser } from "@/lib/auth/rbac";
import type { Vec3 } from "@/lib/floorplan/types";

export type Section =
  | "network"
  | "branches"
  | "twin"
  | "cameras"
  | "kitchen"
  | "orders"
  | "safety"
  | "inventory"
  | "customers"
  | "staff"
  | "delivery"
  | "central"
  | "analytics"
  | "assistant"
  | "editor"
  | "settings";

/** Sections rendered on top of the 3D twin (they need an entered branch). */
export const TWIN_SECTIONS: Section[] = ["twin", "cameras", "kitchen", "orders", "safety", "inventory", "customers", "staff", "delivery"];

/** Sections drawn over the Ghana map (entering one leaves the restaurant twin). */
const MAP_SECTIONS: Section[] = ["network", "branches", "central"];

export type CameraMode = "orbit" | "fps" | "top" | "dollhouse" | "cctv" | "focus" | "tour" | "follow";

export type Selection =
  | { kind: "equipment"; id: string }
  | { kind: "workstation"; id: string }
  | { kind: "room"; id: string }
  | { kind: "order"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "camera"; id: string }
  | { kind: "sensor"; id: string }
  | { kind: "alert"; id: string }
  | { kind: "branch"; id: string }
  | null;

/** Map → restaurant cinematic: flying (map), exterior (3D outside), entering, inside. */
export type TransitionPhase = "map" | "flying" | "exterior" | "entering" | "inside";

export interface CameraRequest {
  /** Increments for every request so the camera rig can react to repeats. */
  nonce: number;
  position?: Vec3;
  target: Vec3;
  fov?: number;
}

interface AppState {
  section: Section;
  selectedBranchId: string | null;
  enteredBranchId: string | null;
  phase: TransitionPhase;
  selection: Selection;
  cameraMode: CameraMode;
  activeCameraId: string | null;
  cameraRequest: CameraRequest | null;
  followOrderId: string | null;
  cctvLayout: 1 | 4 | 9;
  cctvOpen: boolean;
  xray: boolean;
  showPaths: boolean;
  speed: number;
  paused: boolean;
  arrivalPreset: "low" | "medium" | "high";
  /** Throttled simulation tick (≈4 Hz) for panels; 3D reads engines directly. */
  tick: number;
  panels: { left: boolean; right: boolean; bottom: boolean };
  graphics: "high" | "balanced" | "low";
  user: DemoUser;
  regionFilter: string | null;
  statusFilter: string | null;
  search: string;
  toast: { id: number; text: string; tone: "info" | "success" | "warning" | "critical" } | null;

  setSection: (s: Section) => void;
  selectBranch: (id: string | null) => void;
  enterBranch: (id: string) => void;
  setPhase: (p: TransitionPhase) => void;
  exitToMap: () => void;
  select: (s: Selection) => void;
  setCameraMode: (m: CameraMode) => void;
  useVirtualCamera: (id: string | null) => void;
  requestCamera: (r: Omit<CameraRequest, "nonce">) => void;
  followOrder: (id: string | null) => void;
  setCctv: (open: boolean, layout?: 1 | 4 | 9) => void;
  toggle: (k: "xray" | "showPaths") => void;
  setSpeed: (s: number) => void;
  setPaused: (p: boolean) => void;
  setArrivalPreset: (p: "low" | "medium" | "high") => void;
  bumpTick: () => void;
  togglePanel: (p: "left" | "right" | "bottom") => void;
  setGraphics: (g: "high" | "balanced" | "low") => void;
  setUser: (id: string) => void;
  setFilters: (f: Partial<{ regionFilter: string | null; statusFilter: string | null; search: string }>) => void;
  notify: (text: string, tone?: "info" | "success" | "warning" | "critical") => void;
}

export const ARRIVAL_PRESETS = { low: 5, medium: 20, high: 50 } as const;

export const useApp = create<AppState>((set, get) => ({
  section: "network",
  selectedBranchId: null,
  enteredBranchId: null,
  phase: "map",
  selection: null,
  cameraMode: "orbit",
  activeCameraId: null,
  cameraRequest: null,
  followOrderId: null,
  cctvLayout: 4,
  cctvOpen: false,
  xray: false,
  showPaths: false,
  speed: 2,
  paused: false,
  arrivalPreset: "medium",
  tick: 0,
  // Phones start with every side panel folded so the map or twin gets the screen (the app is client-only).
  panels: typeof window !== "undefined" && window.innerWidth < 768 ? { left: false, right: false, bottom: false } : { left: true, right: true, bottom: true },
  graphics: "balanced",
  user: DEMO_USERS[1],
  regionFilter: null,
  statusFilter: null,
  search: "",
  toast: null,

  setSection: (section) => {
    const s = get();
    if (TWIN_SECTIONS.includes(section) && !s.enteredBranchId) {
      // Twin modules need a restaurant — open the selected (or first demo) branch.
      set({ section });
      return;
    }
    if (MAP_SECTIONS.includes(section) && s.enteredBranchId) {
      // Network-level views live on the map: leave the restaurant first.
      s.exitToMap();
      set({ section });
      return;
    }
    set({ section, cctvOpen: section === "cameras" ? true : s.cctvOpen && TWIN_SECTIONS.includes(section) });
  },
  selectBranch: (id) => set({ selectedBranchId: id, selection: id ? { kind: "branch", id } : null }),
  enterBranch: (id) =>
    set({ selectedBranchId: id, enteredBranchId: id, phase: "flying", selection: null, cameraMode: "orbit", activeCameraId: null, followOrderId: null, section: TWIN_SECTIONS.includes(get().section) ? get().section : "twin" }),
  setPhase: (phase) => set({ phase }),
  exitToMap: () => set({ enteredBranchId: null, phase: "map", section: "network", selection: get().selectedBranchId ? { kind: "branch", id: get().selectedBranchId! } : null, cctvOpen: false, followOrderId: null }),
  select: (selection) => set({ selection }),
  setCameraMode: (cameraMode) => set({ cameraMode, followOrderId: cameraMode === "follow" ? get().followOrderId : null, activeCameraId: cameraMode === "cctv" ? get().activeCameraId : null }),
  useVirtualCamera: (id) => set({ activeCameraId: id, cameraMode: id ? "cctv" : "orbit", followOrderId: null, selection: id ? { kind: "camera", id } : get().selection }),
  requestCamera: (r) => set({ cameraRequest: { ...r, nonce: (get().cameraRequest?.nonce ?? 0) + 1 }, cameraMode: "focus", activeCameraId: null }),
  followOrder: (id) => set({ followOrderId: id, cameraMode: id ? "follow" : "orbit", selection: id ? { kind: "order", id } : get().selection }),
  setCctv: (cctvOpen, layout) => set({ cctvOpen, cctvLayout: layout ?? get().cctvLayout }),
  toggle: (k) => set({ [k]: !get()[k] } as Pick<AppState, typeof k>),
  setSpeed: (speed) => set({ speed, paused: false }),
  setPaused: (paused) => set({ paused }),
  setArrivalPreset: (arrivalPreset) => set({ arrivalPreset }),
  bumpTick: () => set({ tick: get().tick + 1 }),
  togglePanel: (p) => set({ panels: { ...get().panels, [p]: !get().panels[p] } }),
  setGraphics: (graphics) => set({ graphics }),
  setUser: (id) => set({ user: DEMO_USERS.find((u) => u.id === id) ?? DEMO_USERS[1] }),
  setFilters: (f) => set(f),
  notify: (text, tone = "info") => set({ toast: { id: Date.now(), text, tone } }),
}));
