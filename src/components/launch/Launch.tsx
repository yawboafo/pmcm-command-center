"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LAUNCH } from "@/config/launch";
import { gate as makeGate, introForced, introPrefs } from "@/lib/auth/gate";
import { demoBranchIds } from "@/lib/network/branches";
import { sims } from "@/store/sims";
import { launchAudio } from "./audio";
import Gate from "./Gate";
import IntroOverlay from "./IntroOverlay";
import { detectTier, useLaunch, type LaunchPhase } from "./launchStore";

const LaunchScene = dynamic(() => import("./LaunchScene"), { ssr: false });

/**
 * Launch flow: cold launch → cinematic intro → access gate → app (or gate → intro → app when
 * `LAUNCH.intro.when` is "after-login"). The intro is skippable after 3 s and can be turned
 * off per device; `?intro=play` forces it. A valid session skips the gate; sign-out clears it.
 */
type Step = "intro" | "gate" | "unlock" | "app";

function plan(): Step[] {
  const forced = typeof window !== "undefined" && introForced();
  const intro = LAUNCH.intro.enabled && (forced || !introPrefs.skipOnLaunch());
  const signedIn = makeGate().sessionValid();
  const steps: Step[] = [];
  if (LAUNCH.intro.when === "before-login") {
    if (intro) steps.push("intro");
    if (!signedIn) steps.push("gate");
  } else {
    if (!signedIn) steps.push("gate");
    if (intro) steps.push("intro");
  }
  steps.push("app");
  return steps;
}

export default function Launch({ children }: { children: ReactNode }) {
  const steps = useMemo(() => (typeof window === "undefined" ? ["app" as Step] : plan()), []);
  const [i, setI] = useState(0);
  const [fade, setFade] = useState(false);
  const step = steps[i];
  const setPhase = useLaunch((s) => s.setPhase);
  const tier = useLaunch((s) => s.tier);
  const setTier = useLaunch((s) => s.setTier);
  const muted = useLaunch((s) => s.muted);
  const audio = launchAudio();
  const sim = useMemo(() => (typeof window === "undefined" ? null : sims().get(demoBranchIds()[0])), []);
  const startedScene = useRef(false);

  useEffect(() => setTier(detectTier()), [setTier]);
  // Keep the store phase in step; the scene reads it every frame.
  useEffect(() => {
    const p: LaunchPhase = step === "intro" ? "intro" : step === "gate" ? "gate" : step === "unlock" ? "unlock" : "app";
    setPhase(p);
    if (step === "intro") useLaunch.getState().setT(0);
  }, [step, setPhase]);
  // Warm the world the intro flies through: a few orders so the fryers and pass are alive, the rider door in use.
  useEffect(() => {
    if (!sim || startedScene.current || step === "app") return;
    startedScene.current = true;
    sim.orderBurst(4, ["ck-wings-10", "ck-bucket-5", "pz-chicken-l"]);
    sim.queueSurge(3);
    sim.advance(60, 1e9);
    const door = sim.zoneCameras.find((c) => c.zoneId === "pickup-bay")?.doorId;
    if (door) setTimeout(() => sim.holdDoor(door, 12), 12500);
  }, [sim, step]);
  // The simulation keeps running under the launch (the app's driver takes over later).
  useEffect(() => {
    if (step === "app" || !sim) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      sims().tick(dt, 1, false);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, sim]);
  useEffect(() => audio.setMuted(muted), [muted, audio]);

  const next = useCallback(() => {
    setFade(true);
    setTimeout(() => {
      setI((k) => Math.min(steps.length - 1, k + 1));
      setFade(false);
    }, 650);
  }, [steps.length]);

  const gesture = useCallback(() => {
    const st = useLaunch.getState();
    if (st.audioUnlocked) return;
    st.setAudioUnlocked(true);
    if (st.phase === "intro") void audio.start(st.t);
  }, [audio]);

  const endIntro = useCallback(() => {
    audio.stop(1.4);
    next();
  }, [audio, next]);

  const unlocked = useCallback(() => {
    setPhase("unlock");
    audio.unlock();
    setTimeout(() => {
      setFade(true);
      setTimeout(() => {
        setI(steps.length - 1);
        setFade(false);
        audio.stop(0.8);
      }, 600);
    }, 1500);
  }, [audio, setPhase, steps.length]);

  if (step === "app") return <>{children}</>;
  const unlocking = useLaunch.getState().phase === "unlock";
  return (
    <div className="launch-root fixed inset-0 overflow-hidden bg-black text-white" data-theme="dark">
      {sim && tier !== "none" && <LaunchScene sim={sim} onIntroEnd={endIntro} />}
      {step === "intro" && <IntroOverlay onSkip={endIntro} onGesture={gesture} />}
      {step === "gate" && <Gate onUnlocked={unlocked} onDeny={() => audio.deny()} unlocking={unlocking} />}
      <div className={`pointer-events-none absolute inset-0 z-40 bg-black transition-opacity duration-700 ${fade ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
