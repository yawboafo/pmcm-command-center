"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Btn, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { clock, clockSec, ghs, mins } from "@/lib/format";
import { INGREDIENT_BY_SKU } from "@/lib/sim/catalog";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { Pill, focusEquipment, inventoryTone, recordWaste, simMs } from "./common";

const TABS = ["Stock", "Ledger", "Replenishment"] as const;
const WASTE_REASONS = ["Expired", "Temperature excursion", "Dropped / damaged", "Over-production"];

export default function InventoryModule({ sim }: { sim: BranchSimulation }) {
  const user = useApp((s) => s.user);
  const select = useApp((s) => s.select);
  const notify = useApp((s) => s.notify);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Stock");
  const [loc, setLoc] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [waste, setWaste] = useState<{ sku: string; qty: string; reason: string } | null>(null);
  const canAct = can(user, "act:inventory");
  const deny = canAct ? undefined : "Your role cannot change inventory";
  const locations = [...new Map(sim.inventory.map((i) => [i.locationId, i.locationName])).entries()];
  const query = q.trim().toLowerCase();
  const items = sim.inventory
    .filter((i) => loc === "all" || i.locationId === loc)
    .filter((i) => status === "all" || (status === "attention" ? i.status !== "OK" : i.status === status))
    .filter((i) => !query || i.name.toLowerCase().includes(query) || i.sku.toLowerCase().includes(query))
    .sort((a, b) => (a.status === "OK" ? 1 : 0) - (b.status === "OK" ? 1 : 0) || a.name.localeCompare(b.name));
  const value = sim.inventory.reduce((s, i) => s + i.qty * i.unitCost, 0);

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-white/5 py-1.5">
          <div className="font-display text-lg font-bold text-white">{ghs(value)}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-white/45">Stock value</div>
        </div>
        <div className="rounded-md bg-amber-500/10 py-1.5">
          <div className="font-display text-lg font-bold text-amber-200">{sim.inventory.filter((i) => i.status !== "OK").length}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-white/45">Need attention</div>
        </div>
        <div className="rounded-md bg-white/5 py-1.5">
          <div className="font-display text-lg font-bold text-white">{sim.replenishments.filter((r) => r.status !== "received").length}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-white/45">Inbound</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cx("rounded-md px-2 py-0.5 text-[10.5px]", tab === t ? "bg-white/15 text-white" : "bg-white/5 text-white/55 hover:text-white")}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Stock" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="relative min-w-0 flex-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item or SKU" className="w-full rounded-md border border-white/10 bg-black/40 py-1 pl-6 pr-2 text-[11px] text-white placeholder:text-white/30" aria-label="Search inventory" />
            </label>
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className="max-w-36 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Storage location">
              <option value="all">All locations</option>
              {locations.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Status filter">
              <option value="all">All status</option>
              <option value="attention">Needs attention</option>
              {["LOW", "CRITICAL", "EXPIRING", "OUT"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            {items.map((i) => {
              const tone = inventoryTone(i);
              const expiresInH = (i.expiresAt - sim.now()) / 3.6e6;
              return (
                <div key={i.sku} className={cx("rounded-md border p-2 text-[11px]", tone === "red" ? "border-red-500/40 bg-red-500/[0.07]" : tone === "yellow" ? "border-amber-400/30 bg-amber-400/[0.05]" : "border-white/[0.06] bg-white/[0.02]")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold text-white">{i.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-white">
                        {i.qty.toFixed(i.unit === "pcs" ? 0 : 1)} {i.unit}
                      </span>
                      <Pill tone={tone}>{i.status}</Pill>
                    </span>
                  </div>
                  <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-[10.5px] text-white/45">
                    <span className="font-mono">{i.sku}</span>
                    <button type="button" className="truncate text-left hover:text-brand-yellow hover:underline" onClick={() => (select({ kind: "equipment", id: i.locationId }), focusEquipment(sim, i.locationId))} title="Show storage location in 3D">
                      📍 {i.locationName}
                    </button>
                    <span>Reorder at {i.reorderLevel} {i.unit}</span>
                    <span className={expiresInH < 24 ? "text-amber-300" : ""}>Expires {expiresInH < 48 ? `in ${Math.max(0, Math.round(expiresInH))} h` : new Date(i.expiresAt).toISOString().slice(0, 10)}</span>
                    <span className="truncate">{i.supplier}</span>
                    <span>{ghs(i.unitCost)} / {i.unit}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {i.onOrder > 0 ? (
                      <span className="text-[10px] text-sky-300">On order: {i.unit === "pcs" ? Math.round(i.onOrder) : i.onOrder} {i.unit}</span>
                    ) : (
                      <Btn size="xs" disabled={!canAct} title={deny} onClick={() => (sim.requestReplenishment(i), notify(`Replenishment requested: ${i.name}`, "info"))}>
                        Request replenishment
                      </Btn>
                    )}
                    <Btn size="xs" tone="ghost" disabled={!canAct} title={deny} onClick={() => setWaste(waste?.sku === i.sku ? null : { sku: i.sku, qty: "", reason: WASTE_REASONS[0] })}>
                      Record waste
                    </Btn>
                  </div>
                  {waste?.sku === i.sku && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <input type="number" min={0} step={i.unit === "pcs" ? 1 : 0.1} value={waste.qty} onChange={(e) => setWaste({ ...waste, qty: e.target.value })} placeholder={`qty (${i.unit})`} className="w-20 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Waste quantity" />
                      <select value={waste.reason} onChange={(e) => setWaste({ ...waste, reason: e.target.value })} className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white" aria-label="Waste reason">
                        {WASTE_REASONS.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <Btn
                        size="xs"
                        tone="red"
                        disabled={!(Number(waste.qty) > 0)}
                        onClick={() => {
                          if (recordWaste(sim, i.sku, Number(waste.qty), user.name, waste.reason)) notify(`Waste recorded: ${waste.qty} ${i.unit} ${i.name}`, "warning");
                          setWaste(null);
                        }}
                      >
                        Save
                      </Btn>
                    </div>
                  )}
                </div>
              );
            })}
            {!items.length && <p className="py-3 text-center text-[11px] text-white/35">No items match.</p>}
          </div>
        </>
      )}

      {tab === "Ledger" && (
        <div>
          <p className="mb-1.5 text-[10.5px] text-white/45">Every stock movement with its idempotency key — each order is deducted exactly once at the moment of sale (returned if cancelled before production).</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[9.5px] uppercase tracking-wider text-white/35">
                <th className="py-1 font-medium">Time</th>
                <th className="font-medium">Item</th>
                <th className="font-medium">Reason</th>
                <th className="text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {[...sim.ledger]
                .reverse()
                .slice(0, 80)
                .map((l) => {
                  const order = l.reason === "order" && l.ref ? sim.orders.get(l.ref) : undefined;
                  return (
                    <tr key={l.id} className="border-t border-white/[0.05]">
                      <td className="py-0.5 font-mono text-white/40">{clockSec(l.t)}</td>
                      <td className="max-w-36 truncate text-white/70">{INGREDIENT_BY_SKU.get(l.sku)?.name ?? l.sku}</td>
                      <td className="text-white/50">
                        {order ? (
                          <button type="button" className="hover:underline" onClick={() => select({ kind: "order", id: order.id })}>
                            order #{order.number}
                          </button>
                        ) : (
                          l.reason
                        )}
                      </td>
                      <td className={cx("text-right font-mono", l.delta < 0 ? "text-red-300" : "text-emerald-300")}>{l.delta > 0 ? "+" : ""}{Math.round(l.delta * 1000) / 1000}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {!sim.ledger.length && <p className="text-[11px] text-white/40">No movements yet.</p>}
        </div>
      )}

      {tab === "Replenishment" && (
        <div className="space-y-1">
          <p className="text-[10.5px] text-white/45">Requests raised automatically below reorder level, or manually. Sources are demo suppliers / conceptual central kitchens.</p>
          {[...sim.replenishments].reverse().map((r) => {
            const item = sim.inventory.find((i) => i.sku === r.sku);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] p-1.5 text-[11px]">
                <span className="min-w-0">
                  <span className="block truncate text-white/80">
                    {r.qty} {item?.unit} {item?.name}
                  </span>
                  <span className="text-[10px] text-white/40">
                    {r.source} · requested {clock(simMs(sim, r.requestedAt))}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <Pill tone={r.status === "received" ? "green" : "blue"}>{r.status}</Pill>
                  {r.status !== "received" && <div className="font-mono text-[10px] text-white/45">ETA {mins(Math.max(0, r.etaAt - sim.t))}</div>}
                </span>
              </div>
            );
          })}
          {!sim.replenishments.length && <p className="text-[11px] text-white/40">No replenishments yet.</p>}
        </div>
      )}
    </div>
  );
}
