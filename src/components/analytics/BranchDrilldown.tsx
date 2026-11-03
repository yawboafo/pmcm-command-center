"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Btn, Empty, SimBadge, Stat, StatusDot, cx } from "@/components/ui/primitives";
import { clock, ghs } from "@/lib/format";
import { useSnapshots, useTick } from "@/lib/hooks/useSim";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { channelLabel } from "@/lib/sim/engine";
import type { Channel } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import { Card, DarkTooltip, GRID, SINGLE, axisProps } from "./chartKit";

const BINS = [
  [0, 10, "<10m"],
  [10, 15, "10–15m"],
  [15, 20, "15–20m"],
  [20, 25, "20–25m"],
  [25, 30, "25–30m"],
  [30, 999, "30m+"],
] as const;

function HBars({ data, fmt, height = 22, labelWidth = 120 }: { data: Array<{ name: string; v: number }>; fmt: (v: number) => string; height?: number; labelWidth?: number }) {
  if (!data.length) return <Empty>No data yet — check back in a few minutes.</Empty>;
  return (
    <div style={{ height: Math.max(80, data.length * height) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={labelWidth} {...axisProps} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--grid)" }} content={<DarkTooltip format={fmt} />} />
          <Bar isAnimationActive={false} dataKey="v" name="Value" fill={SINGLE} radius={[0, 4, 4, 0]} maxBarSize={14}>
            <LabelList dataKey="v" position="right" formatter={(v: unknown) => fmt(Number(v))} style={{ fill: "var(--axis)", fontSize: 10.5 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Per-branch analytics: full-simulation detail when the branch twin is running. */
export default function BranchDrilldown({ branchId, onPick, rows }: { branchId: string | null; onPick: (id: string) => void; rows: Array<{ id: string; name: string }> }) {
  useTick();
  const snaps = useSnapshots();
  const enterBranch = useApp((s) => s.enterBranch);
  // Default: a branch whose full simulation is running, else the top-revenue branch.
  const live = rows.find((r) => sims().peek(r.id));
  const top = [...snaps].filter((s) => rows.some((r) => r.id === s.branchId)).sort((a, c) => c.salesToday - a.salesToday)[0];
  const id = branchId ?? live?.id ?? top?.branchId ?? rows[0]?.id ?? null;
  const b = id ? BRANCH_BY_ID.get(id) : null;
  const snap = snaps.find((s) => s.branchId === id);
  const sim = id ? sims().peek(id) : undefined;

  const picker = (
    <select value={id ?? ""} onChange={(e) => onPick(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white" aria-label="Branch for drill-down">
      {[...rows].sort((a, c) => a.name.localeCompare(c.name)).map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );

  if (!b || !snap) return <Card title="Branch drill-down">{picker}</Card>;

  if (!sim) {
    return (
      <Card title={`Branch drill-down · ${b.name}`} sub="Lightweight network model (seeded demand curve × published opening hours)" right={picker}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Revenue today" value={ghs(snap.salesToday)} />
          <Stat label="Orders" value={snap.ordersToday} />
          <Stat label="Avg ticket" value={ghs(snap.avgTicket)} />
          <Stat label="Active" value={snap.activeOrders} />
          <Stat label="Avg prep" value={`${snap.avgPrepMin}m`} />
          <Stat label="Kitchen load" value={`${Math.round(snap.kitchenLoad * 100)}%`} />
          <Stat label="Status" value={<span className="flex items-center gap-1.5 text-sm"><StatusDot status={snap.status} /> {snap.status}</span>} sub={snap.issue} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-xs text-white/60">
          Workstation utilisation, channel mix, prep-time distribution, inventory consumption, food-safety and delivery analytics come from the branch twin.
          <div className="ml-auto flex gap-2">
            <Btn onClick={() => (sims().get(b.id), onPick(b.id))}>Start simulation here</Btn>
            <Btn tone="red" onClick={() => enterBranch(b.id)}>
              Open digital twin
            </Btn>
          </div>
        </div>
      </Card>
    );
  }

  const m = sim.metrics();
  const orders = [...sim.orders.values()];
  const util = sim.utilizationByWorkstation().map((w) => ({ name: w.name, v: w.utilization })).sort((a, c) => c.v - a.v);
  const channels = new Map<Channel, number>();
  for (const o of orders) channels.set(o.channel, (channels.get(o.channel) ?? 0) + 1);
  const channelData = [...channels].map(([c, v]) => ({ name: channelLabel(c), v })).sort((a, c) => c.v - a.v);
  const prep = orders.filter((o) => o.readyAt !== undefined && o.acceptedAt !== undefined).map((o) => (o.readyAt! - o.acceptedAt!) / 60);
  const prepData = BINS.map(([lo, hi, label]) => ({ name: label, v: prep.filter((p) => p >= lo && p < hi).length }));
  const usage = new Map<string, number>();
  for (const l of sim.ledger) if (l.delta < 0) usage.set(l.sku, (usage.get(l.sku) ?? 0) - l.delta);
  const usageData = [...usage]
    .map(([sku, q]) => {
      const item = sim.inventory.find((i) => i.sku === sku);
      return { name: item?.name ?? sku, v: q * (item?.unitCost ?? 0), q, unit: item?.unit ?? "" };
    })
    .sort((a, c) => c.v - a.v)
    .slice(0, 8);
  const checks = sim.cookChecks;
  const pass = checks.filter((c) => c.pass).length;
  const deliveries = orders.filter((o) => o.delivery);
  const dStat = (s: string) => deliveries.filter((o) => o.delivery!.status === s).length;
  const delivered = deliveries.filter((o) => o.delivery!.deliveredAt !== undefined && o.delivery!.collectedAt !== undefined);
  const avgDeliv = delivered.length ? delivered.reduce((a, o) => a + (o.delivery!.deliveredAt! - o.delivery!.collectedAt!) / 60, 0) / delivered.length : 0;

  return (
    <Card
      title={`Branch drill-down · ${b.name}`}
      sub={`Branch twin running · Model ${sim.plan.format} conceptual layout · ${orders.length} orders since the twin opened`}
      right={
        <div className="flex items-center gap-2">
          <SimBadge />
          {picker}
          <Btn size="xs" tone="red" onClick={() => enterBranch(b.id)}>
            Open twin
          </Btn>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Revenue today" value={ghs(m.sales)} />
        <Stat label="Orders today" value={m.ordersToday} />
        <Stat label="Completed" value={m.completed} />
        <Stat label="Active / delayed" value={`${m.activeOrders} / ${m.delayed}`} tone={m.delayed ? "yellow" : "default"} />
        <Stat label="Avg prep" value={`${m.avgPrepMin.toFixed(1)}m`} />
        <Stat label="Customer wait" value={`${m.avgCustomerWaitMin.toFixed(1)}m`} sub={`${m.lostCustomers} walked away`} />
        <Stat label="Open alerts" value={m.openAlerts} tone={m.criticalAlerts ? "red" : "default"} sub={`${m.criticalAlerts} critical`} />
        <Stat label="Low stock" value={m.lowStock} tone={m.lowStock ? "yellow" : "default"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div>
          <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">Workstation utilisation</h4>
          <HBars data={util} fmt={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <div>
          <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">Orders by channel</h4>
          <HBars data={channelData} fmt={(v) => String(v)} labelWidth={110} />
          <h4 className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">Prep time (accepted → ready)</h4>
          <div style={{ height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={prepData} margin={{ top: 14, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" {...axisProps} tick={{ ...axisProps.tick, fontSize: 9.5 }} />
                <YAxis {...axisProps} width={28} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--grid)" }} content={<DarkTooltip format={(v) => `${v} orders`} />} />
                <Bar isAnimationActive={false} dataKey="v" name="Orders" fill={SINGLE} radius={[4, 4, 0, 0]} maxBarSize={28}>
                  <LabelList dataKey="v" position="top" style={{ fill: "var(--axis)", fontSize: 10 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">Inventory consumption (cost)</h4>
          <HBars data={usageData} fmt={(v) => ghs(v)} labelWidth={140} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">Food-safety history</h4>
          <div className="mb-2 grid grid-cols-3 gap-3">
            <Stat label="Core-temp checks" value={checks.length} />
            <Stat label="Pass rate" value={checks.length ? `${Math.round((pass / checks.length) * 100)}%` : "—"} tone={checks.length && pass < checks.length ? "yellow" : "green"} />
            <Stat label="Lowest reading" value={checks.length ? `${Math.min(...checks.map((c) => c.valueC)).toFixed(1)}°C` : "—"} />
          </div>
          {sim.alerts.length ? (
            <ul className="scroll-thin max-h-36 space-y-1 overflow-y-auto text-[11px]">
              {sim.alerts.slice(0, 12).map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="font-mono text-white/35">{clock(a.openedAt)}</span>
                  <span className={cx("w-14 shrink-0 font-semibold uppercase", a.severity === "critical" ? "text-red-400" : "text-amber-300")}>{a.severity}</span>
                  <span className="min-w-0 flex-1 truncate text-white/75">{a.title}</span>
                  <span className={cx("shrink-0 rounded px-1.5 text-[10px]", a.status === "resolved" ? "bg-emerald-500/15 text-emerald-300" : a.status === "acknowledged" ? "bg-amber-500/15 text-amber-200" : "bg-red-500/15 text-red-300")}>{a.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-white/40">No safety alerts raised since the twin opened.</p>
          )}
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">Delivery performance</h4>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <Stat label="Awaiting" value={dStat("AWAITING_DISPATCH")} />
            <Stat label="Rider assigned" value={dStat("RIDER_ASSIGNED")} />
            <Stat label="In transit" value={dStat("IN_TRANSIT")} />
            <Stat label="Delivered" value={dStat("DELIVERED")} tone="green" />
            <Stat label="Delayed" value={dStat("DELAYED")} tone={dStat("DELAYED") ? "yellow" : "default"} />
            <Stat label="Avg trip" value={avgDeliv ? `${avgDeliv.toFixed(0)}m` : "—"} />
          </div>
          <p className="mt-2 text-[10px] text-white/35">Rider coordinates are not connected yet; trip times only.</p>
        </div>
      </div>
    </Card>
  );
}
