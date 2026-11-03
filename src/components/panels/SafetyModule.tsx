"use client";

import { useState } from "react";
import { Btn, SectionTitle, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { ago, clock, clockSec, mins } from "@/lib/format";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { Pill, limitFor, simMs, statusTone } from "./common";

const TABS = ["Sensors", "Alerts", "Cleaning", "Cook checks", "Inspections"] as const;

export default function SafetyModule({ sim }: { sim: BranchSimulation }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Alerts");
  const select = useApp((s) => s.select);
  const setSection = useApp((s) => s.setSection);
  const user = useApp((s) => s.user);
  const canAct = can(user, "act:safety");
  const open = sim.alerts.filter((a) => a.status !== "resolved");
  const p = sim.safety;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-red-500/10 py-1.5">
          <div className="font-display text-lg font-bold text-red-300">{open.filter((a) => a.severity === "critical").length}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-white/45">Critical open</div>
        </div>
        <div className="rounded-md bg-amber-500/10 py-1.5">
          <div className="font-display text-lg font-bold text-amber-200">{open.filter((a) => a.severity === "warning").length}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-white/45">Warnings open</div>
        </div>
        <div className="rounded-md bg-white/5 py-1.5">
          <div className="font-display text-lg font-bold text-white">{[...sim.sensors.values()].filter((s) => !s.connected).length}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-white/45">Sensors offline</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cx("rounded-md px-2 py-0.5 text-[10.5px]", tab === t ? "bg-white/15 text-white" : "bg-white/5 text-white/55 hover:text-white")}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Sensors" &&
        sim.plan.rooms.map((r) => {
          const list = sim.plan.sensors.filter((s) => s.roomId === r.id && s.kind !== "cleaning-checklist");
          if (!list.length) return null;
          return (
            <div key={r.id}>
              <SectionTitle>{r.name}</SectionTitle>
              <div className="grid grid-cols-2 gap-1.5">
                {list.map((s) => {
                  const st = sim.sensors.get(s.id)!;
                  const lim = limitFor(sim, s);
                  return (
                    <button key={s.id} type="button" onClick={() => select(s.equipmentId ? { kind: "equipment", id: s.equipmentId } : { kind: "sensor", id: s.id })} className={cx("rounded-md border p-1.5 text-left text-[10.5px] hover:bg-white/[0.06]", st.status === "critical" ? "border-red-500/50 bg-red-500/10" : st.status === "warning" ? "border-amber-400/40 bg-amber-400/[0.06]" : st.status === "offline" ? "border-white/15 bg-white/[0.02]" : "border-white/[0.07] bg-white/[0.03]")}>
                      <div className="flex items-center gap-1 truncate text-white/60">
                        {st.source === "live" && <span title={`Live device ${st.deviceId}`} className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />}
                        {st.source === "virtual" && <span title={`Device ${st.deviceId}`} className="h-1.5 w-1.5 shrink-0 rotate-45 bg-fuchsia-400" />}
                        <span className="truncate">{s.name.split(" — ")[0]}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-[13px] font-semibold text-white">{st.value === null ? (st.connected ? "—" : "OFFLINE") : `${st.value}${s.unit === "%" ? "%" : s.unit === "°C" ? "°" : ""}`}</span>
                        <span className="text-[9.5px] text-white/40">{lim ? lim.label : s.kind.replace(/-/g, " ")}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

      {tab === "Alerts" && (
        <div className="space-y-1.5">
          <p className="rounded-md bg-white/[0.04] px-2 py-1.5 text-[10.5px] text-white/55">Acknowledging ≠ resolved. An alert closes only after a corrective action is recorded and the reading is back within the configured limit.</p>
          {sim.alerts.length === 0 && <p className="text-[11px] text-white/40">No alerts this session.</p>}
          {sim.alerts.slice(0, 40).map((a) => (
            <div key={a.id} className={cx("rounded-md border p-2 text-[11px]", a.status === "resolved" ? "border-white/[0.06] opacity-60" : a.severity === "critical" ? "border-red-500/40 bg-red-500/[0.07]" : "border-amber-400/30 bg-amber-400/[0.05]")}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => select({ kind: "alert", id: a.id })} className="min-w-0 truncate text-left font-semibold text-white hover:underline">
                  {a.title}
                </button>
                <Pill tone={a.status === "resolved" ? "green" : a.status === "acknowledged" ? "yellow" : "red"}>{a.status}</Pill>
              </div>
              <div className="text-white/55">{a.issue}</div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-white/40">
                <span>
                  {clock(a.openedAt)} · {mins(((a.resolvedAt ?? sim.now()) - a.openedAt) / 1000)} · {a.correctiveActions.length} action(s)
                </span>
                {a.status === "open" && (
                  <Btn size="xs" disabled={!canAct} title={canAct ? undefined : "Your role cannot acknowledge alerts"} onClick={() => sim.acknowledgeAlert(a.id, user.name)}>
                    Acknowledge
                  </Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Cleaning" && (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9.5px] uppercase tracking-wider text-white/35">
              <th className="py-1 font-medium">Area</th>
              <th className="font-medium">Last done</th>
              <th className="font-medium">By</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sim.cleaning.map((c) => {
              const overdue = sim.t > c.dueAt;
              return (
                <tr key={c.roomId} className="border-t border-white/[0.05]">
                  <td className="py-1 text-white/75">{sim.roomName(c.roomId)}</td>
                  <td className="font-mono text-white/50">{clock(simMs(sim, c.lastDone))}</td>
                  <td className="text-white/50">{c.by ?? "—"}</td>
                  <td>
                    <Pill tone={overdue ? "yellow" : "green"}>{overdue ? `overdue ${mins(sim.t - c.dueAt)}` : `due ${mins(c.dueAt - sim.t)}`}</Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === "Cook checks" && (
        <div>
          <p className="mb-1.5 text-[10.5px] text-white/45">Core-temperature verification of each fried chicken batch (limit ≥ {p.cookCoreMinC} °C). Failed batches return to the fryer.</p>
          <table className="w-full text-[11px]">
            <tbody>
              {[...sim.cookChecks]
                .reverse()
                .slice(0, 40)
                .map((c, i) => (
                  <tr key={i} className="border-t border-white/[0.05]">
                    <td className="py-1 font-mono text-white/45">{clockSec(c.t)}</td>
                    <td className="font-mono text-white">{c.valueC.toFixed(1)} °C</td>
                    <td className="text-right">
                      <Pill tone={c.pass ? "green" : "red"}>{c.pass ? "pass" : "fail · re-cook"}</Pill>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!sim.cookChecks.length && <p className="text-[11px] text-white/40">No batches checked yet.</p>}
        </div>
      )}

      {tab === "Inspections" && (
        <table className="w-full text-[11px]">
          <tbody>
            {sim.plan.equipment
              .filter((e) => e.interaction.inspect.includes("temperature") || e.interaction.inspect.includes("maintenance"))
              .map((e) => ({ e, st: sim.equipment.get(e.id)! }))
              .sort((a, b) => a.st.lastInspection - b.st.lastInspection)
              .map(({ e, st }) => (
                <tr key={e.id} className="cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.04]" onClick={() => select({ kind: "equipment", id: e.id })}>
                  <td className="py-1 text-white/75">{e.name}</td>
                  <td className="text-right text-white/45">{ago(simMs(sim, st.lastInspection), sim.now())}</td>
                  <td className="text-right">
                    <Pill tone={statusTone(st.fault ? "fault" : st.status)}>{st.fault ? "fault" : st.status}</Pill>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <div className="rounded-md border border-white/[0.06] p-2 text-[10.5px] text-white/50">
        <div className="mb-1 font-semibold text-white/70">Configured thresholds · {p.name}</div>
        Chilled ≤ {p.chilledMaxC} °C · Frozen ≤ {p.frozenMaxC} °C · Hot-holding ≥ {p.hotHoldingMinC} °C · Cooked core ≥ {p.cookCoreMinC} °C · Oil ≥ {p.oilQualityMinPct}% · alert after {p.alertDelayMin} min
        <button type="button" onClick={() => setSection("settings")} className="ml-1 text-brand-yellow hover:underline">
          Edit in Settings
        </button>
      </div>
    </div>
  );
}
