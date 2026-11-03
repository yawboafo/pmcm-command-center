"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SimBadge, Stat, StatusDot, cx } from "@/components/ui/primitives";
import { canSeeBranch } from "@/lib/auth/rbac";
import { ghs, ghsCompact } from "@/lib/format";
import { useSnapshots } from "@/lib/hooks/useSim";
import { BRANCH_BY_ID, GHANA_REGIONS, type Branch } from "@/lib/network/branches";
import type { BranchSnapshot } from "@/lib/network/network";
import { useApp } from "@/store/app";
import BranchDrilldown from "./BranchDrilldown";
import { Card, DarkTooltip, DataTable, Legend, SERIES, SINGLE, SURFACE, axisProps, GRID } from "./chartKit";

type Period = "today" | "last3" | "hour";
type Dim = "branch" | "city" | "region" | "format";
type Metric = "sales" | "orders" | "ticket" | "prep" | "load" | "alerts";

const METRICS: Record<Metric, { label: string; fmt: (v: number) => string }> = {
  sales: { label: "Revenue", fmt: (v) => ghs(v) },
  orders: { label: "Orders", fmt: (v) => Math.round(v).toLocaleString() },
  ticket: { label: "Avg ticket", fmt: (v) => ghs(v) },
  prep: { label: "Avg prep (min)", fmt: (v) => `${v.toFixed(1)} min` },
  load: { label: "Kitchen load", fmt: (v) => `${Math.round(v * 100)}%` },
  alerts: { label: "Alerts", fmt: (v) => Math.round(v).toString() },
};

const HOUR = (h: number) => `${String(h).padStart(2, "0")}:00`;

interface Row {
  b: Branch;
  s: BranchSnapshot;
  /** Revenue in the selected period. */
  rev: number;
  /** Orders in the selected period (estimated from revenue ÷ avg ticket for partial periods). */
  ord: number;
}

function periodRevenue(s: BranchSnapshot, period: Period, hour: number, nowH: number) {
  if (period === "today") return s.salesToday;
  if (period === "hour") return s.hourlySales[hour] ?? 0;
  return s.hourlySales.slice(Math.max(0, nowH - 2), nowH + 1).reduce((a, v) => a + v, 0);
}

function groupKey(b: Branch, dim: Dim) {
  return dim === "branch" ? b.id : dim === "city" ? b.city : dim === "region" ? b.region : `Model ${b.floorPlanType}`;
}
function groupLabel(key: string, dim: Dim) {
  return dim === "branch" ? (BRANCH_BY_ID.get(key)?.name ?? key) : key;
}

function aggregate(rows: Row[]) {
  const n = rows.length || 1;
  const open = rows.filter((r) => r.s.open);
  const sales = rows.reduce((a, r) => a + r.rev, 0);
  const orders = rows.reduce((a, r) => a + r.ord, 0);
  return {
    sales,
    orders,
    ticket: orders ? sales / orders : 0,
    prep: open.length ? open.reduce((a, r) => a + r.s.avgPrepMin, 0) / open.length : 0,
    load: open.length ? open.reduce((a, r) => a + r.s.kitchenLoad, 0) / open.length : 0,
    alerts: rows.reduce((a, r) => a + r.s.equipmentAlerts + r.s.delayed + r.s.lowStock, 0),
    branches: n,
  };
}

export default function AnalyticsView() {
  const snaps = useSnapshots();
  const user = useApp((s) => s.user);
  const [period, setPeriod] = useState<Period>("today");
  const nowH = new Date().getUTCHours();
  const latestHour = useMemo(() => {
    let h = 0;
    for (const s of snaps) for (let i = 0; i < 24; i++) if (s.hourlySales[i] > 0) h = Math.max(h, i);
    return h;
  }, [snaps]);
  const currentH = Math.max(latestHour, 0) || nowH;
  const [hour, setHour] = useState<number | null>(null);
  const selHour = hour ?? currentH;
  const [region, setRegion] = useState<string>("");
  const [format, setFormat] = useState<string>("");
  const [stackBy, setStackBy] = useState<"region" | "format">("region");
  const [drill, setDrill] = useState<string | null>(null);
  const [showTables, setShowTables] = useState(false);

  const rows: Row[] = useMemo(
    () =>
      snaps
        .map((s) => ({ s, b: BRANCH_BY_ID.get(s.branchId)! }))
        .filter(({ b }) => canSeeBranch(user, b) && (!region || b.region === region) && (!format || b.floorPlanType === format))
        .map(({ s, b }) => {
          const rev = periodRevenue(s, period, selHour, currentH);
          return { s, b, rev, ord: period === "today" ? s.ordersToday : s.avgTicket ? rev / s.avgTicket : 0 };
        }),
    [snaps, user, region, format, period, selHour, currentH],
  );
  const total = aggregate(rows);

  // Sales by hour, stacked in ≤3 groups (validated all-pairs palette).
  const groups = stackBy === "region" ? ["Greater Accra", "Ashanti", "Other regions"] : ["Model A", "Model B", "Model C"];
  const groupOf = (b: Branch) => (stackBy === "region" ? (b.region === "Greater Accra" || b.region === "Ashanti" ? b.region : "Other regions") : `Model ${b.floorPlanType}`);
  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, ...Object.fromEntries(groups.map((g) => [g, 0])) }) as Record<string, number>);
    for (const r of rows) for (let h = 0; h < 24; h++) out[h][groupOf(r.b)] += r.s.hourlySales[h] ?? 0;
    return out.filter((d) => d.hour <= currentH);
  }, [rows, stackBy, currentH]); // eslint-disable-line react-hooks/exhaustive-deps

  const byRegion = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.b.region, (m.get(r.b.region) ?? 0) + r.rev);
    return [...m].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
  }, [rows]);

  const ranked = useMemo(() => [...rows].sort((a, b) => b.rev - a.rev), [rows]);
  const top10 = ranked.slice(0, 10).map((r) => ({ id: r.b.id, name: r.b.name, v: r.rev, status: r.s.status }));
  const bottom10 = ranked.filter((r) => r.s.open).slice(-10).reverse().map((r) => ({ id: r.b.id, name: r.b.name, v: r.rev, status: r.s.status }));

  const periodLabel = period === "today" ? "today so far" : period === "last3" ? `last 3 hours (${HOUR(Math.max(0, currentH - 2))}–now)` : `${HOUR(selHour)}–${HOUR(selHour + 1)}`;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
        <header className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-bold text-white">Network analytics</h1>
              <SimBadge label="SIMULATED DEMO ANALYTICS" />
            </div>
            <p className="mt-0.5 text-xs text-white/45">Sales, orders and operations across the branch network.</p>
          </div>
        </header>

        {/* Filters: one row, above everything they scope */}
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Time period">
            {(
              [
                ["today", "Today so far"],
                ["last3", "Last 3 hours"],
                ["hour", "By hour"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPeriod(k)} className={cx("rounded-md px-2.5 py-1", period === k ? "bg-white/15 text-white" : "text-white/55 hover:text-white")}>
                {l}
              </button>
            ))}
          </div>
          {period === "hour" && (
            <select value={selHour} onChange={(e) => setHour(Number(e.target.value))} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white" aria-label="Hour">
              {Array.from({ length: currentH + 1 }, (_, h) => (
                <option key={h} value={h}>
                  {HOUR(h)}–{HOUR(h + 1)}
                </option>
              ))}
            </select>
          )}
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white" aria-label="Region">
            <option value="">All regions</option>
            {GHANA_REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white" aria-label="Format">
            <option value="">All formats</option>
            <option value="A">Model A · compact</option>
            <option value="B">Model B · standard</option>
            <option value="C">Model C · flagship</option>
          </select>
          <label className="ml-auto flex items-center gap-1.5 text-white/50">
            <input type="checkbox" checked={showTables} onChange={(e) => setShowTables(e.target.checked)} /> Show data tables
          </label>
        </div>

        {/* KPI row */}
        <div className="glass grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label={`Revenue · ${period === "today" ? "today" : period === "last3" ? "last 3h" : HOUR(selHour)}`} value={ghsCompact(total.sales)} />
          <Stat label="Orders" value={Math.round(total.orders).toLocaleString()} />
          <Stat label="Avg ticket" value={ghs(total.ticket)} />
          <Stat label="Active orders" value={rows.reduce((a, r) => a + r.s.activeOrders, 0).toLocaleString()} sub="right now" />
          <Stat label="Avg prep" value={`${total.prep.toFixed(1)}m`} sub="open branches" />
          <Stat label="Kitchen util." value={`${Math.round(total.load * 100)}%`} />
          <Stat label="Staff on duty" value={rows.reduce((a, r) => a + r.s.staffOnDuty, 0)} />
          <Stat label="Open issues" value={rows.filter((r) => r.s.status === "critical" || r.s.status === "warning").length} tone={rows.some((r) => r.s.status === "critical") ? "red" : "default"} sub={`${rows.filter((r) => r.s.status === "critical").length} critical`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card
            className="xl:col-span-2"
            title="Sales by hour"
            sub={`Revenue per hour, stacked by ${stackBy}`}
            right={
              <div className="flex items-center gap-3">
                <Legend items={groups.map((g, i) => ({ label: g, color: SERIES[i] }))} />
                <div className="flex rounded-md border border-white/10 p-0.5 text-[10.5px]">
                  {(["region", "format"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setStackBy(k)} className={cx("rounded px-2 py-0.5", stackBy === k ? "bg-white/15 text-white" : "text-white/50")}>
                      {k === "region" ? "Region" : "Format"}
                    </button>
                  ))}
                </div>
              </div>
            }
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} onClick={(e) => e?.activeLabel !== undefined && (setPeriod("hour"), setHour(Number(e.activeLabel)))}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} {...axisProps} />
                  <YAxis tickFormatter={(v) => ghsCompact(v)} {...axisProps} width={64} />
                  <Tooltip cursor={{ fill: "var(--grid)" }} content={<DarkTooltip format={ghs} labelFormat={(l) => `${HOUR(Number(l))}–${HOUR(Number(l) + 1)}`} />} />
                  {groups.map((g, i) => (
                    <Bar isAnimationActive={false} key={g} dataKey={g} name={g} stackId="s" fill={SERIES[i]} stroke={SURFACE} strokeWidth={1} radius={i === groups.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[10px] text-white/35">Click an hour to analyse it. Hours before branch opening times are empty (published store hours).</p>
            {showTables && <DataTable rows={hourly.map((h) => ({ hour: HOUR(h.hour), ...Object.fromEntries(groups.map((g) => [g, h[g]])) }))} columns={[{ key: "hour", label: "Hour" }, ...groups.map((g) => ({ key: g, label: g, num: true, fmt: ghs }))]} />}
          </Card>

          <Card title="Revenue by region" sub={periodLabel[0].toUpperCase() + periodLabel.slice(1)}>
            <div style={{ height: Math.max(160, byRegion.length * 26) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byRegion} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={118} {...axisProps} axisLine={false} />
                  <Tooltip cursor={{ fill: "var(--grid)" }} content={<DarkTooltip format={ghs} />} />
                  <Bar isAnimationActive={false} dataKey="v" name="Revenue" fill={SINGLE} radius={[0, 4, 4, 0]} maxBarSize={16}>
                    <LabelList dataKey="v" position="right" formatter={(v: unknown) => ghsCompact(Number(v))} style={{ fill: "var(--axis)", fontSize: 10.5 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Leaderboard title="Top 10 branches by revenue" data={top10} periodLabel={periodLabel} onPick={setDrill} />
          <Leaderboard title="Lowest 10 open branches" data={bottom10} periodLabel={periodLabel} onPick={setDrill} muted />
        </div>

        <Comparison rows={rows} periodLabel={periodLabel} />

        <BranchDrilldown branchId={drill} onPick={setDrill} rows={rows.map((r) => ({ id: r.b.id, name: r.b.name }))} />
      </div>
    </div>
  );
}

function Leaderboard({ title, data, periodLabel, onPick, muted }: { title: string; data: Array<{ id: string; name: string; v: number; status: BranchSnapshot["status"] }>; periodLabel: string; onPick: (id: string) => void; muted?: boolean }) {
  return (
    <Card title={title} sub={`Revenue · ${periodLabel} · click a bar to drill down`}>
      <div style={{ height: Math.max(120, data.length * 28) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 70, left: 0, bottom: 0 }} onClick={(e) => e?.activeLabel && onPick(data.find((d) => d.name === e.activeLabel)?.id ?? "")}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={120} {...axisProps} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--grid)" }} content={<DarkTooltip format={ghs} />} />
            <Bar isAnimationActive={false} dataKey="v" name="Revenue" radius={[0, 4, 4, 0]} maxBarSize={18} className="cursor-pointer">
              {data.map((d) => (
                <Cell key={d.id} fill={SINGLE} fillOpacity={muted ? 0.55 : 1} />
              ))}
              <LabelList dataKey="v" position="right" formatter={(v: unknown) => ghs(Number(v))} style={{ fill: "var(--axis)", fontSize: 10.5, fontFamily: "var(--font-geist-mono)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/40">
        {data.filter((d) => d.status !== "normal").map((d) => (
          <span key={d.id} className="flex items-center gap-1">
            <StatusDot status={d.status} /> {d.name}: {d.status}
          </span>
        ))}
      </div>
    </Card>
  );
}

function Comparison({ rows, periodLabel }: { rows: Row[]; periodLabel: string }) {
  const [dim, setDim] = useState<Dim>("region");
  const [metric, setMetric] = useState<Metric>("sales");
  const options = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = groupKey(r.b, dim);
      m.set(k, (m.get(k) ?? 0) + r.rev);
    }
    return [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [rows, dim]);
  const [picked, setPicked] = useState<Record<Dim, string[]>>({ branch: ["branch-015", "branch-033", "branch-046"], city: ["Accra", "Kumasi"], region: ["Greater Accra", "Ashanti"], format: ["Model A", "Model B", "Model C"] });
  const chosen = picked[dim].filter((k) => options.includes(k));
  const entities = chosen.map((k, i) => ({ key: k, label: groupLabel(k, dim), color: SERIES[i], agg: aggregate(rows.filter((r) => groupKey(r.b, dim) === k)) }));
  const setChosen = (list: string[]) => setPicked({ ...picked, [dim]: list.slice(0, 4) });
  const chartData = entities.map((e) => ({ name: e.label, v: e.agg[metric], color: e.color }));

  return (
    <Card
      title="Comparison"
      sub={`Compare up to 4 ${dim === "branch" ? "branches" : dim === "city" ? "cities" : dim === "region" ? "regions" : "formats"} · ${periodLabel}`}
      right={
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <select value={dim} onChange={(e) => setDim(e.target.value as Dim)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white" aria-label="Compare by">
            <option value="branch">Branches</option>
            <option value="city">Cities</option>
            <option value="region">Regions</option>
            <option value="format">Restaurant formats</option>
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white" aria-label="Chart metric">
            {Object.entries(METRICS).map(([k, m]) => (
              <option key={k} value={k}>
                Chart: {m.label}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {entities.map((e) => (
          <span key={e.key} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-0.5 pl-2 pr-1 text-[11px] text-white">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: e.color }} />
            {e.label}
            <button type="button" onClick={() => setChosen(chosen.filter((k) => k !== e.key))} className="rounded-full p-0.5 text-white/40 hover:bg-white/10 hover:text-white" aria-label={`Remove ${e.label}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        {chosen.length < 4 && (
          <label className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 px-2 py-0.5 text-[11px] text-white/55">
            <Plus size={11} />
            <select value="" onChange={(e) => e.target.value && setChosen([...chosen, e.target.value])} className="bg-transparent text-white/70 outline-none" aria-label="Add to comparison">
              <option value="">Add…</option>
              {options
                .filter((k) => !chosen.includes(k))
                .map((k) => (
                  <option key={k} value={k} className="bg-[var(--surface-2)]">
                    {groupLabel(k, dim)}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {entities.length === 0 ? (
        <p className="text-xs text-white/40">Add entities to compare.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 18, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 10 }} />
                <YAxis {...axisProps} width={60} tickFormatter={(v) => (metric === "sales" || metric === "ticket" ? ghsCompact(v) : metric === "load" ? `${Math.round(v * 100)}%` : String(Math.round(v * 10) / 10))} />
                <Tooltip cursor={{ fill: "var(--grid)" }} content={<DarkTooltip format={METRICS[metric].fmt} />} />
                <Bar isAnimationActive={false} dataKey="v" name={METRICS[metric].label} radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {chartData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                  <LabelList dataKey="v" position="top" formatter={(v: unknown) => METRICS[metric].fmt(Number(v))} style={{ fill: "var(--axis)", fontSize: 10.5 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="scroll-thin overflow-x-auto lg:col-span-3">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-white/45">
                  <th className="py-1.5 text-left font-semibold">Metric</th>
                  {entities.map((e) => (
                    <th key={e.key} className="px-2 py-1.5 text-right font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: e.color }} />
                        <span className="max-w-28 truncate normal-case tracking-normal text-white/80">{e.label}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(METRICS) as Metric[]).map((m) => {
                  const vals = entities.map((e) => e.agg[m]);
                  const best = m === "prep" || m === "alerts" ? Math.min(...vals) : Math.max(...vals);
                  return (
                    <tr key={m} className={cx("border-t border-white/5", m === metric && "bg-white/[0.04]")}>
                      <td className="py-1.5 text-white/60">{METRICS[m].label}</td>
                      {entities.map((e) => (
                        <td key={e.key} className={cx("px-2 text-right font-mono tabular-nums", e.agg[m] === best && entities.length > 1 ? "font-semibold text-white" : "text-white/70")}>
                          {METRICS[m].fmt(e.agg[m])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr className="border-t border-white/5">
                  <td className="py-1.5 text-white/60">Branches</td>
                  {entities.map((e) => (
                    <td key={e.key} className="px-2 text-right font-mono text-white/70">
                      {e.agg.branches}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-white/35">Bold marks the best value per row (lowest for prep time and alerts). Partial-period orders are estimated from revenue ÷ average ticket.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
