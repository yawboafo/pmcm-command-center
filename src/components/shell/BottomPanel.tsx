"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { SimBadge, cx } from "@/components/ui/primitives";
import { clock, ghs } from "@/lib/format";
import { useSnapshots, useTick } from "@/lib/hooks/useSim";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { channelLabel } from "@/lib/sim/engine";
import type { SimEvent } from "@/lib/sim/types";
import { useLive } from "@/lib/integration/liveClient";
import { useIntegrationStatus } from "@/lib/integration/useStatus";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

const TABS = ["Activity", "Incoming orders", "Safety & equipment", "Connectivity"] as const;
const SEV = { info: "text-white/60", success: "text-emerald-300", warning: "text-amber-300", critical: "text-red-400" } as const;

export default function BottomPanel() {
  useTick();
  const open = useApp((s) => s.panels.bottom);
  const toggle = useApp((s) => s.togglePanel);
  const entered = useApp((s) => s.enteredBranchId);
  const select = useApp((s) => s.select);
  const followOrder = useApp((s) => s.followOrder);
  const enterBranch = useApp((s) => s.enterBranch);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Activity");
  const live = useLive();
  const { status: integ } = useIntegrationStatus(tab === "Connectivity" && open ? 5000 : 30_000);
  const online = integ?.devices.filter((d) => d.online).length ?? 0;
  const bound = integ?.devices.filter((d) => d.keyConfigured).length ?? 0;
  const snaps = useSnapshots();

  const running = [...sims().sims.values()];
  const scoped = entered ? running.filter((s) => s.branchId === entered) : running;
  const events: Array<SimEvent & { branchId: string }> = scoped
    .flatMap((s) => s.events.slice(-60).map((e) => ({ ...e, branchId: s.branchId })))
    .sort((a, b) => b.t - a.t)
    .slice(0, 60);
  const orders = scoped.flatMap((s) => s.activeOrders().map((o) => ({ o, sim: s }))).sort((a, b) => b.o.createdAt - a.o.createdAt);
  const issues = snaps.filter((s) => s.issue && (!entered || s.branchId === entered));

  return (
    <section className={cx("glass z-20 shrink-0 rounded-none border-x-0 border-b-0 transition-all", open ? "h-52" : "h-9")} aria-label="Operations feed">
      <div className="flex h-9 items-center gap-1 border-b border-white/5 px-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => (setTab(t), !open && toggle("bottom"))} className={cx("rounded-md px-2.5 py-1 text-[11.5px]", tab === t && open ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}>
            {t}
            {t === "Incoming orders" && orders.length > 0 && <span className="ml-1.5 rounded bg-white/10 px-1 text-[10px]">{orders.length}</span>}
            {t === "Safety & equipment" && issues.length > 0 && <span className="ml-1.5 rounded bg-red-500/25 px-1 text-[10px] text-red-200">{issues.length}</span>}
          </button>
        ))}
        <SimBadge className="ml-2" />
        <button type="button" onClick={() => toggle("bottom")} className="ml-auto rounded p-1 text-white/50 hover:text-white" aria-label={open ? "Collapse feed" : "Expand feed"}>
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {open && (
        <div className="scroll-thin h-[calc(100%-2.25rem)] overflow-y-auto px-3 py-2 text-[11.5px]">
          {tab === "Activity" &&
            (events.length ? (
              <ul className="space-y-0.5">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="shrink-0 font-mono text-white/35">{clock(e.t)}</span>
                    {!entered && <span className="w-24 shrink-0 truncate text-white/45">{BRANCH_BY_ID.get(e.branchId)?.name}</span>}
                    <button
                      type="button"
                      className={cx("min-w-0 truncate text-left hover:underline", SEV[e.severity])}
                      onClick={() => {
                        if (e.refs?.orderId) select({ kind: "order", id: e.refs.orderId });
                        else if (e.refs?.alertId) select({ kind: "alert", id: e.refs.alertId });
                        else if (e.refs?.equipmentId) select({ kind: "equipment", id: e.refs.equipmentId });
                      }}
                    >
                      {e.message}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-white/40">No simulation is running yet. Open a branch from the map to start its kitchen simulation — network markers already show lightweight simulated metrics.</p>
            ))}
          {tab === "Incoming orders" &&
            (orders.length ? (
              <table className="w-full">
                <tbody>
                  {orders.slice(0, 40).map(({ o, sim }) => (
                    <tr key={o.id} className="border-b border-white/5">
                      <td className="py-1 font-mono text-white">#{o.number}</td>
                      {!entered && <td className="text-white/50">{sim.branchName}</td>}
                      <td className="text-white/50">{channelLabel(o.channel)}</td>
                      <td className="max-w-80 truncate text-white/70">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</td>
                      <td className="font-mono text-white/70">{ghs(o.total)}</td>
                      <td>
                        <span className={cx("rounded px-1.5 py-px text-[10px] font-semibold", o.delayed ? "bg-red-500/20 text-red-300" : o.status === "READY" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/70")}>{o.status.replace(/_/g, " ")}</span>
                      </td>
                      <td>
                        {entered && (
                          <button type="button" className="text-[11px] text-brand-yellow hover:underline" onClick={() => followOrder(o.id)}>
                            Follow
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-white/40">No active orders in running simulations.</p>
            ))}
          {tab === "Safety & equipment" &&
            (issues.length ? (
              <ul className="space-y-1">
                {issues.map((s) => (
                  <li key={s.branchId} className="flex items-center gap-2">
                    <span className={cx("w-16 shrink-0 font-semibold uppercase", s.status === "critical" ? "text-red-400" : "text-amber-300")}>{s.status}</span>
                    <span className="w-32 shrink-0 truncate text-white/60">{BRANCH_BY_ID.get(s.branchId)?.name}</span>
                    <span className="truncate text-white/80">{s.issue}</span>
                    {!entered && (
                      <button type="button" onClick={() => enterBranch(s.branchId)} className="ml-auto shrink-0 text-brand-yellow hover:underline">
                        Open twin
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-white/40">No open safety or equipment issues.</p>
            ))}
          {tab === "Connectivity" && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Simulation engine", `Running · ${sims().sims.size} full branch simulation(s)${sims().realtime ? " · real-time clock" : ""}`, "ok"],
                ["Branch directory", "Official outlet list · verified 2026-11-03", "ok"],
                ["Live telemetry stream", `${live.status}${live.readings ? ` · ${live.readings} readings, last ${live.lastReadingAt ? clock(live.lastReadingAt) : "—"}` : " · no readings yet"}${live.unmatched ? ` · ${live.unmatched} unmatched` : ""}`, live.status === "connected" ? "ok" : "warn"],
                ["IoT devices", integ ? `${online} online / ${integ.devices.length} registered (${bound} with keys)${online ? "" : " — sensors use simulated readings"}` : "Checking…", online ? "ok" : "off"],
                ["POS / Chris B orders", integ?.posWebhookConfigured ? "Webhook secret configured — awaiting integration" : "Not connected — simulated orders only", "off"],
                ["Physical CCTV", integ?.cameras.some((c) => c.enabled) ? `${integ.cameras.filter((c) => c.enabled).length} authorised camera(s)` : "Not connected — virtual cameras only", integ?.cameras.some((c) => c.enabled) ? "ok" : "off"],
                ["Rider GPS", "Not connected — no live coordinates shown", "off"],
                ["AI assistant", integ?.assistantConfigured ? "Claude API configured" : "Offline rule-based mode", integ?.assistantConfigured ? "ok" : "off"],
              ].map(([k, v, st]) => (
                <div key={k} className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                  <div className="flex items-center gap-2 text-white">
                    <span className={cx("h-2 w-2 rounded-full", st === "ok" ? "bg-emerald-400" : st === "warn" ? "bg-amber-400" : "bg-white/25")} />
                    {k}
                  </div>
                  <div className="mt-0.5 text-white/45">{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
