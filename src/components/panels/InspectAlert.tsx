"use client";

import { useState } from "react";
import { Btn, SectionTitle, SourceBadge } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { clock, clockSec, mins } from "@/lib/format";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { Card, HistoryChart, KV, Pill, focusEquipment, limitFor } from "./common";

export default function InspectAlert({ sim, id }: { sim: BranchSimulation; id: string }) {
  const user = useApp((s) => s.user);
  const select = useApp((s) => s.select);
  const notify = useApp((s) => s.notify);
  const [text, setText] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const a = sim.alerts.find((x) => x.id === id);
  if (!a) return <p className="p-4 text-xs text-white/50">Alert not found.</p>;
  const e = a.equipmentId ? sim.eqById.get(a.equipmentId) : undefined;
  const sensor = a.sensorId ? sim.plan.sensors.find((s) => s.id === a.sensorId) : undefined;
  const st = a.sensorId ? sim.sensors.get(a.sensorId) : undefined;
  const limit = limitFor(sim, sensor);
  const end = a.resolvedAt ?? sim.now();
  const allowed = can(user, "act:safety");
  const deny = allowed ? undefined : "Your role cannot act on food-safety alerts";
  const unit = sensor?.unit === "%" ? "%" : "°C";

  const timeline = [
    { t: a.openedAt, label: "Alert opened", detail: a.issue },
    ...(a.acknowledgedAt ? [{ t: a.acknowledgedAt, label: "Acknowledged", detail: `by ${a.acknowledgedBy}` }] : []),
    ...a.correctiveActions.map((c) => ({ t: c.t, label: "Corrective action", detail: `${c.text} — ${c.by}` })),
    ...(a.resolvedAt ? [{ t: a.resolvedAt, label: "Resolved", detail: `by ${a.resolvedBy}` }] : []),
  ];

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className={a.severity === "critical" ? "text-[10px] font-bold uppercase tracking-[0.16em] text-red-400" : "text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300"}>{a.severity} alert</span>
          <SourceBadge source={a.source} />
        </div>
        <h2 className="font-display text-sm font-bold leading-snug text-white">{a.title}</h2>
      </div>
      <Card className={a.status === "resolved" ? undefined : a.severity === "critical" ? "border-red-500/40 bg-red-500/[0.07]" : "border-amber-400/30 bg-amber-400/[0.05]"}>
        <KV k="Branch" v={sim.branchName} />
        {e && <KV k="Equipment" v={e.name} />}
        {e && <KV k="Location" v={sim.roomName(e.roomId)} />}
        <KV k="Issue" v={<span className="whitespace-normal">{a.issue}</span>} />
        <KV k="Duration" v={mins((end - a.openedAt) / 1000)} mono />
        {a.peakValue !== undefined && <KV k="Peak reading" v={`${a.peakValue} ${unit}`} mono tone="red" />}
        {a.limit !== undefined && <KV k="Configured limit" v={limit?.label ?? `${a.limit} ${unit}`} mono />}
        {st && <KV k="Current reading" v={st.value === null ? "Sensor offline" : `${st.value} ${unit} · ${st.status.toUpperCase()}`} mono tone={st.status === "normal" ? "green" : st.status === "critical" ? "red" : "yellow"} />}
        <KV k="Status" v={<Pill tone={a.status === "resolved" ? "green" : a.status === "acknowledged" ? "yellow" : "red"}>{a.status === "open" ? "Requires attention" : a.status}</Pill>} />
      </Card>

      {st && st.history.length > 1 && (
        <div>
          <SectionTitle>Reading history</SectionTitle>
          <HistoryChart data={st.history} limit={limit} unit={unit} />
        </div>
      )}

      {a.status !== "resolved" && (
        <div className="space-y-2">
          <p className="rounded-md bg-white/[0.04] px-2 py-1.5 text-[10.5px] text-white/55">Acknowledging an alert does not resolve the incident. Resolution needs a recorded corrective action and a reading back within the configured limit.</p>
          {a.status === "open" && (
            <Btn tone="red" disabled={!allowed} title={deny} onClick={() => (sim.acknowledgeAlert(a.id, user.name), notify("Alert acknowledged — still open until resolved", "warning"))}>
              Acknowledge
            </Btn>
          )}
          <label className="block text-[11px] text-white/55">
            Corrective action
            <textarea value={text} onChange={(ev) => setText(ev.target.value)} disabled={!allowed} rows={2} placeholder="e.g. Moved stock to backup fridge; technician called" className="mt-1 w-full resize-none rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white placeholder:text-white/25 disabled:opacity-50" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Btn size="xs" disabled={!allowed || !text.trim()} title={deny} onClick={() => (sim.addCorrectiveAction(a.id, text, user.name), setText(""), setBlocked(null))}>
              Record action
            </Btn>
            <Btn
              size="xs"
              disabled={!allowed}
              title={deny}
              onClick={() => {
                const r = sim.resolveAlert(a.id, user.name);
                setBlocked(r.ok ? null : (r.reason ?? "Cannot resolve"));
                if (r.ok) notify("Alert resolved", "success");
              }}
            >
              Resolve
            </Btn>
            {e && (
              <Btn size="xs" onClick={() => focusEquipment(sim, e.id)}>
                Show in 3D
              </Btn>
            )}
            {e && (
              <Btn size="xs" tone="ghost" onClick={() => select({ kind: "equipment", id: e.id })}>
                Equipment details
              </Btn>
            )}
          </div>
          {blocked && <p className="text-[11px] text-amber-300">Not resolved: {blocked}</p>}
        </div>
      )}

      <div>
        <SectionTitle>Audit trail</SectionTitle>
        <ol className="relative space-y-2 border-l border-white/10 pl-3">
          {timeline.map((x, i) => (
            <li key={i} className="text-[11px]">
              <span className="absolute -left-[4.5px] mt-1 h-2 w-2 rounded-full bg-white/40" />
              <div className="flex gap-2">
                <span className="font-mono text-white/40">{clockSec(x.t)}</span>
                <span className="font-semibold text-white/80">{x.label}</span>
              </div>
              <div className="text-white/55">{x.detail}</div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[10px] text-white/30">Opened {clock(a.openedAt)} GMT (simulated clock).</p>
      </div>
    </div>
  );
}
