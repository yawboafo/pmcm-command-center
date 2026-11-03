"use client";

import { useState } from "react";
import { Btn, SectionTitle, cx } from "@/components/ui/primitives";
import { EQUIPMENT_CATALOG, FURNITURE_CATALOG } from "@/lib/floorplan/catalog";
import type { Door, Equipment, EquipmentType, FloorPlan, Furniture, FurnitureType, Room, RoomType, Sensor, SensorKind, VirtualCamera, WindowOpening, WorkstationType } from "@/lib/floorplan/types";
import { adjacentRooms, allIds, round, uid, type Issue, type LayoutMetrics } from "./model";
import { displayName } from "./ops";
import { useEditor } from "./store";

const ROOM_TYPES: RoomType[] = ["dining", "customer", "counter", "kitchen", "pizza", "chicken", "rice", "packaging", "dispatch", "cold", "freezer", "dry", "wash", "staff", "toilet", "office", "waste", "corridor"];
const ZONES: Room["hygieneZone"][] = ["public", "raw", "cooked", "storage", "support"];
const WS_TYPES: WorkstationType[] = ["order-counter", "pizza-prep", "oven", "chicken-prep", "fryer", "rice", "qc", "packaging", "pickup", "dispatch", "dish", "storage"];
const SENSOR_KINDS: SensorKind[] = ["fridge-temp", "freezer-temp", "hot-holding-temp", "cook-temp-check", "oil-quality", "equipment-health", "cleaning-checklist", "storage-inspection", "handwash-compliance"];

const input = "w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white disabled:opacity-50";

function Num({ label, value, onChange, step = 0.05, disabled, unit = "m" }: { label: string; value: number; onChange: (v: number) => void; step?: number; disabled?: boolean; unit?: string }) {
  return (
    <label className="block text-[10.5px] text-white/50">
      {label}
      <span className="mt-0.5 flex items-center gap-1">
        <input type="number" step={step} value={Number.isFinite(value) ? round(value, 1000) : 0} disabled={disabled} onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))} className={cx(input, "font-mono")} />
        <span className="w-5 text-white/35">{unit}</span>
      </span>
    </label>
  );
}

function Txt({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block text-[10.5px] text-white/50">
      {label}
      <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx(input, "mt-0.5")} />
    </label>
  );
}

function Sel<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<T | [T, string]>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <label className="block text-[10.5px] text-white/50">
      {label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className={cx(input, "mt-0.5")}>
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}

const ROTATIONS: Array<[string, string]> = [
  ["0", "0° (faces north)"],
  [String(Math.PI / 2), "90° (faces east)"],
  [String(Math.PI), "180° (faces south)"],
  [String(-Math.PI / 2), "270° (faces west)"],
];
const rotKey = (r: number) => {
  const q = ((Math.round(r / (Math.PI / 2)) % 4) + 4) % 4;
  return ROTATIONS[[0, 1, 2, 3][q]][0];
};

// ───────────────────────────── Palette ─────────────────────────────

export function Palette({ readOnly }: { readOnly: boolean }) {
  const { mode, setMode } = useEditor();
  const [q, setQ] = useState("");
  const groups = new Map<string, EquipmentType[]>();
  for (const [t, spec] of Object.entries(EQUIPMENT_CATALOG) as Array<[EquipmentType, (typeof EQUIPMENT_CATALOG)[EquipmentType]]>) {
    if (q && !spec.label.toLowerCase().includes(q.toLowerCase())) continue;
    groups.set(spec.category, [...(groups.get(spec.category) ?? []), t]);
  }
  const furn = (Object.keys(FURNITURE_CATALOG) as FurnitureType[]).filter((t) => !q || FURNITURE_CATALOG[t].label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <input placeholder="Search equipment…" value={q} onChange={(e) => setQ(e.target.value)} className={input} aria-label="Search palette" />
      {[...groups].map(([cat, types]) => (
        <div key={cat}>
          <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-white/35">{cat}</div>
          <div className="grid grid-cols-1 gap-1">
            {types.map((t) => {
              const active = mode.kind === "place-equipment" && mode.type === t;
              return (
                <button key={t} type="button" disabled={readOnly} onClick={() => setMode(active ? { kind: "select" } : { kind: "place-equipment", type: t })} className={cx("flex items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] disabled:opacity-40", active ? "bg-brand-red/80 text-white" : "bg-white/[0.04] text-white/75 hover:bg-white/10")}>
                  <span className="truncate">{EQUIPMENT_CATALOG[t].label}</span>
                  <span className="ml-2 shrink-0 font-mono text-[9.5px] text-white/35">
                    {EQUIPMENT_CATALOG[t].size[0]}×{EQUIPMENT_CATALOG[t].size[2]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {furn.length > 0 && (
        <div>
          <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-white/35">furniture</div>
          <div className="grid grid-cols-1 gap-1">
            {furn.map((t) => {
              const active = mode.kind === "place-furniture" && mode.type === t;
              return (
                <button key={t} type="button" disabled={readOnly} onClick={() => setMode(active ? { kind: "select" } : { kind: "place-furniture", type: t })} className={cx("flex items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] disabled:opacity-40", active ? "bg-brand-red/80 text-white" : "bg-white/[0.04] text-white/75 hover:bg-white/10")}>
                  <span className="truncate">{FURNITURE_CATALOG[t].label}</span>
                  <span className="ml-2 shrink-0 font-mono text-[9.5px] text-white/35">{FURNITURE_CATALOG[t].seats} seats</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Building & rooms ─────────────────────────────

export function BuildingPanel({ plan, readOnly }: { plan: FloorPlan; readOnly: boolean }) {
  const { mutate, setSelection, selection } = useEditor();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Num label="Width" value={plan.dimensions.width} disabled={readOnly} onChange={(v) => mutate((p) => (p.dimensions.width = Math.max(4, v)), { walls: true })} />
        <Num label="Length" value={plan.dimensions.length} disabled={readOnly} onChange={(v) => mutate((p) => (p.dimensions.length = Math.max(4, v)), { walls: true })} />
        <Num label="Height" value={plan.dimensions.height} disabled={readOnly} onChange={(v) => mutate((p) => (p.dimensions.height = Math.min(6, Math.max(2.4, v))), { walls: true })} />
      </div>
      <div>
        <SectionTitle
          right={
            !readOnly && (
              <Btn
                size="xs"
                onClick={() => {
                  let id = "";
                  mutate(
                    (p) => {
                      id = uid("room", allIds(p));
                      p.rooms.push({ id, name: "New room", type: "corridor", hygieneZone: "support", x: 0, z: 0, w: 2, d: 2 });
                    },
                    { walls: true },
                  );
                  setSelection([{ kind: "room", id }]);
                }}
              >
                + Room
              </Btn>
            )
          }
        >
          Rooms
        </SectionTitle>
        <ul className="space-y-0.5">
          {plan.rooms.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSelection([{ kind: "room", id: r.id }])} className={cx("flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11.5px]", selection.some((s) => s.id === r.id) ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/5")}>
                <span className="truncate">{r.name}</span>
                <span className="font-mono text-[10px] text-white/35">{(r.w * r.d).toFixed(1)} m²</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────────── Properties ─────────────────────────────

export function Properties({ plan, readOnly }: { plan: FloorPlan; readOnly: boolean }) {
  const { selection, mutate } = useEditor();
  if (!selection.length) return <p className="text-xs text-white/45">Select an item on the plan (or in 3D). Shift-click adds to the selection. Arrow keys nudge, R rotates, Del deletes, Ctrl/⌘+D duplicates.</p>;
  if (selection.length > 1)
    return (
      <div className="text-xs text-white/60">
        <p className="mb-2">{selection.length} items selected</p>
        <ul className="space-y-0.5 text-[11px] text-white/50">
          {selection.map((s) => (
            <li key={s.id}>{displayName(plan, s)}</li>
          ))}
        </ul>
      </div>
    );
  const s = selection[0];
  const ro = readOnly;
  const roomOptions = plan.rooms.map((r) => [r.id, r.name] as [string, string]);

  if (s.kind === "equipment") {
    const e = plan.equipment.find((x) => x.id === s.id);
    if (!e) return null;
    const set = (fn: (eq: Equipment) => void) => mutate((p) => fn(p.equipment.find((x) => x.id === e.id)!));
    return (
      <div className="space-y-2">
        <div className="text-[10.5px] text-white/40">{EQUIPMENT_CATALOG[e.type].label} · {e.id}</div>
        <Txt label="Name" value={e.name} disabled={ro} onChange={(v) => set((q) => (q.name = v))} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="X (east)" value={e.position[0]} disabled={ro} onChange={(v) => set((q) => (q.position = [v, q.position[1], q.position[2]]))} />
          <Num label="Z (north)" value={e.position[2]} disabled={ro} onChange={(v) => set((q) => (q.position = [q.position[0], q.position[1], v]))} />
          <Num label="Width" value={e.size[0]} disabled={ro} onChange={(v) => set((q) => (q.size = [Math.max(0.2, v), q.size[1], q.size[2]]))} />
          <Num label="Depth" value={e.size[2]} disabled={ro} onChange={(v) => set((q) => (q.size = [q.size[0], q.size[1], Math.max(0.05, v)]))} />
          <Num label="Height" value={e.size[1]} disabled={ro} onChange={(v) => set((q) => (q.size = [q.size[0], Math.max(0.05, v), q.size[2]]))} />
          <Num label="Elevation" value={e.position[1]} disabled={ro} onChange={(v) => set((q) => (q.position = [q.position[0], Math.max(0, v), q.position[2]]))} />
        </div>
        <Sel label="Rotation (front faces…)" value={rotKey(e.rotation)} options={ROTATIONS} disabled={ro} onChange={(v) => set((q) => (q.rotation = Number(v)))} />
        <Sel label="Room" value={e.roomId} options={roomOptions} disabled={ro} onChange={(v) => set((q) => (q.roomId = v))} />
        <Sel
          label="Workstation"
          value={e.workstationId ?? ""}
          options={[["", "— none —"], ...plan.workstations.map((w) => [w.id, w.name] as [string, string])]}
          disabled={ro}
          onChange={(v) =>
            mutate((p) => {
              const q = p.equipment.find((x) => x.id === e.id)!;
              for (const w of p.workstations) w.equipmentIds = w.equipmentIds.filter((id) => id !== q.id);
              if (v) {
                p.workstations.find((w) => w.id === v)?.equipmentIds.push(q.id);
                q.workstationId = v;
              } else delete q.workstationId;
            })
          }
        />
        {e.operational.setpointC !== undefined && <Num label="Setpoint" unit="°C" step={0.5} value={e.operational.setpointC} disabled={ro} onChange={(v) => set((q) => (q.operational.setpointC = v))} />}
        {e.operational.capacity !== undefined && <Num label="Capacity (parallel jobs)" unit="" step={1} value={e.operational.capacity} disabled={ro} onChange={(v) => set((q) => (q.operational.capacity = Math.max(1, Math.round(v))))} />}
      </div>
    );
  }
  if (s.kind === "furniture") {
    const f = plan.furniture.find((x) => x.id === s.id);
    if (!f) return null;
    const set = (fn: (q: Furniture) => void) => mutate((p) => fn(p.furniture.find((x) => x.id === f.id)!));
    return (
      <div className="space-y-2">
        <div className="text-[10.5px] text-white/40">{FURNITURE_CATALOG[f.type].label} · {f.id}</div>
        <div className="grid grid-cols-2 gap-2">
          <Num label="X (east)" value={f.position[0]} disabled={ro} onChange={(v) => set((q) => (q.position = [v, 0, q.position[2]]))} />
          <Num label="Z (north)" value={f.position[2]} disabled={ro} onChange={(v) => set((q) => (q.position = [q.position[0], 0, v]))} />
        </div>
        <Sel label="Rotation" value={rotKey(f.rotation)} options={ROTATIONS} disabled={ro} onChange={(v) => set((q) => (q.rotation = Number(v)))} />
        <Num label="Seats" unit="" step={1} value={f.seats} disabled={ro} onChange={(v) => set((q) => (q.seats = Math.max(0, Math.round(v))))} />
        <Sel label="Room" value={f.roomId} options={roomOptions} disabled={ro} onChange={(v) => set((q) => (q.roomId = v))} />
      </div>
    );
  }
  if (s.kind === "room") {
    const r = plan.rooms.find((x) => x.id === s.id);
    if (!r) return null;
    const set = (fn: (q: Room) => void) => mutate((p) => fn(p.rooms.find((x) => x.id === r.id)!), { walls: true });
    const adj = adjacentRooms(plan, r);
    const isOpen = (o: Room) => plan.openings.some(([a, b]) => (a === r.id && b === o.id) || (a === o.id && b === r.id));
    return (
      <div className="space-y-2">
        <Txt label="Name" value={r.name} disabled={ro} onChange={(v) => set((q) => (q.name = v))} />
        <div className="grid grid-cols-2 gap-2">
          <Sel label="Type" value={r.type} options={ROOM_TYPES} disabled={ro} onChange={(v) => set((q) => (q.type = v))} />
          <Sel label="Hygiene zone" value={r.hygieneZone} options={ZONES} disabled={ro} onChange={(v) => set((q) => (q.hygieneZone = v))} />
          <Num label="X" value={r.x} disabled={ro} onChange={(v) => set((q) => (q.x = v))} />
          <Num label="Z" value={r.z} disabled={ro} onChange={(v) => set((q) => (q.z = v))} />
          <Num label="Width" value={r.w} disabled={ro} onChange={(v) => set((q) => (q.w = Math.max(0.5, v)))} />
          <Num label="Depth" value={r.d} disabled={ro} onChange={(v) => set((q) => (q.d = Math.max(0.5, v)))} />
        </div>
        <div>
          <div className="mb-1 text-[10.5px] text-white/50">Open-plan connections (no wall)</div>
          {adj.length === 0 && <div className="text-[11px] text-white/35">No adjacent rooms</div>}
          {adj.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[11.5px] text-white/75">
              <input
                type="checkbox"
                disabled={ro}
                checked={isOpen(o)}
                onChange={(e) =>
                  mutate(
                    (p) => {
                      p.openings = p.openings.filter(([a, b]) => !((a === r.id && b === o.id) || (a === o.id && b === r.id)));
                      if (e.target.checked) p.openings.push([r.id, o.id]);
                    },
                    { walls: true },
                  )
                }
              />
              {o.name}
            </label>
          ))}
        </div>
        <p className="text-[10.5px] text-white/35">Drag the white edge handles on the plan to resize.</p>
      </div>
    );
  }
  if (s.kind === "door") {
    const d = plan.doors.find((x) => x.id === s.id);
    if (!d) return null;
    const set = (fn: (q: Door) => void) => mutate((p) => fn(p.doors.find((x) => x.id === d.id)!), { walls: true });
    return (
      <div className="space-y-2">
        <Txt label="Name" value={d.name} disabled={ro} onChange={(v) => set((q) => (q.name = v))} />
        <Sel label="Kind" value={d.kind} options={["entrance", "internal", "staff", "emergency", "delivery"]} disabled={ro} onChange={(v) => set((q) => (q.kind = v))} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Width" value={d.width} disabled={ro} onChange={(v) => set((q) => (q.width = Math.max(0.6, v)))} />
          <Num label={d.axis === "x" ? "Position X" : "Position Z"} value={d.axis === "x" ? d.x : d.z} disabled={ro} onChange={(v) => set((q) => (q.axis === "x" ? (q.x = v) : (q.z = v)))} />
        </div>
        <p className="text-[10.5px] text-white/35">Drag the door on the plan to slide it along its wall. Emergency exits and entrances need a clear 0.9 m in front.</p>
      </div>
    );
  }
  if (s.kind === "window") {
    const w = plan.windows.find((x) => x.id === s.id);
    if (!w) return null;
    const set = (fn: (q: WindowOpening) => void) => mutate((p) => fn(p.windows.find((x) => x.id === w.id)!), { walls: true });
    return (
      <div className="grid grid-cols-2 gap-2">
        <Num label="Width" value={w.width} disabled={ro} onChange={(v) => set((q) => (q.width = Math.max(0.3, v)))} />
        <Num label={w.axis === "x" ? "Position X" : "Position Z"} value={w.axis === "x" ? w.x : w.z} disabled={ro} onChange={(v) => set((q) => (q.axis === "x" ? (q.x = v) : (q.z = v)))} />
        <Num label="Sill height" value={w.sill} disabled={ro} onChange={(v) => set((q) => (q.sill = Math.max(0, v)))} />
        <Num label="Glazing height" value={w.height} disabled={ro} onChange={(v) => set((q) => (q.height = Math.max(0.3, v)))} />
      </div>
    );
  }
  if (s.kind === "camera") {
    const c = plan.cameras.find((x) => x.id === s.id);
    if (!c) return null;
    const set = (fn: (q: VirtualCamera) => void) => mutate((p) => fn(p.cameras.find((x) => x.id === c.id)!));
    return (
      <div className="space-y-2">
        <div className="text-[10.5px] text-white/40">{c.code} · virtual viewpoint (not CCTV)</div>
        <Txt label="Name" value={c.name} disabled={ro} onChange={(v) => set((q) => (q.name = v))} />
        <div className="grid grid-cols-3 gap-2">
          <Num label="Pos X" value={c.position[0]} disabled={ro} onChange={(v) => set((q) => (q.position = [v, q.position[1], q.position[2]]))} />
          <Num label="Pos Y" value={c.position[1]} disabled={ro} onChange={(v) => set((q) => (q.position = [q.position[0], v, q.position[2]]))} />
          <Num label="Pos Z" value={c.position[2]} disabled={ro} onChange={(v) => set((q) => (q.position = [q.position[0], q.position[1], v]))} />
          <Num label="Look X" value={c.target[0]} disabled={ro} onChange={(v) => set((q) => (q.target = [v, q.target[1], q.target[2]]))} />
          <Num label="Look Y" value={c.target[1]} disabled={ro} onChange={(v) => set((q) => (q.target = [q.target[0], v, q.target[2]]))} />
          <Num label="Look Z" value={c.target[2]} disabled={ro} onChange={(v) => set((q) => (q.target = [q.target[0], q.target[1], v]))} />
        </div>
        <Num label="Field of view" unit="°" step={1} value={c.fov} disabled={ro} onChange={(v) => set((q) => (q.fov = Math.min(110, Math.max(20, v))))} />
        <Sel label="Room" value={c.roomId} options={roomOptions} disabled={ro} onChange={(v) => set((q) => (q.roomId = v))} />
        <p className="text-[10.5px] text-white/35">Drag the camera square to move it; drag the round handle to aim it.</p>
      </div>
    );
  }
  if (s.kind === "sensor") {
    const sn = plan.sensors.find((x) => x.id === s.id);
    if (!sn) return null;
    const set = (fn: (q: Sensor) => void) => mutate((p) => fn(p.sensors.find((x) => x.id === sn.id)!));
    return (
      <div className="space-y-2">
        <div className="text-[10.5px] text-white/40">{sn.code} · conceptual monitoring point</div>
        <Txt label="Name" value={sn.name} disabled={ro} onChange={(v) => set((q) => (q.name = v))} />
        <Sel label="Kind" value={sn.kind} options={SENSOR_KINDS} disabled={ro} onChange={(v) => set((q) => (q.kind = v))} />
        <Sel
          label="Attached to equipment"
          value={sn.equipmentId ?? ""}
          options={[["", "— none —"], ...plan.equipment.map((e) => [e.id, e.name] as [string, string])]}
          disabled={ro}
          onChange={(v) =>
            set((q) => {
              const e = plan.equipment.find((x) => x.id === v);
              if (e) {
                q.equipmentId = e.id;
                q.roomId = e.roomId;
                q.position = [e.position[0], e.position[1] + e.size[1] + 0.15, e.position[2]];
              } else delete q.equipmentId;
            })
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <Num label="X" value={sn.position[0]} disabled={ro} onChange={(v) => set((q) => (q.position = [v, q.position[1], q.position[2]]))} />
          <Num label="Z" value={sn.position[2]} disabled={ro} onChange={(v) => set((q) => (q.position = [q.position[0], q.position[1], v]))} />
        </div>
      </div>
    );
  }
  return null;
}

// ───────────────────────────── Workstations ─────────────────────────────

export function WorkstationsPanel({ plan, readOnly }: { plan: FloorPlan; readOnly: boolean }) {
  const { selection, mutate, setSelection } = useEditor();
  const [type, setType] = useState<WorkstationType>("packaging");
  const selectedEq = selection.filter((s) => s.kind === "equipment").map((s) => s.id);
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="mb-1 text-[11px] text-white/60">Create workstation from {selectedEq.length || "no"} selected equipment</div>
          <div className="flex gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as WorkstationType)} className={input}>
              {WS_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <Btn
              size="xs"
              disabled={!selectedEq.length}
              onClick={() =>
                mutate((p) => {
                  const first = p.equipment.find((e) => e.id === selectedEq[0])!;
                  const id = uid(`ws-${type}`, allIds(p));
                  for (const w of p.workstations) w.equipmentIds = w.equipmentIds.filter((x) => !selectedEq.includes(x));
                  p.workstations = p.workstations.filter((w) => w.equipmentIds.length);
                  p.workstations.push({ id, name: `${type} station`, type, roomId: first.roomId, equipmentIds: [...selectedEq], standPoint: [0, 0], capacity: first.operational.capacity ?? 1 });
                  for (const e of p.equipment) if (selectedEq.includes(e.id)) e.workstationId = id;
                })
              }
            >
              Create
            </Btn>
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {plan.workstations.map((w) => (
          <li key={w.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input value={w.name} disabled={readOnly} onChange={(e) => mutate((p) => (p.workstations.find((x) => x.id === w.id)!.name = e.target.value))} className={input} aria-label="Workstation name" />
              <input type="number" min={1} value={w.capacity} disabled={readOnly} onChange={(e) => mutate((p) => (p.workstations.find((x) => x.id === w.id)!.capacity = Math.max(1, Number(e.target.value) || 1)))} className={cx(input, "w-14 font-mono")} aria-label="Capacity" title="Parallel jobs" />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <select value={w.type} disabled={readOnly} onChange={(e) => mutate((p) => (p.workstations.find((x) => x.id === w.id)!.type = e.target.value as WorkstationType))} className={cx(input, "w-auto")}>
                {WS_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              {!readOnly && (
                <button
                  type="button"
                  className="text-[10.5px] text-red-300 hover:underline"
                  onClick={() =>
                    mutate((p) => {
                      p.workstations = p.workstations.filter((x) => x.id !== w.id);
                      for (const e of p.equipment) if (e.workstationId === w.id) delete e.workstationId;
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {w.equipmentIds.map((id) => (
                <button key={id} type="button" onClick={() => setSelection([{ kind: "equipment", id }])} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/20">
                  {plan.equipment.find((e) => e.id === id)?.name ?? id}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────────── Issues ─────────────────────────────

export function IssuesPanel({ issues, plan }: { issues: Issue[]; plan: FloorPlan }) {
  const { setSelection, focusOn } = useEditor();
  if (!issues.length) return <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-200">No issues — layout passes overlap, clearance, circulation and hygiene checks.</p>;
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return (
    <ul className="space-y-1.5">
      {sorted.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            onClick={() => {
              if (i.targets.length) setSelection(i.targets.filter((t) => t.kind !== "door" || i.targets.length === 1));
              const at = i.at ?? (i.targets[0] && plan.rooms.find((r) => r.id === i.targets[0].id) ? [plan.rooms.find((r) => r.id === i.targets[0].id)!.x, plan.rooms.find((r) => r.id === i.targets[0].id)!.z] : null);
              if (at) focusOn(at[0], at[1]);
            }}
            className={cx("w-full rounded-lg border px-2 py-1.5 text-left text-[11.5px]", i.severity === "error" ? "border-red-500/30 bg-red-500/10 text-red-100 hover:bg-red-500/15" : "border-amber-400/25 bg-amber-400/5 text-amber-100 hover:bg-amber-400/10")}
          >
            <span className="mr-1.5 font-mono text-[9.5px] uppercase opacity-70">{i.category}</span>
            {i.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── Metrics strip ─────────────────────────────

function delta(cur: number | null, base: number | null, unit: string, lowerIsBetter = true) {
  if (cur === null || base === null) return null;
  const d = Math.round((cur - base) * 10) / 10;
  if (Math.abs(d) < 0.05) return null;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={good ? "text-emerald-300" : "text-red-300"}>
      {d > 0 ? "+" : ""}
      {d}
      {unit}
    </span>
  );
}

export function MetricsStrip({ m, base, errors, warnings }: { m: LayoutMetrics; base: LayoutMetrics | null; errors: number; warnings: number }) {
  const cell = "shrink-0 px-3 py-1.5";
  const lbl = "text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40";
  const val = "font-mono text-[13px] font-semibold tabular-nums text-white";
  return (
    <div className="flex w-max items-stretch divide-x divide-white/5 rounded-xl border border-white/10 bg-white/[0.03]" aria-live="polite">
      <div className={cell}>
        <div className={lbl}>Area</div>
        <div className={val}>{m.area} m²</div>
      </div>
      <div className={cell}>
        <div className={lbl}>Kitchen / customer</div>
        <div className={val}>
          {Math.round(m.kitchenPct * 100)}% / {Math.round(m.customerPct * 100)}%
        </div>
      </div>
      <div className={cell}>
        <div className={lbl}>Seats</div>
        <div className={val}>
          {m.seats} <span className="text-[10px]">{delta(m.seats, base?.seats ?? null, "", false)}</span>
        </div>
      </div>
      <div className={cell} title="A* walking distance between consecutive stations of each product flow">
        <div className={lbl}>Flow walking distance</div>
        <div className={val}>
          {m.flowTotal} m <span className="text-[10px]">{delta(m.flowTotal, base?.flowTotal ?? null, " m")}</span>
        </div>
        <div className="font-mono text-[9.5px] text-white/40">
          pizza {m.flows.pizza ?? "—"} · chicken {m.flows.chicken ?? "—"} · rice {m.flows.rice ?? "—"}
        </div>
      </div>
      <div className={cell} title="Bottleneck estimate from station capacities and the simulation's stage durations (assumption)">
        <div className={lbl}>Est. peak throughput</div>
        <div className={val}>
          {m.throughputPerHour} orders/h <span className="text-[10px]">{delta(m.throughputPerHour, base?.throughputPerHour ?? null, "", false)}</span>
        </div>
        <div className="font-mono text-[9.5px] text-white/40">bottleneck: {m.bottleneck ?? "—"}</div>
      </div>
      <div className={cell}>
        <div className={lbl}>Stations</div>
        <div className={val}>{m.workstations}</div>
      </div>
      <div className={cell}>
        <div className={lbl}>Issues</div>
        <div className={val}>
          <span className={errors ? "text-red-400" : "text-emerald-400"}>{errors} err</span> · <span className={warnings ? "text-amber-300" : "text-white/60"}>{warnings} warn</span>
        </div>
      </div>
    </div>
  );
}
