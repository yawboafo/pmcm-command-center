"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cardKey, useCardLayout } from "@/components/ui/cardLayout";
import { CardsMenu, MovableCard } from "@/components/ui/MovableCard";
import type { BranchSimulation } from "@/lib/sim/engine";
import { ZONE_BY_ID, type ZoneId, type ZoneStatus } from "@/lib/sim/zones";
import AlertCards from "./AlertCards";
import FeedOverlay from "./FeedOverlay";
import FeedTile from "./FeedTile";
import { useFeed, LAYER_LABEL, type Layer } from "./feedStore";
import QuickActions from "./QuickActions";
import Timeline from "./Timeline";
import ZoneMetrics from "./ZoneMetrics";

const TABS = ["Status", "Alerts", "Timeline", "Actions"] as const;
type Tab = (typeof TABS)[number];
const LAYERS: Layer[] = ["people", "queue", "tickets", "heat", "doors"];

/**
 * One zone, full screen. One DOM tree for every size: on desktop and wall screens the feed
 * takes the left two-thirds with the numbers beside it; below the md breakpoint the panels
 * fold into tabs under the feed. (The feed element must exist exactly once — it is the
 * registered viewport of the WebGL canvas.)
 */
export default function CameraScreen({ sim, zoneId, status, onPrev, onNext, wall }: { sim: BranchSimulation; zoneId: ZoneId; status: ZoneStatus; onPrev: () => void; onNext: () => void; wall: boolean }) {
  const layers = useFeed((s) => s.layers);
  const toggleLayer = useFeed((s) => s.toggleLayer);
  const [tab, setTab] = useState<Tab>("Status");
  const column = useRef<HTMLDivElement>(null);
  // A new camera always starts at the top of its column (focus from the grid card must not scroll it).
  useEffect(() => {
    column.current?.scrollTo({ top: 0 });
  }, [zoneId]);
  const tileId = `zone:${zoneId}`;
  const zone = ZONE_BY_ID.get(zoneId)!;
  const alertsLabel = status.alerts.length ? `Alerts · ${status.alerts.length}` : "Alerts";
  const show = (t: Tab) => (tab === t ? "" : "hidden md:block");
  // The side column gives its width back to the feed once nothing is docked in it.
  const sideDocked = useCardLayout((s) => ["status", "alerts"].some((id) => {
    const c = s.cards[cardKey("camera", id)];
    return !c?.hidden && !c?.place;
  }));

  return (
    <div data-card-area className={`relative flex flex-col gap-3 md:grid md:h-full ${!sideDocked ? "md:grid-cols-1" : wall ? "md:grid-cols-[minmax(0,1fr)_460px]" : "md:grid-cols-[minmax(0,1fr)_360px]"} md:gap-4`}>
      <div ref={column} className="scroll-thin flex min-h-0 flex-col gap-3 md:overflow-y-auto md:pr-1">
        <div className="hidden items-center justify-between gap-3 px-1 md:flex">
          <div className="min-w-0 truncate text-[13px] text-[var(--cam-muted)]">{zone.question}</div>
          <CardsMenu area="camera" className="shrink-0" />
        </div>
        <div className="relative">
          <FeedTile id={tileId} zoneId={zoneId} sim={sim} level={status.level} label={zone.name}>
            <FeedOverlay tileId={tileId} zoneId={zoneId} sim={sim} />
          </FeedTile>
          <button type="button" onClick={onPrev} aria-label="Previous camera" className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white/80 hover:bg-black/75 hover:text-white">
            <ChevronLeft size={20} />
          </button>
          <button type="button" onClick={onNext} aria-label="Next camera" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white/80 hover:bg-black/75 hover:text-white">
            <ChevronRight size={20} />
          </button>
        </div>
        {/* Phone tabs */}
        <div className="flex shrink-0 gap-1 overflow-x-auto md:hidden">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`h-11 shrink-0 rounded-lg px-3 text-[13px] ${tab === t ? "bg-white/12 text-white" : "text-white/55"}`}>
              {t === "Alerts" ? alertsLabel : t}
            </button>
          ))}
        </div>
        <MovableCard area="camera" id="layers" title="Feed layers" flow className={`scroll-thin flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 py-0.5 ${tab === "Timeline" ? "" : "hidden md:flex"}`}>
          <span className="mr-1 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--cam-faint)]">Show</span>
          {LAYERS.map((l) => (
            <button key={l} type="button" aria-pressed={layers[l]} onClick={() => toggleLayer(l)} className={`h-9 shrink-0 rounded-full border px-3 text-[13px] ${layers[l] ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-white/50 hover:text-white"}`}>
              {LAYER_LABEL[l]}
            </button>
          ))}
        </MovableCard>
        <MovableCard area="camera" id="timeline" title="Timeline" flow className={show("Timeline")}>
          <Timeline sim={sim} zoneId={zoneId} />
        </MovableCard>
        <MovableCard area="camera" id="actions" title="Quick actions" flow className={show("Actions")}>
          <QuickActions sim={sim} zoneId={zoneId} tileId={tileId} />
        </MovableCard>
        {/* On phones the status and alerts live under the feed too. */}
        <div className={`md:hidden ${show("Status")}`}>
          <ZoneMetrics sim={sim} zoneId={zoneId} status={status} />
        </div>
        <div className={`md:hidden ${show("Alerts")}`}>
          <AlertCards sim={sim} zoneId={zoneId} tileId={tileId} />
        </div>
      </div>
      <div className={`hidden ${sideDocked ? "scroll-thin min-h-0 flex-col gap-4 overflow-y-auto pr-1 md:flex" : "md:contents"}`}>
        <MovableCard area="camera" id="status" title="Zone status" flow>
          <ZoneMetrics sim={sim} zoneId={zoneId} status={status} wall={wall} />
        </MovableCard>
        <MovableCard area="camera" id="alerts" title="Alerts" flow>
          <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cam-faint)]">{alertsLabel}</div>
          <AlertCards sim={sim} zoneId={zoneId} tileId={tileId} />
        </MovableCard>
      </div>
    </div>
  );
}
