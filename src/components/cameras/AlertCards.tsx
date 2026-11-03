"use client";

import { useState } from "react";
import { can } from "@/lib/auth/rbac";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { Alert } from "@/lib/sim/types";
import { zoneAlerts, type ZoneId } from "@/lib/sim/zones";
import { useApp } from "@/store/app";
import { useFeed } from "./feedStore";
import { hhmm, mmss } from "./format";

/**
 * Alerts for one camera, each as a small card: what is wrong (one line), what to do (one
 * line), and at most two buttons. Acknowledging turns the card from red to amber; resolving
 * (or the condition clearing by itself) turns it green and folds it away.
 */
export default function AlertCards({ sim, zoneId, tileId }: { sim: BranchSimulation; zoneId: ZoneId; tileId: string }) {
  useApp((s) => s.tick);
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const setReplay = useFeed((s) => s.setReplay);
  const [assigning, setAssigning] = useState<string | null>(null);
  const open = zoneAlerts(sim, zoneId).sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical") || b.escalation - a.escalation || b.openedAt - a.openedAt);
  const cleared = sim.alerts.filter((a) => a.zoneId === zoneId && a.status === "resolved" && a.resolvedAt !== undefined && sim.now() - a.resolvedAt < 15 * 60_000).slice(0, 3);
  const allowed = can(user, "act:safety");
  const staff = [...sim.staff.values()].map((m) => m.name);
  void tileId;

  const jump = (a: Alert) => {
    const at = (a.openedAt - sim.clockStart) / 1000;
    const from = Math.max(sim.history[0]?.t ?? 0, at - 15);
    setReplay({ t: from, playing: true, speed: 1, clip: { from, to: Math.min(sim.t - 1, at + 5), label: `${a.title} — 15 s before it fired` } });
  };

  if (!open.length && !cleared.length)
    return (
      <div className="cam-panel flex items-center gap-3 p-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--ok)]" aria-hidden />
        <div>
          <div className="text-[13px]">Nothing needs you here.</div>
          <div className="text-[11px] text-[var(--cam-muted)]">Alerts appear the moment a rule holds for long enough to matter.</div>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {open.map((a) => {
        const ack = a.status === "acknowledged";
        const age = Math.max(0, (sim.now() - a.openedAt) / 1000);
        const color = ack ? "var(--watch)" : a.severity === "critical" || a.escalation > 0 ? "var(--act)" : "var(--watch)";
        return (
          <div key={a.id} data-tone={ack ? "watch" : a.severity === "critical" || a.escalation > 0 ? "act" : "watch"} className={`cam-panel cam-alert cam-slide-in relative overflow-hidden p-3 pl-4 ${!ack && a.escalation > 0 ? "cam-pulse" : ""}`}>
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display text-[13px] font-semibold leading-snug tracking-tight">{a.title}</div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--cam-faint)]">
                  {hhmm(a.openedAt)} · open {mmss(age)}
                  {ack && ` · acknowledged by ${a.acknowledgedBy}`}
                  {a.assignedTo && ` · ${a.assignedTo}`}
                  {!ack && a.escalation === 1 && <span className="ml-1 text-[var(--act)]">· unattended</span>}
                  {!ack && a.escalation === 2 && <span className="ml-1 text-[var(--act)]">· manager notified</span>}
                </div>
              </div>
              <span className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color, border: `1px solid ${color}` }}>
                {ack ? "In hand" : a.severity === "critical" ? "Act now" : "Watch"}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-snug text-[var(--cam-fg)]">{a.cause ?? a.issue}</p>
            {a.action && <p className="mt-1 text-[13px] leading-snug text-white/80">→ {a.action}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => jump(a)} className="h-10 rounded-lg border border-white/15 px-3 text-[13px] text-white hover:bg-white/10">
                Jump to moment
              </button>
              {!ack ? (
                <button type="button" disabled={!allowed} onClick={() => (sim.acknowledgeAlert(a.id, user.name), notify("Acknowledged — now in hand", "warning"))} className="cam-btn-primary h-10 rounded-lg px-3 text-[13px] font-semibold text-white disabled:opacity-40">
                  Acknowledge
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!allowed}
                  onClick={() => {
                    const r = sim.resolveAlert(a.id, user.name);
                    if (!r.ok) {
                      sim.addCorrectiveAction(a.id, a.action ?? "Handled on site", user.name);
                      const r2 = sim.resolveAlert(a.id, user.name);
                      notify(r2.ok ? "Resolved" : (r2.reason ?? "Not resolved"), r2.ok ? "success" : "warning");
                    } else notify("Resolved", "success");
                  }}
                  className="h-10 rounded-lg border border-[var(--ok)]/60 px-3 text-[13px] font-semibold text-white hover:bg-[var(--ok)]/15 disabled:opacity-40"
                >
                  Resolve
                </button>
              )}
              <div className="relative ml-auto">
                <button type="button" disabled={!allowed} onClick={() => setAssigning(assigning === a.id ? null : a.id)} className="h-10 px-1 text-[11px] text-white/45 underline-offset-2 hover:text-white hover:underline disabled:opacity-40">
                  {a.assignedTo ? "Reassign" : "Assign to…"}
                </button>
                {assigning === a.id && (
                  <ul className="absolute right-0 top-full z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-white/15 bg-[#0b0f16] p-1 shadow-xl">
                    {staff.map((n) => (
                      <li key={n}>
                        <button type="button" onClick={() => (sim.assignAlert(a.id, n, user.name), setAssigning(null), notify(`Assigned to ${n.split(" ")[0]}`, "info"))} className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-white/85 hover:bg-white/10">
                          {n}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {cleared.map((a) => (
        <div key={a.id} className="flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--cam-muted)]">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--ok)]" aria-hidden />
          <span className="truncate">
            Cleared {hhmm(a.resolvedAt!)} · {a.title}
            {a.autoResolved ? " (condition passed)" : ` by ${a.resolvedBy}`}
          </span>
        </div>
      ))}
    </div>
  );
}
