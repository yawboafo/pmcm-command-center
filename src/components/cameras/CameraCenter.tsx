"use client";

import { ArrowLeft, Pause, Play, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BRANCH_BY_ID, demoBranchIds } from "@/lib/network/branches";
import type { BranchSimulation } from "@/lib/sim/engine";
import { SCENARIOS, runScenario } from "@/lib/sim/scenarios";
import { ZONE_BY_ID, zoneStatus, type ZoneId, type ZoneStatus } from "@/lib/sim/zones";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import CameraGrid from "./CameraGrid";
import CameraScreen from "./CameraScreen";
import DemoDirector from "./DemoDirector";
import { useFeed } from "./feedStore";
import Onboarding, { onboardingDue } from "./Onboarding";

/**
 * The camera centre: every zone at a glance, or one zone in depth. A dark control-room
 * surface in either app theme. Three taps end to end: grid → worst camera → alert → action.
 */
export default function CameraCenter({ sim, ready }: { sim: BranchSimulation; ready: boolean }) {
  const tick = useApp((s) => s.tick);
  const setCctv = useApp((s) => s.setCctv);
  const enterBranch = useApp((s) => s.enterBranch);
  const notify = useApp((s) => s.notify);
  const view = useFeed((s) => s.view);
  const zoneId = useFeed((s) => s.zoneId);
  const openZone = useFeed((s) => s.openZone);
  const autoRotate = useFeed((s) => s.autoRotate);
  const setAutoRotate = useFeed((s) => s.setAutoRotate);
  const [onboarding, setOnboarding] = useState(() => onboardingDue());
  const [demo, setDemo] = useState(false);
  const [scenarios, setScenarios] = useState(false);
  const [wall, setWall] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1900);

  useEffect(() => {
    const on = () => setWall(window.innerWidth >= 1900);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const zones = sim.zoneCameras.map((c) => c.zoneId);
  const statuses = useMemo(() => {
    const out: Partial<Record<ZoneId, ZoneStatus>> = {};
    for (const z of zones) out[z] = zoneStatus(sim, z);
    return out;
  }, [sim, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const worstFirst = [...zones].sort((a, b) => ({ act: 0, watch: 1, ok: 2 })[statuses[a]!.level] - ({ act: 0, watch: 1, ok: 2 })[statuses[b]!.level]);
  const idx = zoneId ? zones.indexOf(zoneId) : -1;
  const step = (d: number) => openZone(zones[(idx + d + zones.length) % zones.length]);

  // Auto-rotate: cycle through every zone, eight seconds each.
  useEffect(() => {
    if (!autoRotate) return;
    const t = setInterval(() => {
      const st = useFeed.getState();
      const cur = st.zoneId ? zones.indexOf(st.zoneId) : -1;
      st.openZone(zones[(cur + 1) % zones.length]);
    }, 8000);
    return () => clearInterval(t);
  }, [autoRotate, zones.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Esc back / close, ←→ between cameras, space play-pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const st = useFeed.getState();
      if (e.key === "Escape") {
        if (st.view === "zone") st.openZone(null);
        return;
      }
      if (st.view !== "zone") return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
      if (e.key === " ") {
        e.preventDefault();
        if (st.replay.t === null) st.setReplay({ t: Math.max(0, sim.t - 20), playing: true });
        else st.setReplay({ playing: !st.replay.playing });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const branch = BRANCH_BY_ID.get(sim.branchId);
  const running = [...sims().sims.keys()];
  const options = [...new Set([...demoBranchIds(), ...running])];
  const counts = { act: zones.filter((z) => statuses[z]!.level === "act").length, watch: zones.filter((z) => statuses[z]!.level === "watch").length };
  const worst = worstFirst[0];

  return (
    <div data-theme="dark" className="cam-root absolute inset-0 z-10 flex flex-col">
      {/* Header: one row, nothing decorative. */}
      <header className="cam-header flex h-14 shrink-0 items-center gap-2 border-b border-[var(--cam-line)] px-3 md:px-4">
        {view === "zone" ? (
          <button type="button" onClick={() => openZone(null)} className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] text-white/80 hover:bg-white/10 hover:text-white" aria-label="All cameras">
            <ArrowLeft size={16} /> <span className="hidden sm:inline">All cameras</span>
          </button>
        ) : (
          <button type="button" onClick={() => setCctv(false)} className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close cameras">
            <X size={16} /> <span className="hidden sm:inline">Close</span>
          </button>
        )}
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-tight">{view === "zone" && zoneId ? ZONE_BY_ID.get(zoneId)!.name : "Cameras"}</div>
          <div className="truncate text-[11px] text-[var(--cam-muted)]">
            {branch?.name}
            {view === "grid" && (counts.act ? ` · ${counts.act} need action` : counts.watch ? ` · ${counts.watch} to watch` : " · all zones running right")}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <label className="hidden items-center gap-1.5 text-[11px] text-[var(--cam-muted)] lg:flex">
            Branch
            <select value={sim.branchId} onChange={(e) => enterBranch(e.target.value)} className="h-9 rounded-lg border border-white/15 bg-black/40 px-2 text-[12px] text-white" aria-label="Branch">
              {options.map((id) => (
                <option key={id} value={id}>
                  {BRANCH_BY_ID.get(id)?.name ?? id}
                </option>
              ))}
            </select>
          </label>
          {view === "grid" && worst && statuses[worst]!.level !== "ok" && (
            <button type="button" onClick={() => openZone(worst)} className="hidden h-9 items-center gap-2 rounded-lg border px-3 text-[12px] text-white sm:flex" style={{ borderColor: `var(--${statuses[worst]!.level})` }}>
              <span className="h-2 w-2 rounded-full" style={{ background: `var(--${statuses[worst]!.level})` }} /> Open {ZONE_BY_ID.get(worst)!.name.toLowerCase()}
            </button>
          )}
          <button type="button" aria-pressed={autoRotate} onClick={() => setAutoRotate(!autoRotate)} title="Auto-rotate through every camera" className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] ${autoRotate ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-white/60 hover:text-white"}`}>
            {autoRotate ? <Pause size={13} /> : <Play size={13} />} <span className="hidden md:inline">Rotate</span>
          </button>
          <div className="relative">
            <button type="button" onClick={() => setScenarios(!scenarios)} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] text-white/70 hover:text-white" title="Rehearse an incident">
              <Sparkles size={13} className="text-[var(--accent)]" /> <span className="hidden md:inline">Rehearse</span>
            </button>
            {scenarios && (
              <div className="cam-panel cam-slide-in absolute right-0 top-full z-30 mt-1 w-80 p-1.5">
                <button type="button" onClick={() => (setScenarios(false), setDemo(true))} className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10">
                  <div className="text-[13px] font-semibold">Run the 2-minute lunch-rush story</div>
                  <div className="text-[11px] text-[var(--cam-muted)]">Rush builds → alert → camera → replay → action → cleared</div>
                </button>
                <div className="my-1 h-px bg-white/10" />
                {SCENARIOS.map((s) => (
                  <button key={s.id} type="button" onClick={() => (setScenarios(false), notify(runScenario(sim, s.id) ?? s.name, "warning"), openZone(s.zoneId))} className="w-full rounded-lg px-3 py-1.5 text-left hover:bg-white/10">
                    <div className="text-[12.5px]">{s.name}</div>
                    <div className="truncate text-[10.5px] text-[var(--cam-muted)]">{s.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        {!ready ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--cam-muted)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" /> Connecting to {branch?.name ?? "branch"} feeds
            </div>
            <div className="text-[12px] text-[var(--cam-faint)]">Floor plan, simulation clock and cameras are loading.</div>
          </div>
        ) : !zones.length ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--cam-muted)]">This floor plan has no camera zones yet.</div>
        ) : view === "zone" && zoneId && statuses[zoneId] ? (
          <CameraScreen sim={sim} zoneId={zoneId} status={statuses[zoneId]!} onPrev={() => step(-1)} onNext={() => step(1)} wall={wall} />
        ) : (
          <CameraGrid sim={sim} statuses={statuses} onOpen={openZone} wall={wall} />
        )}
        {demo && <DemoDirector sim={sim} onClose={() => setDemo(false)} />}
      </div>
      {onboarding && ready && <Onboarding onDone={() => setOnboarding(false)} />}
    </div>
  );
}
