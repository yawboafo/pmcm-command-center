"use client";

import type { ReactNode } from "react";

/**
 * Chart tokens for the dark command-center surface.
 * Categorical slots: dataviz reference palette, dark steps, validated on #0e1117
 * (first three pass all-pairs CVD/normal-vision checks). Status colours are reserved.
 */
// Theme-aware (CSS variables from globals.css), so charts read in light and dark.
export const SURFACE = "var(--surface-2)";
export const SERIES = ["#7f9cc0", "#d1a86a", "#a98fc9", "#6fb8b0"] as const;
export const SINGLE = SERIES[0];
export const GRID = "var(--grid)";
export const AXIS_TEXT = { fill: "var(--axis)", fontSize: 10.5 };

export const axisProps = {
  tick: AXIS_TEXT,
  tickLine: false,
  axisLine: { stroke: "var(--axis-line)" },
} as const;

interface TipPayload {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/** Tooltip: value leads (strong), series name follows; line key, not box. */
export function DarkTooltip({ active, payload, label, format, labelFormat }: { active?: boolean; payload?: TipPayload[]; label?: string | number; format?: (v: number) => string; labelFormat?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  const fmt = format ?? ((v: number) => v.toLocaleString());
  const total = payload.length > 1 ? payload.reduce((s, p) => s + (Number(p.value) || 0), 0) : null;
  return (
    <div className="rounded-lg border border-white/10 bg-[var(--surface)]/95 px-2.5 py-2 text-[11px] shadow-xl">
      {label !== undefined && <div className="mb-1 text-white/50">{labelFormat ? labelFormat(label) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
          <span className="font-mono font-semibold tabular-nums text-white">{fmt(Number(p.value) || 0)}</span>
          <span className="text-white/55">{p.name}</span>
        </div>
      ))}
      {total !== null && (
        <div className="mt-1 border-t border-white/10 pt-1 text-white/55">
          Total <span className="font-mono font-semibold text-white">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-white/60">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Card({ title, right, children, className, sub }: { title: string; right?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <section className={`glass rounded-xl p-4 ${className ?? ""}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">{title}</h3>
          {sub && <p className="mt-0.5 text-[10.5px] text-white/40">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

/** Accessible table alternative for any chart. */
export function DataTable({ rows, columns }: { rows: Array<Record<string, string | number>>; columns: Array<{ key: string; label: string; num?: boolean; fmt?: (v: number) => string }> }) {
  return (
    <div className="scroll-thin max-h-56 overflow-auto rounded-lg border border-white/5">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-white/45">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-2 py-1.5 font-semibold ${c.num ? "text-right" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              {columns.map((c) => (
                <td key={c.key} className={`px-2 py-1 ${c.num ? "text-right font-mono tabular-nums text-white/80" : "text-white/70"}`}>
                  {c.num && c.fmt ? c.fmt(Number(r[c.key])) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
