"use client";

import { useEffect, useState } from "react";
import { LAUNCH } from "@/config/launch";
import { PLATFORM, TENANT } from "@/config/platform";
import { introPrefs } from "@/lib/auth/gate";
import { useLaunch } from "./launchStore";

const DUR = LAUNCH.intro.durationSec;

/**
 * What sits on top of the intro drawing: the veil that lifts, the title lockup (index line,
 * wordmark tracking in with a light sweep, hairline rule, tagline, viewfinder corners), chapter
 * captions, and three instrument-style controls: sound, "don't show again", skip with its
 * progress hairline. Pointer or key input anywhere unlocks audio (platform gesture rule).
 * Everything is HTML so it stays crisp on any screen and follows the app theme.
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
  const ease = 1 - Math.pow(1 - title, 3);
  const fadeIn = Math.min(1, t / 1.4);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      onGesture();
      if ((e.key === "Escape" || e.key === "Enter" || e.key === " ") && useLaunch.getState().t >= LAUNCH.intro.skipAfterSec) onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip, onGesture]);

  const live = audioUnlocked && !muted;
  return (
    <div className="launch-overlay absolute inset-0 z-20 select-none" onPointerDown={onGesture} role="presentation">
      <div className="launch-veil pointer-events-none absolute inset-0" style={{ opacity: 1 - fadeIn }} />
      <div className="launch-bar pointer-events-none absolute inset-x-0 top-0 h-[7vh]" />
      <div className="launch-bar pointer-events-none absolute inset-x-0 bottom-0 h-[7vh]" />

      {/* title lockup */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6" style={{ opacity: title }}>
        <div className="launch-title relative px-8 py-6 text-center sm:px-12 sm:py-8">
          <span className="launch-corner launch-corner-tl" style={{ transform: `translate(${(1 - ease) * -18}px, ${(1 - ease) * -14}px)` }} />
          <span className="launch-corner launch-corner-tr" style={{ transform: `translate(${(1 - ease) * 18}px, ${(1 - ease) * -14}px)` }} />
          <span className="launch-corner launch-corner-bl" style={{ transform: `translate(${(1 - ease) * -18}px, ${(1 - ease) * 14}px)` }} />
          <span className="launch-corner launch-corner-br" style={{ transform: `translate(${(1 - ease) * 18}px, ${(1 - ease) * 14}px)` }} />
          <div className="launch-eyebrow" style={{ opacity: Math.min(1, title * 1.6) }}>
            {TENANT.name} · East Legon
          </div>
          <div className="launch-wordmark launch-sweep" style={{ letterSpacing: `${0.46 - ease * 0.28}em`, transform: `translateY(${(1 - ease) * 10}px)` }}>
            {PLATFORM.name}
          </div>
          <div className="launch-rule mx-auto" style={{ transform: `scaleX(${ease})` }} />
          <div className="launch-tagline" style={{ opacity: Math.max(0, title - 0.4) / 0.6 }}>
            {PLATFORM.tagline}
          </div>
        </div>
      </div>

      <Caption t={t} />

      {/* sound */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onGesture();
          setMuted(!muted);
        }}
        className="launch-ctl absolute bottom-[9vh] left-5 z-30"
        aria-label={muted ? "Sound off" : "Sound on"}
        aria-pressed={!muted}
      >
        <span className={`launch-meter ${live ? "is-live" : ""}`} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="hidden sm:inline">{muted ? "Sound off" : audioUnlocked ? "Sound on" : "Tap for sound"}</span>
      </button>

      {/* don't show again + skip */}
      <div className={`absolute bottom-[9vh] right-5 z-30 flex items-center gap-2 transition-opacity duration-500 ${canSkip ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <label className="launch-ctl launch-ctl-quiet hidden cursor-pointer sm:inline-flex">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => {
              setDontShow(e.target.checked);
              introPrefs.setSkipOnLaunch(e.target.checked);
            }}
            className="sr-only"
          />
          <span className="launch-check" data-on={dontShow ? "1" : undefined} aria-hidden />
          Don&apos;t show again
        </label>
        <button type="button" onClick={(e) => (e.stopPropagation(), onSkip())} className="launch-ctl launch-ctl-skip" aria-label="Skip intro">
          Skip
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2.5 3l4 4-4 4M7.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="launch-ctl-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
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
  const i = CAPTIONS.findIndex(([a, b]) => t >= a && t < b);
  if (i < 0) return null;
  const c = CAPTIONS[i];
  const k = Math.min(1, (t - c[0]) / 0.5) * Math.min(1, (c[1] - t) / 0.4);
  return (
    <div className="launch-caption pointer-events-none absolute left-5 top-[9.5vh] sm:left-8" style={{ opacity: k, transform: `translateY(${(1 - k) * 6}px)` }}>
      <span className="launch-caption-index">0{i + 1}</span>
      <span className="launch-caption-rule" />
      {c[2]}
    </div>
  );
}
