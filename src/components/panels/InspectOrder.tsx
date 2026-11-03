"use client";

import { Check, Navigation } from "lucide-react";
import { Btn, SectionTitle, SimBadge, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { clockSec, ghs, mins } from "@/lib/format";
import { channelLabel, fulfilmentLabel, type BranchSimulation } from "@/lib/sim/engine";
import { ORDER_FLOW, type Order, type Task } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { Card, KV, Pill, ProgressBar, simMs } from "./common";

export function taskProgress(sim: BranchSimulation, t: Task): number {
  if (t.state === "machine" && t.endsAt !== undefined) return 1 - Math.max(0, t.endsAt - sim.t) / Math.max(1, t.duration);
  if (t.state === "working" && t.startedAt !== undefined && t.endsAt !== undefined) return (sim.t - t.startedAt) / Math.max(1, t.endsAt - t.startedAt);
  return 0;
}

export function orderTone(o: Order): "red" | "yellow" | "green" | "blue" | "default" {
  if (o.status === "CANCELLED" || o.status === "FAILED") return "red";
  if (o.delayed) return "red";
  if (o.status === "READY" || o.status === "COMPLETED") return "green";
  if (o.status === "OUT_FOR_DELIVERY") return "blue";
  return "default";
}

export default function InspectOrder({ sim, id }: { sim: BranchSimulation; id: string }) {
  const user = useApp((s) => s.user);
  const followOrder = useApp((s) => s.followOrder);
  const followId = useApp((s) => s.followOrderId);
  const notify = useApp((s) => s.notify);
  const o = sim.orders.get(id);
  if (!o) return <p className="p-4 text-xs text-white/50">Order not found.</p>;
  const canAct = can(user, "act:orders");
  const terminal = ["COMPLETED", "CANCELLED", "FAILED", "REFUNDED"].includes(o.status);
  const elapsed = (o.completedAt ?? sim.t) - o.createdAt;
  const reached = new Map(o.history.map((h) => [h.status, h.t]));
  const flow = o.fulfilment === "delivery" ? ORDER_FLOW : ORDER_FLOW.filter((s) => s !== "OUT_FOR_DELIVERY");
  const tasks = sim.tasksFor(o.id);
  const units = o.unitIds.map((u) => sim.units.get(u)!).filter(Boolean);

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Order</span>
          <SimBadge />
        </div>
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold text-white">#{o.number}</h2>
          <Pill tone={orderTone(o)}>{o.status.replace(/_/g, " ")}</Pill>
          {o.delayed && <Pill tone="red">Delayed</Pill>}
        </div>
      </div>
      <Card>
        <KV k="Branch" v={sim.branchName} />
        <KV k="Channel" v={channelLabel(o.channel)} />
        <KV k="Fulfilment" v={fulfilmentLabel(o.fulfilment)} />
        <KV k="Elapsed" v={mins(elapsed)} mono tone={o.delayed ? "red" : undefined} />
        <KV k="Target (demo SLA)" v={`${o.slaMin} min to ready`} mono />
        {o.note && <KV k="Note" v={o.note} />}
      </Card>

      <div>
        <SectionTitle>Items</SectionTitle>
        <ul className="space-y-1 text-[11.5px]">
          {o.lines.map((l) => (
            <li key={l.menuId} className="flex justify-between gap-2">
              <span className="text-white/80">
                {l.qty}× {l.name}
              </span>
              <span className="font-mono text-white/60">{ghs(l.price * l.qty)}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-white/10 pt-1 font-semibold">
            <span className="text-white/60">Total (menu prices, GH₵)</span>
            <span className="font-mono text-white">{ghs(o.total)}</span>
          </li>
        </ul>
      </div>

      <div>
        <SectionTitle>Lifecycle</SectionTitle>
        <ol className="space-y-1">
          {flow.map((s) => {
            const t = reached.get(s);
            const current = o.status === s;
            return (
              <li key={s} className="flex items-center gap-2 text-[11px]">
                <span className={cx("grid h-4 w-4 shrink-0 place-items-center rounded-full border", t !== undefined ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-300" : "border-white/15 text-transparent", current && "ring-2 ring-emerald-400/40")}>
                  <Check size={10} />
                </span>
                <span className={cx("flex-1", t !== undefined ? "text-white/85" : "text-white/35")}>{s.replace(/_/g, " ")}</span>
                <span className="font-mono text-white/40">{t !== undefined ? clockSec(simMs(sim, t)) : ""}</span>
              </li>
            );
          })}
          {["CANCELLED", "REFUNDED", "FAILED"].map((s) =>
            reached.has(s as Order["status"]) ? (
              <li key={s} className="flex items-center gap-2 text-[11px] text-red-300">
                <span className="h-4 w-4 rounded-full border border-red-400/60 bg-red-400/20" />
                <span className="flex-1">{s}</span>
                <span className="font-mono text-white/40">{clockSec(simMs(sim, reached.get(s as Order["status"])!))}</span>
              </li>
            ) : null,
          )}
        </ol>
      </div>

      {units.length > 0 && (
        <div>
          <SectionTitle>Production</SectionTitle>
          <ul className="space-y-2">
            {units.map((u) => {
              const t = tasks.find((x) => x.unitId === u.id);
              const stage = u.stages[u.stageIndex];
              const waitingStock = t?.state === "pending" && ((u.cut && (sim.chickenStock[u.cut] ?? 0) < (u.pieces ?? 0)) || (u.grams && sim.riceStockKg * 1000 < u.grams));
              return (
                <li key={u.id} className="text-[11px]">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-white/80">{u.label}</span>
                    <span className={cx("shrink-0", u.done ? "text-emerald-300" : "text-white/50")}>{u.done ? "Done" : stage ? `${stage.name}` : u.kind === "drink" ? "Picked at packing" : "—"}</span>
                  </div>
                  {!u.done && t && (
                    <div className="mt-0.5 flex items-center gap-2">
                      <ProgressBar value={taskProgress(sim, t)} tone={t.state === "machine" ? "yellow" : "blue"} />
                      <span className="w-20 shrink-0 text-right font-mono text-[10px] text-white/40">{waitingStock ? "awaiting batch" : t.state === "pending" ? "queued" : t.state === "assigned" ? "staff en route" : t.state === "machine" ? `${Math.ceil(Math.max(0, (t.endsAt ?? sim.t) - sim.t))}s left` : "in progress"}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {tasks
            .filter((t) => !t.unitId)
            .map((t) => (
              <div key={t.id} className="mt-2 text-[11px]">
                <div className="flex justify-between text-white/75">
                  <span>{t.label}</span>
                  <span className="text-white/45">{t.state}</span>
                </div>
                <ProgressBar value={taskProgress(sim, t)} />
              </div>
            ))}
        </div>
      )}

      {o.delivery && (
        <div>
          <SectionTitle>Delivery</SectionTitle>
          <Card>
            <KV k="Status" v={o.delivery.status.replace(/_/g, " ")} />
            {o.delivery.rider && <KV k="Courier" v={o.delivery.rider} />}
            {o.delivery.collectedAt !== undefined && <KV k="Collected" v={clockSec(simMs(sim, o.delivery.collectedAt))} mono />}
            {o.delivery.eta !== undefined && o.delivery.status !== "DELIVERED" && <KV k="Simulated ETA" v={clockSec(simMs(sim, o.delivery.eta))} mono />}
            {o.delivery.deliveredAt !== undefined && <KV k="Delivered" v={clockSec(simMs(sim, o.delivery.deliveredAt))} mono />}
          </Card>
          <p className="mt-1 text-[10px] text-white/35">Live rider location is not connected — no map coordinates are shown.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!terminal && (
          <Btn size="xs" active={followId === o.id} onClick={() => followOrder(followId === o.id ? null : o.id)}>
            <Navigation size={12} /> {followId === o.id ? "Stop following" : "Follow in 3D"}
          </Btn>
        )}
        {!terminal && (
          <Btn size="xs" disabled={!canAct} title={canAct ? "Cancel this simulated order" : "Your role cannot cancel orders"} onClick={() => sim.cancelOrder(o.id, `Cancelled by ${user.name}`) && notify(`Order #${o.number} cancelled`, "warning")}>
            Cancel
          </Btn>
        )}
        {["COMPLETED", "CANCELLED", "FAILED"].includes(o.status) && (
          <Btn size="xs" disabled={!canAct} title={canAct ? "Issue a simulated refund" : "Your role cannot refund orders"} onClick={() => sim.refundOrder(o.id) && notify(`Order #${o.number} refunded (simulated)`, "info")}>
            Refund
          </Btn>
        )}
      </div>
    </div>
  );
}
