"use client";

import { Building2, Camera, CornerDownLeft, Crosshair, Gauge, MapPin, ReceiptText, Search, ShieldAlert, UserRound, Users, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestFlyTo } from "@/components/map/mapState";
import { focusEquipment } from "@/components/panels/common";
import { stationPresets } from "@/components/twin/StationViews";
import { cx } from "@/components/ui/primitives";
import { DEMO_USERS, can } from "@/lib/auth/rbac";
import { ROLE_LABEL } from "@/lib/sim/engine";
import { BRANCHES } from "@/lib/network/branches";
import { useApp, type CameraMode } from "@/store/app";
import { sims } from "@/store/sims";
import { NAV } from "./Sidebar";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

/** Subsequence match: every query character in order; earlier, contiguous and word-start hits score higher. */
function score(q: string, text: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - (direct > 0 && t[direct - 1] !== " " ? 50 : 0);
  let ti = 0;
  let s = 0;
  let last = -2;
  for (const c of q) {
    const i = t.indexOf(c, ti);
    if (i < 0) return -1;
    s += i === last + 1 ? 8 : i === 0 || t[i - 1] === " " ? 5 : 1;
    last = i;
    ti = i + 1;
  }
  return s;
}

const CAMERA_MODES: Array<[CameraMode, string]> = [
  ["dollhouse", "Dollhouse overview"],
  ["orbit", "Free camera"],
  ["fps", "Walk (first person)"],
  ["top", "Top-down plan"],
  ["tour", "Cinematic tour"],
];

/**
 * ⌘K / Ctrl+K command palette: jump to any branch, view, kitchen station, piece of
 * equipment, active order or open alert without hunting through panels.
 */
export default function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const entered = useApp((s) => s.enteredBranchId);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Built when the palette opens, so it reflects the current orders and alerts.
  const commands = useMemo<Command[]>(() => {
    if (!open) return [];
    const app = useApp.getState();
    const out: Command[] = [];
    const sim = entered ? sims().peek(entered) : undefined;
    if (sim) {
      for (const p of stationPresets(sim.plan))
        out.push({ id: `st:${p.id}`, group: "Stations & zones", label: p.label, icon: Crosshair, run: () => (app.setCctv(false), app.requestCamera({ position: p.position, target: p.target }), p.workstationId && app.select({ kind: "workstation", id: p.workstationId })) });
      if (can(app.user, "view:staff-location"))
        for (const a of sim.agents.filter((x) => x.kind === "staff" && !x.gone))
          out.push({ id: `staff:${a.id}`, group: "Locate staff", label: a.name, hint: `${a.role ? ROLE_LABEL[a.role] : "Staff"}${a.tracked ? ` · badge ${a.tracked.tagId}` : " · simulated position"}`, icon: Users, run: () => app.followAgent(a.id) });
      for (const a of sim.alerts.filter((x) => x.status !== "resolved"))
        out.push({ id: `al:${a.id}`, group: "Open alerts", label: a.title, hint: a.severity, icon: ShieldAlert, run: () => app.select({ kind: "alert", id: a.id }) });
      for (const o of sim.activeOrders().slice(0, 40))
        out.push({ id: `or:${o.id}`, group: "Active orders", label: `Order #${o.number}`, hint: o.lines.map((l) => l.name).join(", "), icon: ReceiptText, run: () => app.select({ kind: "order", id: o.id }) });
      for (const e of sim.plan.equipment)
        out.push({ id: `eq:${e.id}`, group: "Equipment", label: e.name, hint: e.type, icon: Wrench, run: () => (app.setCctv(false), app.select({ kind: "equipment", id: e.id }), focusEquipment(sim, e.id)) });
      for (const [m, label] of CAMERA_MODES) out.push({ id: `cam:${m}`, group: "Camera", label, icon: Camera, run: () => (app.setCctv(false), app.setView2d(false), app.setCameraMode(m)) });
      out.push({ id: "cam:grid", group: "Camera", label: "Virtual camera grid", icon: Camera, run: () => app.setCctv(true) });
      out.push({ id: "cam:2d", group: "Camera", label: app.view2d ? "Back to 3D view" : "Live 2D floor plan", icon: Camera, run: () => app.setView2d(!app.view2d) });
    }
    for (const [k, label] of [["low", "Low · 5/h"], ["medium", "Medium · 20/h"], ["high", "High · 50/h"]] as const)
      out.push({ id: `demand:${k}`, group: "Simulation", label: `Demand: ${label}`, hint: app.arrivalPreset === k ? "current" : undefined, icon: Gauge, run: () => app.setArrivalPreset(k) });
    for (const u of DEMO_USERS) out.push({ id: `role:${u.id}`, group: "Demo role", label: `View as ${u.roleLabel}`, hint: app.user.id === u.id ? "current" : undefined, icon: UserRound, run: () => app.setUser(u.id) });
    for (const n of NAV) out.push({ id: `nav:${n.id}`, group: "Go to", label: n.label, icon: n.icon, run: () => app.setSection(n.id) });
    for (const b of BRANCHES) {
      out.push({ id: `tw:${b.id}`, group: "Open branch twin", label: b.name, hint: `${b.city} · ${b.region}`, icon: Building2, run: () => app.enterBranch(b.id) });
      out.push({ id: `map:${b.id}`, group: "Show on map", label: b.name, hint: b.region, icon: MapPin, run: () => (app.exitToMap(), app.selectBranch(b.id), requestFlyTo(b.id)) });
    }
    return out;
  }, [open, entered]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    // With no query, show the in-branch shortcuts and navigation, not 140 branch rows.
    const pool = query ? commands : commands.filter((c) => !/^(map|tw|eq|or|role):/.test(c.id));
    return pool
      .map((c) => ({ c, s: Math.max(score(query, c.label), c.hint ? score(query, c.hint) - 200 : -1) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [q, commands]);

  // Start fresh each time it opens (state adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setActive(0);
    }
  }
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)} role="presentation">
      <div role="dialog" aria-label="Command palette" aria-modal className="glass animate-fade-in w-full max-w-xl overflow-hidden rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-2.5 border-b border-white/[0.07] px-4 py-3">
          <Search size={16} className="text-white/40" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[active]);
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder={entered ? "Search stations, equipment, orders, alerts, branches…" : "Search branches, views…"}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/35"
            aria-label="Command"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          />
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/40">esc</kbd>
        </label>
        <div ref={list} id="palette-results" role="listbox" className="scroll-thin max-h-[50vh] overflow-y-auto py-1.5">
          {results.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-white/40">No matches.</p>}
          {results.map((c, i) => {
            const header = i === 0 || results[i - 1].group !== c.group ? c.group : null;
            const Icon = c.icon;
            return (
              <div key={c.id}>
                {header && <div className="px-4 pb-1 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/30">{header}</div>}
                <button
                  id={`cmd-${c.id}`}
                  data-idx={i}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", i === active ? "bg-white/[0.08]" : "")}
                >
                  <Icon size={15} className={i === active ? "text-sky-300" : "text-white/40"} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white/90">{c.label}</span>
                  {c.hint && <span className="max-w-[45%] truncate text-[11px] text-white/35">{c.hint}</span>}
                  {i === active && <CornerDownLeft size={13} className="shrink-0 text-white/35" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-white/[0.07] px-4 py-2 font-mono text-[10px] text-white/35">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span className="ml-auto">? shortcuts</span>
        </div>
      </div>
    </div>
  );
}
