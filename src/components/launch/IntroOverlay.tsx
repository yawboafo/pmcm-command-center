"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { LAUNCH } from "@/config/launch";
import { PLATFORM, TENANT } from "@/config/platform";
import { introPrefs } from "@/lib/auth/gate";
import { useLaunch } from "./launchStore";

const DUR = LAUNCH.intro.durationSec;

/**
 * What sits on top of the intro world: the fade from black, the title that resolves with a
 * light sweep, the Skip control with its progress ring (after 3 s), the sound toggle and
 * "Don't show again". Pointer or key input anywhere unlocks audio (platform gesture rule).
 */
export default function IntroOverlay({ onSkip, onGesture }: { onSkip: () => void; onGesture: () => void }) {
  const t = useLaunch((s) => s.t);
  const muted = useLaunch((s) => s.muted);
  const setMuted = useLaunch((s) => s.setMuted);
  const audioUnlocked = useLaunch((s) => s.audioUnlocked);
  const [dontShow, setDontShow] = useState(() => introPrefs.skipOnLaunch());
  const canSkip = t >= LAUNCH.intro.skipAfterSec;
  const progress = Math.min(1, t / (DUR + 1));
  const title = Math.max(0, Math.min(1, (t - (DUR - 1.6)) / 1.2));
  const fadeIn = Math.min(1, t / 1.4);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      onGesture();
      if ((e.key === "Escape" || e.key === "Enter" || e.key === " ") && useLaunch.getState().t >= LAUNCH.intro.skipAfterSec) onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip, onGesture]);

  const R = 17;
  const C = 2 * Math.PI * R;
  return (
    <div className="launch-overlay absolute inset-0 z-20 select-none" onPointerDown={onGesture} role="presentation">
      {/* fade from black */}
      <div className="pointer-events-none absolute inset-0 bg-black transition-none" style={{ opacity: 1 - fadeIn }} />
      {/* letterbox */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[7vh] bg-black" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[7vh] bg-black" />

      {/* title */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center px-6 text-center" style={{ opacity: title }}>
        <div className="launch-sweep font-display text-[clamp(30px,6.2vw,76px)] font-extrabold tracking-[-0.03em] text-white" style={{ transform: `translateY(${(1 - title) * 18}px)` }}>
          {PLATFORM.name}
        </div>
        <div className="mt-3 font-mono text-[clamp(10px,1.3vw,13px)] uppercase tracking-[0.42em] text-white/60" style={{ opacity: Math.max(0, title - 0.35) / 0.65 }}>
          {PLATFORM.tagline} · {TENANT.name}
        </div>
        <div className="mt-6 h-px w-24 bg-gradient-to-r from-transparent via-white/60 to-transparent" style={{ transform: `scaleX(${title})` }} />
      </div>

      {/* chapter captions, lower-third, instrument style */}
      <Caption t={t} />

      {/* sound */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onGesture();
          setMuted(!muted);
        }}
        className="absolute bottom-[9vh] left-5 z-30 flex h-11 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur hover:text-white"
        aria-label={muted ? "Sound off" : "Sound on"}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <span className="hidden sm:inline">{muted ? "Sound off" : audioUnlocked ? "Sound on" : "Tap for sound"}</span>
      </button>

      {/* skip + don't show again */}
      <div className={`absolute bottom-[9vh] right-5 z-30 flex items-center gap-3 transition-opacity duration-500 ${canSkip ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <label className="hidden cursor-pointer items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/55 hover:text-white sm:flex">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => {
              setDontShow(e.target.checked);
              introPrefs.setSkipOnLaunch(e.target.checked);
            }}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Don&apos;t show again
        </label>
        <button type="button" onClick={(e) => (e.stopPropagation(), onSkip())} className="flex h-11 items-center gap-2 rounded-full border border-white/20 bg-black/40 pl-3 pr-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/85 backdrop-blur hover:border-white/40 hover:text-white" aria-label="Skip intro">
          Skip
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
            <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
            <circle cx="20" cy="20" r={R} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 20 20)" />
            <path d="M15 13.5 L24 20 L15 26.5 Z" fill="rgba(255,255,255,0.9)" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const CAPTIONS: Array<[number, number, string]> = [
  [1.2, 4.5, "Digital twin · East Legon"],
  [4.7, 6.6, "Kitchen line"],
  [6.8, 8.4, "Front counter · queue"],
  [8.6, 10, "Dining"],
  [10.2, 12.2, "Rider bay · live instruments"],
];

function Caption({ t }: { t: number }) {
  const c = CAPTIONS.find(([a, b]) => t >= a && t < b);
  if (!c) return null;
  const k = Math.min(1, (t - c[0]) / 0.5) * Math.min(1, (c[1] - t) / 0.4);
  return (
    <div className="pointer-events-none absolute left-5 top-[9.5vh] flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-white/70 sm:left-8" style={{ opacity: k, transform: `translateY(${(1 - k) * 6}px)` }}>
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
      {c[2]}
    </div>
  );
}
