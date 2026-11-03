"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Btn, SectionTitle, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import type { WorkstationType } from "@/lib/floorplan/types";
import { clock, ghs, mins } from "@/lib/format";
import { channelLabel, type BranchSimulation } from "@/lib/sim/engine";
import { MENU, MENU_BY_ID } from "@/lib/sim/menu";
import type { Channel, Fulfilment, Task } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { ProgressBar, chickenTargets, riceCapacityKg, simMs } from "./common";
import { taskProgress } from "./InspectOrder";

const STATIONS: Array<{ key: string; label: string; ws: WorkstationType[] }> = [
  { key: "counter", label: "Counter", ws: ["order-counter"] },
  { key: "pizza", label: "Pizza make-line", ws: ["pizza-prep"] },
  { key: "oven", label: "Oven", ws: ["oven"] },
  { key: "chicken", label: "Chicken prep / batch", ws: ["chicken-prep"] },
  { key: "fryer", label: "Fryer", ws: ["fryer"] },
  { key: "rice", label: "Rice", ws: ["rice"] },
  { key: "qc", label: "QC & hot-holding pick", ws: ["qc"] },
  { key: "pack", label: "Packaging", ws: ["packaging"] },
  { key: "handover", label: "Hand-over", ws: ["pickup", "dispatch"] },
];

function Ticket({ sim, t, rank }: { sim: BranchSimulation; t: Task; rank: number }) {
  const select = useApp((s) => s.select);
  const o = t.orderId ? sim.orders.get(t.orderId) : undefined;
  const batch = t.kind === "chicken-batch" || t.kind === "rice-batch";
  const remain = t.endsAt !== undefined ? Math.max(0, t.endsAt - sim.t) : 0;
  const timer = t.state === "pending" ? `waiting ${mins(sim.t - t.createdAt)}` : t.state === "assigned" ? "staff en route" : t.state === "machine" ? `${mins(remain)} left` : `${Math.ceil(remain)}s`;
  return (
    <button
      type="button"
      onClick={() => o && select({ kind: "order", id: o.id })}
      className={cx(
        "w-full rounded-md border px-2 py-1.5 text-left text-[11px] transition hover:bg-white/[0.06]",
        o?.delayed ? "border-red-500/50 bg-red-500/10" : t.state === "machine" ? "border-amber-400/30 bg-amber-400/[0.06]" : t.state === "working" ? "border-sky-400/30 bg-sky-400/[0.06]" : "border-white/[0.07] bg-white/[0.03]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-white">{batch ? "BATCH" : o ? `#${o.number}` : "—"}</span>
        <span className="flex items-center gap-1.5">
          {rank === 0 && t.state === "pending" && <span className="rounded bg-white/10 px-1 text-[9px] font-bold text-white/70">NEXT</span>}
          {o?.delayed && <span className="rounded bg-red-500/30 px-1 text-[9px] font-bold text-red-100">DELAYED</span>}
          <span className={cx("font-mono tabular-nums", t.state === "machine" ? "text-amber-200" : "text-white/55")}>{timer}</span>
        </span>
      </div>
      <div className="truncate text-white/70">{t.label}</div>
      {(t.state === "working" || t.state === "machine") && (
        <div className="mt-1">
          <ProgressBar value={taskProgress(sim, t)} tone={t.state === "machine" ? "yellow" : "blue"} />
        </div>
      )}
    </button>
  );
}

function Gauge({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const r = value / Math.max(1, max);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
      <div className="mb-0.5 font-mono text-[12px] text-white/90">
        {unit === "kg" ? value.toFixed(1) : Math.round(value)}
        <span className="text-white/40">
          {" "}/ {max} {unit}
        </span>
      </div>
      <ProgressBar value={r} tone={r < 0.25 ? "red" : r < 0.5 ? "yellow" : "green"} />
    </div>
  );
}

export default function KitchenDisplay({ sim }: { sim: BranchSimulation }) {
  const [filter, setFilter] = useState<string | null>(null);
  const tasks = [...sim.tasks.values()].filter((t) => t.kind !== "clean").sort((a, b) => a.priority - b.priority);
  const targets = chickenTargets(sim);
  const recent = [...sim.orders.values()]
    .filter((o) => o.readyAt !== undefined)
    .sort((a, b) => b.readyAt! - a.readyAt!)
    .slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-white/[0.06] bg-white/[0.025] p-2.5">
        <Gauge label="Wings held" value={sim.chickenStock.wing} max={targets.wing} unit="pcs" />
        <Gauge label="Drums held" value={sim.chickenStock.drum} max={targets.drum} unit="pcs" />
        <Gauge label="Rice warmer" value={sim.riceStockKg} max={riceCapacityKg(sim)} unit="kg" />
      </div>

      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => setFilter(null)} className={cx("rounded-md px-2 py-0.5 text-[10.5px]", !filter ? "bg-white/15 text-white" : "bg-white/5 text-white/55 hover:text-white")}>
          All stations
        </button>
        {STATIONS.map((s) => {
          const n = tasks.filter((t) => s.ws.includes(t.ws)).length;
          return (
            <button key={s.key} type="button" onClick={() => setFilter(filter === s.key ? null : s.key)} className={cx("rounded-md px-2 py-0.5 text-[10.5px]", filter === s.key ? "bg-white/15 text-white" : "bg-white/5 text-white/55 hover:text-white")}>
              {s.label} <span className="font-mono text-white/40">{n}</span>
            </button>
          );
        })}
      </div>

      {STATIONS.filter((s) => !filter || s.key === filter).map((s) => {
        const list = tasks.filter((t) => s.ws.includes(t.ws));
        if (!list.length && !filter) return null;
        const active = list.filter((t) => t.state !== "pending");
        const queued = list.filter((t) => t.state === "pending");
        return (
          <div key={s.key}>
            <SectionTitle right={<span className="font-mono text-[10px] text-white/40">{active.length} active · {queued.length} queued</span>}>{s.label}</SectionTitle>
            <div className="grid gap-1.5">
              {[...active, ...queued].slice(0, filter ? 40 : 6).map((t, i) => (
                <Ticket key={t.id} sim={sim} t={t} rank={i - active.length} />
              ))}
              {!filter && list.length > 6 && <div className="text-center text-[10px] text-white/35">+{list.length - 6} more</div>}
              {!list.length && <div className="text-[11px] text-white/35">Station idle.</div>}
            </div>
          </div>
        );
      })}
      {!filter && tasks.length === 0 && <p className="text-[11px] text-white/40">Kitchen is idle — no tickets.</p>}

      <div>
        <SectionTitle>Recently ready</SectionTitle>
        <ul className="space-y-0.5 text-[11px]">
          {recent.map((o) => (
            <li key={o.id} className="flex justify-between gap-2 text-white/65">
              <span className="font-mono">#{o.number}</span>
              <span className="truncate">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</span>
              <span className="shrink-0 font-mono text-white/40">{clock(simMs(sim, o.readyAt!))}</span>
            </li>
          ))}
          {!recent.length && <li className="text-white/35">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Compose a simulated order from the real menu and inject it into the kitchen. */
export function OrderComposer({ sim }: { sim: BranchSimulation }) {
  const user = useApp((s) => s.user);
  const followOrder = useApp((s) => s.followOrder);
  const notify = useApp((s) => s.notify);
  const [lines, setLines] = useState<Array<{ menuId: string; qty: number }>>([]);
  const [pick, setPick] = useState(MENU[0].id);
  const [channel, setChannel] = useState<Channel>("online");
  // Injected orders are remote (delivery): walk-in pickups are generated by simulated customers who collect them.
  const fulfilment: Fulfilment = "delivery";
  const allowed = can(user, "act:orders") || can(user, "control:simulation");
  const total = lines.reduce((s, l) => s + (MENU_BY_ID.get(l.menuId)?.price ?? 0) * l.qty, 0);
  const cats = [...new Set(MENU.map((m) => m.category))];

  const place = (ls: Array<{ menuId: string; qty: number }>) => {
    const o = sim.placeOrder(ls, channel, fulfilment);
    followOrder(o.id);
    notify(`Order #${o.number} sent to the kitchen`, "success");
    setLines([]);
  };

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
      <SectionTitle>New order</SectionTitle>
      <div className="flex gap-1.5">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Menu item">
          {cats.map((c) => (
            <optgroup key={c} label={c}>
              {MENU.filter((m) => m.category === c).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {ghs(m.price)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Btn size="xs" onClick={() => setLines((ls) => (ls.some((l) => l.menuId === pick) ? ls.map((l) => (l.menuId === pick ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { menuId: pick, qty: 1 }]))}>
          <Plus size={12} /> Add
        </Btn>
      </div>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px]">
          {lines.map((l) => (
            <li key={l.menuId} className="flex items-center justify-between gap-2 text-white/75">
              <span className="truncate">
                {l.qty}× {MENU_BY_ID.get(l.menuId)?.name}
              </span>
              <button type="button" className="text-white/40 hover:text-red-300" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.menuId !== l.menuId))}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
          <li className="flex justify-between border-t border-white/10 pt-0.5 font-semibold text-white">
            <span>Total</span>
            <span className="font-mono">{ghs(total)}</span>
          </li>
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Channel">
          {(["online", "chris-b-app", "phone", "delivery-partner"] as Channel[]).map((c) => (
            <option key={c} value={c}>
              {channelLabel(c)}
            </option>
          ))}
        </select>
        <Btn size="xs" tone="red" disabled={!allowed || !lines.length} title={allowed ? undefined : "Your role cannot create orders"} onClick={() => place(lines)}>
          Send to kitchen
        </Btn>
        <Btn size="xs" disabled={!allowed} title="Large Chicken Pizza + PlayMan Jollof (demo scenario)" onClick={() => place([{ menuId: "pz-chicken-l", qty: 1 }, { menuId: "rc-playman-jollof", qty: 1 }])}>
          Demo order
        </Btn>
      </div>
      <p className="mt-1.5 text-[10px] text-white/35">Menu names and prices from the public Chris B catalogue.</p>
    </div>
  );
}
