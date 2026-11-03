"use client";

import { useState } from "react";

const KEY = "ops.cameras.onboarded.v1";
const TIPS = [
  { title: "Worst camera first", body: "The grid sorts itself: whatever needs you most is top-left. Green means running right, amber means watch, red means act now." },
  { title: "Tap any camera", body: "One tap opens the zone with its numbers, the last hour on a timeline, and the alerts that matter. Scrub the timeline to replay any moment." },
  { title: "Every alert tells you what to do", body: "Cause in one line, action in one line. Acknowledge to take it in hand; alerts clear themselves when the problem passes." },
];

export function onboardingDue() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) !== "done";
  } catch {
    return false;
  }
}

/** First-open coach marks: three short cards, dismissible, never shown again. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const finish = () => {
    try {
      window.localStorage.setItem(KEY, "done");
    } catch {
      /* not persisted */
    }
    onDone();
  };
  const tip = TIPS[i];
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-4 md:items-center" role="dialog" aria-label="How the cameras work">
      <div className="cam-panel cam-slide-in w-full max-w-sm p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cam-muted)]">
          {i + 1} of {TIPS.length}
        </div>
        <div className="mt-1 text-[16px] font-semibold">{tip.title}</div>
        <p className="mt-2 text-[13px] leading-relaxed text-white/80">{tip.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={finish} className="h-11 px-2 text-[13px] text-white/55 hover:text-white">
            Skip
          </button>
          <button type="button" onClick={() => (i + 1 < TIPS.length ? setI(i + 1) : finish())} className="h-11 rounded-lg bg-[var(--accent)] px-5 text-[13px] font-semibold text-white">
            {i + 1 < TIPS.length ? "Next" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
