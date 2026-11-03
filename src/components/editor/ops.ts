import { roomAt } from "../../lib/floorplan/derive";
import type { FloorPlan, Vec2, Vec3 } from "../../lib/floorplan/types";
import { allIds, round, uid, type SelItem } from "./model";

/** Current reference position (x, z) of a selectable item. */
export function itemPos(plan: FloorPlan, s: SelItem): Vec2 | null {
  switch (s.kind) {
    case "equipment": {
      const e = plan.equipment.find((x) => x.id === s.id);
      return e ? [e.position[0], e.position[2]] : null;
    }
    case "furniture": {
      const f = plan.furniture.find((x) => x.id === s.id);
      return f ? [f.position[0], f.position[2]] : null;
    }
    case "camera": {
      const c = plan.cameras.find((x) => x.id === s.id);
      return c ? [c.position[0], c.position[2]] : null;
    }
    case "sensor": {
      const c = plan.sensors.find((x) => x.id === s.id);
      return c ? [c.position[0], c.position[2]] : null;
    }
    case "door": {
      const d = plan.doors.find((x) => x.id === s.id);
      return d ? [d.x, d.z] : null;
    }
    case "window": {
      const w = plan.windows.find((x) => x.id === s.id);
      return w ? [w.x, w.z] : null;
    }
    case "room": {
      const r = plan.rooms.find((x) => x.id === s.id);
      return r ? [r.x + r.w / 2, r.z + r.d / 2] : null;
    }
  }
}

/**
 * Set an item's position to `start + delta` (start captured at drag begin).
 * Doors and windows slide only along their wall; rooms are not moved by drag.
 */
export function placeItem(plan: FloorPlan, s: SelItem, start: Vec3 | Vec2, dx: number, dz: number) {
  const sx = start[0];
  const sz = start.length === 3 ? start[2] : start[1];
  const nx = round(sx + dx);
  const nz = round(sz + dz);
  switch (s.kind) {
    case "equipment": {
      const e = plan.equipment.find((x) => x.id === s.id);
      if (!e) return;
      e.position = [nx, e.position[1], nz];
      const r = roomAt(plan.rooms, nx, nz);
      if (r) e.roomId = r.id;
      break;
    }
    case "furniture": {
      const f = plan.furniture.find((x) => x.id === s.id);
      if (!f) return;
      f.position = [nx, 0, nz];
      const r = roomAt(plan.rooms, nx, nz);
      if (r) f.roomId = r.id;
      break;
    }
    case "camera": {
      const c = plan.cameras.find((x) => x.id === s.id);
      if (!c) return;
      const ox = c.target[0] - c.position[0];
      const oz = c.target[2] - c.position[2];
      c.position = [nx, c.position[1], nz];
      c.target = [round(nx + ox), c.target[1], round(nz + oz)];
      const r = roomAt(plan.rooms, nx, nz);
      if (r) c.roomId = r.id;
      break;
    }
    case "sensor": {
      const c = plan.sensors.find((x) => x.id === s.id);
      if (!c) return;
      c.position = [nx, c.position[1], nz];
      const r = roomAt(plan.rooms, nx, nz);
      if (r) c.roomId = r.id;
      break;
    }
    case "door": {
      const d = plan.doors.find((x) => x.id === s.id);
      if (!d) return;
      if (d.axis === "x") d.x = nx;
      else d.z = nz;
      break;
    }
    case "window": {
      const w = plan.windows.find((x) => x.id === s.id);
      if (!w) return;
      if (w.axis === "x") w.x = nx;
      else w.z = nz;
      break;
    }
    case "room":
      break;
  }
}

/** Snapshot of start positions for every selected item (used for drags and nudges). */
export function startPositions(plan: FloorPlan, sel: SelItem[]): Array<{ s: SelItem; p: Vec2 }> {
  return sel.map((s) => ({ s, p: itemPos(plan, s) })).filter((x): x is { s: SelItem; p: Vec2 } => !!x.p);
}

export function nudge(plan: FloorPlan, sel: SelItem[], dx: number, dz: number) {
  for (const { s, p } of startPositions(plan, sel)) placeItem(plan, s, p, dx, dz);
}

export function rotate(plan: FloorPlan, sel: SelItem[], delta = Math.PI / 2) {
  const norm = (r: number) => {
    let v = Math.round(((r + delta) / (Math.PI / 2)) % 4);
    if (v > 2) v -= 4;
    if (v <= -2) v += 4;
    return (v * Math.PI) / 2;
  };
  for (const s of sel) {
    if (s.kind === "equipment") {
      const e = plan.equipment.find((x) => x.id === s.id);
      if (e) e.rotation = norm(e.rotation);
    } else if (s.kind === "furniture") {
      const f = plan.furniture.find((x) => x.id === s.id);
      if (f) f.rotation = norm(f.rotation);
    } else if (s.kind === "camera") {
      // Rotate the camera's look direction by 90° around its position.
      const c = plan.cameras.find((x) => x.id === s.id);
      if (c) {
        const ox = c.target[0] - c.position[0];
        const oz = c.target[2] - c.position[2];
        c.target = [round(c.position[0] + oz), c.target[1], round(c.position[2] - ox)];
      }
    }
  }
}

export function remove(plan: FloorPlan, sel: SelItem[]) {
  const ids = (k: SelItem["kind"]) => new Set(sel.filter((s) => s.kind === k).map((s) => s.id));
  const eq = ids("equipment");
  plan.equipment = plan.equipment.filter((e) => !eq.has(e.id));
  for (const w of plan.workstations) w.equipmentIds = w.equipmentIds.filter((id) => !eq.has(id));
  plan.workstations = plan.workstations.filter((w) => w.equipmentIds.length > 0);
  plan.sensors = plan.sensors.filter((s) => !s.equipmentId || !eq.has(s.equipmentId));
  const fu = ids("furniture");
  plan.furniture = plan.furniture.filter((f) => !fu.has(f.id));
  const ca = ids("camera");
  plan.cameras = plan.cameras.filter((c) => !ca.has(c.id));
  const se = ids("sensor");
  plan.sensors = plan.sensors.filter((s) => !se.has(s.id));
  const dr = ids("door");
  plan.doors = plan.doors.filter((d) => !dr.has(d.id));
  const wi = ids("window");
  plan.windows = plan.windows.filter((w) => !wi.has(w.id));
  const ro = ids("room");
  if (ro.size && ro.size < plan.rooms.length) {
    plan.rooms = plan.rooms.filter((r) => !ro.has(r.id));
    plan.openings = plan.openings.filter(([a, b]) => !ro.has(a) && !ro.has(b));
  }
}

/** Duplicate equipment/furniture/cameras/sensors offset by 0.5 m; returns the new selection. */
export function duplicate(plan: FloorPlan, sel: SelItem[]): SelItem[] {
  const out: SelItem[] = [];
  for (const s of sel) {
    const taken = allIds(plan);
    if (s.kind === "equipment") {
      const e = plan.equipment.find((x) => x.id === s.id);
      if (!e) continue;
      const copy = structuredClone(e);
      copy.id = uid(e.type, taken);
      copy.name = `${e.name} (copy)`;
      delete copy.workstationId;
      copy.position = [round(e.position[0] + 0.5), e.position[1], round(e.position[2] + 0.5)];
      plan.equipment.push(copy);
      out.push({ kind: "equipment", id: copy.id });
    } else if (s.kind === "furniture") {
      const f = plan.furniture.find((x) => x.id === s.id);
      if (!f) continue;
      const copy = structuredClone(f);
      copy.id = uid(f.type, taken);
      copy.position = [round(f.position[0] + 0.5), 0, round(f.position[2] + 0.5)];
      plan.furniture.push(copy);
      out.push({ kind: "furniture", id: copy.id });
    } else if (s.kind === "camera") {
      const c = plan.cameras.find((x) => x.id === s.id);
      if (!c) continue;
      const copy = structuredClone(c);
      copy.id = uid("cam", taken);
      const max = plan.cameras.reduce((m, x) => Math.max(m, Number(x.code.split("-")[1]) || 0), 0);
      copy.code = `CAM-${String(max + 1).padStart(3, "0")}`;
      copy.name = `${c.name} (copy)`;
      copy.position = [round(c.position[0] + 0.5), c.position[1], round(c.position[2] + 0.5)];
      copy.target = [round(c.target[0] + 0.5), c.target[1], round(c.target[2] + 0.5)];
      plan.cameras.push(copy);
      out.push({ kind: "camera", id: copy.id });
    }
  }
  return out;
}

export function displayName(plan: FloorPlan, s: SelItem): string {
  switch (s.kind) {
    case "equipment":
      return plan.equipment.find((x) => x.id === s.id)?.name ?? s.id;
    case "furniture":
      return plan.furniture.find((x) => x.id === s.id)?.type ?? s.id;
    case "camera": {
      const c = plan.cameras.find((x) => x.id === s.id);
      return c ? `${c.code} ${c.name}` : s.id;
    }
    case "sensor": {
      const c = plan.sensors.find((x) => x.id === s.id);
      return c ? `${c.code} ${c.name}` : s.id;
    }
    case "room":
      return plan.rooms.find((x) => x.id === s.id)?.name ?? s.id;
    case "door":
      return plan.doors.find((x) => x.id === s.id)?.name ?? s.id;
    case "window":
      return `Window ${s.id}`;
  }
}
