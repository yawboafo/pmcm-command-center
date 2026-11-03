"use client";

import { useEffect, useRef, useState } from "react";
import { LAUNCH } from "@/config/launch";
import { useLaunch } from "./launchStore";

/**
 * Pre-rendered fallback for devices that cannot run the real-time intro. Drives the same
 * timeline (`t`) from the video's clock so the overlay, captions and skip ring stay in sync.
 * If the file is missing the intro is skipped.
 */
export default function IntroVideo({ onEnd }: { onEnd: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const muted = useLaunch((s) => s.muted);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (failed) onEnd();
  }, [failed, onEnd]);
  return (
    <video
      ref={video}
      src={LAUNCH.intro.fallbackVideo}
      autoPlay
      muted={muted}
      playsInline
      preload="auto"
      onTimeUpdate={(e) => useLaunch.getState().setT(e.currentTarget.currentTime)}
      onEnded={onEnd}
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
