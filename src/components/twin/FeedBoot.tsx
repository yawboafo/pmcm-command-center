"use client";

import { useEffect, useRef, useState } from "react";
import { clockSec } from "@/lib/format";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

/** Seconds into the sequence at which each check completes, then the static clears. */
const STEPS = [0.35, 0.75, 1.15, 1.55];
const CLEAR_AT = 1.9;
const DONE_AT = 2.6;

/**
 * Branch entry styled as a surveillance feed coming online: static and scanlines while the
 * link is "established", a checklist of what actually loaded (floor plan, simulation clock,
 * sensors, cameras), then the picture resolves. Always labelled as a simulated feed — this
 * is the 3D twin, not CCTV.
 */
export default function FeedBoot({ branchId }: { branchId: string }) {
  const phase = useApp((s) => s.phase);
  const setPhase = useApp((s) => s.setPhase);
  const setCameraMode = useApp((s) => s.setCameraMode);
  const active = phase === "exterior" || phase === "entering";
  const [t, setT] = useState(0);
  const noise = useRef<HTMLCanvasElement>(null);

  // One clock drives the checklist, the static and the final fade.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const ctx = noise.current?.getContext("2d");
    const img = ctx?.createImageData(160, 90);
    const loop = (now: number) => {
      const s = (now - start) / 1000;
      setT(s);
      if (ctx && img && s < CLEAR_AT + 0.4) {
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          // Dark, slightly cool sensor noise rather than bright TV snow.
          const v = Math.random() * 110;
          d[i] = v * 0.85;
          d[i + 1] = v * 0.95;
          d[i + 2] = v;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      if (s < DONE_AT + 0.2) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  const sim = sims().peek(branchId);
  const b = BRANCH_BY_ID.get(branchId);
  const checks = [
    `Floor plan · Model ${sim?.plan.format ?? "?"} (conceptual layout)`,
    `Simulation synced · ${clockSec(sims().clock)} GMT`,
    `Sensors ${sim?.plan.sensors.length ?? 0} · equipment ${sim?.plan.equipment.length ?? 0}`,
    `Virtual cameras ${sim?.plan.cameras.length ?? 0} · feed locked`,
  ];
  // Near-opaque while connecting (the scene shows through more as checks pass), then clears.
  const staticOpacity = t < CLEAR_AT ? 0.97 - Math.min(0.3, t * 0.16) : Math.max(0, 0.67 - (t - CLEAR_AT) * 1.6);
  const panelOpacity = t < CLEAR_AT ? 1 : Math.max(0, 1 - (t - CLEAR_AT) / (DONE_AT - CLEAR_AT));
  const locked = t >= STEPS[STEPS.length - 1];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {/* Static, scanlines and a rolling bar, fading out as the link locks. */}
      <canvas ref={noise} width={160} height={90} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" style={{ opacity: staticOpacity }} />
      <div className="absolute inset-0" style={{ opacity: panelOpacity * 0.6, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 3px)" }} />
      <div className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-white/[0.06] to-transparent" style={{ top: `${((t * 55) % 120) - 20}%`, opacity: panelOpacity }} />

      {/* Corner brackets of a camera frame. */}
      <div className="absolute inset-4" style={{ opacity: Math.max(panelOpacity, 0.35) }}>
        {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((k) => (
          <span key={k} className={`absolute h-8 w-8 border-white/70 ${k}`} />
        ))}
      </div>

      <div className="absolute left-8 top-8 rounded-md bg-black/55 px-3 py-2 font-mono text-[11px] text-white/85" style={{ opacity: panelOpacity }}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${locked ? "bg-emerald-400" : "animate-pulse bg-red-500"}`} />
          <span className="tracking-[0.2em]">{locked ? "FEED LOCKED" : "ESTABLISHING LINK"}</span>
        </div>
        <div className="mt-1 text-white/45">
          {`PMCM // ${b?.name.toUpperCase() ?? ""} // OVERVIEW · SIMULATED FEED`}
        </div>
      </div>

      <div className="absolute bottom-10 left-8 w-[min(400px,calc(100%-4rem))] rounded-lg bg-black/55 p-4 font-mono text-[11px]" style={{ opacity: panelOpacity }}>
        <div className="text-[10px] uppercase tracking-[0.25em] text-brand-yellow">Pizzaman Chickenman · {b?.region}</div>
        <div className="mb-3 mt-1 font-display text-3xl font-extrabold tracking-tight text-white">{b?.name}</div>
        <ol className="space-y-1">
          {checks.map((c, i) => {
            const done = t >= STEPS[i];
            const doing = !done && (i === 0 || t >= STEPS[i - 1]);
            return (
              <li key={c} className={done ? "text-white/80" : doing ? "text-white/55" : "text-white/20"}>
                <span className={`mr-2 inline-block w-12 whitespace-pre ${done ? "text-emerald-300" : "text-white/35"}`}>{done ? "[ OK ]" : doing ? "[ .. ]" : "[    ]"}</span>
                {c}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-px w-full bg-white/10">
          <div className="h-px bg-emerald-400/80" style={{ width: `${Math.min(100, (t / STEPS[STEPS.length - 1]) * 100)}%` }} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => (setPhase("inside"), setCameraMode("dollhouse"))}
        className="glass pointer-events-auto absolute bottom-10 right-8 rounded-lg px-4 py-2 font-mono text-[11px] tracking-wider text-white hover:bg-white/10"
        style={{ opacity: Math.max(panelOpacity, 0.6) }}
      >
        SKIP ›
      </button>
    </div>
  );
}
