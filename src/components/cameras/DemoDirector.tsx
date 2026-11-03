"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BranchSimulation } from "@/lib/sim/engine";
import { runScenario } from "@/lib/sim/scenarios";
import { useApp } from "@/store/app";
import { useFeed } from "./feedStore";

/**
 * Demo mode: the two-minute "lunch rush" story. Each step narrates what is happening while
 * the simulation does it for real — the rush builds, the counter alert fires, the camera
 * opens, the replay shows the cause, the recommended action is taken and the alert clears.
 */
interface Step {
  title: string;
  body: string;
  /** Runs when the step starts. */
  enter?: (sim: BranchSimulation) => void;
  /** Step ends when this returns true, or after maxSec. */
  until?: (sim: BranchSimulation) => boolean;
  maxSec: number;
}

const STEPS: Step[] = [
  {
    title: "The rush builds",
    body: "It is lunchtime at East Legon. Seven walk-ins and five app orders land in the same two minutes. Watch the front counter card: the queue count climbs and the card turns amber.",
    enter: (sim) => {
      useFeed.getState().openZone(null);
      useApp.getState().setArrivalPreset("high");
      runScenario(sim, "lunch-rush");
    },
    until: (sim) => sim.alerts.some((a) => a.kind === "queue-long" && a.status === "open"),
    maxSec: 110,
  },
  {
    title: "The alert fires",
    body: "Queue building at the counter. The card goes red and the alert says why in one line — and what to do in the next.",
    until: () => false,
    maxSec: 5,
  },
  {
    title: "Chris opens the camera",
    body: "One tap. The feed shows every person in the queue with how long they have waited; the numbers beside it show tills staffed and the longest wait against yesterday.",
    enter: () => useFeed.getState().openZone("front-counter"),
    until: () => false,
    maxSec: 7,
  },
  {
    title: "Replay the cause",
    body: "Jump to the moment: 15 seconds before the alert the queue was already seven deep with one till covering it. The scene and the numbers rewind together.",
    enter: (sim) => {
      const a = sim.alerts.find((x) => x.kind === "queue-long" && x.status !== "resolved") ?? sim.alerts.find((x) => x.kind === "queue-long");
      const at = a ? (a.openedAt - sim.clockStart) / 1000 : sim.t - 20;
      const from = Math.max(sim.history[0]?.t ?? 0, at - 15);
      useFeed.getState().setReplay({ t: from, playing: true, speed: 1, clip: { from, to: Math.min(sim.t - 1, at + 5), label: "Queue building — 15 s before the alert" } });
    },
    until: () => false,
    maxSec: 22,
  },
  {
    title: "Take the action",
    body: "Back to live. The recommended action is to open a second till. One tap moves a packer to the counter; the alert is acknowledged and in hand.",
    enter: (sim) => {
      useFeed.getState().goLive();
      const name = sim.coverStation("order-counter");
      const a = sim.alerts.find((x) => x.kind === "queue-long" && x.status === "open");
      if (a) sim.acknowledgeAlert(a.id, "Chris");
      useApp.getState().notify(name ? `${name.split(" ")[0]} moved to the till` : "No spare staff to move", name ? "success" : "warning");
    },
    until: () => false,
    maxSec: 8,
  },
  {
    title: "The queue clears",
    body: "Two tills now. The queue drains, the longest wait falls, and when the condition has passed the alert closes itself and the card turns green. Nothing to tidy up.",
    enter: () => useApp.getState().setArrivalPreset("medium"),
    until: (sim) => !sim.alerts.some((a) => a.kind === "queue-long" && a.status !== "resolved"),
    maxSec: 150,
  },
];

export default function DemoDirector({ sim, onClose }: { sim: BranchSimulation; onClose: () => void }) {
  const [i, setI] = useState(0);
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  // Each step runs its entry action once; a timer then watches for the step's end condition.
  useEffect(() => {
    if (i >= STEPS.length) return;
    startedAt.current = sim.t;
    STEPS[i].enter?.(sim);
    const step = STEPS[i];
    const timer = setInterval(() => {
      const e = sim.t - startedAt.current;
      setElapsed(e);
      if ((step.until?.(sim) && e > 2) || e >= step.maxSec) setI((k) => k + 1);
    }, 250);
    return () => clearInterval(timer);
  }, [i, sim]);
  useEffect(() => {
    if (i >= STEPS.length) {
      sim.restoreRoles();
      const t = setTimeout(onClose, 6000);
      return () => clearTimeout(t);
    }
  }, [i, sim, onClose]);

  const step = STEPS[Math.min(i, STEPS.length - 1)];
  const done = i >= STEPS.length;
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 p-3 md:left-1/2 md:w-[min(720px,calc(100%-2rem))] md:-translate-x-1/2">
      <div className="cam-panel cam-slide-in flex items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cam-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> Demo story · lunch rush
            <span className="ml-auto flex gap-1">
              {STEPS.map((_, k) => (
                <span key={k} className={`h-1 w-5 rounded ${k < i ? "bg-white/70" : k === i ? "bg-[var(--accent)]" : "bg-white/15"}`} />
              ))}
            </span>
          </div>
          <div className="mt-1 text-[16px] font-semibold">{done ? "Story complete" : step.title}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-white/80">{done ? "Grid → camera → alert → replay → action: three taps end to end. Everything you saw came from one simulation state." : step.body}</p>
          {!done && <div className="mt-2 h-0.5 w-full rounded bg-white/10"><div className="h-0.5 rounded bg-white/50 transition-[width] duration-500" style={{ width: `${Math.min(100, (elapsed / step.maxSec) * 100)}%` }} /></div>}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button type="button" onClick={onClose} aria-label="Stop demo" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
          {!done && (
            <button type="button" onClick={() => setI(i + 1)} className="h-9 rounded-lg px-2 font-mono text-[11px] text-white/60 hover:bg-white/10 hover:text-white">
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
