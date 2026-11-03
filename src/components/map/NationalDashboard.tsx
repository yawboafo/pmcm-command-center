"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Readout, SimBadge, cx } from "@/components/ui/primitives";
import { ghsCompact } from "@/lib/format";
import type { BranchSnapshot } from "@/lib/network/network";
import { sims } from "@/store/sims";
import { useMapFilters } from "./mapState";

export function nationalTotals(snaps: BranchSnapshot[]) {
  const open = snaps.filter((s) => s.open);
  const sum = (f: (s: BranchSnapshot) => number) => snaps.reduce((a, s) => a + f(s), 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  const withIssues = snaps.filter((s) => s.equipmentAlerts > 0).length;
  return {
    total: snaps.length,
    open: open.length,
    active: sum((s) => s.activeOrders),
    orders: sum((s) => s.ordersToday),
    sales: sum((s) => s.salesToday),
    avgPrep: avg(open.map((s) => s.avgPrepMin).filter(Boolean)),
    avgLoad: avg(open.map((s) => s.kitchenLoad)),
    staff: sum((s) => s.staffOnDuty),
    critical: snaps.filter((s) => s.status === "critical").length,
    warning: snaps.filter((s) => s.status === "warning").length,
    lowStock: snaps.filter((s) => s.lowStock > 0).length,
    equipmentHealth: open.length ? 1 - withIssues / open.length : 1,
  };
}

/**
 * National telemetry ribbon on the Ghana map: the network's state in one line of readouts
 * (simulated metrics), with today's revenue curve. Ranked issues and top branches live in the
 * inspector, so nothing here is duplicated.
 */
export default function NationalDashboard({ snaps }: { snaps: BranchSnapshot[] }) {
  const open = useMapFilters((s) => s.dashboardOpen);
  const toggle = useMapFilters((s) => s.toggleDashboard);
  const t = nationalTotals(snaps);
  const hour = new Date(sims().clock).getUTCHours();
  // Revenue per hour across the network so far today, and cumulative revenue.
  const hourly = Array.from({ length: hour + 1 }, (_, h) => snaps.reduce((a, s) => a + (s.hourlySales[h] ?? 0), 0));
  const cumulative = hourly.reduce<number[]>((acc, v) => (acc.push((acc.at(-1) ?? 0) + v), acc), []);
  const thisHour = hourly.at(-1) ?? 0;
  const lastHour = hourly.at(-2) ?? 0;
  const delta = lastHour ? (thisHour - lastHour) / lastHour : 0;

  return (
    <div className="glass absolute left-3 top-3 z-10 max-w-[calc(100%-28.5rem)] rounded-xl max-md:max-w-[calc(100%-1.5rem)]">
      <div className="flex items-center gap-2 px-3.5 pt-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/45">Network telemetry</span>
        <SimBadge />
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? "Collapse telemetry" : "Expand telemetry"} className="ml-auto rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <div className={cx("grid gap-x-6 gap-y-3 px-3.5 pb-3 pt-2", open ? "grid-cols-[repeat(2,minmax(128px,1fr))] xl:grid-cols-[repeat(4,minmax(128px,1fr))]" : "grid-cols-[repeat(2,minmax(128px,1fr))]")}>
        <Readout label="Revenue today" value={ghsCompact(t.sales)} trend={cumulative} sub={`${ghsCompact(thisHour)} this hour · ${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}% vs last`} />
        <Readout label="Active orders" value={t.active.toLocaleString()} trend={hourly} trendColor="#a5b4fc" sub={`${t.orders.toLocaleString()} today`} />
        {open && (
          <>
            <Readout label="Avg prep" value={t.avgPrep.toFixed(1)} unit="min" tone={t.avgPrep > 15 ? "yellow" : "default"} sub={`${Math.round(t.avgLoad * 100)}% kitchen load`} />
            <Readout
              label="Branches"
              value={`${t.open}/${t.total}`}
              unit="open"
              sub={
                <span className="flex items-center gap-2">
                  <span className={t.critical ? "text-red-300" : ""}>{t.critical} critical</span>
                  <span className={t.warning ? "text-amber-200" : ""}>{t.warning} warning</span>
                  <span>{Math.round(t.equipmentHealth * 100)}% equip.</span>
                </span>
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
