"use client";

import { Pause, Play, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { MarkerKind } from "@/lib/sim/types";
import { ZONE_BY_ID, type ZoneId } from "@/lib/sim/zones";
import { useIncidents, INCIDENT_LABEL } from "@/lib/ops/incidents";
import { useApp } from "@/store/app";
import { useFeed } from "./feedStore";
import { formatMetric, hhmm, mmss } from "./format";

const WINDOW = 3600;
const MARKER_LABEL: Record<MarkerKind, string> = { alert: "Alert", rush: "Rush", shift: "Shift change", delivery: "Delivery", anomaly: "Event", incident: "Saved" };

/**
 * The last hour of this camera: a thin bar with coloured markers (alerts, rush start/end,
 * shift changes, deliveries, anomalies, saved moments), a thumb-sized scrubber, and
 * playback at 1× / 4× / 16×. Scrubbing moves the scene and the metrics together.
 */
export default function Timeline({ sim, zoneId }: { sim: BranchSimulation; zoneId: ZoneId }) {
  useApp((s) => s.tick);
  const replay = useFeed((s) => s.replay);
  const setReplay = useFeed((s) => s.setReplay);
  const goLive = useFeed((s) => s.goLive);
  const incidents = useIncidents((s) => s.incidents).filter((i) => i.branchId === sim.branchId && i.zoneId === zoneId);
  const [hover, setHover] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const now = sim.t;
  const bucket = Math.floor(now / 5);
  const start = Math.max(0, now - WINDOW);
  const span = Math.max(60, now - start);
  const pos = (t: number) => `${Math.max(0, Math.min(100, ((t - start) / span) * 100))}%`;
  const cur = replay.t ?? now;

  // Playback: advance the playhead in simulated seconds; return to live at the end.
  useEffect(() => {
    if (!replay.playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      const dt = (ts - last) / 1000;
      last = ts;
      const st = useFeed.getState();
      if (st.replay.t === null) return;
      let t = st.replay.t + dt * st.replay.speed;
      const clip = st.replay.clip;
      if (clip && t > clip.to) t = clip.from;
      if (t >= sim.t - 0.5 && !clip) return st.goLive();
      st.setReplay({ t });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay.playing, sim]);

  const markers = useMemo(() => {
    const out: Array<{ id: string; t: number; kind: MarkerKind; text: string; mine: boolean; tone: "act" | "watch" | "neutral"; image?: string }> = [];
    for (const e of sim.markers()) {
      const t = (e.t - sim.clockStart) / 1000;
      if (t < start) continue;
      const mine = !e.refs?.zoneId || e.refs.zoneId === zoneId;
      out.push({ id: e.id, t, kind: e.refs!.marker!, text: e.message, mine, tone: e.severity === "critical" ? "act" : e.severity === "warning" ? "watch" : "neutral" });
    }
    for (const i of incidents) if (i.atSimS >= start) out.push({ id: i.id, t: i.atSimS, kind: "incident", text: `${INCIDENT_LABEL[i.kind]}${i.note ? ` — ${i.note}` : ""}`, mine: true, tone: "neutral", image: i.image });
    return out.sort((a, b) => a.t - b.t);
  }, [sim, zoneId, incidents, start, bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoverFrame = hover !== null ? sim.frameAt(hover) : null;
  const hoverIncident = hover !== null ? incidents.find((i) => i.image && Math.abs(i.atSimS - hover) < 20) : undefined;
  const zone = ZONE_BY_ID.get(zoneId)!;
  const scrub = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return null;
    return start + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };

  return (
    <div className="cam-panel select-none p-3">
      {replay.clip && (
        <div className="cam-slide-in mb-2 flex items-center justify-between gap-2 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[13px]">
          <span className="truncate">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--cam-muted)]">Replaying</span> {replay.clip.label}
          </span>
          <button type="button" onClick={goLive} className="shrink-0 font-mono text-[11px] text-white/70 hover:text-white">
            Stop
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => (replay.t === null ? setReplay({ t: Math.max(start, now - 20), playing: true, speed: 1 }) : setReplay({ playing: !replay.playing }))} aria-label={replay.playing ? "Pause" : "Play"} className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] text-white hover:bg-white/10">
          {replay.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="flex h-11 items-center rounded-lg border border-white/15 bg-white/[0.04] p-1 font-mono text-[13px]">
          {([1, 4, 16] as const).map((s) => (
            <button key={s} type="button" onClick={() => setReplay({ speed: s, ...(replay.t === null ? { t: Math.max(start, now - 60), playing: true } : {}) })} className={`h-9 rounded-md px-2.5 ${replay.speed === s && replay.t !== null ? "bg-white/15 text-white" : "text-white/55 hover:text-white"}`}>
              {s}×
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {replay.t !== null && <span className="font-mono text-[13px] tabular-nums text-white/85">−{mmss(Math.max(0, now - replay.t))}</span>}
          <button type="button" onClick={goLive} disabled={replay.t === null} className={`flex h-11 items-center gap-1.5 rounded-lg border px-3 font-mono text-[11px] tracking-[0.14em] ${replay.t === null ? "border-[var(--accent)]/60 text-white" : "border-white/15 text-white/70 hover:bg-white/10 hover:text-white"}`}>
            <Radio size={13} className={replay.t === null ? "text-[var(--accent)]" : ""} /> LIVE
          </button>
        </div>
      </div>
      <div
        ref={bar}
        className="relative mt-2 h-14 touch-none"
        onPointerMove={(e) => setHover(scrub(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          const t = scrub(e.clientX);
          if (t !== null) setReplay({ t: Math.min(t, now - 1), playing: false, clip: null });
        }}
      >
        {/* bar with ten-minute ticks */}
        <div className="cam-ticks absolute inset-x-0 top-[18px] h-3 opacity-60" />
        <div className="absolute inset-x-0 top-[22px] h-1 rounded bg-white/15" />
        <div className="absolute top-[22px] h-1 rounded bg-white/40" style={{ left: 0, width: pos(cur) }} />
        {/* markers */}
        {markers.map((m) => (
          <div key={m.id} className="absolute top-[13px]" style={{ left: pos(m.t), transform: "translateX(-50%)" }} title={`${hhmm(sim.clockStart + m.t * 1000)} · ${MARKER_LABEL[m.kind]} · ${m.text}`}>
            {m.kind === "incident" ? (
              <div className="h-[22px] w-[3px] rounded bg-white/90" />
            ) : m.kind === "alert" ? (
              <div className={`h-[22px] w-[3px] rounded`} style={{ background: m.tone === "act" ? "var(--act)" : m.tone === "watch" ? "var(--watch)" : "var(--ok)", opacity: m.mine ? 1 : 0.35 }} />
            ) : (
              <div className="h-[14px] w-[2px] translate-y-1 rounded bg-white/45" style={{ opacity: m.mine ? 0.9 : 0.35 }} />
            )}
          </div>
        ))}
        {/* playhead */}
        <div className="pointer-events-none absolute top-[12px] h-6 w-[2px] bg-white" style={{ left: pos(cur) }} />
        <input type="range" min={start} max={now} step={1} value={cur} onChange={(e) => setReplay({ t: Math.min(Number(e.target.value), now - 1), playing: false, clip: null })} aria-label="Timeline scrubber" className="cam-range absolute inset-x-0 top-0 opacity-0" />
        {/* axis */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between font-mono text-[11px] text-[var(--cam-faint)]">
          <span>{hhmm(sim.clockStart + start * 1000)}</span>
          <span>−45</span>
          <span>−30 min</span>
          <span>−15</span>
          <span>{hhmm(sim.clockStart + now * 1000)}</span>
        </div>
        {/* hover snapshot */}
        {hover !== null && hoverFrame && (
          <div className="pointer-events-none absolute bottom-full z-20 mb-1 w-[200px] -translate-x-1/2 rounded-lg border border-white/15 bg-[#0b0f16] p-2 shadow-xl" style={{ left: pos(hover) }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data-URL thumbnail captured from the canvas */}
            {hoverIncident?.image && <img src={hoverIncident.image} alt="" className="mb-1.5 aspect-video w-full rounded object-cover" />}
            <div className="flex items-baseline justify-between font-mono text-[11px] text-white/60">
              <span>{hhmm(sim.clockStart + hoverFrame.t * 1000)}</span>
              <span>{hoverFrame.people.length} people in store</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
              {Object.entries(hoverFrame.zones[zoneId]?.metrics ?? {})
                .slice(0, 4)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-1">
                    <span className="truncate text-white/50">{k}</span>
                    <span className="font-mono text-white/90">{formatMetric(k, v)}</span>
                  </div>
                ))}
            </div>
            <div className="mt-1 text-[11px] text-white/40">{zone.name} · press to view</div>
          </div>
        )}
      </div>
    </div>
  );
}
