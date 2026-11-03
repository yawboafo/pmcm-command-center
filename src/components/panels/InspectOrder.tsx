"use client";

import { Check, Navigation } from "lucide-react";
import { Btn, EstimatedBadge, SectionTitle, SourceBadge, UnavailableBadge, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { clockSec, ghs, mins } from "@/lib/format";
import { channelLabel, fulfilmentLabel, type BranchSimulation } from "@/lib/sim/engine";
import { MENU_BY_ID } from "@/lib/sim/menu";
import { ORDER_FLOW, type Order, type Task } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { Card, KV, Pill, ProgressBar, simMs } from "./common";

export function taskProgress(sim: BranchSimulation, t: Task): number {
  if (t.state === "machine" && t.endsAt !== undefined) return 1 - Math.max(0, t.endsAt - sim.t) / Math.max(1, t.duration);
  if (t.state === "working" && t.startedAt !== undefined && t.endsAt !== undefined) return (sim.t - t.startedAt) / Math.max(1, t.endsAt - t.startedAt);
  return 0;
}

const PAYMENT_LABEL = { "mobile-money": "Mobile money", card: "Card", cash: "Cash" } as const;

/** Operator-facing names for each lifecycle step (the last step depends on fulfilment). */
export function statusLabel(s: Order["status"], o?: Pick<Order, "fulfilment">): string {
  if (s === "COMPLETED") return o?.fulfilment === "delivery" ? "Delivered" : o?.fulfilment === "dine-in" ? "Served" : "Collected";
  return (
    {
      RECEIVED: "Order placed",
      ACCEPTED: "Accepted",
      KITCHEN_QUEUE: "Kitchen queue",
      PREPARATION: "Preparation",
      COOKING: "Cooking",
      QUALITY_CHECK: "Quality check",
      PACKAGING: "Packaging",
      READY: "Ready",
      OUT_FOR_DELIVERY: "Dispatched",
      CANCELLED: "Cancelled",
      FAILED: "Failed",
      REFUNDED: "Refunded",
    } as Record<string, string>
  )[s];
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
  const eta = sim.estimateReadyAt(o);
  // Every engine event and stock movement that references this order, oldest first.
  const trail = sim.events.filter((e) => e.refs?.orderId === o.id);
  const invName = new Map(sim.inventory.map((i) => [i.sku, `${i.unit} ${i.name}`]));
  const stockBy = new Map<string, number>();
  for (const l of sim.ledger) if (l.ref === o.id) stockBy.set(l.sku, (stockBy.get(l.sku) ?? 0) + l.delta);
  const stock = [...stockBy].filter(([, d]) => Math.abs(d) > 1e-9);
  const units = o.unitIds.map((u) => sim.units.get(u)!).filter(Boolean);
  // Order placed → Payment → Kitchen queue → … → Ready → Served / Collected / Dispatched → Delivered.
  const steps: Array<{ key: string; label: string; t?: number; current: boolean }> = [];
  for (const s of flow) {
    if (s === "ACCEPTED") {
      // Payment is its own step; acceptance is shown inside it for remote orders.
      steps.push({ key: "PAYMENT", label: o.source !== "simulated" && !o.payment ? "Payment (not reported)" : "Payment", t: o.payment?.paidAt, current: false });
      continue;
    }
    steps.push({ key: s, label: statusLabel(s, o), t: reached.get(s), current: o.status === s });
  }

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Order</span>
          <SourceBadge source={o.source} />
        </div>
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold text-white">#{o.number}</h2>
          <Pill tone={orderTone(o)}>{statusLabel(o.status, o)}</Pill>
          {o.delayed && <Pill tone="red">Delayed</Pill>}
        </div>
      </div>
      <Card>
        <KV k="Branch" v={sim.branchName} />
        <KV k="Channel" v={channelLabel(o.channel)} />
        {o.source !== "simulated" && <KV k="Source reference" v={`${o.externalRef}${o.externalStatus ? ` · ${o.externalStatus}` : ""}${o.source === "virtual" ? " · simulated POS terminal" : ""}`} mono />}
        <KV k="Fulfilment" v={fulfilmentLabel(o.fulfilment)} />
        <KV k="Elapsed" v={mins(elapsed)} mono tone={o.delayed ? "red" : undefined} />
        <KV k="Target (demo SLA)" v={`${o.slaMin} min to ready`} mono />
        {eta !== null && o.readyAt === undefined && (
          <KV
            k={
              <span className="inline-flex items-center gap-1.5">
                Ready by <EstimatedBadge />
              </span>
            }
            v={`${clockSec(simMs(sim, eta))} · in ${mins(Math.max(0, eta - sim.t))}`}
            mono
            tone={o.acceptedAt !== undefined && eta - o.acceptedAt > o.slaMin * 60 ? "yellow" : undefined}
          />
        )}
        <KV
          k="Payment"
          v={
            o.payment ? (
              `${PAYMENT_LABEL[o.payment.method]} · ${clockSec(simMs(sim, o.payment.paidAt))}`
            ) : o.source !== "simulated" ? (
              <span className="inline-flex items-center gap-1.5">
                Not reported by source <UnavailableBadge />
              </span>
            ) : (
              "Pending"
            )
          }
        />
        {o.note && <KV k="Note" v={o.note} />}
      </Card>

      <div>
        <SectionTitle>Items</SectionTitle>
        <ul className="space-y-1 text-[11.5px]">
          {o.lines.map((l) => (
            <li key={l.menuId} className="flex justify-between gap-2" title={MENU_BY_ID.get(l.menuId) ? `Published as "${MENU_BY_ID.get(l.menuId)!.publishedName}" · ${MENU_BY_ID.get(l.menuId)!.sourceUrl} · verified ${MENU_BY_ID.get(l.menuId)!.verifiedAt}` : undefined}>
              <span className="text-white/80">
                {l.qty}× {l.name}
              </span>
              <span className="font-mono text-white/60">{ghs(l.price * l.qty)}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-white/10 pt-1 font-semibold">
            <span className="text-white/60">{o.source === "live" ? "Total (source system prices, GH₵)" : o.source === "virtual" ? "Total (simulated POS prices, GH₵)" : "Total (published menu prices, GH₵)"}</span>
            <span className="font-mono text-white">{ghs(o.total)}</span>
          </li>
        </ul>
      </div>

      <div>
        <SectionTitle>Lifecycle</SectionTitle>
        <ol className="space-y-1">
          {steps.map(({ key, label, t, current }) => (
            <li key={key} className="flex items-center gap-2 text-[11px]">
              <span className={cx("grid h-4 w-4 shrink-0 place-items-center rounded-full border", t !== undefined ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-300" : "border-white/15 text-transparent", current && "ring-2 ring-emerald-400/40")}>
                <Check size={10} />
              </span>
              <span className={cx("flex-1", t !== undefined ? "text-white/85" : "text-white/35")}>{label}</span>
              <span className="font-mono text-white/40">{t !== undefined ? clockSec(simMs(sim, t)) : ""}</span>
            </li>
          ))}
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

      <div>
        <SectionTitle>Event trail</SectionTitle>
        <ol className="space-y-0.5 border-l border-white/10 pl-2.5">
          {trail.map((e) => (
            <li key={e.id} className="relative text-[10.5px] leading-snug">
              <span className={cx("absolute -left-[13px] top-1.5 h-1.5 w-1.5 rounded-full", e.severity === "critical" ? "bg-red-400" : e.severity === "warning" ? "bg-amber-300" : e.severity === "success" ? "bg-emerald-400" : "bg-white/40")} />
              <span className="mr-1.5 font-mono text-white/35">{clockSec(e.t)}</span>
              <span className="text-white/70">{e.message}</span>
            </li>
          ))}
        </ol>
        {stock.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {stock.map(([sku, d]) => (
              <span key={sku} title={`Ledger movement for ${sku}`} className={cx("rounded border px-1.5 py-px font-mono text-[9.5px]", d < 0 ? "border-white/10 text-white/55" : "border-emerald-400/30 text-emerald-300")}>
                {d > 0 ? "+" : "−"}
                {Math.abs(d).toLocaleString("en-GH", { maximumFractionDigits: 3 })} {invName.get(sku) ?? sku}
              </span>
            ))}
          </div>
        )}
      </div>

      {o.delivery && (
        <div>
          <SectionTitle>Delivery</SectionTitle>
          <Card>
            <KV k="Status" v={o.delivery.status.replace(/_/g, " ")} />
            {o.delivery.rider && <KV k="Courier" v={o.delivery.rider} />}
            {o.delivery.collectedAt !== undefined && <KV k="Collected" v={clockSec(simMs(sim, o.delivery.collectedAt))} mono />}
            {o.delivery.eta !== undefined && o.delivery.status !== "DELIVERED" && <KV k="ETA" v={clockSec(simMs(sim, o.delivery.eta))} mono />}
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
          <Btn size="xs" disabled={!canAct} title={canAct ? "Cancel this order" : "Your role cannot cancel orders"} onClick={() => sim.cancelOrder(o.id, `Cancelled by ${user.name}`) && notify(`Order #${o.number} cancelled`, "warning")}>
            Cancel
          </Btn>
        )}
        {["COMPLETED", "CANCELLED", "FAILED"].includes(o.status) && (
          <Btn size="xs" disabled={!canAct} title={canAct ? "Issue a refund" : "Your role cannot refund orders"} onClick={() => sim.refundOrder(o.id) && notify(`Order #${o.number} refunded (simulated)`, "info")}>
            Refund
          </Btn>
        )}
      </div>
    </div>
  );
}
