"use client";

import { ChevronDown, ChevronUp, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { ConceptBadge, SimBadge, VerifiedBadge, cx } from "@/components/ui/primitives";
import { clock } from "@/lib/format";
import { useTick } from "@/lib/hooks/useSim";
import { BRANCHES, BRANCH_BY_ID } from "@/lib/network/branches";
import { SUPPLY_HUBS, hubFor, transferStatus, transfersForDay, type Transfer } from "@/lib/network/supply";
import { INGREDIENT_BY_SKU } from "@/lib/sim/catalog";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

const STATUS_STYLE: Record<Transfer["status"], string> = {
  scheduled: "bg-white/10 text-white/60",
  loading: "bg-sky-500/15 text-sky-200",
  "in-transit": "bg-amber-500/15 text-amber-200",
  delivered: "bg-emerald-500/15 text-emerald-300",
};

/** Central kitchens & warehouses overlay (shown over the map's supply-route layer). */
export default function CentralKitchens() {
  useTick();
  const enterBranch = useApp((s) => s.enterBranch);
  const [open, setOpen] = useState(true);
  const [hubFilter, setHubFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Transfer["status"] | "">("");
  const now = sims().clock;
  const dayStart = Math.floor(now / 86400000) * 86400000;
  const transfers = useMemo(() => transfersForDay(dayStart, sims().seed), [dayStart]);

  const served = useMemo(() => {
    const m = new Map<string, Array<{ id: string; km: number }>>();
    for (const b of BRANCHES) {
      const { hub, distanceKm } = hubFor(b);
      m.set(hub.id, [...(m.get(hub.id) ?? []), { id: b.id, km: distanceKm }]);
    }
    return m;
  }, []);

  const withStatus = transfers.map((t) => ({ ...t, status: transferStatus(t, now) }));
  const counts = { scheduled: 0, loading: 0, "in-transit": 0, delivered: 0 } as Record<Transfer["status"], number>;
  for (const t of withStatus) counts[t.status]++;
  const list = withStatus
    .filter((t) => (!hubFilter || t.hubId === hubFilter) && (!statusFilter || t.status === statusFilter))
    .sort((a, b) => {
      const rank = { "in-transit": 0, loading: 1, scheduled: 2, delivered: 3 };
      return rank[a.status] - rank[b.status] || a.departAt - b.departAt;
    });

  // Replenishment requests raised by running branch simulations, routed to their nearest hub.
  const requests = [...sims().sims.values()].flatMap((sim) =>
    sim.replenishments.map((r) => {
      const b = BRANCH_BY_ID.get(sim.branchId)!;
      const item = sim.inventory.find((i) => i.sku === r.sku);
      return { r, b, hub: hubFor(b).hub, item, etaMs: sim.clockStart + r.etaAt * 1000 };
    }),
  );

  // Stock allocated per hub today = sum of transfer loads.
  const allocation = SUPPLY_HUBS.map((h) => {
    const loads = new Map<string, { qty: number; unit: string; name: string }>();
    for (const t of transfers.filter((x) => x.hubId === h.id))
      for (const it of t.items) {
        const cur = loads.get(it.sku) ?? { qty: 0, unit: it.unit, name: it.name };
        cur.qty += it.qty;
        loads.set(it.sku, cur);
      }
    return { hub: h, loads: [...loads.values()], runs: transfers.filter((x) => x.hubId === h.id).length };
  });

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="glass absolute right-11 top-3 z-20 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-white">
        <Truck size={14} className="text-brand-yellow" /> Central kitchens & supply <ChevronDown size={14} />
      </button>
    );

  return (
    <aside aria-label="Central kitchens and supply" className="glass animate-fade-in absolute bottom-3 right-11 top-3 z-20 flex w-[min(460px,calc(100%-3.5rem))] flex-col overflow-hidden rounded-xl !bg-[#0b0e13]/95 max-md:inset-x-3 max-md:top-auto max-md:h-[60%] max-md:w-auto">
      <header className="border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Truck size={16} className="text-brand-yellow" />
          <h2 className="font-display text-sm font-bold text-white">Central kitchens &amp; warehouses</h2>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded p-1 text-white/40 hover:text-white" aria-label="Collapse panel">
            <ChevronUp size={15} />
          </button>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-[11.5px]">
        <section className="space-y-2 rounded-lg border border-white/5 bg-white/[0.03] p-3">
          <div className="flex items-start gap-2">
            <VerifiedBadge className="mt-0.5 shrink-0" />
            <p className="text-white/70">The company states it operates <b className="text-white">9 central kitchens and warehouses</b> supplying all outlets on a <b className="text-white">24-hour schedule</b>. The only facility named publicly is a warehouse at <b className="text-white">Nyankyerenase, near Kumasi</b> (2023 court report).</p>
          </div>
          <div className="flex items-start gap-2">
            <ConceptBadge className="mt-0.5 shrink-0" />
            <p className="text-white/60">Hub locations (other than Nyankyerenase&apos;s town), branch-to-hub assignment, routes, loads and schedules below are demo assumptions — the company does not publish them. Only {SUPPLY_HUBS.length} illustrative hubs are modelled.</p>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-white/50">Hubs</h3>
            <SimBadge label="DEMO LOGISTICS" />
          </div>
          <ul className="space-y-1.5">
            {SUPPLY_HUBS.map((h) => {
              const list = served.get(h.id) ?? [];
              const avgKm = list.length ? Math.round(list.reduce((a, x) => a + x.km, 0) / list.length) : 0;
              const active = withStatus.filter((t) => t.hubId === h.id && t.status === "in-transit").length;
              return (
                <li key={h.id}>
                  <button type="button" onClick={() => setHubFilter(hubFilter === h.id ? "" : h.id)} className={cx("w-full rounded-lg border p-2.5 text-left transition", hubFilter === h.id ? "border-brand-yellow/40 bg-brand-yellow/5" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]")}>
                    <div className="flex items-center gap-2">
                      <span className={cx("h-2.5 w-2.5 rounded-full border-2", h.verified ? "border-white bg-[#5AB350]" : "border-[#5AB350] bg-transparent")} />
                      <span className="font-medium text-white">{h.name}</span>
                      <span className="ml-auto text-[10px] text-white/40">{h.kind === "warehouse" ? "Warehouse" : "Central kitchen"}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-4 gap-2 text-[10.5px] text-white/55">
                      <span>
                        <b className="font-mono text-white">{list.length}</b> branches
                      </span>
                      <span>
                        avg <b className="font-mono text-white">{avgKm}</b> km
                      </span>
                      <span>
                        <b className="font-mono text-white">{h.capacityPerDay}</b> kg/day*
                      </span>
                      <span>
                        <b className="font-mono text-amber-200">{active}</b> en route
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-white/35">{h.note}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[10px] text-white/35">* Illustrative capacity for the simulation.</p>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-[10.5px] font-semibold uppercase tracking-wider text-white/50">Today&apos;s distribution runs</h3>
            {(Object.keys(counts) as Transfer["status"][]).map((s) => (
              <button key={s} type="button" onClick={() => setStatusFilter(statusFilter === s ? "" : s)} className={cx("rounded px-1.5 py-0.5 text-[10px]", STATUS_STYLE[s], statusFilter === s && "ring-1 ring-white/40")}>
                {s} {counts[s]}
              </button>
            ))}
          </div>
          <ul className="scroll-thin max-h-72 space-y-1 overflow-y-auto pr-1">
            {list.slice(0, 80).map((t) => {
              const b = BRANCH_BY_ID.get(t.branchId)!;
              const h = SUPPLY_HUBS.find((x) => x.id === t.hubId)!;
              const k = t.status === "in-transit" ? (now - t.departAt) / (t.arriveAt - t.departAt) : t.status === "delivered" ? 1 : 0;
              return (
                <li key={t.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white/40">{clock(t.departAt)}</span>
                    <span className="min-w-0 flex-1 truncate text-white/80">
                      {h.name.replace(" (demo)", "")} → <b className="text-white">{b.name}</b>
                    </span>
                    <span className={cx("rounded px-1.5 py-px text-[10px]", STATUS_STYLE[t.status])}>{t.status}</span>
                  </div>
                  {t.status === "in-transit" && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-brand-yellow" style={{ width: `${k * 100}%` }} />
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-[10px] text-white/40">
                    ETA {clock(t.arriveAt)} · {t.items.map((i) => `${i.qty}${i.unit} ${i.name.toLowerCase()}`).join(", ")}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/50">Replenishment requests from open twins</h3>
          {requests.length ? (
            <ul className="space-y-1">
              {requests.slice(-20).reverse().map(({ r, b, hub, item, etaMs }) => (
                <li key={r.id} className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <b className="text-white">{b.name}</b> <span className="text-white/50">needs</span> {r.qty} {item?.unit} {item?.name ?? INGREDIENT_BY_SKU.get(r.sku)?.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-white/45">from {hub.name.replace(" (demo)", "")}</span>
                  <span className={cx("shrink-0 rounded px-1.5 py-px text-[10px]", r.status === "received" ? STATUS_STYLE.delivered : STATUS_STYLE["in-transit"])}>{r.status === "received" ? "received" : `ETA ${clock(etaMs)}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-white/10 p-3 text-center text-white/40">
              No requests yet. Requests appear automatically when a branch twin is open and an ingredient drops below its reorder level.{" "}
              <button type="button" onClick={() => enterBranch("branch-015")} className="text-brand-yellow hover:underline">
                Open East Legon
              </button>
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/50">Stock allocated today by hub</h3>
          <div className="space-y-2">
            {allocation.map(({ hub, loads, runs }) => (
              <details key={hub.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                <summary className="cursor-pointer text-white/80">
                  {hub.name} <span className="text-white/40">· {runs} runs</span>
                </summary>
                <table className="mt-1 w-full text-[10.5px]">
                  <tbody>
                    {loads.map((l) => (
                      <tr key={l.name} className="border-t border-white/5">
                        <td className="py-0.5 text-white/60">{l.name}</td>
                        <td className="text-right font-mono text-white/80">
                          {l.qty.toLocaleString()} {l.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
