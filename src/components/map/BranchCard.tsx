"use client";

import { Clock, ExternalLink, X } from "lucide-react";
import { Btn, Meter, SimBadge, StatusDot, VerifiedBadge, cx } from "@/components/ui/primitives";
import { ghs } from "@/lib/format";
import type { Branch } from "@/lib/network/branches";
import type { BranchSnapshot } from "@/lib/network/network";
import { useApp } from "@/store/app";
import { SAFETY_LABEL, STATUS_LABEL } from "./mapState";

export function hoursLabel(b: Branch) {
  if (b.is24h) return "Open 24 hours";
  return `${b.hours.storeOpen ?? "?"}–${b.hours.storeClose ?? "?"} · delivery ${b.hours.deliveryOpen ?? "?"}–${b.hours.deliveryClose ?? "?"}`;
}

/** Branch popup: verified directory facts + simulated live metrics. */
export default function BranchCard({ b, s, onClose, compact }: { b: Branch; s: BranchSnapshot; onClose?: () => void; compact?: boolean }) {
  const enterBranch = useApp((st) => st.enterBranch);
  const selectBranch = useApp((st) => st.selectBranch);
  const safetyTone = s.safetyStatus === "critical" ? "text-red-400" : s.safetyStatus === "attention" ? "text-amber-300" : "text-emerald-400";

  return (
    <div className="glass animate-fade-in w-[300px] rounded-xl !bg-[var(--surface-2)]/95 p-3.5 text-white">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={s.status} pulse={s.status === "critical"} />
            <h3 className="truncate font-display text-[15px] font-bold">{b.name}</h3>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/55">
            {b.city}, {b.region}
            {b.siteContext ? ` · ${b.siteContext}` : ""}
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded p-0.5 text-white/40 hover:text-white" aria-label="Close branch card">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <VerifiedBadge label="VERIFIED LOCATION" />
        <span className="rounded border border-white/10 px-1.5 py-px font-mono text-[9px] text-white/60" title={b.floorPlanReason}>
          MODEL {b.floorPlanType} LAYOUT · CONCEPTUAL
        </span>
        {b.brand.includes("Pinkberry") && <span className="rounded border border-pink-400/30 bg-pink-400/10 px-1.5 py-px text-[9px] font-semibold text-pink-200">+ PINKBERRY</span>}
      </div>

      <div className={cx("mt-2.5 rounded-lg px-2.5 py-1.5 text-[11px]", s.status === "critical" ? "bg-red-500/15 text-red-200" : s.status === "warning" ? "bg-amber-500/15 text-amber-100" : s.status === "closed" ? "bg-white/5 text-white/60" : "bg-emerald-500/10 text-emerald-200")}>
        <span className="font-semibold">{STATUS_LABEL[s.status]}</span>
        {s.issue ? ` — ${s.issue}` : s.status === "closed" ? " — outside published store hours" : " — no open issues"}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Today so far</span>
        <SimBadge />
      </div>
      <div className="mt-1.5 rounded-lg border border-white/5 bg-white/[0.03] p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-white/45">Revenue today</div>
        <div className="font-display text-2xl font-bold tabular-nums text-white">{ghs(s.salesToday)}</div>
        <div className="text-[10.5px] text-white/50">
          {s.ordersToday.toLocaleString()} orders · avg ticket {ghs(s.avgTicket)}
        </div>
      </div>
      {!compact && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[
            ["Active orders", s.activeOrders],
            ["Staff on duty", s.staffOnDuty],
            ["Equip. alerts", s.equipmentAlerts],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-white/[0.04] py-1.5">
              <div className="font-display text-base font-semibold tabular-nums">{v}</div>
              <div className="text-[9.5px] text-white/45">{k}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2.5 space-y-1.5 text-[11px]">
        <div>
          <div className="mb-1 flex justify-between text-white/55">
            <span>Kitchen activity</span>
            <span className="tabular-nums text-white/80">{Math.round(s.kitchenLoad * 100)}%</span>
          </div>
          <Meter value={s.kitchenLoad} color={s.kitchenLoad > 0.85 ? "#ef4444" : s.kitchenLoad > 0.65 ? "#eab308" : "#5ab350"} />
        </div>
        <div className="flex justify-between text-white/55">
          <span>Food safety</span>
          <span className={cx("font-semibold", safetyTone)}>{SAFETY_LABEL[s.safetyStatus]}</span>
        </div>
        <div className="flex justify-between gap-2 text-white/55">
          <span className="flex items-center gap-1">
            <Clock size={11} /> Hours
          </span>
          <span className="truncate text-right text-white/80" title="Published store hours from the official outlet directory">
            {hoursLabel(b)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Btn tone="red" className="flex-1" onClick={() => enterBranch(b.id)}>
          Open digital twin
        </Btn>
        <Btn onClick={() => selectBranch(b.id)}>Details</Btn>
      </div>
      <a href={b.source} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70">
        <ExternalLink size={10} /> Official directory record · verified {b.lastVerified}
      </a>
    </div>
  );
}
