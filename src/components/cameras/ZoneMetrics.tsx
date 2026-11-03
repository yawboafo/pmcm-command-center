"use client";

import { useMemo } from "react";
import { baselineFor } from "@/lib/sim/baseline";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { Metric, ZoneId, ZoneStatus } from "@/lib/sim/zones";
import { sims } from "@/store/sims";
import { useFeed } from "./feedStore";
import { formatMetric, hhmm, LEVEL_TEXT } from "./format";

/**
 * The zone's numbers: one hero metric (the single thing the owner needs), then three or four
 * supporting readouts, each with a one-hour trend and the same moment yesterday / last week.
 * Every number names what it is and when it was measured.
 */
export default function ZoneMetrics({ sim, zoneId, status, wall = false }: { sim: BranchSimulation; zoneId: ZoneId; status: ZoneStatus; wall?: boolean }) {
  const replayT = useFeed((s) => s.replay.t);
  const frame = replayT !== null ? sim.frameAt(replayT) : null;
  const atMs = replayT !== null ? sim.clockStart + replayT * 1000 : sims().clock;
  const primary = status.metrics.find((m) => m.primary)!;
  const rest = status.metrics.filter((m) => !m.primary);
  const valueOf = (m: Metric) => (frame ? formatMetric(m.key, frame.zones[zoneId]?.metrics[m.key] ?? null) : m.display);
  // Replayed values keep the status recorded at that second (for the hero); supporting readouts stay neutral.
  const toneOf = (m: Metric) => (frame ? (m.primary ? frame.zones[zoneId]?.level ?? "ok" : "ok") : m.tone);
  const bucket = Math.floor(sim.t / 30);
  const trends = useMemo(() => {
    const end = replayT ?? sim.t;
    const out: Record<string, number[]> = {};
    const frames = sim.history.filter((f) => f.t % 60 === 0 && f.t > end - 3600 && f.t <= end);
    for (const m of status.metrics) out[m.key] = frames.map((f) => f.zones[zoneId]?.metrics[m.key]).filter((v): v is number => typeof v === "number");
    return out;
  }, [sim, zoneId, status.metrics, replayT, bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-4">
      <div className="cam-panel cam-hero p-4" data-level={toneOf(primary)}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--cam-muted)]">{primary.label}</div>
          <div className="font-mono text-[11px] text-[var(--cam-faint)]">{hhmm(atMs)} GMT</div>
        </div>
        <div className={`cam-num mt-2 leading-none ${wall ? "text-[64px]" : "text-[44px]"} ${LEVEL_TEXT[toneOf(primary)]}`}>{valueOf(primary)}</div>
        <div className="mt-2 text-[13px] leading-snug text-[var(--cam-fg)]">{frame ? `At ${hhmm(atMs)} (replay)` : status.headline}</div>
        {primary.hint && <div className="mt-1 text-[11px] text-[var(--cam-muted)]">{primary.hint}</div>}
        <Baseline sim={sim} zoneId={zoneId} metric={primary} atMs={atMs} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rest.map((m) => (
          <div key={m.key} className="cam-panel p-3">
            <div className="truncate text-[11px] text-[var(--cam-muted)]">{m.label}</div>
            <div className={`cam-num mt-1.5 truncate text-[22px] leading-none ${LEVEL_TEXT[toneOf(m)]}`}>{valueOf(m)}</div>
            <Trend values={trends[m.key] ?? []} lowerIsBetter={m.lowerIsBetter} />
            <Baseline sim={sim} zoneId={zoneId} metric={m} atMs={atMs} compact />
          </div>
        ))}
      </div>
      <p className="px-1 text-[11px] leading-snug text-[var(--cam-faint)]">Measured by the branch simulation every second · trend = last 60 min · comparisons are modelled from the demand pattern until a history store is connected.</p>
    </div>
  );
}

function Trend({ values, lowerIsBetter }: { values: number[]; lowerIsBetter?: boolean }) {
  const w = 120;
  const h = 22;
  if (values.length < 3) return <div className="mt-2 h-[22px] text-[11px] text-[var(--cam-faint)]">Trend after a few minutes</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 2 - ((v - min) / span) * (h - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = values[values.length - 1];
  const first = values[0];
  const delta = last - first;
  const worse = lowerIsBetter === undefined ? false : lowerIsBetter ? delta > 0 : delta < 0;
  return (
    <div className="mt-2 flex items-end gap-2">
      <svg width={w} height={h} className="max-w-full" aria-hidden>
        <defs>
          <linearGradient id="cam-spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d}L${pts[pts.length - 1][0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z`} fill="url(#cam-spark)" />
        <path d={d} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill="#fff" />
      </svg>
      <span className="font-mono text-[11px] text-[var(--cam-faint)]" title="Change over the last hour">
        {delta === 0 ? "steady" : `${delta > 0 ? "↑" : "↓"} ${Math.abs(Math.round(delta * 10) / 10)}${worse ? "" : ""}`}
      </span>
    </div>
  );
}

function Baseline({ sim, zoneId, metric, atMs, compact = false }: { sim: BranchSimulation; zoneId: ZoneId; metric: Metric; atMs: number; compact?: boolean }) {
  const b = baselineFor(zoneId, metric.key, atMs, sim.config.seed, sim.branchId, sim.plan.format);
  if (b.yesterday === null && b.lastWeek === null) return null;
  const weekday = new Date(atMs - 7 * 86_400_000).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return (
    <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono ${compact ? "text-[11px]" : "text-[11px]"} text-[var(--cam-muted)]`}>
      <span title="Same time yesterday (modelled)">Yesterday {formatMetric(metric.key, b.yesterday)}</span>
      <span title={`Same time last ${weekday} (modelled)`}>Last {weekday} {formatMetric(metric.key, b.lastWeek)}</span>
    </div>
  );
}
