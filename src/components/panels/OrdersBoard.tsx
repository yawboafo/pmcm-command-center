"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { clock, ghs, mins } from "@/lib/format";
import { channelLabel, type BranchSimulation } from "@/lib/sim/engine";
import type { Channel, Order } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { Pill, simMs } from "./common";
import { orderTone, statusLabel } from "./InspectOrder";

const GROUPS: Array<{ key: string; label: string; match: (o: Order) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "kitchen", label: "In kitchen", match: (o) => ["RECEIVED", "ACCEPTED", "KITCHEN_QUEUE", "PREPARATION", "COOKING", "QUALITY_CHECK", "PACKAGING"].includes(o.status) },
  { key: "ready", label: "Ready", match: (o) => o.status === "READY" },
  { key: "delivery", label: "Out for delivery", match: (o) => o.status === "OUT_FOR_DELIVERY" },
  { key: "done", label: "Completed", match: (o) => o.status === "COMPLETED" },
  { key: "cancel", label: "Cancelled / refunded", match: (o) => ["CANCELLED", "REFUNDED", "FAILED"].includes(o.status) },
];

export default function OrdersBoard({ sim }: { sim: BranchSimulation }) {
  const user = useApp((s) => s.user);
  const select = useApp((s) => s.select);
  const followOrder = useApp((s) => s.followOrder);
  const selected = useApp((s) => s.selection);
  const [group, setGroup] = useState("kitchen");
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [q, setQ] = useState("");
  const [delayedOnly, setDelayedOnly] = useState(false);
  const canAct = can(user, "act:orders");
  const all = [...sim.orders.values()];
  const g = GROUPS.find((x) => x.key === group)!;
  const query = q.trim().toLowerCase();
  const rows = all
    .filter(g.match)
    .filter((o) => channel === "all" || o.channel === channel)
    .filter((o) => !delayedOnly || o.delayed)
    .filter((o) => !query || String(o.number).includes(query) || o.lines.some((l) => l.name.toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 150);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1">
        {GROUPS.map((x) => (
          <button key={x.key} type="button" onClick={() => setGroup(x.key)} className={cx("rounded-md px-2 py-0.5 text-[10.5px]", group === x.key ? "bg-white/15 text-white" : "bg-white/5 text-white/55 hover:text-white")}>
            {x.label} <span className="font-mono text-white/40">{all.filter(x.match).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-0 flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order # or item" className="w-full rounded-md border border-white/10 bg-black/40 py-1 pl-6 pr-2 text-[11px] text-white placeholder:text-white/30" aria-label="Search orders" />
        </label>
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | "all")} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Channel filter">
          <option value="all">All channels</option>
          {(["walk-in", "chris-b-app", "online", "phone", "delivery-partner", "demo"] as Channel[]).map((c) => (
            <option key={c} value={c}>
              {channelLabel(c)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10.5px] text-white/60">
          <input type="checkbox" checked={delayedOnly} onChange={(e) => setDelayedOnly(e.target.checked)} /> Delayed
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9.5px] uppercase tracking-wider text-white/35">
              <th className="py-1 font-medium">#</th>
              <th className="font-medium">Time</th>
              <th className="font-medium">Items</th>
              <th className="font-medium">Status</th>
              <th className="text-right font-medium">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const active = !["COMPLETED", "CANCELLED", "FAILED", "REFUNDED"].includes(o.status);
              return (
                <tr key={o.id} onClick={() => select({ kind: "order", id: o.id })} className={cx("cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.04]", selected?.kind === "order" && selected.id === o.id && "bg-white/[0.07]")}>
                  <td className="py-1 pr-1 font-mono text-white">
                    {o.number}
                    {o.source === "live" && <span title="Live order from a connected ordering system" className="ml-1 text-[9px] font-semibold text-emerald-300">LIVE</span>}
                    {o.source === "virtual" && <span title="SIM DEVICE — order from a simulated POS terminal through the real pipeline" className="ml-1 text-[9px] font-semibold text-fuchsia-300">SIM</span>}
                  </td>
                  <td className="pr-1 font-mono text-white/45">
                    {clock(simMs(sim, o.createdAt))}
                    <div className="text-[9.5px] text-white/30">{active ? mins(sim.t - o.createdAt) : channelLabel(o.channel)}</div>
                  </td>
                  <td className="max-w-40 truncate pr-1 text-white/70" title={o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}>
                    {o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}
                  </td>
                  <td className="pr-1">
                    <Pill tone={orderTone(o)}>{o.delayed && active ? "delayed" : statusLabel(o.status, o).toLowerCase()}</Pill>
                  </td>
                  <td className="pr-1 text-right font-mono text-white/70">{ghs(o.total)}</td>
                  <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    {active && (
                      <button type="button" className="text-[10.5px] text-brand-yellow hover:underline" onClick={() => followOrder(o.id)}>
                        Follow
                      </button>
                    )}
                    {active && (
                      <button type="button" disabled={!canAct} title={canAct ? "Cancel order" : "Your role cannot cancel orders"} className="ml-2 text-[10.5px] text-white/45 enabled:hover:text-red-300 disabled:opacity-40" onClick={() => sim.cancelOrder(o.id, `Cancelled by ${user.name}`)}>
                        Cancel
                      </button>
                    )}
                    {["COMPLETED", "CANCELLED"].includes(o.status) && (
                      <button type="button" disabled={!canAct} title={canAct ? "Refund" : "Your role cannot refund orders"} className="text-[10.5px] text-white/45 enabled:hover:text-white disabled:opacity-40" onClick={() => sim.refundOrder(o.id)}>
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="py-4 text-center text-[11px] text-white/35">No orders match these filters.</p>}
      </div>
    </div>
  );
}
