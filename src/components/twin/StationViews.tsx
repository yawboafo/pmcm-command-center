"use client";

import { Crosshair } from "lucide-react";
import { useMemo } from "react";
import type { FloorPlan, RoomType, Vec3, WorkstationType } from "@/lib/floorplan/types";
import { useApp } from "@/store/app";
import { useTwin } from "./twinStore";

export interface Preset {
  id: string;
  label: string;
  position: Vec3;
  target: Vec3;
  /** Workstation to select so the inspector shows its tasks and workload. */
  workstationId?: string;
}

const STATIONS: Array<{ id: string; label: string; ws: WorkstationType[] }> = [
  { id: "pizza", label: "Pizza line", ws: ["pizza-prep", "oven"] },
  { id: "fry", label: "Fry station", ws: ["chicken-prep", "fryer"] },
  { id: "rice", label: "Rice station", ws: ["rice"] },
  { id: "qc", label: "QC & packing", ws: ["qc", "packaging"] },
  { id: "dispatch", label: "Dispatch", ws: ["dispatch"] },
  { id: "counter", label: "Front counter", ws: ["order-counter", "pickup"] },
];

const ZONES: Array<{ id: string; label: string; rooms: RoomType[]; height: number }> = [
  { id: "kitchen", label: "Kitchen overview", rooms: ["kitchen", "pizza", "chicken", "rice", "packaging", "dispatch"], height: 7.5 },
  { id: "cold", label: "Cold storage", rooms: ["cold", "freezer", "dry"], height: 4.5 },
  { id: "dining", label: "Dining room", rooms: ["dining", "customer"], height: 6 },
];

/** Camera presets derived from the floor plan, so every branch layout gets matching views. */
export function stationPresets(plan: FloorPlan): Preset[] {
  const out: Preset[] = [];
  const eq = new Map(plan.equipment.map((e) => [e.id, e]));
  for (const z of ZONES) {
    const rooms = plan.rooms.filter((r) => z.rooms.includes(r.type));
    if (!rooms.length) continue;
    const x0 = Math.min(...rooms.map((r) => r.x));
    const x1 = Math.max(...rooms.map((r) => r.x + r.w));
    const z0 = Math.min(...rooms.map((r) => r.z));
    const z1 = Math.max(...rooms.map((r) => r.z + r.d));
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Look down at ~55° from the side of the zone nearest the building centre.
    const towardsFront = cz < plan.dimensions.length / 2 ? 1 : -1;
    out.push({ id: z.id, label: z.label, target: [cx, 0.6, cz], position: [cx, z.height, cz + towardsFront * Math.max(2.5, (z1 - z0) * 0.6)] });
  }
  for (const s of STATIONS) {
    const ws = plan.workstations.filter((w) => s.ws.includes(w.type));
    const items = ws.flatMap((w) => w.equipmentIds.map((id) => eq.get(id)).filter((e) => !!e && e.position[1] < 1));
    if (!items.length) continue;
    const cx = items.reduce((a, e) => a + e!.position[0], 0) / items.length;
    const cz = items.reduce((a, e) => a + e!.position[2], 0) / items.length;
    // Look down from above wall height (interiors are cut away), offset towards the operators'
    // side so the working faces of the equipment are visible.
    const sx = ws.reduce((a, w) => a + w.standPoint[0], 0) / ws.length;
    const sz = ws.reduce((a, w) => a + w.standPoint[1], 0) / ws.length;
    const len = Math.hypot(sx - cx, sz - cz) || 1;
    const px = cx + ((sx - cx) / len) * 2.6;
    const pz = cz + ((sz - cz) / len) * 2.6;
    const H = plan.dimensions.height;
    out.push({ id: s.id, label: s.label, target: [cx, 0.9, cz], position: [px, H + 1.6, pz], workstationId: ws[0].id });
  }
  return out;
}

export function StationViews({ plan }: { plan: FloorPlan }) {
  const open = useTwin((s) => s.stationsOpen);
  const setOpen = useTwin((s) => s.setStationsOpen);
  const requestCamera = useApp((s) => s.requestCamera);
  const select = useApp((s) => s.select);
  const list = useMemo(() => stationPresets(plan), [plan]);
  return (
    <div className="pointer-events-auto relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="glass flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-semibold text-white hover:bg-white/10">
        <Crosshair size={14} className="text-sky-300" /> Stations &amp; zones
      </button>
      {open && (
        <ul className="glass animate-fade-in absolute left-0 top-full mt-2 w-56 rounded-xl p-1">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  requestCamera({ position: p.position, target: p.target });
                  if (p.workstationId) select({ kind: "workstation", id: p.workstationId });
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-1.5 text-left text-[11.5px] text-white/80 hover:bg-white/10 hover:text-white"
              >
                {p.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
