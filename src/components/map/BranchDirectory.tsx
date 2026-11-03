"use client";

import { ArrowDown, ArrowUp, Download, ExternalLink, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, SimBadge, StatusDot, VerifiedBadge, cx } from "@/components/ui/primitives";
import { ghs } from "@/lib/format";
import { useSnapshots } from "@/lib/hooks/useSim";
import { GHANA_REGIONS, type Branch } from "@/lib/network/branches";
import type { BranchSnapshot } from "@/lib/network/network";
import { useApp } from "@/store/app";
import { hoursLabel } from "./BranchCard";
import { STATUS_LABEL, filterBranches, requestFlyTo, useMapFilters } from "./mapState";

type Row = { b: Branch; s: BranchSnapshot };
type Key = "name" | "region" | "city" | "format" | "status" | "sales" | "orders" | "ticket" | "active" | "prep" | "alerts";

const SEV = { closed: 0, normal: 1, warning: 2, critical: 3 };
const COLS: Array<{ key: Key; label: string; num?: boolean; get: (r: Row) => string | number }> = [
  { key: "name", label: "Branch", get: (r) => r.b.name },
  { key: "region", label: "Region", get: (r) => r.b.region },
  { key: "city", label: "City", get: (r) => r.b.city },
  { key: "format", label: "Format", get: (r) => r.b.floorPlanType },
  { key: "status", label: "Status", get: (r) => SEV[r.s.status] },
  { key: "sales", label: "Revenue today", num: true, get: (r) => r.s.salesToday },
  { key: "orders", label: "Orders", num: true, get: (r) => r.s.ordersToday },
  { key: "ticket", label: "Avg ticket", num: true, get: (r) => r.s.avgTicket },
  { key: "active", label: "Active", num: true, get: (r) => r.s.activeOrders },
  { key: "prep", label: "Avg prep", num: true, get: (r) => r.s.avgPrepMin },
  { key: "alerts", label: "Alerts", num: true, get: (r) => r.s.equipmentAlerts + r.s.delayed + r.s.lowStock },
];

function csv(rows: Row[]) {
  const head = ["id", "branch", "brand", "region", "city", "format", "status", "revenue_today_ghs_simulated", "orders_today_simulated", "avg_ticket_ghs_simulated", "active_orders_simulated", "avg_prep_min_simulated", "issue_simulated", "store_hours", "lat", "lng", "source", "last_verified"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map(({ b, s }) => [b.id, b.name, b.brand, b.region, b.city, b.floorPlanType, s.status, s.salesToday, s.ordersToday, s.avgTicket, s.activeOrders, s.avgPrepMin, s.issue ?? "", hoursLabel(b), b.lat, b.lng, b.source, b.lastVerified].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

/** Sortable directory of every branch with simulated revenue (overlay on the map). */
export default function BranchDirectory() {
  const snaps = useSnapshots();
  const { user, regionFilter, statusFilter, search, setFilters, selectBranch, enterBranch, selectedBranchId } = useApp();
  const { format, setFormat, pinkberry } = useMapFilters();
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "sales", dir: -1 });
  const [open, setOpen] = useState(true);

  const rows = useMemo(() => {
    const list = filterBranches(snaps, { user, regionFilter, statusFilter, search, format, pinkberry });
    const col = COLS.find((c) => c.key === sort.key)!;
    return list.sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }, [snaps, user, regionFilter, statusFilter, search, format, pinkberry, sort]);

  const totals = rows.reduce((t, { s }) => ({ sales: t.sales + s.salesToday, orders: t.orders + s.ordersToday, active: t.active + s.activeOrders, alerts: t.alerts + s.equipmentAlerts + s.delayed + s.lowStock }), { sales: 0, orders: 0, active: 0, alerts: 0 });
  const focus = (id: string) => {
    selectBranch(id);
    requestFlyTo(id);
  };
  const download = () => {
    const blob = new Blob([csv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pmcm-branches-simulated-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!open)
    return (
      <Btn className="glass absolute bottom-14 left-1/2 z-20 -translate-x-1/2" onClick={() => setOpen(true)}>
        Show branch directory ({rows.length})
      </Btn>
    );

  return (
    <section aria-label="Branch directory" className="glass animate-fade-in absolute inset-x-3 bottom-3 top-3 z-20 flex flex-col overflow-hidden rounded-xl !bg-[#0b0e13]/95 md:right-11">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-3">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-bold text-white">Restaurant branches</h2>
            <VerifiedBadge label="OFFICIAL DIRECTORY" />
            <SimBadge label="METRICS SIMULATED" />
          </div>
          <p className="mt-0.5 text-[11px] text-white/45">
            {rows.length} of 70 branches · revenue today <span className="font-semibold text-white">{ghs(totals.sales)}</span> · {totals.orders.toLocaleString()} orders
          </p>
        </div>
        <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1">
          <Search size={13} className="text-white/40" />
          <input value={search} onChange={(e) => setFilters({ search: e.target.value })} placeholder="Search" className="w-28 bg-transparent text-xs text-white outline-none placeholder:text-white/35" aria-label="Search branches" />
        </label>
        <select value={regionFilter ?? ""} onChange={(e) => setFilters({ regionFilter: e.target.value || null })} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Region">
          <option value="">All regions</option>
          {GHANA_REGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={statusFilter ?? ""} onChange={(e) => setFilters({ statusFilter: e.target.value || null })} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={format ?? ""} onChange={(e) => setFormat((e.target.value || null) as "A" | "B" | "C" | null)} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Format">
          <option value="">All formats</option>
          <option value="A">Model A</option>
          <option value="B">Model B</option>
          <option value="C">Model C</option>
        </select>
        <Btn size="xs" onClick={download} title="Download the filtered table as CSV">
          <Download size={12} /> CSV
        </Btn>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-white/40 hover:text-white" aria-label="Hide directory">
          <X size={15} />
        </button>
      </header>

      {/* Desktop table */}
      <div className="scroll-thin hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-[#0e1117]">
            <tr className="text-left text-[10px] uppercase tracking-wider text-white/45">
              {COLS.map((c) => (
                <th key={c.key} className={cx("px-2 py-2 font-semibold", c.num && "text-right", c.key === "name" && "pl-4")} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.num ? -1 : 1 }))} className={cx("inline-flex items-center gap-1 hover:text-white", sort.key === c.key && "text-white")}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                </th>
              ))}
              <th className="px-2 py-2 font-semibold">Hours</th>
              <th className="px-2 py-2 pr-4 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, s }) => (
              <tr key={b.id} onClick={() => focus(b.id)} className={cx("cursor-pointer border-t border-white/5 hover:bg-white/[0.04]", selectedBranchId === b.id && "bg-white/[0.07]")}>
                <td className="py-1.5 pl-4 pr-2">
                  <div className="font-medium text-white">{b.name}</div>
                  <div className="text-[10px] text-white/35">{b.brand.includes("Pinkberry") ? "+ Pinkberry" : b.siteContext ?? ""}</div>
                </td>
                <td className="whitespace-nowrap px-2 text-white/65">{b.region}</td>
                <td className="px-2 text-white/65">{b.city}</td>
                <td className="px-2">
                  <span className="rounded border border-white/10 px-1.5 py-px font-mono text-[10px] text-white/70" title={`${b.floorPlanReason} (conceptual layout)`}>
                    {b.floorPlanType}
                  </span>
                </td>
                <td className="px-2">
                  <span className="inline-flex items-center gap-1.5" title={s.issue}>
                    <StatusDot status={s.status} />
                    <span className="text-white/75">{STATUS_LABEL[s.status]}</span>
                  </span>
                </td>
                <td className="px-2 text-right font-mono font-semibold tabular-nums text-white">{ghs(s.salesToday)}</td>
                <td className="px-2 text-right font-mono tabular-nums text-white/75">{s.ordersToday}</td>
                <td className="px-2 text-right font-mono tabular-nums text-white/75">{ghs(s.avgTicket)}</td>
                <td className="px-2 text-right font-mono tabular-nums text-white/75">{s.activeOrders}</td>
                <td className="px-2 text-right font-mono tabular-nums text-white/75">{s.avgPrepMin ? `${s.avgPrepMin.toFixed(1)}m` : "—"}</td>
                <td className={cx("px-2 text-right font-mono tabular-nums", s.status === "critical" ? "text-red-400" : s.status === "warning" ? "text-amber-300" : "text-white/40")}>{s.equipmentAlerts + s.delayed + s.lowStock}</td>
                <td className="whitespace-nowrap px-2 text-[10.5px] text-white/50">{b.is24h ? "24 h" : `${b.hours.storeOpen}–${b.hours.storeClose}`}</td>
                <td className="whitespace-nowrap px-2 pr-4 text-right">
                  <button type="button" onClick={(e) => (e.stopPropagation(), enterBranch(b.id))} className="mr-2 rounded-md bg-brand-red px-2 py-0.5 text-[10.5px] font-semibold text-white hover:bg-brand-red/85">
                    Open twin
                  </button>
                  <a href={b.source} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center text-white/40 hover:text-white" title={`Official record · verified ${b.lastVerified}`} aria-label={`Official directory record for ${b.name}`}>
                    <ExternalLink size={12} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-[#0e1117]">
            <tr className="border-t border-white/10 text-[11px] font-semibold text-white">
              <td className="py-2 pl-4" colSpan={5}>
                Total · {rows.length} branches
              </td>
              <td className="px-2 text-right font-mono tabular-nums">{ghs(totals.sales)}</td>
              <td className="px-2 text-right font-mono tabular-nums">{totals.orders.toLocaleString()}</td>
              <td className="px-2 text-right font-mono tabular-nums">{totals.orders ? ghs(totals.sales / totals.orders) : "—"}</td>
              <td className="px-2 text-right font-mono tabular-nums">{totals.active}</td>
              <td />
              <td className="px-2 text-right font-mono tabular-nums">{totals.alerts}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3 md:hidden">
        <li className="flex gap-1.5 overflow-x-auto pb-1 text-[10.5px]">
          {(["sales", "orders", "name", "status"] as Key[]).map((k) => (
            <button key={k} type="button" onClick={() => setSort({ key: k, dir: k === "name" ? 1 : -1 })} className={cx("shrink-0 rounded-full border px-2 py-0.5", sort.key === k ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50")}>
              Sort: {COLS.find((c) => c.key === k)!.label}
            </button>
          ))}
        </li>
        {rows.map(({ b, s }) => (
          <li key={b.id} className="rounded-lg border border-white/5 bg-white/[0.03] p-3" onClick={() => focus(b.id)}>
            <div className="flex items-center gap-2">
              <StatusDot status={s.status} />
              <span className="font-medium text-white">{b.name}</span>
              <span className="ml-auto font-mono text-sm font-semibold text-white">{ghs(s.salesToday)}</span>
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-white/50">
              <span>
                {b.city} · {b.region} · Model {b.floorPlanType}
              </span>
              <span>
                {s.ordersToday} orders · {s.activeOrders} active
              </span>
            </div>
            {s.issue && <div className={cx("mt-1 text-[10.5px]", s.status === "critical" ? "text-red-300" : "text-amber-200")}>{s.issue}</div>}
            <button type="button" onClick={(e) => (e.stopPropagation(), enterBranch(b.id))} className="mt-2 w-full rounded-md bg-brand-red py-1 text-[11px] font-semibold text-white">
              Open digital twin
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
