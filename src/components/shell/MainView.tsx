"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Btn, cx } from "@/components/ui/primitives";
import { BRANCH_BY_ID, demoBranchIds } from "@/lib/network/branches";
import { TWIN_SECTIONS, useApp } from "@/store/app";
import Settings from "./Settings";

// Heavy modules load on demand so the map opens fast and each branch twin streams in when entered.
const GhanaMap = dynamic(() => import("@/components/map/GhanaMap"), { ssr: false });
const BranchDirectory = dynamic(() => import("@/components/map/BranchDirectory"), { ssr: false });
const CentralKitchens = dynamic(() => import("@/components/analytics/CentralKitchens"), { ssr: false });
const AnalyticsView = dynamic(() => import("@/components/analytics/AnalyticsView"), { ssr: false });
const loadTwin = () => import("@/components/twin/TwinView");
const TwinView = dynamic(loadTwin, { ssr: false, loading: () => <Loading text="Generating restaurant from floor plan…" /> });
const ModuleOverlay = dynamic(() => import("@/components/panels/ModuleOverlay"), { ssr: false });
const FloorPlanEditor = dynamic(() => import("@/components/editor/FloorPlanEditor"), { ssr: false, loading: () => <Loading text="Loading floor plan editor…" /> });

/** Mount the (heavy) twin this long into the ~2.8 s map flight, so the flight itself stays smooth. */
const TWIN_MOUNT_DELAY_MS = 2000;

function Loading({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-xs text-white/50">{text}</div>;
}

export default function MainView() {
  const section = useApp((s) => s.section);
  const entered = useApp((s) => s.enteredBranchId);
  const phase = useApp((s) => s.phase);
  const enterBranch = useApp((s) => s.enterBranch);
  const [readyFor, setReadyFor] = useState<string | null>(null);

  // Fetch the twin code during the flight but build the scene only near its end.
  useEffect(() => {
    if (phase !== "flying" || !entered) return;
    loadTwin();
    const t = setTimeout(() => setReadyFor(entered), TWIN_MOUNT_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, entered]);
  // Forget it on leaving, so re-entering the same branch delays the mount again.
  useEffect(() => {
    if (entered) return;
    const t = setTimeout(() => setReadyFor(null), 0);
    return () => clearTimeout(t);
  }, [entered]);

  if (section === "editor") return <FloorPlanEditor />;
  if (section === "analytics") return <AnalyticsView />;
  if (section === "settings") return <Settings />;

  const twinVisible = !!entered && (phase === "exterior" || phase === "entering" || phase === "inside");
  const mountTwin = !!entered && (phase !== "flying" || readyFor === entered);
  const needsBranch = TWIN_SECTIONS.includes(section) && !entered;

  return (
    <div className="relative h-full w-full">
      <div className={cx("absolute inset-0 transition-opacity duration-700", twinVisible ? "pointer-events-none opacity-0" : "opacity-100")}>
        <GhanaMap visible={!twinVisible} />
      </div>
      {entered && mountTwin && (
        <div className={cx("absolute inset-0 transition-opacity duration-700", twinVisible ? "opacity-100" : "pointer-events-none opacity-0")}>
          <TwinView key={entered} branchId={entered} />
          {twinVisible && phase === "inside" && TWIN_SECTIONS.includes(section) && section !== "twin" && section !== "cameras" && <ModuleOverlay section={section} />}
        </div>
      )}
      {!entered && section === "branches" && <BranchDirectory />}
      {!entered && section === "central" && <CentralKitchens />}
      {needsBranch && (
        <div className="glass animate-fade-in absolute left-1/2 top-4 z-20 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-xl p-4">
          <div className="font-display text-sm font-semibold text-white">Select a branch to open its digital twin</div>
          <p className="mt-1 text-xs text-white/55">Click any marker on the map, or jump straight into one of the three demonstration branches (each uses a different conceptual layout):</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {demoBranchIds().map((id) => {
              const b = BRANCH_BY_ID.get(id)!;
              return (
                <Btn key={id} onClick={() => enterBranch(id)}>
                  {b.name} · Model {b.floorPlanType}
                </Btn>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
