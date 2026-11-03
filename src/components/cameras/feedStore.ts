"use client";

import * as THREE from "three";
import { create } from "zustand";
import type { ZoneId } from "@/lib/sim/zones";

/**
 * Feed registry: any DOM element can become a camera viewport. The twin's renderer reads the
 * registered elements every frame, renders the zone camera into exactly that rectangle of the
 * one WebGL canvas, and publishes the camera it used so HTML overlays can project 3D points
 * onto the tile. Registrations are module-level (no React state) because they change with
 * layout, not with data.
 */
export interface TileReg {
  el: HTMLElement;
  zoneId: ZoneId;
}

export interface TileFrame {
  camera: THREE.PerspectiveCamera;
  /** CSS pixel rectangle of the tile within the canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wall-clock ms of the last render. */
  at: number;
}

const tiles = new Map<string, TileReg>();
const frames = new Map<string, TileFrame>();
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __opsFeed?: unknown }).__opsFeed = { tiles, frames };
const captures = new Map<string, Array<(dataUrl: string) => void>>();
let tilesVersion = 0;

export function registerTile(id: string, reg: TileReg) {
  tiles.set(id, reg);
  tilesVersion++;
  return () => {
    tiles.delete(id);
    frames.delete(id);
    tilesVersion++;
  };
}

/** Wall-clock ms between refreshes of one tile, as measured by the renderer (round-robin ÷ frame rate). */
let refreshMs = 1000;

export const tileRegistry = {
  all: () => tiles,
  version: () => tilesVersion,
  frame: (id: string) => frames.get(id),
  setFrame: (id: string, f: TileFrame) => frames.set(id, f),
  setRefreshMs: (ms: number) => (refreshMs = ms),
  refreshMs: () => refreshMs,
  /** Ask the renderer for a JPEG of the tile at its next render. */
  capture: (id: string, cb: (dataUrl: string) => void) => {
    const list = captures.get(id) ?? [];
    list.push(cb);
    captures.set(id, list);
  },
  takeCaptures: (id: string) => {
    const list = captures.get(id);
    if (list) captures.delete(id);
    return list ?? [];
  },
};

const v = new THREE.Vector3();

/** Project a world point onto a tile. Returns tile-local CSS pixels, depth (0 near … 1 far) and whether it is in frame. */
export function projectToTile(id: string, x: number, y: number, z: number): { x: number; y: number; depth: number; visible: boolean } | null {
  const f = frames.get(id);
  if (!f) return null;
  v.set(x, y, z).project(f.camera);
  const visible = v.z > -1 && v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15;
  return { x: ((v.x + 1) / 2) * f.w, y: ((1 - v.y) / 2) * f.h, depth: (v.z + 1) / 2, visible };
}

export type Layer = "people" | "queue" | "tickets" | "heat" | "doors";
export const LAYER_LABEL: Record<Layer, string> = { people: "People", queue: "Queue", tickets: "Orders", heat: "Heat map", doors: "Doors & temps" };

export interface Replay {
  /** Sim seconds being viewed; null = live. */
  t: number | null;
  playing: boolean;
  speed: 1 | 4 | 16;
  /** Optional clip bounds (sim seconds) the playhead loops inside. */
  clip: { from: number; to: number; label: string } | null;
}

interface FeedState {
  view: "grid" | "zone";
  zoneId: ZoneId | null;
  layers: Record<Layer, boolean>;
  replay: Replay;
  autoRotate: boolean;
  /** Measured canvas frame rate (updated once a second by the renderer). */
  fps: number;
  /** Crossfade trigger: increments whenever the zone screen switches camera. */
  switchNonce: number;
  openZone: (z: ZoneId | null) => void;
  setView: (v: "grid" | "zone") => void;
  toggleLayer: (l: Layer) => void;
  setReplay: (r: Partial<Replay>) => void;
  goLive: () => void;
  setAutoRotate: (b: boolean) => void;
  setFps: (n: number) => void;
}

const LAYERS_KEY = "ops.cameras.layers.v1";
function storedLayers(): Record<Layer, boolean> {
  const def: Record<Layer, boolean> = { people: true, queue: true, tickets: true, heat: false, doors: true };
  if (typeof window === "undefined") return def;
  try {
    return { ...def, ...JSON.parse(window.localStorage.getItem(LAYERS_KEY) ?? "{}") };
  } catch {
    return def;
  }
}

export const useFeed = create<FeedState>((set, get) => ({
  view: "grid",
  zoneId: null,
  layers: storedLayers(),
  replay: { t: null, playing: false, speed: 1, clip: null },
  autoRotate: false,
  fps: 0,
  switchNonce: 0,
  openZone: (zoneId) => set({ zoneId, view: zoneId ? "zone" : "grid", switchNonce: get().switchNonce + 1, replay: { t: null, playing: false, speed: 1, clip: null } }),
  setView: (view) => set({ view, replay: view === "grid" ? { t: null, playing: false, speed: 1, clip: null } : get().replay }),
  toggleLayer: (l) => {
    const layers = { ...get().layers, [l]: !get().layers[l] };
    try {
      window.localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      /* not persisted */
    }
    set({ layers });
  },
  setReplay: (r) => set({ replay: { ...get().replay, ...r } }),
  goLive: () => set({ replay: { t: null, playing: false, speed: 1, clip: null } }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setFps: (fps) => set({ fps }),
}));
