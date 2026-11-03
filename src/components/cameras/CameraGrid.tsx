"use client";

import type { BranchSimulation } from "@/lib/sim/engine";
import { ZONE_BY_ID, type ZoneId, type ZoneStatus } from "@/lib/sim/zones";
import FeedOverlay from "./FeedOverlay";
import FeedTile from "./FeedTile";
import { hhmm, LEVEL_TEXT } from "./format";

const RANK = { act: 0, watch: 1, ok: 2 } as const;

/** Every zone at a glance: equal cards, worst first, one number each, tap to open. */
export default function CameraGrid({ sim, statuses, onOpen, wall }: { sim: BranchSimulation; statuses: Partial<Record<ZoneId, ZoneStatus>>; onOpen: (z: ZoneId) => void; wall: boolean }) {
  const cards = sim.zoneCameras
    .map((c) => ({ zoneId: c.zoneId, status: statuses[c.zoneId]! }))
    .filter((c) => c.status)
    .sort((a, b) => RANK[a.status.level] - RANK[b.status.level] || b.status.alerts.length - a.status.alerts.length || a.zoneId.localeCompare(b.zoneId));
  return (
    <div className={`grid gap-3 ${wall ? "grid-cols-4" : "grid-cols-2 xl:grid-cols-4"}`}>
      {cards.map(({ zoneId, status }) => {
        const primary = status.metrics.find((m) => m.primary)!;
        const last = sim
          .markers()
          .filter((e) => !e.refs?.zoneId || e.refs.zoneId === zoneId)
          .at(-1);
        const ring = status.level === "ok" ? "var(--cam-line)" : `var(--${status.level})`;
        return (
          <div key={zoneId} className="cam-slide-in overflow-hidden rounded-[14px] transition-[box-shadow] duration-300" style={{ boxShadow: `0 0 0 2px ${ring}` }}>
            <FeedTile id={`grid:${zoneId}`} zoneId={zoneId} sim={sim} level={status.level} compact onClick={() => onOpen(zoneId)} label={ZONE_BY_ID.get(zoneId)!.name}>
              <FeedOverlay tileId={`grid:${zoneId}`} zoneId={zoneId} sim={sim} compact />
            </FeedTile>
            <button type="button" onClick={() => onOpen(zoneId)} className="flex w-full items-center gap-3 bg-[var(--cam-panel)] px-3 py-2.5 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{ZONE_BY_ID.get(zoneId)!.name}</div>
                <div className="truncate text-[11px] text-[var(--cam-muted)]">{status.headline}</div>
                {last && <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--cam-faint)]">{hhmm(last.t)} · {last.message}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className={`font-mono text-[22px] font-medium leading-none ${LEVEL_TEXT[primary.tone]}`}>{primary.display}</div>
                <div className="mt-0.5 text-[10px] text-[var(--cam-muted)]">{primary.label}</div>
              </div>
              {status.alerts.length > 0 && (
                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 font-mono text-[12px] font-semibold text-white" style={{ background: status.alerts.some((a) => a.severity === "critical" || a.escalation > 0) ? "var(--act)" : "var(--watch)" }} aria-label={`${status.alerts.length} alerts`}>
                  {status.alerts.length}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
