"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { SimBadge, Stat, cx } from "@/components/ui/primitives";
import { ghs, ghsCompact } from "@/lib/format";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import type { BranchSnapshot } from "@/lib/network/network";
import { useApp } from "@/store/app";
import { requestFlyTo, useMapFilters } from "./mapState";

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

/** Floating national KPI card on the Ghana map (simulated metrics). */
export default function NationalDashboard({ snaps }: { snaps: BranchSnapshot[] }) {
  const open = useMapFilters((s) => s.dashboardOpen);
  const toggle = useMapFilters((s) => s.toggleDashboard);
  const selectBranch = useApp((s) => s.selectBranch);
  const t = nationalTotals(snaps);
  const top = [...snaps].sort((a, b) => b.salesToday - a.salesToday).slice(0, 5);
  const max = top[0]?.salesToday || 1;

  return (
    <div className="glass absolute left-3 top-3 z-10 w-[min(330px,calc(100%-1.5rem))] rounded-xl">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">National overview</div>
          <div className="font-display text-xl font-bold tabular-nums text-white">
            {ghs(t.sales)} <span className="text-[11px] font-medium text-white/45">revenue today</span>
          </div>
        </div>
        <SimBadge />
        {open ? <ChevronUp size={15} className="text-white/50" /> : <ChevronDown size={15} className="text-white/50" />}
      </button>
      {open && (
        <div className="border-t border-white/5 px-3.5 pb-3 pt-2.5">
          <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
            <Stat label="Branches" value={t.total} sub={`${t.open} open now`} />
            <Stat label="Active orders" value={t.active.toLocaleString()} />
            <Stat label="Orders today" value={t.orders.toLocaleString()} />
            <Stat label="Avg prep" value={`${t.avgPrep.toFixed(1)}m`} />
            <Stat label="Kitchen util." value={`${Math.round(t.avgLoad * 100)}%`} />
            <Stat label="Staff on duty" value={t.staff} />
            <Stat label="Critical" value={t.critical} tone={t.critical ? "red" : "green"} sub="branches" />
            <Stat label="Warnings" value={t.warning} tone={t.warning ? "yellow" : "default"} sub="branches" />
            <Stat label="Equip. health" value={`${Math.round(t.equipmentHealth * 100)}%`} sub={`${t.lowStock} low-stock`} />
          </div>
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/45">Top revenue today</div>
          <ol className="mt-1.5 space-y-1">
            {top.map((s, i) => (
              <li key={s.branchId}>
                <button
                  type="button"
                  className="group flex w-full items-center gap-2 text-left text-[11.5px]"
                  onClick={() => {
                    selectBranch(s.branchId);
                    requestFlyTo(s.branchId);
                  }}
                >
                  <span className="w-3 font-mono text-white/35">{i + 1}</span>
                  <span className="w-24 truncate text-white/80 group-hover:text-white">{BRANCH_BY_ID.get(s.branchId)?.name}</span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[#3987e5]" style={{ width: `${(s.salesToday / max) * 100}%` }} />
                  </span>
                  <span className={cx("w-14 text-right font-mono tabular-nums text-white/75")}>{ghsCompact(s.salesToday)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
