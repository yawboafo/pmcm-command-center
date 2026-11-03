"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import LiveCameraPlayer from "@/components/integration/LiveCameraPlayer";
import type { FloorPlan, VirtualCamera } from "@/lib/floorplan/types";
import { clockSec } from "@/lib/format";
import { useIntegrationStatus } from "@/lib/integration/useStatus";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import { virtualPose } from "./CameraRig";
import { M } from "./materials";
import { G } from "./parts";
import { useTwin } from "./twinStore";

/** Render cameras reused for grid tiles (one twin is mounted at a time). */
const pool = Array.from({ length: 9 }, () => new THREE.PerspectiveCamera(60, 1, 0.05, 200));

export function gridDims(layout: 1 | 4 | 9) {
  const n = layout === 1 ? 1 : layout === 4 ? 2 : 3;
  return { cols: n, rows: n };
}

/**
 * Owns rendering for the twin canvas (useFrame priority 1) whenever the
 * post-processing composer is off. When the CCTV grid is open the composer is
 * disabled and this renders 1/4/9 virtual cameras into scissored viewports of
 * the same WebGL context.
 */
export function MultiViewRenderer({ cameras, composerActive }: { cameras: VirtualCamera[]; composerActive: boolean }) {
  useFrame(({ gl, scene, camera, size }) => {
    const { cctvOpen, cctvLayout } = useApp.getState();
    if (!cctvOpen) {
      // The post-processing composer renders the main view when it is active.
      if (composerActive) return;
      const prev = gl.autoClear;
      gl.autoClear = true;
      gl.setScissorTest(false);
      gl.setViewport(0, 0, size.width, size.height);
      gl.render(scene, camera);
      gl.autoClear = prev;
      return;
    }
    const { cctvPage, camAdjust } = useTwin.getState();
    const { cols, rows } = gridDims(cctvLayout);
    const gap = 2;
    const tw = (size.width - gap * (cols - 1)) / cols;
    const th = (size.height - gap * (rows - 1)) / rows;
    gl.autoClear = false;
    gl.setScissorTest(false);
    gl.setClearColor("#05070a", 1);
    gl.clear();
    gl.setScissorTest(true);
    for (let i = 0; i < cctvLayout; i++) {
      const c = cameras[cctvPage * cctvLayout + i];
      if (!c) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (tw + gap);
      const y = size.height - (row + 1) * th - row * gap;
      const pc = pool[i];
      const p = virtualPose(c, camAdjust[c.id]);
      pc.position.copy(p.pos);
      pc.fov = p.fov;
      pc.aspect = tw / th;
      pc.lookAt(p.target);
      pc.updateProjectionMatrix();
      gl.setViewport(x, y, tw, th);
      gl.setScissor(x, y, tw, th);
      gl.clear();
      gl.render(scene, pc);
    }
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.autoClear = true;
  }, 2);
  return null;
}

/** HTML labels and controls laid over the grid tiles. */
export function CctvOverlay({ plan }: { plan: FloorPlan }) {
  const open = useApp((s) => s.cctvOpen);
  const layout = useApp((s) => s.cctvLayout);
  const setCctv = useApp((s) => s.setCctv);
  const goToCamera = useApp((s) => s.useVirtualCamera);
  useApp((s) => s.tick);
  const page = useTwin((s) => s.cctvPage);
  const setPage = useTwin((s) => s.setPage);
  const { status } = useIntegrationStatus(60_000);
  const [watching, setWatching] = useState<{ cameraId: string; name: string; protocol: string; virtual: boolean } | null>(null);
  if (!open) return null;
  // Registered cameras (real, or simulated through the camera gateway) at the pose of a virtual camera in this branch.
  const physical = new Map((status?.cameras ?? []).filter((c) => c.enabled && c.branchId === plan.restaurantId && c.virtualCameraId && (c.protocol === "webrtc-whep" || c.protocol === "mjpeg")).map((c) => [c.virtualCameraId!, c]));
  const { cols } = gridDims(layout);
  const pages = Math.max(1, Math.ceil(plan.cameras.length / layout));
  const p = Math.min(page, pages - 1);
  const tiles = plan.cameras.slice(p * layout, p * layout + layout);
  const rooms = new Map(plan.rooms.map((r) => [r.id, r.name]));
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="grid h-full w-full gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${cols}, 1fr)` }}>
        {tiles.map((c) => (
          <div key={c.id} className="group pointer-events-auto relative cursor-pointer border border-white/5 hover:border-brand-red/70" onClick={() => (layout === 1 ? (setCctv(false), goToCamera(c.id)) : (setPage(Math.floor(plan.cameras.indexOf(c) / 1)), setCctv(true, 1)))}>
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {c.code}
              <span className="text-white/60">{c.name}</span>
            </div>
            <div className="absolute right-2 top-2 flex items-center gap-1">
              {physical.has(c.id) && !physical.get(c.id)!.virtual && (
                <button type="button" title="Open the real camera at this position in a separate live player" className="rounded border border-emerald-400/50 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-emerald-300 hover:bg-emerald-400/15" onClick={(e) => (e.stopPropagation(), setWatching({ cameraId: physical.get(c.id)!.cameraId, name: physical.get(c.id)!.name, protocol: physical.get(c.id)!.protocol, virtual: false }))}>
                  ● LIVE FEED
                </button>
              )}
              {physical.get(c.id)?.virtual && (
                <button type="button" title="Open the simulated camera stream at this position (synthetic video through the camera pipeline)" className="rounded border border-fuchsia-400/50 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-fuchsia-300 hover:bg-fuchsia-400/15" onClick={(e) => (e.stopPropagation(), setWatching({ cameraId: physical.get(c.id)!.cameraId, name: physical.get(c.id)!.name, protocol: physical.get(c.id)!.protocol, virtual: true }))}>
                  ◈ SIM CAMERA
                </button>
              )}
              <span className="rounded border border-amber-400/40 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-amber-300">SIMULATED VIEW</span>
            </div>
            <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
              {rooms.get(c.roomId)} · {clockSec(sims().clock)}
            </div>
            <div className="absolute bottom-2 right-2 hidden gap-1 group-hover:flex">
              <button type="button" className="rounded bg-brand-red px-2 py-0.5 text-[10px] font-semibold text-white" onClick={(e) => (e.stopPropagation(), setCctv(false), goToCamera(c.id))}>
                Go to camera
              </button>
            </div>
          </div>
        ))}
      </div>
      {watching && (
        <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6" onClick={() => setWatching(null)}>
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <LiveCameraPlayer cameraId={watching.cameraId} name={watching.name} protocol={watching.protocol} virtual={watching.virtual} className="aspect-video" />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => setWatching(null)} className="rounded-md border border-white/15 px-3 py-1 text-[11px] text-white/80 hover:bg-white/10">
                {watching.virtual ? "Close camera" : "Close live feed"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="glass pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-1 text-[11px] text-white">
        <span className="px-2 font-semibold tracking-wide text-white/70">VIRTUAL CAMERA GRID</span>
        {([1, 4, 9] as const).map((l) => (
          <button key={l} type="button" onClick={() => (setCctv(true, l), setPage(0))} className={`rounded-md px-2 py-1 ${layout === l ? "bg-white/15" : "text-white/60 hover:text-white"}`}>
            {l === 1 ? "1" : l === 4 ? "2×2" : "3×3"}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button type="button" disabled={p === 0} onClick={() => setPage(p - 1)} className="rounded-md px-2 py-1 text-white/70 disabled:opacity-30">
          ‹
        </button>
        <span className="font-mono text-white/60">
          {p + 1}/{pages}
        </span>
        <button type="button" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="rounded-md px-2 py-1 text-white/70 disabled:opacity-30">
          ›
        </button>
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button type="button" onClick={() => setCctv(false)} className="rounded-md px-2 py-1 text-white/70 hover:text-white">
          Close grid
        </button>
      </div>
    </div>
  );
}

/** Small dome cameras mounted where the floor plan places each virtual camera. */
export const CameraDevices = memo(function CameraDevices({ cameras, activeId }: { cameras: VirtualCamera[]; activeId: string | null }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    ref.current?.traverse((o) => o.layers.set(1));
  });
  return (
    <group ref={ref}>
      {cameras.map((c) => {
        const dir = new THREE.Vector3(...c.target).sub(new THREE.Vector3(...c.position)).normalize();
        const yaw = Math.atan2(dir.x, dir.z);
        return (
          <group key={c.id} position={c.position} rotation={[0, yaw, 0]}>
            <mesh geometry={G.box} material={M.white()} position={[0, 0.12, -0.05]} scale={[0.06, 0.24, 0.06]} />
            <mesh geometry={G.box} material={M.white()} position={[0, 0, 0.04]} scale={[0.12, 0.1, 0.2]} rotation={[0.35, 0, 0]} />
            <mesh geometry={G.sphereLow} material={c.id === activeId ? M.emissive("#ef4444", 3) : M.emissive("#22c55e", 1.5)} position={[0, -0.03, 0.15]} scale={0.035} />
          </group>
        );
      })}
    </group>
  );
});

/** Reference navigation paths from the floor plan plus live agent routes. */
export function PathsOverlay({ plan, version }: { plan: FloorPlan; version: number }) {
  const sim = sims().peek(plan.restaurantId);
  const colors = { customer: "#ef4444", staff: "#22c55e", delivery: "#FFD400", emergency: "#38bdf8" } as const;
  const live = useMemo(
    () => (sim ? sim.agents.filter((a) => !a.gone && a.path.length).map((a) => ({ id: a.id, kind: a.kind, pts: [a.pos, ...a.path].map(([x, z]) => [x, 0.05, z] as [number, number, number]) })) : []),
    [sim, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <group>
      {plan.navigationPaths.map((p) => (
        <Line key={p.id} points={p.points.map(([x, z]) => [x, 0.04, z] as [number, number, number])} color={colors[p.kind]} lineWidth={2.5} dashed dashSize={0.25} gapSize={0.15} transparent opacity={0.85} />
      ))}
      {live.map((l) => (
        <Line key={l.id} points={l.pts} color={l.kind === "staff" ? "#86efac" : l.kind === "rider" ? "#fde047" : "#fca5a5"} lineWidth={1.5} transparent opacity={0.6} />
      ))}
    </group>
  );
}
