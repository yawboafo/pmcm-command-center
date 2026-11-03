"use client";

import type { ReactNode } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "@/components/ui/primitives";
import { clock } from "@/lib/format";
import type { Equipment, Sensor, Vec3 } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { InventoryItem } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

/** Chart tokens for the dark surface (reference palette, dark column). */
export const VIZ = {
  series1: "#3987e5",
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.4)",
  text: "#f0efec",
  muted: "rgba(240,239,236,0.55)",
  critical: "#e66767",
  surface: "#14171d",
};

/** Sim-seconds → epoch ms for a given simulation. */
export const simMs = (sim: BranchSimulation, seconds: number) => sim.clockStart + seconds * 1000;

export function KV({ k, v, mono, tone }: { k: ReactNode; v: ReactNode; mono?: boolean; tone?: "red" | "yellow" | "green" }) {
  const color = tone === "red" ? "text-red-400" : tone === "yellow" ? "text-amber-300" : tone === "green" ? "text-emerald-400" : "text-white/85";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1 text-[11.5px]">
      <span className="shrink-0 text-white/45">{k}</span>
      <span className={cx("min-w-0 truncate text-right", mono && "font-mono tabular-nums", color)}>{v}</span>
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-white/[0.06] bg-white/[0.025] p-3", className)}>{children}</div>;
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "red" | "yellow" | "green" | "blue" }) {
  const cls = {
    default: "bg-white/10 text-white/70",
    red: "bg-red-500/20 text-red-300",
    yellow: "bg-amber-500/20 text-amber-200",
    green: "bg-emerald-500/20 text-emerald-300",
    blue: "bg-sky-500/20 text-sky-200",
  }[tone];
  return <span className={cx("inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", cls)}>{children}</span>;
}

export function statusTone(s: string): "red" | "yellow" | "green" | "default" {
  const u = s.toLowerCase();
  if (["critical", "fault", "out", "red", "failed", "open"].includes(u)) return "red";
  if (["warning", "low", "expiring", "acknowledged", "delayed", "offline"].includes(u)) return "yellow";
  if (["normal", "ok", "active", "resolved", "pass", "good", "completed", "delivered"].includes(u)) return "green";
  return "default";
}

export interface Limit {
  kind: "max" | "min";
  value: number;
  unit: string;
  label: string;
}

/** Configured limit for a sensor, taken from the branch's active safety profile. */
export function limitFor(sim: BranchSimulation, s: Sensor | undefined): Limit | null {
  if (!s) return null;
  const p = sim.safety;
  switch (s.thresholdProfile) {
    case "chilled":
      return { kind: "max", value: p.chilledMaxC, unit: "°C", label: `≤ ${p.chilledMaxC} °C` };
    case "frozen":
      return { kind: "max", value: p.frozenMaxC, unit: "°C", label: `≤ ${p.frozenMaxC} °C` };
    case "hotHolding":
      return { kind: "min", value: p.hotHoldingMinC, unit: "°C", label: `≥ ${p.hotHoldingMinC} °C` };
    case "oilQuality":
      return { kind: "min", value: p.oilQualityMinPct, unit: "%", label: `≥ ${p.oilQualityMinPct}%` };
    case "cookCore":
      return { kind: "min", value: p.cookCoreMinC, unit: "°C", label: `≥ ${p.cookCoreMinC} °C` };
    default:
      return null;
  }
}

export function primarySensor(sim: BranchSimulation, equipmentId: string): Sensor | undefined {
  const list = sim.plan.sensors.filter((s) => s.equipmentId === equipmentId);
  return list.find((s) => s.unit === "°C") ?? list.find((s) => s.unit === "%") ?? list[0];
}

/** Maintenance due-state from the last service time and the equipment's interval. */
export function maintenance(sim: BranchSimulation, e: Equipment) {
  const st = sim.equipment.get(e.id);
  const interval = e.operational.maintenanceIntervalDays;
  if (!st || !interval) return { label: "No schedule", tone: "default" as const, daysSince: null as number | null };
  const days = (sim.t - st.lastMaintenance) / 86400;
  const left = interval - days;
  if (st.fault) return { label: "REPAIR REQUIRED", tone: "red" as const, daysSince: days };
  if (left < 0) return { label: `OVERDUE by ${Math.ceil(-left)} d`, tone: "red" as const, daysSince: days };
  if (left < interval * 0.15) return { label: `DUE in ${Math.ceil(left)} d`, tone: "yellow" as const, daysSince: days };
  return { label: `GOOD · next in ${Math.ceil(left)} d`, tone: "green" as const, daysSince: days };
}

/** Ask the 3D camera rig to frame a piece of equipment. */
export function focusEquipment(sim: BranchSimulation, equipmentId: string) {
  const e = sim.eqById.get(equipmentId);
  if (!e) return;
  const d = Math.max(2.2, e.interaction.focusDistance);
  const target: Vec3 = [e.position[0], e.position[1] + Math.min(e.size[1], 2) / 2, e.position[2]];
  const position: Vec3 = [e.position[0] + Math.sin(e.rotation) * d + Math.cos(e.rotation) * 0.8, 1.9 + (e.position[1] > 1 ? 0.8 : 0), e.position[2] + Math.cos(e.rotation) * d - Math.sin(e.rotation) * 0.8];
  useApp.getState().requestCamera({ position, target });
}

export function focusPoint(x: number, z: number) {
  useApp.getState().requestCamera({ position: [x + 2.2, 2.6, z + 2.2], target: [x, 0.9, z] });
}

/** Locate an entity's simulation: the entered branch first, then any running branch. */
export function findSimFor(pred: (s: BranchSimulation) => boolean): BranchSimulation | null {
  const entered = useApp.getState().enteredBranchId;
  if (entered) {
    const s = sims().peek(entered);
    if (s && pred(s)) return s;
  }
  for (const s of sims().sims.values()) if (pred(s)) return s;
  return null;
}

export function inventoryTone(i: InventoryItem): "red" | "yellow" | "green" {
  return i.status === "OUT" || i.status === "CRITICAL" ? "red" : i.status === "LOW" || i.status === "EXPIRING" ? "yellow" : "green";
}

/**
 * Record wastage against an inventory item. Implemented over the engine's public
 * state (qty, ledger, log) with a unique ledger key so it is never double-counted.
 */
export function recordWaste(sim: BranchSimulation, sku: string, qty: number, by: string, reason: string) {
  return sim.recordWaste(sku, qty, reason, by);
}

export function chickenTargets(sim: BranchSimulation) {
  return sim.chickenTarget;
}

export function riceCapacityKg(sim: BranchSimulation) {
  return sim.plan.format === "C" ? 22 : sim.plan.format === "B" ? 16 : 12;
}

/** Single-series history line with an optional configured-limit reference line. */
export function HistoryChart({ data, limit, unit, height = 120 }: { data: Array<{ t: number; v: number | null }>; limit?: Limit | null; unit: string; height?: number }) {
  const rows = data.map((d) => ({ t: d.t, v: d.v }));
  const vals = rows.map((r) => r.v).filter((v): v is number => v !== null);
  if (!vals.length) return <div className="py-6 text-center text-[11px] text-white/40">No readings yet</div>;
  let lo = Math.min(...vals, limit?.value ?? Infinity);
  let hi = Math.max(...vals, limit?.value ?? -Infinity);
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  lo = Math.floor(lo - pad);
  hi = Math.ceil(hi + pad);
  return (
    <div style={{ height }} role="img" aria-label={`Simulated history, latest ${vals.at(-1)} ${unit}${limit ? `, limit ${limit.label}` : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => clock(t)} tick={{ fill: VIZ.axis, fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={[lo, hi]} tick={{ fill: VIZ.axis, fontSize: 9 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.35)", strokeWidth: 1 }}
            contentStyle={{ background: VIZ.surface, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, fontSize: 11, color: VIZ.text }}
            labelFormatter={(t) => `${clock(Number(t))} GMT · simulated`}
            formatter={(v) => [`${v} ${unit}`, "Reading"]}
          />
          <Area type="monotone" dataKey="v" stroke="none" fill={VIZ.series1} fillOpacity={0.12} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="v" stroke={VIZ.series1} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          {limit && <ReferenceLine y={limit.value} stroke={VIZ.critical} strokeDasharray="4 3" label={{ value: `Limit ${limit.label}`, fill: VIZ.muted, fontSize: 9, position: "insideTopRight" }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Hourly bars (e.g. simulated sales) with per-bar hover. */
export function HourlyBars({ values, format, height = 80, nowHour }: { values: number[]; format: (n: number) => string; height?: number; nowHour?: number }) {
  const rows = values.map((v, h) => ({ h, v }));
  return (
    <div style={{ height }} role="img" aria-label={`Hourly simulated values, total ${format(values.reduce((s, v) => s + v, 0))}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis dataKey="h" tick={{ fill: VIZ.axis, fontSize: 9 }} tickLine={false} axisLine={false} interval={5} tickFormatter={(h) => `${String(h).padStart(2, "0")}h`} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            contentStyle={{ background: VIZ.surface, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, fontSize: 11, color: VIZ.text }}
            labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(Number(h) + 1).padStart(2, "0")}:00 · simulated`}
            formatter={(v) => [format(Number(v)), "Sales"]}
          />
          {nowHour !== undefined && <ReferenceLine x={nowHour} stroke="rgba(255,255,255,0.3)" strokeDasharray="2 2" />}
          <Bar dataKey="v" fill={VIZ.series1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProgressBar({ value, tone = "blue" }: { value: number; tone?: "blue" | "red" | "yellow" | "green" }) {
  const c = { blue: "#3987e5", red: "#ef4444", yellow: "#eab308", green: "#22c55e" }[tone];
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: c }} />
    </div>
  );
}
