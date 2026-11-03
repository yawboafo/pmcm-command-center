"use client";

import { Video } from "lucide-react";
import { Btn, LiveBadge, SectionTitle, SimBadge, SimDeviceBadge } from "@/components/ui/primitives";
import { EQUIPMENT_CATALOG } from "@/lib/floorplan/catalog";
import { mins, pct } from "@/lib/format";
import { roleLabel, type BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { Card, HistoryChart, KV, Pill, ProgressBar, focusEquipment, focusPoint, limitFor, statusTone } from "./common";
import { statusLabel, taskProgress } from "./InspectOrder";

const CUSTOMER_PHASE: Record<string, string> = {
  "to-queue": "Walking to queue",
  queue: "Queuing",
  ordering: "Ordering at counter",
  waiting: "Waiting for order",
  "to-pickup": "Going to collect",
  collect: "Collecting order",
  "to-seat": "Going to table",
  sitting: "Eating (dine-in)",
  leave: "Leaving",
};

const RIDER_PHASE: Record<string, string> = { "to-wait": "Arriving", waiting: "Waiting at dispatch", "to-rack": "Collecting at rack", collect: "Collecting", leave: "Departing" };

export function InspectAgent({ sim, id }: { sim: BranchSimulation; id: string }) {
  const select = useApp((s) => s.select);
  const a = sim.agents.find((x) => x.id === id);
  if (!a) return <p className="p-4 text-xs text-white/50">This person has left the restaurant.</p>;
  const m = sim.staff.get(a.id);
  const task = a.taskId ? sim.tasks.get(a.taskId) : undefined;
  const order = a.orderId ? sim.orders.get(a.orderId) : undefined;
  const room = sim.roomAtPoint(a.pos);
  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">{a.kind === "staff" ? "Staff member" : a.kind === "rider" ? "Delivery rider" : "Customer"}</span>
          <SimBadge label="FICTIONAL" />
        </div>
        <h2 className="font-display text-base font-bold text-white">{a.name}</h2>
        {m && <div className="text-[11px] text-white/50">{roleLabel(m.role)}</div>}
      </div>
      <Card>
        <KV k="Currently in" v={room?.name ?? "Outside"} />
        {m && <KV k="Shift" v={m.shift} />}
        {m && <KV k="Status" v={a.phase === "working" ? "Working" : a.phase === "to-task" ? "Moving to task" : "Available"} />}
        {m && <KV k="Tasks completed" v={m.tasksDone} mono />}
        {m && <KV k="Utilisation" v={pct(m.busySeconds / Math.max(1, sim.t))} mono />}
        {a.kind === "customer" && <KV k="Activity" v={CUSTOMER_PHASE[a.phase] ?? a.phase} />}
        {a.kind === "customer" && <KV k="Time in store" v={mins(sim.t - a.arrivedAt)} mono />}
        {a.kind === "rider" && <KV k="Activity" v={RIDER_PHASE[a.phase] ?? a.phase} />}
      </Card>
      {task && (
        <div>
          <SectionTitle>Current task</SectionTitle>
          <div className="text-[11.5px] text-white/80">{task.label}</div>
          <div className="mt-1">
            <ProgressBar value={taskProgress(sim, task)} />
          </div>
        </div>
      )}
      {m && (
        <div>
          <SectionTitle>Workstations covered</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {m.skills.map((s) => (
              <Pill key={s}>{s}</Pill>
            ))}
          </div>
          <SectionTitle>
            <span className="mt-3 block">Training records</span>
          </SectionTitle>
          <ul className="list-disc pl-4 text-[11px] text-white/60">
            {m.training.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {order && (
        <Btn size="xs" onClick={() => select({ kind: "order", id: order.id })}>
          Order #{order.number} · {statusLabel(order.status, order)}
        </Btn>
      )}
      {a.kind === "staff" && <p className="text-[10px] leading-snug text-white/35">Fictional demo staff. A production deployment must not track real employees&apos; locations without consent, a lawful basis, privacy controls and dedicated tracking infrastructure.</p>}
    </div>
  );
}

export function InspectCamera({ sim, id }: { sim: BranchSimulation; id: string }) {
  const select = useApp((s) => s.select);
  const viewFromCamera = useApp((s) => s.useVirtualCamera);
  const activeCam = useApp((s) => s.activeCameraId);
  const c = sim.plan.cameras.find((x) => x.id === id);
  if (!c) return <p className="p-4 text-xs text-white/50">Camera not found.</p>;
  const eqInRoom = sim.plan.equipment.filter((e) => e.roomId === c.roomId && e.position[1] < 1.5);
  const wsIds = new Set(c.workstationIds.length ? c.workstationIds : sim.plan.workstations.filter((w) => w.roomId === c.roomId).map((w) => w.id));
  const orders = sim.activeOrders().filter((o) => sim.tasksFor(o.id).some((t) => t.wsId && wsIds.has(t.wsId)));
  const alerts = sim.alerts.filter((a) => a.status !== "resolved" && a.equipmentId && sim.eqById.get(a.equipmentId)?.roomId === c.roomId);
  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-white/40">{c.code}</span>
          <SimBadge label="VIRTUAL CAMERA" />
        </div>
        <h2 className="font-display text-base font-bold text-white">{c.name}</h2>
        <p className="text-[10.5px] text-white/40">Rendered viewpoint of the 3D model — not a CCTV feed.</p>
      </div>
      <Card>
        <KV k="Room" v={sim.roomName(c.roomId)} />
        <KV k="Field of view" v={`${c.fov}°`} mono />
        <KV k="Workstations covered" v={[...wsIds].map((w) => sim.wsById.get(w)?.name).filter(Boolean).join(", ") || "—"} />
      </Card>
      <Btn size="xs" active={activeCam === c.id} onClick={() => viewFromCamera(activeCam === c.id ? null : c.id)}>
        <Video size={12} /> {activeCam === c.id ? "Leave camera view" : "View from this camera"}
      </Btn>
      <div>
        <SectionTitle>Nearby equipment</SectionTitle>
        <div className="flex flex-wrap gap-1">
          {eqInRoom.map((e) => {
            const st = sim.equipment.get(e.id)?.status ?? "idle";
            return (
              <button key={e.id} type="button" onClick={() => select({ kind: "equipment", id: e.id })} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10.5px] text-white/75 hover:bg-white/10">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: st === "fault" ? "#ef4444" : st === "active" ? "#22c55e" : st === "offline" ? "#6b7280" : "#94a3b8" }} />
                {e.name}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <SectionTitle>Active orders in this zone</SectionTitle>
        {orders.length ? (
          <ul className="space-y-0.5 text-[11px]">
            {orders.slice(0, 10).map((o) => (
              <li key={o.id}>
                <button type="button" className="text-white/75 hover:underline" onClick={() => select({ kind: "order", id: o.id })}>
                  #{o.number} · {statusLabel(o.status, o)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-white/40">None right now.</p>
        )}
      </div>
      {alerts.length > 0 && (
        <div>
          <SectionTitle>Alerts in this room</SectionTitle>
          {alerts.map((a) => (
            <button key={a.id} type="button" onClick={() => select({ kind: "alert", id: a.id })} className="block w-full truncate text-left text-[11px] text-red-300 hover:underline">
              {a.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function InspectWorkstation({ sim, id }: { sim: BranchSimulation; id: string }) {
  const select = useApp((s) => s.select);
  const ws = sim.wsById.get(id);
  if (!ws) return <p className="p-4 text-xs text-white/50">Workstation not found.</p>;
  const u = sim.utilizationByWorkstation().find((x) => x.id === id);
  const tasks = [...sim.tasks.values()].filter((t) => t.wsId === id || (t.state === "pending" && t.ws === ws.type));
  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Workstation</span>
          <SimBadge />
        </div>
        <h2 className="font-display text-base font-bold text-white">{ws.name}</h2>
      </div>
      <Card>
        <KV k="Room" v={sim.roomName(ws.roomId)} />
        <KV k="Type" v={ws.type} />
        <KV k="Busy slots" v={`${u?.busySlots ?? 0} / ${ws.capacity}`} mono />
        <KV k="Utilisation (session)" v={pct(u?.utilization ?? 0)} mono />
      </Card>
      <div className="flex flex-wrap gap-1">
        {ws.equipmentIds.map((eid) => (
          <Btn key={eid} size="xs" onClick={() => select({ kind: "equipment", id: eid })}>
            {sim.eqById.get(eid)?.name}
          </Btn>
        ))}
      </div>
      <div>
        <SectionTitle>Queue ({tasks.length})</SectionTitle>
        <ul className="space-y-0.5 text-[11px] text-white/70">
          {tasks.slice(0, 12).map((t) => (
            <li key={t.id} className="flex justify-between gap-2">
              <span className="truncate">{t.label}</span>
              <span className="shrink-0 text-white/40">{t.state}</span>
            </li>
          ))}
        </ul>
      </div>
      <Btn size="xs" onClick={() => focusPoint(ws.standPoint[0], ws.standPoint[1])}>
        Focus camera
      </Btn>
    </div>
  );
}

export function InspectRoom({ sim, id }: { sim: BranchSimulation; id: string }) {
  const select = useApp((s) => s.select);
  const r = sim.plan.rooms.find((x) => x.id === id);
  if (!r) return <p className="p-4 text-xs text-white/50">Room not found.</p>;
  const eq = sim.plan.equipment.filter((e) => e.roomId === id);
  const clean = sim.cleaning.find((c) => c.roomId === id);
  const people = sim.agents.filter((a) => !a.gone && sim.roomAtPoint(a.pos)?.id === id);
  return (
    <div className="space-y-3 p-4">
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Room · conceptual layout</span>
        <h2 className="font-display text-base font-bold text-white">{r.name}</h2>
      </div>
      <Card>
        <KV k="Area" v={`${(r.w * r.d).toFixed(1)} m² (${r.w} × ${r.d} m)`} mono />
        <KV k="Hygiene zone" v={r.hygieneZone} />
        <KV k="People present" v={people.length} mono />
        {clean && <KV k="Cleaning checklist" v={sim.t > clean.dueAt ? "OVERDUE" : `Due in ${mins(clean.dueAt - sim.t)}`} tone={sim.t > clean.dueAt ? "yellow" : "green"} />}
      </Card>
      <div className="flex flex-wrap gap-1">
        {eq.map((e) => (
          <button key={e.id} type="button" onClick={() => select({ kind: "equipment", id: e.id })} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10.5px] text-white/75 hover:bg-white/10">
            {e.name}
          </button>
        ))}
      </div>
      <Btn size="xs" onClick={() => focusPoint(r.x + r.w / 2, r.z + r.d / 2)}>
        Focus camera
      </Btn>
    </div>
  );
}

export function InspectSensor({ sim, id }: { sim: BranchSimulation; id: string }) {
  const select = useApp((s) => s.select);
  const s = sim.plan.sensors.find((x) => x.id === id);
  const st = sim.sensors.get(id);
  if (!s || !st) return <p className="p-4 text-xs text-white/50">Sensor not found.</p>;
  const limit = limitFor(sim, s);
  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.16em] text-white/40">{s.code}</span>
          {st.source === "live" ? <LiveBadge label={`LIVE · ${st.deviceId}`} /> : st.source === "virtual" ? <SimDeviceBadge label={`SIM DEVICE · ${st.deviceId}`} /> : <SimBadge label="CONCEPTUAL SENSOR" />}
        </div>
        <h2 className="font-display text-sm font-bold text-white">{s.name}</h2>
      </div>
      <Card>
        <KV k="Kind" v={s.kind} />
        <KV k="Room" v={sim.roomName(s.roomId)} />
        <KV k="Reading" v={st.value === null ? st.note ?? "—" : `${st.value} ${s.unit === "status" ? "" : s.unit}`} mono />
        <KV k="Status" v={<Pill tone={statusTone(st.status)}>{st.status}</Pill>} />
        <KV k="Connectivity" v={st.source !== "simulated" ? (st.connected ? `${st.source === "virtual" ? "Simulated device" : "Live device"} ${st.deviceId}` : `No data from ${st.deviceId}`) : st.connected ? "Connected (simulated)" : "Offline"} tone={st.connected ? "green" : "yellow"} />
        {limit && <KV k="Configured limit" v={limit.label} mono />}
      </Card>
      {st.history.length > 1 && <HistoryChart data={st.history} limit={limit} unit={s.unit === "%" ? "%" : "°C"} />}
      {s.equipmentId && (
        <div className="flex gap-1.5">
          <Btn size="xs" onClick={() => select({ kind: "equipment", id: s.equipmentId! })}>
            {sim.eqById.get(s.equipmentId)?.name ?? EQUIPMENT_CATALOG[sim.eqById.get(s.equipmentId)!.type].label}
          </Btn>
          <Btn size="xs" onClick={() => focusEquipment(sim, s.equipmentId!)}>
            Focus camera
          </Btn>
        </div>
      )}
    </div>
  );
}
