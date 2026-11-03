"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box as BoxIcon,
  Camera,
  Clapperboard,
  Eye,
  Footprints,
  Grid2x2,
  Home,
  LayoutGrid,
  Minus,
  Plus,
  Route,
  RotateCcw,
  RotateCw,
  ScanEye,
  Sparkles,
  Square,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { clockSec } from "@/lib/format";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp, type CameraMode } from "@/store/app";
import { sims } from "@/store/sims";
import { useTwin } from "./twinStore";

const MODES: Array<{ id: CameraMode; label: string; icon: LucideIcon; hint: string }> = [
  { id: "dollhouse", label: "Dollhouse", icon: Home, hint: "Cut-away overview of every room" },
  { id: "orbit", label: "Free", icon: Eye, hint: "Free camera — drag to orbit, right-drag to pan, scroll to zoom" },
  { id: "fps", label: "Walk", icon: Footprints, hint: "First-person walk-through (WASD, collision-aware)" },
  { id: "top", label: "Top", icon: Square, hint: "Top-down floor plan view" },
  { id: "tour", label: "Tour", icon: Clapperboard, hint: "Cinematic tour through every virtual camera" },
];

function ToolBtn({ active, onClick, icon: Icon, label, title }: { active?: boolean; onClick: () => void; icon: LucideIcon; label: string; title?: string }) {
  return (
    <button type="button" title={title ?? label} aria-pressed={active} onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${active ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}>
      <Icon size={14} />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

export function Toolbar() {
  const mode = useApp((s) => s.cameraMode);
  const setCameraMode = useApp((s) => s.setCameraMode);
  const xray = useApp((s) => s.xray);
  const showPaths = useApp((s) => s.showPaths);
  const toggle = useApp((s) => s.toggle);
  const cctvOpen = useApp((s) => s.cctvOpen);
  const setCctv = useApp((s) => s.setCctv);
  return (
    <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-xl p-1" role="toolbar" aria-label="Camera modes">
      {MODES.map((m) => (
        <ToolBtn key={m.id} active={mode === m.id && !cctvOpen} onClick={() => (setCctv(false), setCameraMode(m.id))} icon={m.icon} label={m.label} title={m.hint} />
      ))}
      <span className="mx-1 h-5 w-px bg-white/10" />
      <ToolBtn active={xray} onClick={() => toggle("xray")} icon={ScanEye} label="X-ray" title="Transparent walls" />
      <ToolBtn active={showPaths} onClick={() => toggle("showPaths")} icon={Route} label="Paths" title="Show customer, staff, delivery and exit paths" />
      <ToolBtn active={cctvOpen} onClick={() => setCctv(!cctvOpen)} icon={LayoutGrid} label="Camera grid" title="Monitor several virtual cameras at once" />
    </div>
  );
}

export function CameraList({ sim }: { sim: BranchSimulation }) {
  const activeId = useApp((s) => s.activeCameraId);
  const mode = useApp((s) => s.cameraMode);
  const goToCamera = useApp((s) => s.useVirtualCamera);
  const setCctv = useApp((s) => s.setCctv);
  const open = useTwin((s) => s.camListOpen);
  const toggleList = useTwin((s) => s.toggleCamList);
  const rooms = new Map(sim.plan.rooms.map((r) => [r.id, r.name]));
  return (
    <div className="glass pointer-events-auto w-56 overflow-hidden rounded-xl">
      <button type="button" onClick={toggleList} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-white/70 hover:text-white">
        <Video size={13} className="text-brand-red" /> Virtual cameras <span className="ml-auto font-mono text-white/40">{sim.plan.cameras.length}</span>
      </button>
      {open && (
        <ul className="scroll-thin max-h-[30vh] overflow-y-auto border-t border-white/5 py-1">
          {sim.plan.cameras.map((c) => {
            const active = mode === "cctv" && activeId === c.id;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => (setCctv(false), goToCamera(c.id))} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] ${active ? "bg-brand-red/20 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-red-500" : "bg-emerald-400/70"}`} />
                  <span className="font-mono text-[10px] text-white/45">{c.code}</span>
                  <span className="min-w-0 truncate">{c.name}</span>
                </button>
                {active && <div className="truncate px-3 pb-1 pl-9 text-[10px] text-white/40">{rooms.get(c.roomId)}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DemoMenu({ sim }: { sim: BranchSimulation }) {
  const open = useTwin((s) => s.demoOpen);
  const toggleDemo = useTwin((s) => s.toggleDemo);
  const { followOrder, notify, select, requestCamera, setArrivalPreset, setCctv } = useApp.getState();
  const newOrder = () => {
    const o = sim.placeOrder([{ menuId: "pz-chicken-l", qty: 1 }, { menuId: "rc-playman-jollof", qty: 1 }], "online", "delivery");
    setCctv(false);
    followOrder(o.id);
    notify(`Order #${o.number} received (simulated) — Chicken Pizza Large + PlayMan Jollof. Following it through the kitchen.`, "info");
    toggleDemo(false);
  };
  const fridgeFault = () => {
    const eq = sim.plan.equipment;
    const coldRooms = new Set(sim.plan.rooms.filter((r) => r.type === "cold").map((r) => r.id));
    const target = eq.find((e) => e.type === "walk-in-cold") ?? eq.find((e) => e.type === "fridge" && coldRooms.has(e.roomId)) ?? eq.find((e) => e.type === "fridge");
    if (!target) return;
    sim.injectFault(target.id, "compressor", 7);
    setCctv(false);
    select({ kind: "equipment", id: target.id });
    const H = sim.plan.dimensions.height;
    const front = { x: target.position[0] + Math.sin(target.rotation) * 3, z: target.position[2] + Math.cos(target.rotation) * 3 };
    requestCamera({ target: [target.position[0], 1.0, target.position[2]], position: [front.x, H + 2.6, front.z] });
    notify(`Simulated compressor fault on ${target.name} — temperature rising above the configured limit`, "critical");
    toggleDemo(false);
  };
  const rush = () => {
    setArrivalPreset("high");
    notify("Demand set to High (50 customers/hour, demo setting)", "warning");
    toggleDemo(false);
  };
  return (
    <div className="pointer-events-auto relative">
      <button type="button" onClick={() => toggleDemo()} className="glass flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-semibold text-white hover:bg-white/10">
        <Sparkles size={14} className="text-brand-yellow" /> Demo scenarios
      </button>
      {open && (
        <div className="glass animate-fade-in absolute bottom-full right-0 mb-2 w-80 rounded-xl p-1.5">
          <button type="button" onClick={newOrder} className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10">
            <div className="text-[12px] font-semibold text-white">New order #{(sim.orders.size ? Math.max(...[...sim.orders.values()].map((o) => o.number)) : 1000) + 1}</div>
            <div className="text-[11px] text-white/50">1 × Chicken Pizza (Large) + 1 × PlayMan Jollof · online delivery · camera follows it</div>
          </button>
          <button type="button" onClick={fridgeFault} className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10">
            <div className="text-[12px] font-semibold text-white">Simulate refrigerator fault</div>
            <div className="text-[11px] text-white/50">Compressor failure in cold storage → temperature alert, equipment highlighted</div>
          </button>
          <button type="button" onClick={rush} className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10">
            <div className="text-[12px] font-semibold text-white">Lunch rush</div>
            <div className="text-[11px] text-white/50">Raise simulated demand to 50 customers/hour</div>
          </button>
          <div className="px-3 pb-1 pt-1 text-[10px] text-amber-300/80">All scenarios are simulated demo events.</div>
        </div>
      )}
    </div>
  );
}

export function CctvLabel({ sim }: { sim: BranchSimulation }) {
  const activeId = useApp((s) => s.activeCameraId);
  const mode = useApp((s) => s.cameraMode);
  const goToCamera = useApp((s) => s.useVirtualCamera);
  useApp((s) => s.tick);
  const adjust = useTwin((s) => s.adjust);
  const reset = useTwin((s) => s.resetAdjust);
  if (mode !== "cctv" || !activeId) return null;
  const c = sim.plan.cameras.find((x) => x.id === activeId);
  if (!c) return null;
  const room = sim.plan.rooms.find((r) => r.id === c.roomId)?.name;
  return (
    <>
      {/* Surveillance-style frame */}
      <div className="pointer-events-none absolute inset-3 rounded-lg border border-white/10">
        {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((k) => (
          <span key={k} className={`absolute h-6 w-6 border-white/60 ${k}`} />
        ))}
      </div>
      <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 text-center">
        <div className="inline-flex items-center gap-2 rounded-md bg-black/70 px-3 py-1 font-mono text-[11px] text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {c.code} · {c.name} · {room}
        </div>
        <div className="mt-1 font-mono text-[10px] font-semibold tracking-wider text-amber-300">VIRTUAL CAMERA — SIMULATED VIEW, NOT CCTV</div>
      </div>
      <div className="pointer-events-none absolute bottom-6 left-6 font-mono text-[12px] text-white/80">{new Date(sims().clock).toISOString().slice(0, 10)} {clockSec(sims().clock)} GMT</div>
      <div className="glass pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-1 text-white">
        {(
          [
            [ZoomIn, () => adjust(c.id, { fov: -5 }), "Zoom in"],
            [ZoomOut, () => adjust(c.id, { fov: 5 }), "Zoom out"],
            [RotateCcw, () => adjust(c.id, { yaw: 6 }), "Rotate left"],
            [RotateCw, () => adjust(c.id, { yaw: -6 }), "Rotate right"],
            [ArrowUp, () => adjust(c.id, { pitch: 4 }), "Tilt up"],
            [ArrowDown, () => adjust(c.id, { pitch: -4 }), "Tilt down"],
          ] as Array<[LucideIcon, () => void, string]>
        ).map(([Icon, fn, label]) => (
          <button key={label} type="button" title={label} aria-label={label} onClick={fn} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
            <Icon size={14} />
          </button>
        ))}
        <button type="button" onClick={() => reset(c.id)} className="rounded-md px-2 py-1 text-[11px] text-white/60 hover:text-white">
          Reset
        </button>
        <button type="button" onClick={() => goToCamera(null)} className="rounded-md px-2 py-1 text-[11px] text-white/60 hover:text-white">
          <X size={13} className="inline" /> Exit
        </button>
      </div>
    </>
  );
}

const ZoomIn = Plus;
const ZoomOut = Minus;

export function FpsHud() {
  const mode = useApp((s) => s.cameraMode);
  const locked = useTwin((s) => s.fpsLocked);
  const setFps = useTwin((s) => s.setFps);
  if (mode !== "fps") return null;
  const hold = (k: "f" | "r" | "turn", v: number) => ({
    onPointerDown: () => setFps({ [k]: v }),
    onPointerUp: () => setFps({ [k]: 0 }),
    onPointerLeave: () => setFps({ [k]: 0 }),
  });
  return (
    <>
      {!locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/60 px-4 py-3 text-center text-[12px] text-white">
          <div className="font-semibold">Click the view to look around</div>
          <div className="text-white/60">W A S D / arrows to walk · Shift to run · Esc to release the mouse</div>
        </div>
      )}
      {locked && <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80" />}
      <div className="pointer-events-auto absolute bottom-5 left-5 grid grid-cols-3 gap-1" aria-label="Touch movement controls">
        <span />
        <button type="button" aria-label="Walk forward" className="glass rounded-lg p-2 text-white" {...hold("f", 1)}>
          <ArrowUp size={16} />
        </button>
        <span />
        <button type="button" aria-label="Turn left" className="glass rounded-lg p-2 text-white" {...hold("turn", -1)}>
          <RotateCcw size={16} />
        </button>
        <button type="button" aria-label="Walk back" className="glass rounded-lg p-2 text-white" {...hold("f", -1)}>
          <ArrowDown size={16} />
        </button>
        <button type="button" aria-label="Turn right" className="glass rounded-lg p-2 text-white" {...hold("turn", 1)}>
          <RotateCw size={16} />
        </button>
        <button type="button" aria-label="Step left" className="glass rounded-lg p-2 text-white" {...hold("r", -1)}>
          <ArrowLeft size={16} />
        </button>
        <span />
        <button type="button" aria-label="Step right" className="glass rounded-lg p-2 text-white" {...hold("r", 1)}>
          <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}

export function FollowBanner({ sim }: { sim: BranchSimulation }) {
  const id = useApp((s) => s.followOrderId);
  const mode = useApp((s) => s.cameraMode);
  const followOrder = useApp((s) => s.followOrder);
  const select = useApp((s) => s.select);
  useApp((s) => s.tick);
  if (mode !== "follow" || !id) return null;
  const o = sim.orders.get(id);
  if (!o) return null;
  const task = sim.tasksFor(id).find((t) => t.state === "working" || t.state === "machine") ?? sim.tasksFor(id)[0];
  return (
    <div className="glass pointer-events-auto absolute left-1/2 top-14 flex -translate-x-1/2 items-center gap-3 rounded-xl px-3 py-2 text-[12px] text-white">
      <Camera size={14} className="text-brand-red" />
      <button type="button" className="font-semibold hover:underline" onClick={() => select({ kind: "order", id })}>
        Following order #{o.number}
      </button>
      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">{o.status.replace(/_/g, " ")}</span>
      {task && <span className="max-w-64 truncate text-white/60">{task.label}</span>}
      <button type="button" onClick={() => followOrder(null)} className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Stop following">
        <X size={13} />
      </button>
    </div>
  );
}

export function IntroOverlay({ branchId }: { branchId: string }) {
  const phase = useApp((s) => s.phase);
  const setPhase = useApp((s) => s.setPhase);
  const setCameraMode = useApp((s) => s.setCameraMode);
  if (phase !== "exterior" && phase !== "entering") return null;
  const b = BRANCH_BY_ID.get(branchId);
  return (
    <>
      <div className="pointer-events-none absolute bottom-10 left-8 max-w-lg animate-fade-in">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brand-yellow">Pizzaman Chickenman · {b?.region}</div>
        <div className="mt-1 font-display text-4xl font-extrabold text-white drop-shadow-lg">{b?.name}</div>
        <div className="mt-2 text-[12px] text-white/70">
          Conceptual Model {sims().peek(branchId)?.plan.format} layout · generated from floor-plan data · simulated operations
        </div>
      </div>
      <button type="button" onClick={() => (setPhase("inside"), setCameraMode("dollhouse"))} className="glass pointer-events-auto absolute bottom-10 right-8 rounded-lg px-4 py-2 text-[12px] font-semibold text-white hover:bg-white/10">
        Skip intro →
      </button>
    </>
  );
}

export const ICONS = { BoxIcon, Grid2x2 };
