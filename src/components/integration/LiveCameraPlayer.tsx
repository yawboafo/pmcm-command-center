"use client";

import { useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/primitives";

type PlayerState = { kind: "connecting" } | { kind: "playing" } | { kind: "error"; message: string };

const ERRORS: Record<number, string> = {
  401: "Not authorised for the live camera feed",
  404: "Camera is not registered or not enabled",
  400: "Camera does not support WebRTC (WHEP) playback",
  502: "Camera gateway did not answer",
  503: "Camera gateway is not configured on the server (CAMERA_GATEWAY_URL)",
};

/** Waits until ICE candidates are in the local SDP (WHEP here is non-trickle), capped so a slow STUN never hangs the player. */
function iceGathered(pc: RTCPeerConnection, timeoutMs = 2000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

/**
 * Real camera video over WebRTC (WHEP), signalled through /api/cameras/{id}/whep
 * so camera addresses and credentials stay server-side. Always rendered as a
 * separate, clearly labelled LIVE player — never blended into the 3D simulation.
 */
export default function LiveCameraPlayer({ cameraId, name, className }: { cameraId: string; name: string; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayerState>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let closed = false;
    // The gateway publishes its own ICE candidates; a STUN server is only needed across NATs.
    const stun = process.env.NEXT_PUBLIC_STUN_URL;
    const pc = new RTCPeerConnection({ iceServers: stun ? [{ urls: stun }] : [] });
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (e) => {
      if (video.current && e.streams[0]) video.current.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      if (pc.connectionState === "connected") setState({ kind: "playing" });
      if (pc.connectionState === "failed") setState({ kind: "error", message: "Video connection failed (network or firewall)" });
    };
    (async () => {
      setState({ kind: "connecting" });
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await iceGathered(pc);
        const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/whep`, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription?.sdp ?? "" });
        if (!res.ok) throw new Error(ERRORS[res.status] ?? `Camera gateway error (${res.status})`);
        const answer = await res.text();
        if (!closed) await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (e) {
        if (!closed) setState({ kind: "error", message: e instanceof Error ? e.message : "Could not start the live feed" });
      }
    })();
    return () => {
      closed = true;
      pc.close();
    };
  }, [cameraId, attempt]);

  return (
    <div className={`relative overflow-hidden rounded-lg border-2 border-emerald-400/50 bg-black ${className ?? ""}`}>
      <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
      <div className="absolute left-2 top-2 flex items-center gap-2">
        <LiveBadge label="LIVE CAMERA" />
        <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">{name}</span>
      </div>
      {state.kind !== "playing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-white/60">
          {state.kind === "connecting" ? "Connecting to camera gateway…" : state.message}
          {state.kind === "error" && (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10">
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
