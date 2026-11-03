"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BranchSimulation } from "@/lib/sim/engine";
import { LEVEL_LABEL, type Level, type ZoneId, ZONE_BY_ID } from "@/lib/sim/zones";
import { sims } from "@/store/sims";
import { registerTile, tileRegistry, useFeed } from "./feedStore";
import { clockOf } from "./format";

type Health = "connecting" | "live" | "stale";

/**
 * A camera feed: the element registers itself as a viewport of the twin's canvas, and the
 * renderer paints that zone's camera into exactly this rectangle. Everything drawn on top
 * (name plate, ticking timestamp, recording dot, health, provenance, crossfade, scanlines)
 * is HTML, so it stays crisp at any size and never costs GPU time.
 */
export default function FeedTile({
  id,
  zoneId,
  sim,
  level,
  children,
  onClick,
  compact = false,
  className = "",
  label,
}: {
  id: string;
  zoneId: ZoneId;
  sim: BranchSimulation;
  level: Level;
  children?: ReactNode;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
  label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const clockEl = useRef<HTMLSpanElement>(null);
  const [health, setHealth] = useState<Health>("connecting");
  const [fps, setFps] = useState(0);
  // Narrow tiles (phones, grid cards) carry fewer words on their plates.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 420));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const switchNonce = useFeed((s) => s.switchNonce);
  const replayT = useFeed((s) => s.replay.t);
  const available = sim.zoneCameras.some((c) => c.zoneId === zoneId);
  const zone = ZONE_BY_ID.get(zoneId)!;
  const cam = sim.zoneCameras.find((c) => c.zoneId === zoneId);

  useEffect(() => {
    if (!el.current || !available) return;
    return registerTile(id, { el: el.current, zoneId });
  }, [id, zoneId, available]);

  // Health and the ticking clock run outside React: a timer, not re-renders.
  useEffect(() => {
    let raf = 0;
    let lastHealth: Health = "connecting";
    const loop = () => {
      const f = tileRegistry.frame(id);
      const now = performance.now();
      // "No signal" only when a tile has missed several of its expected refreshes.
      const h: Health = !f ? "connecting" : now - f.at > Math.max(4000, tileRegistry.refreshMs() * 4) ? "stale" : "live";
      if (h !== lastHealth) {
        lastHealth = h;
        setHealth(h);
      }
      if (clockEl.current) {
        const t = useFeed.getState().replay.t;
        const ms = t === null ? sims().clock : sim.clockStart + t * 1000;
        const narrowNow = clockEl.current.dataset.narrow === "1";
        clockEl.current.textContent = narrowNow ? clockOf(ms) : `${new Date(ms).toISOString().slice(0, 10)} ${clockOf(ms)}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const fpsTimer = setInterval(() => setFps(useFeed.getState().fps), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(fpsTimer);
    };
  }, [id, sim]);

  const replay = replayT !== null;
  const plate = compact ? "text-[10px]" : "text-[11px]";
  return (
    <div
      ref={el}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      className={`cam-scanlines cam-vignette relative aspect-video w-full overflow-hidden rounded-[12px] ${onClick ? "cursor-pointer" : ""} ${className}`}
      aria-label={`${zone.name} camera`}
    >
      {/* Crossfade from black whenever the zone screen switches camera. */}
      {!compact && <div key={switchNonce} className="cam-crossfade pointer-events-none absolute inset-0 z-20 bg-black" />}

      {!available && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-[#0b0f16] text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cam-faint)]">No camera</div>
          <div className="text-[13px] text-[var(--cam-muted)]">This layout has no {zone.name.toLowerCase()} zone.</div>
        </div>
      )}
      {available && health !== "live" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b0f16]/85">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--cam-muted)]">
            <span className={`h-2 w-2 rounded-full ${health === "connecting" ? "animate-pulse bg-white/60" : "bg-[var(--watch)]"}`} />
            {health === "connecting" ? "Connecting" : "No signal"}
          </div>
        </div>
      )}

      {/* Overlays (projected instrumentation) */}
      {available && <div className="pointer-events-none absolute inset-0 z-[5]">{children}</div>}

      {/* Name plate */}
      <div className={`pointer-events-none absolute left-2 top-2 z-10 flex max-w-[62%] items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 font-mono ${plate} text-white/90`}>
        <span className={`h-1.5 w-1.5 rounded-full ${replay ? "bg-white/70" : "animate-pulse bg-[var(--accent)]"}`} aria-hidden />
        <span className="shrink-0 tracking-wide">{cam?.code ?? "—"}</span>
        <span className="shrink-0 text-white/60">·</span>
        <span className="truncate whitespace-nowrap">{label ?? zone.name}</span>
      </div>
      <div className={`pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 ${narrow && !replay ? "hidden" : ""}`}>
        {replay ? (
          <span className={`rounded-md border border-white/30 bg-black/60 px-1.5 py-0.5 font-mono ${compact ? "text-[9px]" : "text-[10px]"} tracking-[0.18em] text-white/85`}>REPLAY</span>
        ) : (
          <span className={`rounded-md bg-black/60 px-1.5 py-0.5 font-mono ${compact ? "text-[9px]" : "text-[10px]"} tracking-[0.18em] text-white/55`} title="Rendered from the branch simulation — not a real camera">SIMULATED</span>
        )}
      </div>
      {/* Status: one dot, three colours, nothing decorative. On narrow tiles the dot alone; the card text names the state. */}
      <div className={`pointer-events-none absolute bottom-2 right-2 z-10 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 font-mono ${plate} text-white/80`}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--${level})` }} aria-hidden />
        {!narrow && LEVEL_LABEL[level]}
        {!compact && !narrow && health === "live" && <span className="text-white/40">· {fps >= 1 ? `${fps} fps` : "link ok"}</span>}
      </div>
      <div className={`pointer-events-none absolute bottom-2 left-2 z-10 rounded-md bg-black/60 px-2 py-1 font-mono ${plate} tabular-nums text-white/80`}>
        <span ref={clockEl} data-narrow={narrow ? "1" : "0"} /> {!narrow && <span className="text-white/45">GMT</span>}
      </div>
    </div>
  );
}
