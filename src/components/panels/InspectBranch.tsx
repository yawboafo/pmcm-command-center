"use client";

import { ExternalLink, LogIn } from "lucide-react";
import { Btn, ConceptBadge, SectionTitle, SimBadge, Stat, StatusDot, VerifiedBadge } from "@/components/ui/primitives";
import { canSeeBranch } from "@/lib/auth/rbac";
import { ghs, ghsCompact, mins, pct } from "@/lib/format";
import { useSnapshots } from "@/lib/hooks/useSim";
import { BRANCHES, BRANCH_BY_ID, demoBranchIds } from "@/lib/network/branches";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { WorkstationType } from "@/lib/floorplan/types";
import PriorityQueue from "@/components/ops/PriorityQueue";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import { Card, HourlyBars, KV } from "./common";

export function InspectBranch({ id }: { id: string }) {
  const snaps = useSnapshots();
  const enterBranch = useApp((s) => s.enterBranch);
  const entered = useApp((s) => s.enteredBranchId);
  const user = useApp((s) => s.user);
  const b = BRANCH_BY_ID.get(id);
  const snap = snaps.find((s) => s.branchId === id);
  if (!b || !snap) return <p className="p-4 text-xs text-white/50">Branch not found.</p>;
  const allowed = canSeeBranch(user, b);
  const hours = b.is24h ? "Open 24 hours" : `${b.hours.storeOpen ?? "?"}–${b.hours.storeClose ?? "?"}`;
  const nowH = new Date(sims().clock).getUTCHours();

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <StatusDot status={snap.status} pulse={snap.status === "critical"} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{snap.open ? snap.status : "closed"}</span>
        </div>
        <h2 className="font-display text-lg font-bold leading-tight text-white">{b.name}</h2>
        <div className="text-[11px] text-white/50">
          {b.city}, {b.region} Region · {b.brand}
        </div>
      </div>

      {!allowed ? (
        <Card>
          <p className="text-[11.5px] text-white/60">Your demo role ({user.roleLabel}) is not authorised for this branch. Switch role in the top bar or Settings.</p>
        </Card>
      ) : (
        <>
          {entered !== id && (
            <Btn tone="red" className="w-full" onClick={() => enterBranch(id)}>
              <LogIn size={14} /> Open digital twin
            </Btn>
          )}
          <div>
            <SectionTitle right={<SimBadge />}>Today</SectionTitle>
            {snap.issue && <div className={snap.status === "critical" ? "mb-2 rounded-md bg-red-500/15 px-2 py-1.5 text-[11.5px] text-red-200" : "mb-2 rounded-md bg-amber-500/15 px-2 py-1.5 text-[11.5px] text-amber-100"}>{snap.issue}</div>}
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Revenue" value={ghsCompact(snap.salesToday)} />
              <Stat label="Orders" value={snap.ordersToday} />
              <Stat label="Active" value={snap.activeOrders} />
              <Stat label="Staff" value={snap.staffOnDuty} />
              <Stat label="Kitchen load" value={pct(snap.kitchenLoad)} tone={snap.kitchenLoad > 0.85 ? "yellow" : "default"} />
              <Stat label="Avg prep" value={snap.avgPrepMin ? `${snap.avgPrepMin}m` : "—"} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Stat label="Avg ticket" value={ghs(snap.avgTicket)} />
              <Stat label="Equip. alerts" value={snap.equipmentAlerts} tone={snap.equipmentAlerts ? "red" : "default"} />
              <Stat label="Food safety" value={snap.safetyStatus.toUpperCase()} tone={snap.safetyStatus === "critical" ? "red" : snap.safetyStatus === "attention" ? "yellow" : "green"} />
            </div>
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">Simulated sales by hour</div>
              <HourlyBars values={snap.hourlySales} format={ghs} nowHour={nowH} />
            </div>
            <p className="mt-1 text-[10px] text-white/35">{snap.live ? "From this branch's full kitchen simulation." : "Lightweight network model — open the twin for a full simulation."}</p>
          </div>
        </>
      )}

      <div>
        <SectionTitle right={<VerifiedBadge />}>Official directory data</SectionTitle>
        <Card>
          <KV k="Store hours" v={hours} />
          <KV k="Delivery hours" v={`${b.hours.deliveryOpen ?? "?"}–${b.hours.deliveryClose ?? "?"}`} />
          {b.pickupOnly && <KV k="Service" v="Pickup only" />}
          {b.siteContext && <KV k="Site" v={b.siteContext} />}
          {b.phone && <KV k="Branch phone" v={b.phone} mono />}
          <KV k="Coordinates" v={`${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`} mono />
          <KV k="Last verified" v={b.lastVerified} mono />
        </Card>
        {b.brand.includes("Pinkberry") && <p className="mt-1 text-[10px] text-white/40">Pinkberry co-location noted from the official branch photo (researcher visual check). Pinkberry is a separate franchise.</p>}
        {b.notes && <p className="mt-1 text-[10px] leading-snug text-white/40">{b.notes}</p>}
        <a href={b.source} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-yellow hover:underline">
          Source: official outlet page <ExternalLink size={11} />
        </a>
      </div>

      <div>
        <SectionTitle right={<ConceptBadge />}>Digital twin layout</SectionTitle>
        <p className="text-[11.5px] text-white/70">Model {b.floorPlanType} template — {b.floorPlanReason}.</p>
        <p className="mt-1 text-[10px] text-white/35">Not the branch&apos;s real floor plan. Replace it in the Floor Plan Editor when surveyed plans become available.</p>
      </div>
    </div>
  );
}

const QUEUE_LABEL: Partial<Record<WorkstationType, string>> = { "order-counter": "Counter", "pizza-prep": "Pizza prep", oven: "Oven", "chicken-prep": "Chicken prep", fryer: "Fryer", rice: "Rice", qc: "QC", packaging: "Packing", pickup: "Collection", dispatch: "Dispatch" };

export function BranchLive({ sim }: { sim: BranchSimulation }) {
  const setSection = useApp((s) => s.setSection);
  const m = sim.metrics();
  const q = new Map<WorkstationType, number>();
  for (const t of sim.tasks.values()) if (t.ws in QUEUE_LABEL && t.kind !== "clean") q.set(t.ws, (q.get(t.ws) ?? 0) + 1);
  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Live branch summary</span>
          <SimBadge />
        </div>
        <h2 className="font-display text-base font-bold text-white">{sim.branchName}</h2>
        <p className="text-[10.5px] text-white/40">Click equipment, people, or orders in the 3D view to inspect them.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Revenue" value={ghsCompact(m.sales)} />
        <Stat label="Orders" value={m.ordersToday} />
        <Stat label="Active" value={m.activeOrders} />
        <Stat label="Delayed" value={m.delayed} tone={m.delayed ? "red" : "default"} />
        <Stat label="Avg prep" value={m.avgPrepMin ? `${m.avgPrepMin.toFixed(1)}m` : "—"} />
        <Stat label="Queue" value={m.queueLength} tone={m.queueLength > 5 ? "yellow" : "default"} />
        <Stat label="Avg wait" value={m.avgCustomerWaitMin ? mins(m.avgCustomerWaitMin * 60) : "—"} />
        <Stat label="Low stock" value={m.lowStock} tone={m.lowStock ? "yellow" : "default"} />
        <Stat label="Alerts" value={m.openAlerts} tone={m.criticalAlerts ? "red" : m.openAlerts ? "yellow" : "default"} />
      </div>
      <div>
        <SectionTitle>Kitchen queues</SectionTitle>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {Object.entries(QUEUE_LABEL).map(([k, label]) => (
            <div key={k} className="flex justify-between text-[11px]">
              <span className="text-white/55">{label}</span>
              <span className="font-mono text-white/85">{q.get(k as WorkstationType) ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
      <PriorityQueue branchId={sim.branchId} limit={6} />
      <div className="flex flex-wrap gap-1.5">
        {(["kitchen", "orders", "safety", "inventory", "staff"] as const).map((s) => (
          <Btn key={s} size="xs" onClick={() => setSection(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </Btn>
        ))}
      </div>
    </div>
  );
}

export function NationalSummary() {
  const snaps = useSnapshots();
  const enterBranch = useApp((s) => s.enterBranch);
  const selectB = useApp((s) => s.selectBranch);
  const open = snaps.filter((s) => s.open);
  const sales = snaps.reduce((s, x) => s + x.salesToday, 0);
  const top = [...snaps].sort((a, b) => b.salesToday - a.salesToday).slice(0, 5);
  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">National summary</span>
          <SimBadge />
        </div>
        <p className="text-[11px] text-white/45">Select a branch marker on the map for details.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Branches" value={BRANCHES.length} sub="official directory" />
        <Stat label="Open now" value={open.length} />
        <Stat label="Revenue" value={ghsCompact(sales)} />
        <Stat label="Active orders" value={snaps.reduce((s, x) => s + x.activeOrders, 0)} />
        <Stat label="Critical" value={snaps.filter((s) => s.status === "critical").length} tone="red" />
        <Stat label="Warnings" value={snaps.filter((s) => s.status === "warning").length} tone="yellow" />
      </div>
      <div>
        <SectionTitle>Top branches by revenue</SectionTitle>
        {top.map((s, i) => (
          <button key={s.branchId} type="button" onClick={() => selectB(s.branchId)} className="flex w-full items-center justify-between py-0.5 text-[11.5px] hover:underline">
            <span className="text-white/75">
              {i + 1}. {BRANCH_BY_ID.get(s.branchId)?.name}
            </span>
            <span className="font-mono text-white/60">{ghs(s.salesToday)}</span>
          </button>
        ))}
      </div>
      <PriorityQueue />
      <div>
        <SectionTitle>Demonstration branches</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {demoBranchIds().map((id) => (
            <Btn key={id} size="xs" onClick={() => enterBranch(id)}>
              {BRANCH_BY_ID.get(id)?.name} · {BRANCH_BY_ID.get(id)?.floorPlanType}
            </Btn>
          ))}
        </div>
      </div>
    </div>
  );
}
