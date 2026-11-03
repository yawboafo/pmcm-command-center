"use client";

import { ArrowLeft, Pause, Play, RotateCcw, Search } from "lucide-react";
import { Btn, SimBadge, cx } from "@/components/ui/primitives";
import { DEMO_USERS, can } from "@/lib/auth/rbac";
import { clockSec } from "@/lib/format";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useSnapshots, useTick } from "@/lib/hooks/useSim";
import { useLive } from "@/lib/integration/liveClient";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

const SPEEDS = [0.5, 1, 2, 5, 10];

export default function TopBar() {
  useTick();
  const { speed, paused, setSpeed, setPaused, arrivalPreset, setArrivalPreset, enteredBranchId, exitToMap, user, setUser, notify } = useApp();
  const branch = enteredBranchId ? BRANCH_BY_ID.get(enteredBranchId) : null;
  const realtime = sims().realtime;
  // Live devices run on the real clock, so speed controls are locked while connected.
  const canControl = can(user, "control:simulation") && !realtime;
  const snaps = useSnapshots();
  const liveBranches = useLive((s) => s.liveBranches.length);
  const count = (st: string) => snaps.filter((x) => x.status === st).length;

  return (
    <header className="glass z-20 flex h-12 shrink-0 items-center gap-3 rounded-none border-x-0 border-t-0 px-3">
      {branch ? (
        <div className="flex min-w-0 items-center gap-2">
          <Btn size="xs" tone="ghost" onClick={exitToMap} title="Back to Ghana map">
            <ArrowLeft size={14} /> Map
          </Btn>
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-bold text-white">{branch.name}</div>
            <div className="truncate text-[10px] text-white/45 max-md:hidden">
              {branch.city}, {branch.region} · Model {sims().peek(branch.id)?.plan.format ?? branch.floorPlanType} layout (conceptual)
            </div>
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-bold text-white">Ghana Operations</div>
          <div className="truncate text-[10px] text-white/45 max-md:hidden">70 outlets from the official directory · verified 2026-11-03</div>
        </div>
      )}

      {/* Network status at a glance: what needs attention right now, and how much data is real. */}
      <div className="ml-2 hidden shrink-0 items-center gap-3 whitespace-nowrap font-mono text-[10.5px] tracking-wide xl:flex" aria-label="Network status">
        <StatusCount n={count("critical")} label="CRIT" color="bg-red-500" strong title="Branches with a critical issue" />
        <StatusCount n={count("warning")} label="WARN" color="bg-amber-400" title="Branches with a warning" />
        <StatusCount n={count("normal")} label="OK" color="bg-emerald-500" title="Branches operating normally" />
        {count("closed") > 0 && <StatusCount n={count("closed")} label="CLOSED" color="bg-white/30" title="Branches outside opening hours" />}
        <span className="h-4 w-px bg-white/10" />
        <span className={cx(liveBranches ? "text-emerald-300" : "text-white/35")} title="Branches receiving data from connected devices or order systems">
          LIVE {liveBranches}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => useApp.getState().setPaletteOpen(true)} title="Search and jump anywhere (⌘K)" className="hidden items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-white/45 hover:border-white/20 hover:text-white/80 md:flex">
          <Search size={13} />
          <span className="hidden 2xl:inline">Search</span>
          <kbd className="font-mono text-[10px] text-white/35">⌘K</kbd>
        </button>
        <span className="whitespace-nowrap max-md:hidden">{realtime ? <SimBadge label="LIVE + SIMULATION" /> : <SimBadge label="SIMULATION" />}</span>
        <span className="md:hidden">{realtime ? <SimBadge label="LIVE + SIM" /> : <SimBadge label="DEMO" />}</span>
        <div className={cx("hidden items-center gap-1 rounded-lg border px-2 py-1 md:flex", realtime ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-black/30")} title={realtime ? "Real wall clock — live devices connected" : "Simulated clock (Africa/Accra, GMT)"}>
          {realtime && <span className="font-mono text-[9px] font-semibold tracking-wider text-emerald-300">LIVE CLOCK</span>}
          <span className={cx("h-1.5 w-1.5 rounded-full", paused && !realtime ? "bg-white/30" : "animate-pulse bg-emerald-400")} />
          <span className="font-mono text-xs tabular-nums text-white">{clockSec(sims().clock)}</span>
          <span className="text-[10px] text-white/40">GMT</span>
        </div>
        <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Simulation speed">
          <button type="button" disabled={!canControl} onClick={() => setPaused(!paused)} className="rounded-md p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-40" aria-label={paused ? "Resume simulation" : "Pause simulation"}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          {SPEEDS.map((s) => (
            <button key={s} type="button" disabled={!canControl} onClick={() => setSpeed(s)} className={cx("rounded-md px-1.5 py-1 font-mono text-[11px] disabled:opacity-40 max-md:hidden", !paused && speed === s ? "bg-white/15 text-white" : "text-white/50 hover:text-white")}>
              {s}×
            </button>
          ))}
          <button
            type="button"
            disabled={!canControl}
            onClick={() => {
              if (enteredBranchId) sims().restart(enteredBranchId);
              else sims().restartAll();
              notify(enteredBranchId ? "Branch simulation restarted" : "All simulations restarted", "info");
            }}
            className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"
            aria-label="Restart simulation"
            title="Restart simulation"
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <label className="hidden items-center gap-1.5 text-[10px] text-white/45 min-[1760px]:flex">
          Demand
          <select value={arrivalPreset} disabled={!canControl} onChange={(e) => setArrivalPreset(e.target.value as "low" | "medium" | "high")} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white">
            <option value="low">Low · 5/h</option>
            <option value="medium">Medium · 20/h</option>
            <option value="high">High · 50/h</option>
          </select>
        </label>
        <select value={user.id} onChange={(e) => setUser(e.target.value)} className="hidden max-w-44 truncate rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white min-[1760px]:block" aria-label="Demo user role">
          {DEMO_USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.roleLabel}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}

function StatusCount({ n, label, color, strong, title }: { n: number; label: string; color: string; strong?: boolean; title: string }) {
  return (
    <span title={title} className={cx("flex items-center gap-1.5", n === 0 ? "text-white/30" : strong ? "text-red-200" : "text-white/70")}>
      <span className={cx("h-1.5 w-1.5 rounded-full", color, n > 0 && strong && "animate-pulse")} />
      <span className="tabular-nums text-white/90">{n}</span>
      {label}
    </span>
  );
}
