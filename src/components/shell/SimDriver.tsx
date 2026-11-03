"use client";

import { useEffect } from "react";
import { startLiveTelemetry } from "@/lib/integration/liveClient";
import { ARRIVAL_PRESETS, useApp } from "@/store/app";
import { sims } from "@/store/sims";

/**
 * Single animation-frame loop that advances the shared simulation clock and
 * every running branch simulation, then publishes a throttled tick (≈4 Hz)
 * so React panels refresh without re-rendering at 60 fps.
 */
export default function SimDriver() {
  const preset = useApp((s) => s.arrivalPreset);

  useEffect(() => {
    sims().setArrivalRate(ARRIVAL_PRESETS[preset]);
  }, [preset]);

  // Live device telemetry (if any devices are bound and reporting).
  useEffect(() => startLiveTelemetry(), []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let sinceTick = 0;
    const loop = (now: number) => {
      // Clamp to avoid a huge catch-up after the tab was backgrounded.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { paused, speed } = useApp.getState();
      sims().tick(dt, speed, paused);
      sinceTick += dt;
      if (sinceTick >= 0.25) {
        sinceTick = 0;
        useApp.getState().bumpTick();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}
