"use client";

import { Layers, Search, X } from "lucide-react";
import { STATUS_COLOR, cx } from "@/components/ui/primitives";
import { GHANA_REGIONS } from "@/lib/network/branches";
import { TENANT } from "@/config/platform";
import { useApp } from "@/store/app";
import { useMapFilters } from "./mapState";

const selectCls = "rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white";

/** Search + filters (top-right) and marker legend (bottom-left) for the Ghana map. */
export default function MapToolbar({ visibleCount }: { visibleCount: number }) {
  const { regionFilter, statusFilter, search, setFilters } = useApp();
  const { format, setFormat, pinkberry, setPinkberry, regionalPerformance, toggleRegional } = useMapFilters();
  const active = !!(regionFilter || statusFilter || search || format || pinkberry !== "any");

  return (
    <>
      <div className="glass absolute right-11 top-3 z-10 w-[min(380px,calc(100%-3.5rem))] max-md:right-3 max-md:w-[calc(100%-1.5rem)] rounded-xl p-2.5 max-md:top-auto max-md:bottom-14">
        <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5">
          <Search size={14} className="text-white/45" />
          <input
            value={search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Search branch, city, region…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-white/35"
            aria-label="Search branches"
          />
          {search && (
            <button type="button" onClick={() => setFilters({ search: "" })} aria-label="Clear search" className="text-white/40 hover:text-white">
              <X size={13} />
            </button>
          )}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 max-md:hidden">
          <select className={selectCls} value={regionFilter ?? ""} onChange={(e) => setFilters({ regionFilter: e.target.value || null })} aria-label="Region filter">
            <option value="">All 16 regions</option>
            {GHANA_REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select className={selectCls} value={statusFilter ?? ""} onChange={(e) => setFilters({ statusFilter: e.target.value || null })} aria-label="Status filter">
            <option value="">Any status</option>
            <option value="normal">Normal</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="closed">Closed</option>
          </select>
          <select className={selectCls} value={format ?? ""} onChange={(e) => setFormat((e.target.value || null) as "A" | "B" | "C" | null)} aria-label="Restaurant format filter">
            <option value="">All formats</option>
            <option value="A">Model A · compact</option>
            <option value="B">Model B · standard</option>
            <option value="C">Model C · flagship</option>
          </select>
          <select className={selectCls} value={pinkberry} onChange={(e) => setPinkberry(e.target.value as "any" | "co-branded" | "standalone")} aria-label="Brand filter">
            <option value="any">All brands</option>
            <option value="co-branded">+ Pinkberry co-brand</option>
            <option value="standalone">{TENANT.short} only</option>
          </select>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10.5px] text-white/45">
          <span>
            {visibleCount} branch{visibleCount === 1 ? "" : "es"} shown
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleRegional} className={cx("flex items-center gap-1 rounded-md px-1.5 py-0.5", regionalPerformance ? "bg-white/15 text-white" : "hover:text-white")} aria-pressed={regionalPerformance}>
              <Layers size={11} /> Regional performance
            </button>
            {active && (
              <button type="button" className="text-brand-yellow hover:underline" onClick={() => (setFilters({ regionFilter: null, statusFilter: null, search: "" }), setFormat(null), setPinkberry("any"))}>
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="glass absolute bottom-3 left-3 z-10 rounded-lg px-3 py-2 text-[10.5px] text-white/70 max-md:hidden" aria-label="Map legend">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {(
            [
              ["normal", "Normal"],
              ["warning", "Warning"],
              ["critical", "Critical"],
              ["closed", "Closed / offline"],
            ] as const
          ).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-black/40" style={{ background: STATUS_COLOR[k] }} />
              {label}
            </span>
          ))}
        </div>
        {regionalPerformance && (
          <div className="mt-1.5 flex items-center gap-2 text-[9.5px] text-white/55">
            Region revenue today
            <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(90deg,#0d366b,#184f95,#256abf,#3987e5,#6da7ec,#9ec5f4)" }} />
            <span>low → high</span>
            <span className="h-2 w-3 rounded-sm bg-[#1b1f27] ring-1 ring-white/15" /> no outlets
          </div>
        )}
        <div className="mt-1 text-[9.5px] text-white/40">Locations verified from the official outlet directory</div>
      </div>
    </>
  );
}
