"use client";

import { create } from "zustand";
import type { EquipmentType, FloorPlan, FurnitureType } from "@/lib/floorplan/types";
import { plans } from "@/store/sims";
import { recompute, type SelItem } from "./model";

export type EditorMode =
  | { kind: "select" }
  | { kind: "add-door" }
  | { kind: "add-window" }
  | { kind: "add-camera" }
  | { kind: "add-sensor" }
  | { kind: "place-equipment"; type: EquipmentType }
  | { kind: "place-furniture"; type: FurnitureType };

export type LayerKey = "zones" | "equipment" | "furniture" | "cameras" | "sensors" | "paths" | "navgrid" | "dimensions" | "issues";

interface EditorState {
  branchId: string | null;
  draft: FloorPlan | null;
  baseline: FloorPlan | null;
  undoStack: FloorPlan[];
  redoStack: FloorPlan[];
  selection: SelItem[];
  mode: EditorMode;
  snapStep: number;
  layers: Record<LayerKey, boolean>;
  dirty: boolean;
  view: "2d" | "split" | "3d";
  /** Bumps when the canvas should fit the plan into view. */
  fitNonce: number;
  /** World point the canvas should centre on (issue click). */
  focus: { x: number; z: number; nonce: number } | null;

  load: (branchId: string) => void;
  replaceDraft: (plan: FloorPlan, dirty?: boolean) => void;
  /** Apply an edit. `undo:false` is used for intermediate drag frames after `checkpoint()`. */
  mutate: (fn: (p: FloorPlan) => void, opts?: { undo?: boolean; walls?: boolean }) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setSelection: (s: SelItem[]) => void;
  toggleSelection: (s: SelItem) => void;
  setMode: (m: EditorMode) => void;
  setSnap: (n: number) => void;
  toggleLayer: (k: LayerKey) => void;
  setView: (v: "2d" | "split" | "3d") => void;
  markSaved: () => void;
  fit: () => void;
  focusOn: (x: number, z: number) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  branchId: null,
  draft: null,
  baseline: null,
  undoStack: [],
  redoStack: [],
  selection: [],
  mode: { kind: "select" },
  snapStep: 0.1,
  layers: { zones: true, equipment: true, furniture: true, cameras: true, sensors: false, paths: true, navgrid: false, dimensions: true, issues: true },
  dirty: false,
  view: "split",
  fitNonce: 0,
  focus: null,

  load: (branchId) => {
    const plan = plans().get(branchId);
    set({ branchId, draft: plan, baseline: structuredClone(plan), undoStack: [], redoStack: [], selection: [], dirty: false, mode: { kind: "select" }, fitNonce: get().fitNonce + 1 });
  },
  replaceDraft: (plan, dirty = true) => {
    const cur = get().draft;
    set({ draft: plan, undoStack: cur ? [...get().undoStack, cur].slice(-100) : get().undoStack, redoStack: [], selection: [], dirty, fitNonce: get().fitNonce + 1 });
  },
  mutate: (fn, opts = {}) => {
    const cur = get().draft;
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    recompute(next, { walls: opts.walls ?? false });
    set({
      draft: next,
      dirty: true,
      undoStack: opts.undo === false ? get().undoStack : [...get().undoStack, cur].slice(-100),
      redoStack: opts.undo === false ? get().redoStack : [],
    });
  },
  checkpoint: () => {
    const cur = get().draft;
    if (cur) set({ undoStack: [...get().undoStack, cur].slice(-100), redoStack: [] });
  },
  undo: () => {
    const { undoStack, draft } = get();
    if (!undoStack.length || !draft) return;
    set({ draft: undoStack[undoStack.length - 1], undoStack: undoStack.slice(0, -1), redoStack: [...get().redoStack, draft], dirty: true });
  },
  redo: () => {
    const { redoStack, draft } = get();
    if (!redoStack.length || !draft) return;
    set({ draft: redoStack[redoStack.length - 1], redoStack: redoStack.slice(0, -1), undoStack: [...get().undoStack, draft], dirty: true });
  },
  setSelection: (selection) => set({ selection }),
  toggleSelection: (s) => {
    const sel = get().selection;
    set({ selection: sel.some((x) => x.id === s.id && x.kind === s.kind) ? sel.filter((x) => !(x.id === s.id && x.kind === s.kind)) : [...sel, s] });
  },
  setMode: (mode) => set({ mode }),
  setSnap: (snapStep) => set({ snapStep }),
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setView: (view) => set({ view }),
  markSaved: () => set({ dirty: false, baseline: structuredClone(get().draft) }),
  fit: () => set({ fitNonce: get().fitNonce + 1 }),
  focusOn: (x, z) => set({ focus: { x, z, nonce: (get().focus?.nonce ?? 0) + 1 } }),
}));
