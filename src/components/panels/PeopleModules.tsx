"use client";

import { Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { Btn, SectionTitle, Stat, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { clock, mins, pct } from "@/lib/format";
import { roleLabel, type BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { Pill, ProgressBar, simMs } from "./common";

const PHASE_GROUP: Record<string, string> = {
  "to-queue": "Queuing",
  queue: "Queuing",
  ordering: "Ordering",
  waiting: "Waiting for food",
  "to-pickup": "Collecting",
  collect: "Collecting",
  "to-seat": "Dining in",
  sitting: "Dining in",
  leave: "Leaving",
};

export function CustomersModule({ sim }: { sim: BranchSimulation }) {
  const preset = useApp((s) => s.arrivalPreset);
  const setPreset = useApp((s) => s.setArrivalPreset);
  const select = useApp((s) => s.select);
  const user = useApp((s) => s.user);
  const m = sim.metrics();
  const customers = sim.agents.filter((a) => a.kind === "customer" && !a.gone);
  const groups = new Map<string, number>();
  for (const c of customers) groups.set(PHASE_GROUP[c.phase] ?? c.phase, (groups.get(PHASE_GROUP[c.phase] ?? c.phase) ?? 0) + 1);
  const seated = customers.filter((c) => c.phase === "sitting" || c.phase === "to-seat").length;
  const hourAgo = sim.t - 3600;
  const throughput = [...sim.orders.values()].filter((o) => o.completedAt !== undefined && o.completedAt >= hourAgo).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="In store" value={customers.length} />
        <Stat label="Queue" value={m.queueLength} tone={m.queueLength > 5 ? "yellow" : "default"} />
        <Stat label="Avg wait" value={m.avgCustomerWaitMin ? mins(m.avgCustomerWaitMin * 60) : "—"} sub="arrival → collection" />
        <Stat label="Lost (balked)" value={m.lostCustomers} tone={m.lostCustomers ? "red" : "default"} />
        <Stat label="Seats used" value={sim.seats.length ? `${seated}/${sim.seats.length}` : "takeaway"} />
        <Stat label="Completed /h" value={throughput} sub="last sim hour" />
      </div>
      <div>
        <SectionTitle>Simulated demand</SectionTitle>
        <div className="flex gap-1">
          {(["low", "medium", "high"] as const).map((p) => (
            <Btn key={p} size="xs" active={preset === p} disabled={!can(user, "control:simulation")} onClick={() => setPreset(p)}>
              {p === "low" ? "Low · 5/h" : p === "medium" ? "Medium · 20/h" : "High · 50/h"}
            </Btn>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-white/40">Demo configuration values, scaled by a lunch/dinner demand curve and branch format — not company statistics. This branch: {Math.round(sim.config.arrivalRate)} orders/h at average demand.</p>
      </div>
      <div>
        <SectionTitle>Customers by activity</SectionTitle>
        {groups.size ? (
          [...groups].map(([k, v]) => (
            <div key={k} className="mb-1 flex items-center gap-2 text-[11px]">
              <span className="w-32 shrink-0 text-white/60">{k}</span>
              <ProgressBar value={v / Math.max(1, customers.length)} />
              <span className="w-6 text-right font-mono text-white/80">{v}</span>
            </div>
          ))
        ) : (
          <p className="text-[11px] text-white/40">No customers in store right now.</p>
        )}
      </div>
      <div>
        <SectionTitle>Queue</SectionTitle>
        <ol className="space-y-0.5 text-[11px]">
          {sim.queue.map((id, i) => {
            const a = sim.agents.find((x) => x.id === id);
            if (!a) return null;
            return (
              <li key={id}>
                <button type="button" onClick={() => select({ kind: "agent", id })} className="flex w-full justify-between text-white/70 hover:underline">
                  <span>
                    {i + 1}. {a.name}
                  </span>
                  <span className="font-mono text-white/40">{mins(sim.t - a.arrivedAt)}</span>
                </button>
              </li>
            );
          })}
          {!sim.queue.length && <li className="text-white/40">Queue is empty.</li>}
        </ol>
      </div>
    </div>
  );
}

interface Baseline {
  at: number;
  pending: number;
  queue: number;
  prep: number;
  changes: string[];
}

export function StaffModule({ sim }: { sim: BranchSimulation }) {
  const select = useApp((s) => s.select);
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const [base, setBase] = useState<Baseline | null>(null);
  const canControl = can(user, "control:simulation");
  const pending = [...sim.tasks.values()].filter((t) => t.state === "pending").length;
  const m = sim.metrics();
  const staff = [...sim.staff.values()];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-white">Optimise staffing</div>
            <div className="text-[10.5px] text-white/45">Find the busiest station and let under-loaded staff cover it.</div>
          </div>
          <div className="flex gap-1">
            <Btn
              size="xs"
              tone="red"
              disabled={!canControl}
              title={canControl ? undefined : "Your role cannot change assignments"}
              onClick={() => {
                const changes = sim.rebalanceStaff();
                setBase({ at: sim.t, pending, queue: m.queueLength, prep: m.avgPrepMin, changes });
                notify("Staff assignments rebalanced (simulated)", "success");
              }}
            >
              <Sparkles size={12} /> Optimise
            </Btn>
            <Btn size="xs" disabled={!canControl} title="Restore each role's default stations" onClick={() => (sim.restoreRoles(), setBase(null), notify("Default roles restored", "info"))}>
              <Undo2 size={12} />
            </Btn>
          </div>
        </div>
        {base && (
          <div className="mt-2 space-y-1 text-[11px]">
            <ul className="list-disc pl-4 text-white/70">
              {base.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="grid grid-cols-3 gap-2 rounded-md bg-black/30 p-1.5 text-center">
              {[
                ["Waiting tasks", base.pending, pending],
                ["Queue", base.queue, m.queueLength],
                ["Avg prep (min)", Number(base.prep.toFixed(1)), Number(m.avgPrepMin.toFixed(1))],
              ].map(([k, before, after]) => (
                <div key={k as string}>
                  <div className="text-[9.5px] uppercase tracking-wider text-white/40">{k}</div>
                  <div className="font-mono text-white">
                    {before} → <span className={Number(after) < Number(before) ? "text-emerald-300" : Number(after) > Number(before) ? "text-amber-300" : ""}>{after}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/40">Measured {mins(sim.t - base.at)} of simulated time after the change{sim.t - base.at < 600 ? " — give it ~10 sim-minutes to settle" : ""}.</p>
          </div>
        )}
      </div>

      <div>
        <SectionTitle right={<span className="text-[10px] text-white/40">{staff.length} on duty</span>}>Roster</SectionTitle>
        <div className="space-y-1">
          {staff.map((s) => {
            const a = sim.agents.find((x) => x.id === s.agentId)!;
            const task = a.taskId ? sim.tasks.get(a.taskId) : undefined;
            const util = s.busySeconds / Math.max(1, sim.t);
            return (
              <button key={s.agentId} type="button" onClick={() => select({ kind: "agent", id: s.agentId })} className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] p-2 text-left text-[11px] hover:bg-white/[0.05]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{s.name}</span>
                  <Pill tone={a.phase === "working" ? "green" : a.phase === "to-task" ? "blue" : "default"}>{a.phase === "working" ? "working" : a.phase === "to-task" ? "moving" : "available"}</Pill>
                </div>
                <div className="text-white/50">
                  {roleLabel(s.role)} · {s.shift}
                </div>
                <div className="truncate text-white/65">{task ? task.label : "—"}</div>
                <div className="mt-1 flex items-center gap-2">
                  <ProgressBar value={util} tone={util > 0.85 ? "red" : util > 0.6 ? "yellow" : "green"} />
                  <span className="w-20 shrink-0 text-right font-mono text-[10px] text-white/45">
                    {pct(util)} · {s.tasksDone} done
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.skills.map((k) => (
                    <span key={k} className="rounded bg-white/5 px-1 text-[9.5px] text-white/50">
                      {k}
                    </span>
                  ))}
                  <span className="text-[9.5px] text-white/30">· {s.training.join(", ")}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] leading-snug text-white/35">Fictional demo staff driven by the task scheduler. In production, staff positions must not be shown without consented tracking infrastructure and privacy controls; attendance and shifts would come from HR/rostering systems.</p>
    </div>
  );
}

const PIPE = ["AWAITING_DISPATCH", "RIDER_ASSIGNED", "COLLECTED", "IN_TRANSIT", "DELIVERED", "DELAYED"] as const;

export function DeliveryModule({ sim }: { sim: BranchSimulation }) {
  const select = useApp((s) => s.select);
  const orders = [...sim.orders.values()].filter((o) => o.delivery && !["CANCELLED", "REFUNDED"].includes(o.status)).sort((a, b) => b.createdAt - a.createdAt);
  const count = (s: string) => orders.filter((o) => o.delivery!.status === s).length;
  const delivered = orders.filter((o) => o.delivery!.deliveredAt !== undefined);
  const avgTotal = delivered.length ? delivered.reduce((s, o) => s + (o.delivery!.deliveredAt! - o.createdAt), 0) / delivered.length : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {PIPE.map((p) => (
          <div key={p} className={cx("rounded-md py-1.5 text-center", p === "DELAYED" && count(p) ? "bg-red-500/15" : "bg-white/5")}>
            <div className="font-display text-lg font-bold text-white">{count(p)}</div>
            <div className="text-[9px] uppercase tracking-wider text-white/45">{p.replace(/_/g, " ").toLowerCase()}</div>
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-white/45">Avg order-to-door (simulated): {avgTotal ? mins(avgTotal) : "—"}. Live rider GPS is not connected, so no rider coordinates are shown.</p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9.5px] uppercase tracking-wider text-white/35">
            <th className="py-1 font-medium">#</th>
            <th className="font-medium">Placed</th>
            <th className="font-medium">Courier</th>
            <th className="font-medium">Status</th>
            <th className="text-right font-medium">ETA / done</th>
          </tr>
        </thead>
        <tbody>
          {orders.slice(0, 60).map((o) => {
            const d = o.delivery!;
            return (
              <tr key={o.id} className="cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.04]" onClick={() => select({ kind: "order", id: o.id })}>
                <td className="py-1 font-mono text-white">{o.number}</td>
                <td className="font-mono text-white/45">{clock(simMs(sim, o.createdAt))}</td>
                <td className="max-w-28 truncate text-white/55">{d.rider ?? "—"}</td>
                <td>
                  <Pill tone={d.status === "DELIVERED" ? "green" : d.status === "DELAYED" ? "red" : d.status === "IN_TRANSIT" ? "blue" : "default"}>{d.status === "AWAITING_DISPATCH" && o.status !== "READY" ? "in kitchen" : d.status.replace(/_/g, " ").toLowerCase()}</Pill>
                </td>
                <td className="text-right font-mono text-white/50">{d.deliveredAt !== undefined ? clock(simMs(sim, d.deliveredAt)) : d.eta !== undefined ? clock(simMs(sim, d.eta)) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!orders.length && <p className="text-[11px] text-white/40">No delivery orders yet.</p>}
    </div>
  );
}
