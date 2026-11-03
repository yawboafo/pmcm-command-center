"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { tileRegistry, useFeed } from "@/components/cameras/feedStore";
import type { FloorPlan, VirtualCamera } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import { virtualPose } from "./CameraRig";
import { M } from "./materials";
import { G } from "./parts";
import { useTwin } from "./twinStore";

/**
 * Owns rendering for the twin canvas (useFrame priority 2) whenever the post-processing
 * composer is off. With the camera centre open it renders each registered feed tile — a
 * DOM element anywhere in the page — as a scissored viewport of the same WebGL context,
 * using that zone's fixed camera. Tiles are refreshed round-robin so eight feeds cost about
 * the same as two full frames; the canvas keeps its drawing buffer between frames.
 */
const RENDER_W = 480;

export function MultiViewRenderer({ sim, composerActive }: { sim: BranchSimulation; composerActive: boolean }) {
  const cams = useRef(new Map<string, THREE.PerspectiveCamera>());
  const rr = useRef(0);
  const seenVersion = useRef(-1);
  const fps = useRef({ n: 0, at: 0 });

  useFrame(({ gl, scene, camera, size }) => {
    const now = performance.now();
    fps.current.n++;
    if (!fps.current.at) fps.current.at = now;
    if (now - fps.current.at >= 1000) {
      useFeed.getState().setFps(Math.round((fps.current.n * 1000) / (now - fps.current.at)));
      fps.current = { n: 0, at: now };
    }
    const { cctvOpen } = useApp.getState();
    if (!cctvOpen) {
      if (composerActive) return;
      gl.autoClear = true;
      gl.setScissorTest(false);
      gl.setViewport(0, 0, size.width, size.height);
      gl.render(scene, camera);
      return;
    }
    const regs = [...tileRegistry.all().entries()].filter(([, r]) => r.el.isConnected);
    const pr = gl.getPixelRatio();
    const cRect = gl.domElement.getBoundingClientRect();
    gl.autoClear = false;
    // Layout changed (tiles added/removed): wipe the whole buffer once so stale pictures never linger.
    // Otherwise only the gutters are cleared, so tiles rendered on earlier frames stay on screen.
    gl.setScissorTest(false);
    gl.setClearColor("#07090d", 1);
    if (seenVersion.current !== tileRegistry.version()) {
      seenVersion.current = tileRegistry.version();
      gl.clear();
    } else gl.clear(false, true, true);
    if (!regs.length) return;
    const { camAdjust } = useTwin.getState();
    const prevAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    gl.setScissorTest(true);
    const budget = regs.length <= 2 ? regs.length : Math.ceil(regs.length / 3);
    for (let i = 0; i < budget; i++) {
      const [id, reg] = regs[(rr.current + i) % regs.length];
      const zc = sim.zoneCameras.find((c) => c.zoneId === reg.zoneId);
      if (!zc) continue;
      const r = reg.el.getBoundingClientRect();
      const x = r.left - cRect.left;
      const y = cRect.bottom - r.bottom;
      if (r.width < 8 || r.height < 8 || r.right < cRect.left || r.left > cRect.right || r.bottom < cRect.top || r.top > cRect.bottom) continue;
      let pc = cams.current.get(id);
      if (!pc) {
        pc = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
        pc.layers.disable(1); // camera domes never appear in a camera's own picture
        cams.current.set(id, pc);
      }
      const p = virtualPose(zc, camAdjust[zc.id]);
      pc.position.copy(p.pos);
      pc.fov = p.fov;
      pc.aspect = r.width / r.height;
      pc.lookAt(p.target);
      pc.updateProjectionMatrix();
      // three.js takes CSS pixels here and applies the pixel ratio itself.
      gl.setViewport(x, y, r.width, r.height);
      gl.setScissor(x, y, r.width, r.height);
      gl.clear();
      gl.render(scene, pc);
      tileRegistry.setFrame(id, { camera: pc, x, y: r.top - cRect.top, w: r.width, h: r.height, at: now });
      const caps = tileRegistry.takeCaptures(id);
      if (caps.length) {
        // readPixels is raw WebGL: device pixels.
        const url = snapshot(gl, Math.round(x * pr), Math.round(y * pr), Math.round(r.width * pr), Math.round(r.height * pr));
        for (const cb of caps) cb(url);
      }
    }
    rr.current = (rr.current + budget) % Math.max(1, regs.length);
    tileRegistry.setRefreshMs((Math.ceil(regs.length / budget) * 1000) / Math.max(1, useFeed.getState().fps || 30));
    gl.shadowMap.autoUpdate = prevAuto;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.autoClear = true;
  }, 2);
  return null;
}

/** Read the tile's pixels straight from the drawing buffer and return a JPEG data URL (≤ 480 px wide). */
function snapshot(gl: THREE.WebGLRenderer, x: number, y: number, w: number, h: number) {
  const ctx = gl.getContext();
  const buf = new Uint8Array(w * h * 4);
  ctx.readPixels(x, y, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
  const raw = document.createElement("canvas");
  raw.width = w;
  raw.height = h;
  const c2 = raw.getContext("2d")!;
  const img = c2.createImageData(w, h);
  // WebGL rows run bottom-up.
  for (let row = 0; row < h; row++) img.data.set(buf.subarray(row * w * 4, (row + 1) * w * 4), (h - 1 - row) * w * 4);
  c2.putImageData(img, 0, 0);
  const out = document.createElement("canvas");
  const scale = Math.min(1, RENDER_W / w);
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out.getContext("2d")!.drawImage(raw, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.74);
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
