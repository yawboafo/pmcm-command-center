"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EQUIPMENT_CATALOG, FURNITURE_CATALOG, isElevated } from "@/lib/floorplan/catalog";
import { footprint } from "@/lib/floorplan/derive";
import type { NavGrid } from "@/lib/floorplan/nav";
import type { Door, FloorPlan, Vec2, Vec3 } from "@/lib/floorplan/types";
import { allIds, doorClearance, floorItems, isExteriorDoor, nearestWall, newEquipment, newFurniture, nextCode, round, snap, uid, type Issue, type SelItem } from "./model";
import { placeItem, startPositions } from "./ops";
import { useEditor } from "./store";

const ZONE_FILL: Record<string, string> = {
  public: "rgba(244, 239, 230, 0.10)",
  raw: "rgba(239, 68, 68, 0.20)",
  cooked: "rgba(250, 204, 21, 0.13)",
  storage: "rgba(56, 189, 248, 0.16)",
  support: "rgba(148, 163, 184, 0.12)",
};
const ZONE_STROKE: Record<string, string> = { public: "#d6d3d1", raw: "#f87171", cooked: "#facc15", storage: "#38bdf8", support: "#94a3b8" };
const CAT_FILL: Record<string, string> = {
  cooking: "#7f1d1d",
  preparation: "#475569",
  refrigeration: "#0c4a6e",
  storage: "#3f3f46",
  sanitation: "#134e4a",
  service: "#7c2d12",
  office: "#374151",
  ventilation: "#334155",
  waste: "#365314",
};
const DOOR_COLOR: Record<Door["kind"], string> = { entrance: "#EE1D25", emergency: "#22c55e", delivery: "#FFD400", staff: "#a3a3a3", internal: "#737373" };
const PATH_COLOR = { customer: "#f87171", staff: "#4ade80", delivery: "#facc15", emergency: "#22c55e" } as const;

type Drag =
  | { type: "pending"; startClient: Vec2; startView: ViewBox; onClick: () => void; panOnMove: boolean }
  | { type: "pan"; startClient: Vec2; startView: ViewBox }
  | { type: "move"; startWorld: Vec2; items: Array<{ s: SelItem; p: Vec2 }>; primary: SelItem; started: boolean; startClient: Vec2 }
  | { type: "room-edge"; roomId: string; edge: "l" | "r" | "b" | "t"; startWorld: Vec2; start: { x: number; z: number; w: number; d: number } }
  | { type: "cam-target"; camId: string };

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  plan: FloorPlan;
  issues: Issue[];
  grid: NavGrid | null;
  readOnly: boolean;
}

export default function PlanCanvas({ plan, issues, grid, readOnly }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const L = plan.dimensions.length;
  const W = plan.dimensions.width;
  const { selection, setSelection, toggleSelection, mode, setMode, layers, snapStep, mutate, checkpoint, fitNonce, focus } = useEditor();
  const [view, setView] = useState<ViewBox>({ x: -2, y: -2, w: W + 4, h: L + 4 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [guides, setGuides] = useState<{ x?: number; z?: number }>({});
  const [hoverWorld, setHoverWorld] = useState<Vec2 | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const pinch = useRef<{ dist: number; view: ViewBox } | null>(null);
  const spaceDown = useRef(false);

  const Y = (z: number) => L - z;

  // Fit to view
  const fitView = useCallback(() => {
    const pad = 2.2;
    const aspect = size.w / Math.max(1, size.h);
    let w = W + pad * 2;
    let h = L + pad * 2;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    setView({ x: W / 2 - w / 2, y: L / 2 - h / 2, w, h });
  }, [W, L, size.w, size.h]);

  // Fit on load, and again once the element has its real size unless the user already moved the view.
  const userMoved = useRef(false);
  useEffect(() => {
    userMoved.current = false;
    fitView();
  }, [fitNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!userMoved.current) fitView();
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep aspect ratio consistent with element size once the user has taken control of the view.
  useEffect(() => {
    if (!userMoved.current) return;
    setView((v) => {
      const aspect = size.w / Math.max(1, size.h);
      const h = v.w / aspect;
      return { ...v, y: v.y + (v.h - h) / 2, h };
    });
  }, [size.w, size.h]);

  useEffect(() => {
    if (!focus) return;
    setView((v) => ({ ...v, x: focus.x - v.w / 2, y: Y(focus.z) - v.h / 2 }));
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, L - p.y];
  };

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    userMoved.current = true;
    setView((v) => {
      const fx = cx ?? v.x + v.w / 2;
      const fy = cy ?? v.y + v.h / 2;
      const w = Math.min(200, Math.max(2, v.w * factor));
      const h = w * (v.h / v.w);
      return { x: fx - (fx - v.x) * (w / v.w), y: fy - (fy - v.y) * (h / v.h), w, h };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    zoomAt(Math.exp(e.deltaY * 0.0012), p.x, p.y);
  };

  const isSelected = (kind: SelItem["kind"], id: string) => selection.some((s) => s.kind === kind && s.id === id);
  const issueTargets = useMemo(() => new Map(issues.flatMap((i) => i.targets.map((t) => [`${t.kind}:${t.id}`, i.severity] as const))), [issues]);

  // ───────────── pointer handling ─────────────
  const capture = (e: React.PointerEvent) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), view };
      drag.current = null;
    }
  };

  const placeAt = (world: Vec2, equipmentUnder?: string) => {
    const [x, z] = [snap(world[0], snapStep), snap(world[1], snapStep)];
    switch (mode.kind) {
      case "place-equipment": {
        let id = "";
        mutate((p) => {
          const e = newEquipment(p, mode.type, x, z);
          id = e.id;
          p.equipment.push(e);
        });
        setSelection([{ kind: "equipment", id }]);
        return true;
      }
      case "place-furniture": {
        let id = "";
        mutate((p) => {
          const f = newFurniture(p, mode.type, x, z);
          id = f.id;
          p.furniture.push(f);
        });
        setSelection([{ kind: "furniture", id }]);
        return true;
      }
      case "add-door":
      case "add-window": {
        const w = nearestWall(plan, world);
        if (!w || w.dist > 0.6) return true;
        let id = "";
        const along = w.axis === "x" ? snap(world[0], snapStep) : snap(world[1], snapStep);
        mutate(
          (p) => {
            if (mode.kind === "add-door") {
              id = uid("door", allIds(p));
              p.doors.push({ id, name: "New door", x: w.axis === "x" ? along : w.x, z: w.axis === "x" ? w.z : along, width: 0.9, axis: w.axis, kind: "internal" });
            } else {
              id = uid("win", allIds(p));
              p.windows.push({ id, x: w.axis === "x" ? along : w.x, z: w.axis === "x" ? w.z : along, width: 1.2, axis: w.axis, sill: 0.9, height: 1.2 });
            }
          },
          { walls: true },
        );
        setSelection([{ kind: mode.kind === "add-door" ? "door" : "window", id }]);
        return true;
      }
      case "add-camera": {
        let id = "";
        mutate((p) => {
          id = uid("cam", allIds(p));
          const room = p.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) ?? p.rooms[0];
          const camH = Math.min(p.dimensions.height - 0.35, 2.85);
          p.cameras.push({ id, code: nextCode("CAM", p.cameras.map((c) => c.code)), name: `Camera — ${room.name}`, roomId: room.id, position: [x, camH, z], target: [round(room.x + room.w / 2), 0.8, round(room.z + room.d / 2)], fov: 62, workstationIds: [] });
        });
        setSelection([{ kind: "camera", id }]);
        return true;
      }
      case "add-sensor": {
        let id = "";
        mutate((p) => {
          id = uid("sensor", allIds(p));
          const e = equipmentUnder ? p.equipment.find((q) => q.id === equipmentUnder) : undefined;
          const room = p.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) ?? p.rooms[0];
          const kind = e ? (e.category === "refrigeration" ? (e.operational.setpointC ?? 0) < 0 ? "freezer-temp" : "fridge-temp" : e.type === "fryer" ? "oil-quality" : ["hot-holding", "rice-warmer", "qc-pass"].includes(e.type) ? "hot-holding-temp" : "equipment-health") : "cleaning-checklist";
          const profile = { "fridge-temp": "chilled", "freezer-temp": "frozen", "hot-holding-temp": "hotHolding", "oil-quality": "oilQuality" } as Record<string, string>;
          p.sensors.push({
            id,
            code: nextCode("SNS", p.sensors.map((s) => s.code)),
            name: e ? `${e.name} — sensor` : `${room.name} — checklist point`,
            kind,
            roomId: e?.roomId ?? room.id,
            equipmentId: e?.id,
            position: e ? [e.position[0], e.position[1] + e.size[1] + 0.15, e.position[2]] : [x, 1.5, z],
            unit: kind.endsWith("temp") ? "°C" : kind === "oil-quality" ? "%" : "status",
            thresholdProfile: profile[kind],
          });
        });
        setSelection([{ kind: "sensor", id }]);
        return true;
      }
      default:
        return false;
    }
  };

  const onItemDown = (e: React.PointerEvent, s: SelItem) => {
    if (e.button !== 0 || spaceDown.current) return;
    e.stopPropagation();
    capture(e);
    const world = toWorld(e.clientX, e.clientY);
    if (!readOnly && mode.kind !== "select") {
      placeAt(world, s.kind === "equipment" ? s.id : undefined);
      return;
    }
    let sel = selection;
    if (e.shiftKey) {
      toggleSelection(s);
      sel = selection.some((x) => x.id === s.id) ? selection.filter((x) => x.id !== s.id) : [...selection, s];
    } else if (!isSelected(s.kind, s.id)) {
      sel = [s];
      setSelection(sel);
    }
    if (readOnly || s.kind === "room") return;
    drag.current = { type: "move", startWorld: world, items: startPositions(plan, sel.length ? sel : [s]), primary: s, started: false, startClient: [e.clientX, e.clientY] };
  };

  const onRoomDown = (e: React.PointerEvent, roomId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    capture(e);
    const world = toWorld(e.clientX, e.clientY);
    if (!readOnly && mode.kind !== "select") {
      placeAt(world);
      return;
    }
    drag.current = { type: "pending", startClient: [e.clientX, e.clientY], startView: view, panOnMove: true, onClick: () => (e.shiftKey ? toggleSelection({ kind: "room", id: roomId }) : setSelection([{ kind: "room", id: roomId }])) };
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    capture(e);
    if (e.button === 1 || spaceDown.current) {
      drag.current = { type: "pan", startClient: [e.clientX, e.clientY], startView: view };
      return;
    }
    if (!readOnly && mode.kind !== "select") {
      placeAt(toWorld(e.clientX, e.clientY));
      return;
    }
    drag.current = { type: "pending", startClient: [e.clientX, e.clientY], startView: view, panOnMove: true, onClick: () => setSelection([]) };
  };

  const onEdgeDown = (e: React.PointerEvent, roomId: string, edge: "l" | "r" | "b" | "t") => {
    e.stopPropagation();
    capture(e);
    const r = plan.rooms.find((x) => x.id === roomId)!;
    checkpoint();
    drag.current = { type: "room-edge", roomId, edge, startWorld: toWorld(e.clientX, e.clientY), start: { x: r.x, z: r.z, w: r.w, d: r.d } };
  };

  const onTargetDown = (e: React.PointerEvent, camId: string) => {
    e.stopPropagation();
    capture(e);
    checkpoint();
    drag.current = { type: "cam-target", camId };
  };

  const alignmentSnap = (primary: SelItem, startP: Vec2, dx: number, dz: number, moving: Set<string>): { dx: number; dz: number; gx?: number; gz?: number } => {
    const obj = primary.kind === "equipment" ? plan.equipment.find((x) => x.id === primary.id) : primary.kind === "furniture" ? plan.furniture.find((x) => x.id === primary.id) : null;
    if (!obj) return { dx, dz };
    const { hw, hd } = footprint(obj.size, obj.rotation);
    const cx = startP[0] + dx;
    const cz = startP[1] + dz;
    const xs: number[] = [];
    const zs: number[] = [];
    for (const it of floorItems(plan)) {
      if (moving.has(it.id)) continue;
      xs.push(it.rect.x0, it.rect.x1, (it.rect.x0 + it.rect.x1) / 2);
      zs.push(it.rect.z0, it.rect.z1, (it.rect.z0 + it.rect.z1) / 2);
    }
    for (const r of plan.rooms) {
      xs.push(r.x, r.x + r.w);
      zs.push(r.z, r.z + r.d);
    }
    const thr = Math.max(0.06, (view.w / Math.max(1, size.w)) * 7);
    let bestX: { d: number; adj: number; line: number } | null = null;
    for (const edge of [cx - hw, cx, cx + hw])
      for (const l of xs) {
        const d = Math.abs(edge - l);
        if (d < thr && (!bestX || d < bestX.d)) bestX = { d, adj: l - edge, line: l };
      }
    let bestZ: { d: number; adj: number; line: number } | null = null;
    for (const edge of [cz - hd, cz, cz + hd])
      for (const l of zs) {
        const d = Math.abs(edge - l);
        if (d < thr && (!bestZ || d < bestZ.d)) bestZ = { d, adj: l - edge, line: l };
      }
    return { dx: dx + (bestX?.adj ?? 0), dz: dz + (bestZ?.adj ?? 0), gx: bestX?.line, gz: bestZ?.line };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const world = toWorld(e.clientX, e.clientY);
    setHoverWorld(world);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const v0 = pinch.current.view;
      const f = pinch.current.dist / Math.max(1, d);
      const w = Math.min(200, Math.max(2, v0.w * f));
      const h = w * (v0.h / v0.w);
      setView({ x: v0.x + (v0.w - w) / 2, y: v0.y + (v0.h - h) / 2, w, h });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const scale = view.w / Math.max(1, size.w);
    switch (d.type) {
      case "pending": {
        const moved = Math.hypot(e.clientX - d.startClient[0], e.clientY - d.startClient[1]);
        if (moved > 4 && d.panOnMove) drag.current = { type: "pan", startClient: d.startClient, startView: d.startView };
        break;
      }
      case "pan": {
        userMoved.current = true;
        const dx = (e.clientX - d.startClient[0]) * scale;
        const dy = (e.clientY - d.startClient[1]) * scale;
        setView({ ...d.startView, x: d.startView.x - dx, y: d.startView.y - dy });
        break;
      }
      case "move": {
        if (!d.started) {
          if (Math.hypot(e.clientX - d.startClient[0], e.clientY - d.startClient[1]) < 3) return;
          d.started = true;
          checkpoint();
        }
        const primary = d.items.find((i) => i.s.id === d.primary.id) ?? d.items[0];
        if (!primary) return;
        let dx = world[0] - d.startWorld[0];
        let dz = world[1] - d.startWorld[1];
        // Grid-snap the primary item's position, then apply alignment guides.
        dx = snap(primary.p[0] + dx, snapStep) - primary.p[0];
        dz = snap(primary.p[1] + dz, snapStep) - primary.p[1];
        let gx: number | undefined;
        let gz: number | undefined;
        if (!e.altKey) ({ dx, dz, gx, gz } = alignmentSnap(primary.s, primary.p, dx, dz, new Set(d.items.map((i) => i.s.id))));
        setGuides({ x: gx, z: gz });
        mutate((p) => d.items.forEach(({ s, p: start }) => placeItem(p, s, start, dx, dz)), { undo: false });
        break;
      }
      case "room-edge": {
        const dxw = snap(world[0] - d.startWorld[0], snapStep);
        const dzw = snap(world[1] - d.startWorld[1], snapStep);
        const s = d.start;
        mutate(
          (p) => {
            const r = p.rooms.find((x) => x.id === d.roomId);
            if (!r) return;
            if (d.edge === "l") {
              r.x = round(Math.min(s.x + s.w - 0.5, s.x + dxw));
              r.w = round(s.x + s.w - r.x);
            } else if (d.edge === "r") r.w = round(Math.max(0.5, s.w + dxw));
            else if (d.edge === "b") {
              r.z = round(Math.min(s.z + s.d - 0.5, s.z + dzw));
              r.d = round(s.z + s.d - r.z);
            } else r.d = round(Math.max(0.5, s.d + dzw));
          },
          { undo: false, walls: true },
        );
        break;
      }
      case "cam-target": {
        mutate(
          (p) => {
            const c = p.cameras.find((x) => x.id === d.camId);
            if (c) c.target = [snap(world[0], snapStep), c.target[1], snap(world[1], snapStep)];
          },
          { undo: false },
        );
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (d?.type === "pending") d.onClick();
    if (d?.type === "move" && d.started && d.items.some((i) => i.s.kind === "door" || i.s.kind === "window")) mutate(() => undefined, { undo: false, walls: true });
    drag.current = null;
    setGuides({});
  };

  // ───────────── render helpers ─────────────
  const px = view.w / Math.max(1, size.w); // metres per pixel
  const fs = (pxSize: number) => pxSize * px;
  const sel = (kind: SelItem["kind"], id: string) => isSelected(kind, id);
  const errStroke = (kind: SelItem["kind"], id: string) => {
    const s = issueTargets.get(`${kind}:${id}`);
    return layers.issues && s ? (s === "error" ? "#ef4444" : "#f59e0b") : null;
  };

  const doorEl = (d: Door) => {
    const ext = isExteriorDoor(plan, d);
    const cx = W / 2;
    const cz = L / 2;
    // Leaf swings into the building (or towards +axis for internal doors).
    const inward = d.axis === "x" ? (ext ? (d.z < cz ? 1 : -1) : 1) : ext ? (d.x < cx ? 1 : -1) : 1;
    const hx = d.axis === "x" ? d.x - d.width / 2 : d.x;
    const hz = d.axis === "x" ? d.z : d.z - d.width / 2;
    const leafEnd: Vec2 = d.axis === "x" ? [hx, hz + inward * d.width] : [hx + inward * d.width, hz];
    const closedEnd: Vec2 = d.axis === "x" ? [d.x + d.width / 2, d.z] : [d.x, d.z + d.width / 2];
    const sweep = d.axis === "x" ? (inward > 0 ? 0 : 1) : inward > 0 ? 1 : 0;
    const color = DOOR_COLOR[d.kind];
    const s = sel("door", d.id);
    return (
      <g key={d.id} onPointerDown={(e) => onItemDown(e, { kind: "door", id: d.id })} className="cursor-pointer">
        {(d.kind === "emergency" || d.kind === "entrance") && layers.paths && doorClearance(plan, d).map((c, i) => <rect key={i} x={c.x0} y={Y(c.z1)} width={c.x1 - c.x0} height={c.z1 - c.z0} fill={d.kind === "emergency" ? "rgba(34,197,94,0.10)" : "rgba(238,29,37,0.08)"} />)}
        <line x1={d.axis === "x" ? d.x - d.width / 2 : d.x} y1={Y(d.axis === "x" ? d.z : d.z - d.width / 2)} x2={closedEnd[0]} y2={Y(closedEnd[1])} stroke="#07090d" strokeWidth={0.3} />
        <line x1={hx} y1={Y(hz)} x2={leafEnd[0]} y2={Y(leafEnd[1])} stroke={color} strokeWidth={fs(2)} />
        <path d={`M ${leafEnd[0]} ${Y(leafEnd[1])} A ${d.width} ${d.width} 0 0 ${sweep} ${closedEnd[0]} ${Y(closedEnd[1])}`} fill="none" stroke={color} strokeWidth={fs(1)} strokeDasharray={`${fs(4)} ${fs(3)}`} opacity={0.8} />
        <line x1={d.axis === "x" ? d.x - d.width / 2 : d.x} y1={Y(d.axis === "x" ? d.z : d.z - d.width / 2)} x2={closedEnd[0]} y2={Y(closedEnd[1])} stroke={s ? "#fff" : "transparent"} strokeWidth={fs(10)} opacity={s ? 0.35 : 1} />
        {d.kind === "emergency" && <text x={d.x + (d.axis === "z" ? (d.x < cx ? -0.3 : 0.3) : 0)} y={Y(d.z + (d.axis === "x" ? (d.z < cz ? -0.35 : 0.35) : 0))} fontSize={fs(10)} fill="#22c55e" textAnchor="middle" fontWeight={700}>EXIT</text>}
      </g>
    );
  };

  const cams = layers.cameras ? plan.cameras : [];
  const singleRoom = selection.length === 1 && selection[0].kind === "room" ? plan.rooms.find((r) => r.id === selection[0].id) : undefined;

  // Scale bar: pick a nice length ≈ 100 px.
  const metersFor100 = 100 * px;
  const nice = [0.5, 1, 2, 5, 10, 20, 50].find((n) => n >= metersFor100 * 0.6) ?? 50;

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none overflow-hidden bg-[#0b0e14]" style={{ touchAction: "none" }}>
      <svg
        ref={svgRef}
        className={mode.kind === "select" ? "h-full w-full" : "h-full w-full cursor-crosshair"}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverWorld(null)}
        role="application"
        aria-label={`Floor plan of ${plan.name}`}
      >
        <defs>
          <pattern id="fp-grid" width={1} height={1} patternUnits="userSpaceOnUse" x={0} y={Y(Math.floor(L))}>
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={fs(1)} />
          </pattern>
          <pattern id="fp-hatch" width={0.25} height={0.25} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.25} stroke="rgba(255,255,255,0.25)" strokeWidth={0.04} />
          </pattern>
        </defs>
        <rect x={view.x - 50} y={view.y - 50} width={view.w + 100} height={view.h + 100} fill="url(#fp-grid)" onPointerDown={onBackgroundDown} />
        {/* street */}
        <rect x={-6} y={Y(-0.3)} width={W + 12} height={3.2} fill="rgba(255,255,255,0.025)" pointerEvents="none" />
        <text x={W / 2} y={Y(-2.6)} fontSize={fs(11)} fill="rgba(255,255,255,0.3)" textAnchor="middle" pointerEvents="none" letterSpacing={fs(3)}>STREET FRONTAGE</text>

        {/* rooms */}
        {plan.rooms.map((r) => {
          const s = sel("room", r.id);
          const err = errStroke("room", r.id);
          return (
            <g key={r.id} onPointerDown={(e) => onRoomDown(e, r.id)}>
              <rect x={r.x} y={Y(r.z + r.d)} width={r.w} height={r.d} fill={layers.zones ? ZONE_FILL[r.hygieneZone] : "rgba(255,255,255,0.03)"} stroke={s ? "#fff" : err ?? (layers.zones ? ZONE_STROKE[r.hygieneZone] : "transparent")} strokeOpacity={s || err ? 0.9 : 0.25} strokeWidth={fs(s ? 2 : 1)} strokeDasharray={s ? undefined : `${fs(3)} ${fs(3)}`} />
            </g>
          );
        })}

        {/* nav grid occupancy */}
        {layers.navgrid && grid && <NavGridLayer grid={grid} L={L} view={view} />}

        {/* walls */}
        {plan.walls.map((w) => {
          const low = (w.base ?? 0) > 0 || w.height < 1.5;
          return <line key={w.id} x1={w.a[0]} y1={Y(w.a[1])} x2={w.b[0]} y2={Y(w.b[1])} stroke={low ? "#60a5fa" : "#e5e7eb"} strokeWidth={low ? w.thickness * 0.45 : w.thickness} strokeLinecap="square" pointerEvents="none" opacity={low ? 0.8 : 0.92} />;
        })}
        {plan.windows.map((w) => {
          const [x1, z1, x2, z2] = w.axis === "x" ? [w.x - w.width / 2, w.z, w.x + w.width / 2, w.z] : [w.x, w.z - w.width / 2, w.x, w.z + w.width / 2];
          const s = sel("window", w.id);
          return (
            <g key={w.id} onPointerDown={(e) => onItemDown(e, { kind: "window", id: w.id })} className="cursor-pointer">
              <line x1={x1} y1={Y(z1)} x2={x2} y2={Y(z2)} stroke="#93c5fd" strokeWidth={0.1} />
              <line x1={x1} y1={Y(z1)} x2={x2} y2={Y(z2)} stroke={s ? "rgba(255,255,255,0.4)" : "transparent"} strokeWidth={fs(10)} />
            </g>
          );
        })}
        {plan.doors.map(doorEl)}

        {/* furniture */}
        {layers.furniture &&
          plan.furniture.map((f) => {
            const { hw, hd } = footprint(f.size, f.rotation);
            const s = sel("furniture", f.id);
            const err = errStroke("furniture", f.id);
            const round_ = f.type === "plant";
            return (
              <g key={f.id} onPointerDown={(e) => onItemDown(e, { kind: "furniture", id: f.id })} className={readOnly ? "cursor-pointer" : "cursor-move"}>
                {round_ ? <circle cx={f.position[0]} cy={Y(f.position[2])} r={hw} fill="#365314" stroke={s ? "#fff" : err ?? "#65a30d"} strokeWidth={fs(s ? 2 : 1)} /> : <rect x={f.position[0] - hw} y={Y(f.position[2] + hd)} width={hw * 2} height={hd * 2} rx={0.08} fill={f.type.startsWith("table") || f.type === "booth-4" ? "rgba(238,29,37,0.35)" : "rgba(255,212,0,0.28)"} stroke={s ? "#fff" : err ?? "rgba(255,255,255,0.35)"} strokeWidth={fs(s ? 2 : 1)} />}
                {f.seats > 0 && hw * 2 > fs(30) && <text x={f.position[0]} y={Y(f.position[2]) + fs(3.5)} fontSize={fs(9)} fill="rgba(255,255,255,0.75)" textAnchor="middle" pointerEvents="none">{f.seats}</text>}
              </g>
            );
          })}

        {/* equipment */}
        {layers.equipment &&
          [...plan.equipment].sort((a, b) => Number(isElevated(a.type)) - Number(isElevated(b.type))).map((e) => {
            const { hw, hd } = footprint(e.size, e.rotation);
            const elevated = isElevated(e.type);
            const s = sel("equipment", e.id);
            const err = errStroke("equipment", e.id);
            const fx = e.position[0] + Math.sin(e.rotation) * (e.size[2] / 2);
            const fz = e.position[2] + Math.cos(e.rotation) * (e.size[2] / 2);
            const label = EQUIPMENT_CATALOG[e.type].label.split(" ").slice(-1)[0];
            const maxChars = Math.floor((hw * 2) / fs(5.6));
            return (
              <g key={e.id} onPointerDown={(ev) => onItemDown(ev, { kind: "equipment", id: e.id })} className={readOnly ? "cursor-pointer" : "cursor-move"}>
                <title>{`${e.name} (${EQUIPMENT_CATALOG[e.type].label})`}</title>
                <rect x={e.position[0] - hw} y={Y(e.position[2] + hd)} width={hw * 2} height={hd * 2} fill={elevated ? "rgba(148,163,184,0.06)" : CAT_FILL[e.category]} fillOpacity={elevated ? 1 : 0.85} stroke={s ? "#fff" : err ?? (elevated ? "rgba(148,163,184,0.6)" : "rgba(255,255,255,0.45)")} strokeWidth={fs(s ? 2.2 : err ? 2 : 1)} strokeDasharray={elevated ? `${fs(4)} ${fs(3)}` : undefined} pointerEvents={elevated && !s ? "stroke" : undefined} />
                {!elevated && <circle cx={fx} cy={Y(fz)} r={fs(2.6)} fill="#EE1D25" pointerEvents="none" />}
                {!elevated && maxChars >= 3 && hd * 2 > fs(10) && (
                  <text x={e.position[0]} y={Y(e.position[2]) + fs(3)} fontSize={fs(8.5)} fill="rgba(255,255,255,0.85)" textAnchor="middle" pointerEvents="none">
                    {label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label}
                  </text>
                )}
              </g>
            );
          })}

        {/* paths and workstations */}
        {layers.paths && (
          <g pointerEvents="none">
            {plan.navigationPaths.map((p) => (
              <polyline key={p.id} points={p.points.map(([x, z]) => `${x},${Y(z)}`).join(" ")} fill="none" stroke={PATH_COLOR[p.kind]} strokeWidth={fs(1.6)} strokeDasharray={`${fs(6)} ${fs(4)}`} opacity={p.kind === "emergency" ? 0.9 : 0.6} markerEnd="" />
            ))}
            {plan.workstations.map((w) => (
              <g key={w.id}>
                <circle cx={w.standPoint[0]} cy={Y(w.standPoint[1])} r={fs(4)} fill="#5AB350" stroke="#07090d" strokeWidth={fs(1)} />
              </g>
            ))}
          </g>
        )}

        {/* sensors */}
        {layers.sensors &&
          plan.sensors.map((s) => {
            const st = sel("sensor", s.id);
            const r = fs(st ? 6 : 4.5);
            const x = s.position[0];
            const y = Y(s.position[2]);
            return (
              <g key={s.id} onPointerDown={(e) => onItemDown(e, { kind: "sensor", id: s.id })} className="cursor-move">
                <title>{`${s.code} ${s.name}`}</title>
                <path d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`} fill={s.kind.endsWith("temp") ? "#38bdf8" : s.kind === "cleaning-checklist" ? "#a3e635" : "#fbbf24"} stroke={st ? "#fff" : "#07090d"} strokeWidth={fs(1)} />
              </g>
            );
          })}

        {/* cameras with view cones */}
        {cams.map((c) => {
          const dx = c.target[0] - c.position[0];
          const dz = c.target[2] - c.position[2];
          const len = Math.hypot(dx, dz) || 1;
          const ang = Math.atan2(dz, dx);
          const half = ((c.fov / 2) * Math.PI) / 180;
          const reach = Math.min(4.5, Math.max(2, len * 1.1));
          const p1: Vec2 = [c.position[0] + Math.cos(ang - half) * reach, c.position[2] + Math.sin(ang - half) * reach];
          const p2: Vec2 = [c.position[0] + Math.cos(ang + half) * reach, c.position[2] + Math.sin(ang + half) * reach];
          const s = sel("camera", c.id);
          return (
            <g key={c.id}>
              <path d={`M ${c.position[0]} ${Y(c.position[2])} L ${p1[0]} ${Y(p1[1])} L ${p2[0]} ${Y(p2[1])} Z`} fill={s ? "rgba(168,85,247,0.22)" : "rgba(168,85,247,0.09)"} stroke="rgba(168,85,247,0.5)" strokeWidth={fs(0.8)} pointerEvents="none" />
              <g onPointerDown={(e) => onItemDown(e, { kind: "camera", id: c.id })} className="cursor-move">
                <title>{`${c.code} ${c.name}`}</title>
                <rect x={c.position[0] - fs(5)} y={Y(c.position[2]) - fs(5)} width={fs(10)} height={fs(10)} rx={fs(2)} fill="#a855f7" stroke={s ? "#fff" : "#07090d"} strokeWidth={fs(1.2)} />
              </g>
              {(s || px < 0.02) && <text x={c.position[0]} y={Y(c.position[2]) - fs(8)} fontSize={fs(8)} fill="#d8b4fe" textAnchor="middle" pointerEvents="none">{c.code}</text>}
              {s && !readOnly && (
                <g onPointerDown={(e) => onTargetDown(e, c.id)} className="cursor-crosshair">
                  <line x1={c.position[0]} y1={Y(c.position[2])} x2={c.target[0]} y2={Y(c.target[2])} stroke="#d8b4fe" strokeWidth={fs(1)} strokeDasharray={`${fs(3)} ${fs(3)}`} pointerEvents="none" />
                  <circle cx={c.target[0]} cy={Y(c.target[2])} r={fs(6)} fill="#07090d" stroke="#d8b4fe" strokeWidth={fs(1.5)} />
                  <circle cx={c.target[0]} cy={Y(c.target[2])} r={fs(2)} fill="#d8b4fe" />
                </g>
              )}
            </g>
          );
        })}

        {/* room labels */}
        <g pointerEvents="none">
          {plan.rooms.map((r) => (
            <g key={r.id}>
              <text x={r.x + r.w / 2} y={Y(r.z + r.d) + Math.min(0.45, r.d * 0.25)} fontSize={Math.min(fs(10.5), r.w / Math.max(6, r.name.length) * 1.5)} fill="rgba(255,255,255,0.75)" fontWeight={600} textAnchor="middle">
                {r.name}
              </text>
              <text x={r.x + r.w / 2} y={Y(r.z + r.d) + Math.min(0.45, r.d * 0.25) + fs(11)} fontSize={fs(8.5)} fill="rgba(255,255,255,0.4)" textAnchor="middle">
                {(r.w * r.d).toFixed(1)} m²
              </text>
            </g>
          ))}
        </g>

        {/* dimensions */}
        {layers.dimensions && (
          <g pointerEvents="none" fill="rgba(255,255,255,0.6)" stroke="rgba(255,255,255,0.45)">
            <DimLine a={[0, -1.1]} b={[W, -1.1]} L={L} label={`${W.toFixed(2)} m`} fs={fs} />
            <DimLine a={[-1.1, 0]} b={[-1.1, L]} L={L} label={`${L.toFixed(2)} m`} fs={fs} vertical />
            {singleRoom && (
              <>
                <DimLine a={[singleRoom.x, singleRoom.z + singleRoom.d + 0.35]} b={[singleRoom.x + singleRoom.w, singleRoom.z + singleRoom.d + 0.35]} L={L} label={`${singleRoom.w.toFixed(2)} m`} fs={fs} accent />
                <DimLine a={[singleRoom.x + singleRoom.w + 0.35, singleRoom.z]} b={[singleRoom.x + singleRoom.w + 0.35, singleRoom.z + singleRoom.d]} L={L} label={`${singleRoom.d.toFixed(2)} m`} fs={fs} vertical accent />
              </>
            )}
          </g>
        )}

        {/* selected room edge handles */}
        {singleRoom && !readOnly && (
          <g>
            {(
              [
                ["l", singleRoom.x, singleRoom.z + singleRoom.d / 2, "ew-resize"],
                ["r", singleRoom.x + singleRoom.w, singleRoom.z + singleRoom.d / 2, "ew-resize"],
                ["b", singleRoom.x + singleRoom.w / 2, singleRoom.z, "ns-resize"],
                ["t", singleRoom.x + singleRoom.w / 2, singleRoom.z + singleRoom.d, "ns-resize"],
              ] as const
            ).map(([edge, x, z, cursor]) => (
              <rect key={edge} x={x - fs(6)} y={Y(z) - fs(6)} width={fs(12)} height={fs(12)} rx={fs(2)} fill="#fff" stroke="#EE1D25" strokeWidth={fs(2)} style={{ cursor }} onPointerDown={(e) => onEdgeDown(e, singleRoom.id, edge)} />
            ))}
          </g>
        )}

        {/* issue markers */}
        {layers.issues &&
          issues
            .filter((i) => i.at)
            .map((i) => (
              <g key={i.id} pointerEvents="none">
                <circle cx={i.at![0]} cy={Y(i.at![1])} r={fs(9)} fill="none" stroke={i.severity === "error" ? "#ef4444" : "#f59e0b"} strokeWidth={fs(2)} />
                <text x={i.at![0]} y={Y(i.at![1]) + fs(4)} fontSize={fs(11)} fontWeight={800} fill={i.severity === "error" ? "#ef4444" : "#f59e0b"} textAnchor="middle">!</text>
              </g>
            ))}

        {/* alignment guides */}
        {guides.x !== undefined && <line x1={guides.x} y1={view.y - 10} x2={guides.x} y2={view.y + view.h + 10} stroke="#22d3ee" strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(4)}`} pointerEvents="none" />}
        {guides.z !== undefined && <line x1={view.x - 10} y1={Y(guides.z)} x2={view.x + view.w + 10} y2={Y(guides.z)} stroke="#22d3ee" strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(4)}`} pointerEvents="none" />}

        {/* placement ghost */}
        {hoverWorld && mode.kind === "place-equipment" && <Ghost size={EQUIPMENT_CATALOG[mode.type].size} at={[snap(hoverWorld[0], snapStep), snap(hoverWorld[1], snapStep)]} L={L} />}
        {hoverWorld && mode.kind === "place-furniture" && <Ghost size={FURNITURE_CATALOG[mode.type].size} at={[snap(hoverWorld[0], snapStep), snap(hoverWorld[1], snapStep)]} L={L} />}
      </svg>

      {/* HUD overlays */}
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-sky-400/25 bg-sky-400/10 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-sky-200">◇ CONCEPTUAL — not an official branch plan</div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-4">
        <div className="flex flex-col items-center text-white/70">
          <svg width="22" height="30" viewBox="0 0 22 30" aria-hidden>
            <path d="M11 2 L18 22 L11 17 L4 22 Z" fill="#EE1D25" stroke="#fff" strokeWidth="1" />
          </svg>
          <span className="font-mono text-[10px]">N</span>
        </div>
        <div>
          <div className="h-1.5 border-x border-b border-white/70" style={{ width: nice / px }} />
          <div className="mt-0.5 font-mono text-[10px] text-white/70">{nice} m</div>
        </div>
        {hoverWorld && <div className="font-mono text-[10px] text-white/45">x {hoverWorld[0].toFixed(2)} · z {hoverWorld[1].toFixed(2)}</div>}
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        {[
          [<Plus key="p" size={14} />, "Zoom in", () => zoomAt(0.8)],
          [<Minus key="m" size={14} />, "Zoom out", () => zoomAt(1.25)],
          [<Maximize2 key="f" size={14} />, "Fit to view", fitView],
        ].map(([icon, label, fn]) => (
          <button key={label as string} type="button" title={label as string} aria-label={label as string} onClick={fn as () => void} className="glass rounded-md p-1.5 text-white/70 hover:text-white">
            {icon as React.ReactNode}
          </button>
        ))}
      </div>
      {mode.kind !== "select" && (
        <div className="glass absolute left-1/2 top-3 -translate-x-1/2 rounded-lg px-3 py-1.5 text-xs text-white">
          {mode.kind === "add-door" ? "Click a wall to add a door" : mode.kind === "add-window" ? "Click a wall to add a window" : mode.kind === "add-camera" ? "Click to place a virtual camera" : mode.kind === "add-sensor" ? "Click equipment to attach a sensor (or empty floor for a checklist point)" : `Click to place ${mode.kind === "place-equipment" ? EQUIPMENT_CATALOG[mode.type].label : FURNITURE_CATALOG[mode.type].label}`}
          <button type="button" className="ml-3 text-white/60 underline hover:text-white" onClick={() => setMode({ kind: "select" })}>
            Done (Esc)
          </button>
        </div>
      )}
    </div>
  );
}

function Ghost({ size, at, L }: { size: Vec3; at: Vec2; L: number }) {
  return <rect x={at[0] - size[0] / 2} y={L - at[1] - size[2] / 2} width={size[0]} height={size[2]} fill="rgba(238,29,37,0.25)" stroke="#EE1D25" strokeWidth={0.03} strokeDasharray="0.1 0.06" pointerEvents="none" />;
}

function DimLine({ a, b, L, label, fs, vertical, accent }: { a: Vec2; b: Vec2; L: number; label: string; fs: (n: number) => number; vertical?: boolean; accent?: boolean }) {
  const y1 = L - a[1];
  const y2 = L - b[1];
  const t = fs(5);
  const stroke = accent ? "#f87171" : "rgba(255,255,255,0.45)";
  return (
    <g stroke={stroke} fill={accent ? "#fca5a5" : "rgba(255,255,255,0.65)"}>
      <line x1={a[0]} y1={y1} x2={b[0]} y2={y2} strokeWidth={fs(1)} />
      {vertical ? (
        <>
          <line x1={a[0] - t} y1={y1} x2={a[0] + t} y2={y1} strokeWidth={fs(1)} />
          <line x1={b[0] - t} y1={y2} x2={b[0] + t} y2={y2} strokeWidth={fs(1)} />
          <text x={a[0] - fs(4)} y={(y1 + y2) / 2} fontSize={fs(9.5)} textAnchor="middle" stroke="none" transform={`rotate(-90 ${a[0] - fs(4)} ${(y1 + y2) / 2})`}>
            {label}
          </text>
        </>
      ) : (
        <>
          <line x1={a[0]} y1={y1 - t} x2={a[0]} y2={y1 + t} strokeWidth={fs(1)} />
          <line x1={b[0]} y1={y2 - t} x2={b[0]} y2={y2 + t} strokeWidth={fs(1)} />
          <text x={(a[0] + b[0]) / 2} y={y1 - fs(4)} fontSize={fs(9.5)} textAnchor="middle" stroke="none">
            {label}
          </text>
        </>
      )}
    </g>
  );
}

function NavGridLayer({ grid, L, view }: { grid: NavGrid; L: number; view: ViewBox }) {
  const cells = useMemo(() => {
    const out: string[] = [];
    for (let r = 0; r < grid.rows; r++) {
      let runStart = -1;
      for (let c = 0; c <= grid.cols; c++) {
        const b = c < grid.cols && grid.blocked[r * grid.cols + c] === 1;
        if (b && runStart < 0) runStart = c;
        if (!b && runStart >= 0) {
          const x = grid.ox + runStart * grid.cell;
          const z = grid.oz + r * grid.cell;
          out.push(`M${x} ${L - z - grid.cell}h${(c - runStart) * grid.cell}v${grid.cell}h${-(c - runStart) * grid.cell}z`);
          runStart = -1;
        }
      }
    }
    return out.join("");
  }, [grid, L]);
  void view;
  return <path d={cells} fill="rgba(239,68,68,0.16)" pointerEvents="none" />;
}
