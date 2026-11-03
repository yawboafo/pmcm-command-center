"use client";

import { Crosshair, Droplets, FlaskConical, ShieldAlert, Wrench } from "lucide-react";
import { Btn, SectionTitle, SourceBadge } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { EQUIPMENT_CATALOG } from "@/lib/floorplan/catalog";
import { ago, clock } from "@/lib/format";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { Card, HistoryChart, KV, Pill, focusEquipment, inventoryTone, limitFor, maintenance, primarySensor, simMs, statusTone } from "./common";

export default function InspectEquipment({ sim, id }: { sim: BranchSimulation; id: string }) {
  const user = useApp((s) => s.user);
  const select = useApp((s) => s.select);
  const notify = useApp((s) => s.notify);
  const e = sim.eqById.get(id);
  const st = sim.equipment.get(id);
  if (!e || !st) return <p className="p-4 text-xs text-white/50">Equipment not found in this branch.</p>;

  const ws = e.workstationId ? sim.wsById.get(e.workstationId) : undefined;
  const sensor = primarySensor(sim, id);
  const sState = sensor ? sim.sensors.get(sensor.id) : undefined;
  const limit = limitFor(sim, sensor);
  const maint = maintenance(sim, e);
  const isTemp = sensor?.unit === "°C";
  const alerts = sim.alerts.filter((a) => a.equipmentId === id);
  const openAlerts = alerts.filter((a) => a.status !== "resolved");
  const stock = sim.inventory.filter((i) => i.locationId === id);
  const active = ws ? sim.activeWorkstations().get(ws.id) : undefined;
  const pendingAtWs = ws ? [...sim.tasks.values()].filter((t) => t.wsId === ws.id) : [];
  const status = st.fault ? (st.fault.kind === "sensor-offline" ? "OFFLINE" : "FAULT") : sState?.status === "critical" ? "CRITICAL" : sState?.status === "warning" ? "WARNING" : st.status === "active" ? "ACTIVE" : "NORMAL";
  const canSafety = can(user, "act:safety");
  const canSim = can(user, "control:simulation");

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Equipment</span>
          <SourceBadge source={sState?.source ?? "simulated"} />
        </div>
        <h2 className="font-display text-base font-bold uppercase leading-tight text-white">{e.name}</h2>
        <div className="text-[11px] text-white/45">{EQUIPMENT_CATALOG[e.type].label}</div>
      </div>

      <Card className={openAlerts.some((a) => a.severity === "critical") ? "border-red-500/40 bg-red-500/[0.06]" : undefined}>
        <KV k="Location" v={sim.roomName(e.roomId)} />
        {ws && <KV k="Workstation" v={ws.name} />}
        {isTemp && <KV k="Current temperature" v={sState?.value === null || sState?.value === undefined ? "—" : `${sState.value.toFixed(1)} °C`} mono tone={statusTone(sState?.status ?? "") === "default" ? undefined : (statusTone(sState?.status ?? "") as "red" | "yellow" | "green")} />}
        {e.operational.setpointC !== undefined && <KV k="Setpoint" v={`${e.operational.setpointC} °C`} mono />}
        {limit && <KV k="Configured limit" v={`${limit.label} · alert after ${sim.safety.alertDelayMin} min`} mono />}
        <KV k="Status" v={<Pill tone={statusTone(status)}>{status}</Pill>} />
        {sensor && <KV k="Sensor" v={sState?.connected ? `CONNECTED · ${sensor.code}${sState.source === "live" ? ` · device ${sState.deviceId}` : sState.source === "virtual" ? ` · simulated device ${sState.deviceId}` : " · simulated"}` : sState && sState.source !== "simulated" ? `NO DATA · device ${sState.deviceId}` : "DISCONNECTED"} tone={sState?.connected ? "green" : "yellow"} />}
        {st.oilQualityPct !== undefined && <KV k="Oil quality" v={`${Math.round(st.oilQualityPct)}% (min ${sim.safety.oilQualityMinPct}%)`} mono tone={st.oilQualityPct < sim.safety.oilQualityMinPct ? "red" : st.oilQualityPct < sim.safety.oilQualityMinPct + 15 ? "yellow" : "green"} />}
        <KV k="Last inspection" v={`${clock(simMs(sim, st.lastInspection))} · ${ago(simMs(sim, st.lastInspection), sim.now())}`} mono />
        <KV k="Maintenance status" v={maint.label} tone={maint.tone === "default" ? undefined : maint.tone} />
        <KV k="Cycles this session" v={st.cycles} mono />
        {st.fault && <KV k={st.fault.kind === "reported" ? "Fault reported by device" : "Simulated fault"} v={`${st.fault.kind} since ${clock(simMs(sim, st.fault.since))}`} tone="red" />}
      </Card>

      {sensor && sState && sState.history.length > 0 && (
        <div>
          <SectionTitle right={<span className="text-[10px] text-white/35">last {Math.round((sState.history.length * 30) / 60)} min</span>}>{isTemp ? "Temperature history" : "Reading history"}</SectionTitle>
          <HistoryChart data={sState.history} limit={limit} unit={sensor.unit === "%" ? "%" : "°C"} />
        </div>
      )}

      {openAlerts.length > 0 && (
        <div>
          <SectionTitle>Open alerts</SectionTitle>
          <div className="space-y-1.5">
            {openAlerts.map((a) => (
              <button key={a.id} type="button" onClick={() => select({ kind: "alert", id: a.id })} className="flex w-full items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-left text-[11.5px] hover:bg-red-500/15">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-red-400" />
                <span className="min-w-0">
                  <span className="block font-semibold text-red-200">{a.severity.toUpperCase()} · {a.status}</span>
                  <span className="block text-white/70">{a.issue}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {ws && (
        <div>
          <SectionTitle>Workstation activity</SectionTitle>
          {pendingAtWs.length === 0 ? (
            <p className="text-[11px] text-white/40">Idle — no jobs at {ws.name}.</p>
          ) : (
            <ul className="space-y-1">
              {pendingAtWs.slice(0, 8).map((t) => {
                const o = t.orderId ? sim.orders.get(t.orderId) : undefined;
                const remain = t.endsAt !== undefined ? Math.max(0, t.endsAt - sim.t) : null;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <button type="button" disabled={!o} onClick={() => o && select({ kind: "order", id: o.id })} className="min-w-0 truncate text-left text-white/75 enabled:hover:underline">
                      {o ? `#${o.number} · ` : ""}
                      {t.label}
                    </button>
                    <span className="shrink-0 font-mono text-white/45">{t.state === "machine" || t.state === "working" ? `${Math.ceil(remain ?? 0)}s` : t.state}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {active && <p className="mt-1 text-[10px] text-white/40">{active.jobs} active job(s) · capacity {ws.capacity}</p>}
        </div>
      )}

      {stock.length > 0 && (
        <div>
          <SectionTitle>Stored here</SectionTitle>
          <ul className="space-y-1">
            {stock.map((i) => (
              <li key={i.sku} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-white/75">{i.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="font-mono text-white/60">
                    {i.qty.toFixed(i.unit === "pcs" ? 0 : 1)} {i.unit}
                  </span>
                  {i.status !== "OK" && <Pill tone={inventoryTone(i)}>{i.status}</Pill>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Btn size="xs" onClick={() => focusEquipment(sim, id)}>
          <Crosshair size={12} /> Focus camera
        </Btn>
        <Btn size="xs" disabled={!canSafety} title={canSafety ? "Record a visual inspection" : "Your role cannot record inspections"} onClick={() => (sim.recordInspection(id, user.name), notify("Inspection recorded (simulated)", "success"))}>
          <FlaskConical size={12} /> Record inspection
        </Btn>
        {st.oilQualityPct !== undefined && (
          <Btn size="xs" disabled={!canSafety} title={canSafety ? "Log a fryer oil change" : "Your role cannot log maintenance"} onClick={() => (sim.changeOil(id), notify("Oil change logged (simulated)", "success"))}>
            <Droplets size={12} /> Change oil
          </Btn>
        )}
      </div>
      <div className="rounded-lg border border-dashed border-amber-400/25 p-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">Demo controls</div>
        <div className="flex flex-wrap gap-1.5">
          {!st.fault ? (
            <Btn size="xs" disabled={!canSim} title={canSim ? "Inject a simulated fault for demonstration" : "Your role cannot control the simulation"} onClick={() => (sim.injectFault(id, undefined, e.category === "refrigeration" ? 6 : 0), notify(`Simulated fault injected: ${e.name}`, "warning"))}>
              <Wrench size={12} /> Simulate fault
            </Btn>
          ) : (
            <Btn size="xs" disabled={!canSim} title={canSim ? "Stand-in for a technician repair" : "Your role cannot control the simulation"} onClick={() => (sim.clearFault(id), notify("Simulated fault cleared — readings recover gradually", "info"))}>
              <Wrench size={12} /> Clear simulated fault
            </Btn>
          )}
        </div>
      </div>
      {alerts.some((a) => a.status === "resolved") && <p className="text-[10px] text-white/35">{alerts.filter((a) => a.status === "resolved").length} resolved alert(s) in history.</p>}
    </div>
  );
}
