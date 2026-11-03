"use client";

import { useEffect, useRef, useState } from "react";
import { LiveBadge, SimDeviceBadge } from "@/components/ui/primitives";

/**
 * MJPEG camera player (multipart/x-mixed-replace in an <img>), streamed through
 * /api/cameras/{id}/mjpeg so the gateway address stays server-side. Simulated cameras
 * (scripts/camera-sim.ts) are labelled SIM CAMERA — never LIVE — and framed in the
 * SIM DEVICE colour; their video is a synthetic test pattern.
 */
export default function MjpegCameraPlayer({ cameraId, name, virtual, className }: { cameraId: string; name: string; virtual: boolean; className?: string }) {
  const img = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"connecting" | "playing" | "error">("connecting");
  const [attempt, setAttempt] = useState(0);
  const src = `/api/cameras/${encodeURIComponent(cameraId)}/mjpeg?a=${attempt}`;

  // The stream is attached imperatively so unmounting (or a retry) reliably closes the HTTP
  // connection, and the error raised by detaching it is not mistaken for a gateway failure.
  useEffect(() => {
    const el = img.current;
    if (!el) return;
    let active = true;
    el.onload = () => active && setState("playing");
    el.onerror = () => active && setState("error");
    el.src = src;
    return () => {
      active = false;
      el.onload = el.onerror = null;
      el.removeAttribute("src");
    };
  }, [src]);

  return (
    <div className={`relative overflow-hidden rounded-lg border-2 bg-black ${virtual ? "border-fuchsia-400/50" : "border-emerald-400/50"} ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG streams need a plain <img>; next/image cannot play them */}
      <img ref={img} alt={`${virtual ? "Camera" : "Live camera"}: ${name}`} className={`h-full w-full object-contain ${state === "playing" ? "" : "text-transparent"}`} />
      <div className="absolute left-2 top-2 flex items-center gap-2">
        {virtual ? <SimDeviceBadge label="SIM CAMERA" /> : <LiveBadge label="LIVE CAMERA" />}
        <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">{name}</span>
      </div>
      {state !== "playing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-white/60">
          {state === "connecting" ? "Connecting to camera gateway…" : virtual ? "Camera gateway not reachable — start it with npm run camera:sim" : "Camera gateway did not answer"}
          {state === "error" && (
            <button type="button" onClick={() => (setState("connecting"), setAttempt((n) => n + 1))} className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10">
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
