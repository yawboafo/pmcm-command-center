"use client";

import { create } from "zustand";
import { introPrefs } from "@/lib/auth/gate";

export type LaunchPhase = "intro" | "gate" | "unlock" | "app";
export type QualityTier = "cinema" | "standard" | "lite" | "none";

interface LaunchState {
  phase: LaunchPhase;
  /** Seconds into the intro (drives the camera path, lights, overlays and score). */
  t: number;
  muted: boolean;
  /** Audio is allowed only after a user gesture. */
  audioUnlocked: boolean;
  tier: QualityTier;
  setPhase: (p: LaunchPhase) => void;
  setT: (t: number) => void;
  setMuted: (b: boolean) => void;
  setAudioUnlocked: (b: boolean) => void;
  setTier: (q: QualityTier) => void;
}

export const useLaunch = create<LaunchState>((set) => ({
  phase: "intro",
  t: 0,
  muted: typeof window !== "undefined" ? introPrefs.muted() : false,
  audioUnlocked: false,
  tier: "standard",
  setPhase: (phase) => set({ phase }),
  setT: (t) => set({ t }),
  setMuted: (muted) => {
    introPrefs.setMuted(muted);
    set({ muted });
  },
  setAudioUnlocked: (audioUnlocked) => set({ audioUnlocked }),
  setTier: (tier) => set({ tier }),
}));

/**
 * Quality tier from the device: "cinema" adds chromatic aberration at full pixel ratio,
 * "standard" keeps bloom, grain and vignette, "lite" drops post-processing, "none" skips the
 * scene entirely (no WebGL, reduced motion, very low memory, or an explicit ?intro=none flag):
 * the gate then sits on a plain dark background and the intro is not played.
 */
export function detectTier(): QualityTier {
  if (typeof window === "undefined") return "standard";
  const q = new URLSearchParams(window.location.search).get("intro");
  if (q === "none" || q === "cinema" || q === "standard" || q === "lite") return q;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 8;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = document.createElement("canvas").getContext("webgl2") as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl || reduced) return "none";
  if (mem <= 2 || cores <= 2) return "none";
  if (coarse || mem <= 4 || cores <= 4) return "lite";
  if (coarse || cores <= 6) return "standard";
  return "cinema";
}
