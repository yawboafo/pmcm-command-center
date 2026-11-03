"use client";

import { OrbitControls, PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { FloorPlan, VirtualCamera } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";
import { useTwin } from "./twinStore";

type V3 = [number, number, number];
interface Pose {
  pos: V3;
  target: V3;
  fov?: number;
}

/** Narrow (portrait / mobile) viewports back the camera off to keep the building framed. */
function backOff(aspect: number) {
  return THREE.MathUtils.clamp(1.6 / aspect, 1, 2.4);
}

export function dollhousePose(plan: FloorPlan, aspect = 1.6): Pose {
  const { width: W, length: L } = plan.dimensions;
  const span = Math.max(W, L * 1.15);
  const d = (span * 0.92 + 4) * backOff(aspect);
  return { pos: [W / 2 - d * 0.3, d * 0.8, L / 2 - d * 0.78], target: [W / 2, 0, L / 2 + span * 0.03], fov: 45 };
}

export function topPose(plan: FloorPlan, aspect = 1.6): Pose {
  const { width: W, length: L } = plan.dimensions;
  const fit = Math.max(W / Math.max(aspect, 0.5), L) * 1.25 + 3;
  return { pos: [W / 2, fit / (2 * Math.tan(THREE.MathUtils.degToRad(22.5))) * 0.95, L / 2 - 0.01], target: [W / 2, 0, L / 2], fov: 45 };
}

export function entrancePoses(plan: FloorPlan) {
  const e = plan.doors.find((d) => d.kind === "entrance" && d.axis === "x" && d.z < 0.01) ?? plan.doors.find((d) => d.kind === "entrance") ?? plan.doors[0];
  return {
    exterior: { pos: [e.x + 4.6, 1.75, -13] as V3, target: [e.x - 0.8, 2.7, 0] as V3, fov: 50 },
    approach: { pos: [e.x, 1.7, -3.4] as V3, target: [e.x, 1.6, 3] as V3, fov: 58 },
    inside: { pos: [e.x, 1.7, 1.6] as V3, target: [e.x, 1.4, 6] as V3, fov: 62 },
  };
}

/** Pose for a virtual camera including the user's zoom / nudge adjustments. */
export function virtualPose(c: VirtualCamera, adj?: { fov: number; yaw: number; pitch: number }) {
  const pos = new THREE.Vector3(...c.position);
  const dir = new THREE.Vector3(...c.target).sub(pos);
  if (adj && (adj.yaw || adj.pitch)) {
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta += THREE.MathUtils.degToRad(adj.yaw);
    sph.phi = THREE.MathUtils.clamp(sph.phi - THREE.MathUtils.degToRad(adj.pitch), 0.2, Math.PI - 0.2);
    dir.setFromSpherical(sph);
  }
  return { pos, target: pos.clone().add(dir), fov: THREE.MathUtils.clamp(c.fov + (adj?.fov ?? 0), 20, 95) };
}

// Scratch vectors (one camera rig is mounted at a time), keeping useFrame allocation-free.
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const tmpT = new THREE.Vector3();

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Tween {
  fromP: THREE.Vector3;
  fromT: THREE.Vector3;
  fromFov: number;
  toP: THREE.Vector3;
  toT: THREE.Vector3;
  toFov: number;
  t: number;
  dur: number;
  onDone?: () => void;
}

/**
 * Drives the main camera: orbit · fps · top · dollhouse · cctv · focus · tour · follow,
 * plus the map-to-restaurant intro. Preset changes use eased cubic in-out tweens
 * (≈1.1 s); any OrbitControls interaction cancels a running tween.
 */
export default function CameraRig({ sim }: { sim: BranchSimulation }) {
  const plan = sim.plan;
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  // Read the live camera on demand (the compiler forbids mutating values captured during render).
  const cameraNow = () => get().camera as THREE.PerspectiveCamera;
  const controls = useRef<OrbitControlsImpl>(null);
  const mode = useApp((s) => s.cameraMode);
  const phase = useApp((s) => s.phase);
  const activeCameraId = useApp((s) => s.activeCameraId);
  const request = useApp((s) => s.cameraRequest);
  const followId = useApp((s) => s.followOrderId);
  const followAgentId = useApp((s) => s.followAgentId);
  const camAdjust = useTwin((s) => (activeCameraId ? s.camAdjust[activeCameraId] : undefined));
  const aspect = size.width / Math.max(1, size.height);

  const look = useRef(new THREE.Vector3(plan.dimensions.width / 2, 0, plan.dimensions.length / 2));
  const tween = useRef<Tween | null>(null);
  const seq = useRef<Array<Pose & { dur: number; hold?: number; onDone?: () => void }>>([]);
  const holdUntil = useRef(0);
  const tourIdx = useRef(0);
  const tourNext = useRef(0);
  const clock = useRef(0);
  const followGoal = useRef({ p: new THREE.Vector3(), t: new THREE.Vector3(), on: false });

  const target = () => controls.current?.target ?? look.current;

  const tweenTo = (pose: { pos: V3 | THREE.Vector3; target: V3 | THREE.Vector3; fov?: number }, dur = 1.1, onDone?: () => void) => {
    const camera = cameraNow();
    const cam = camera;
    const toP = Array.isArray(pose.pos) ? new THREE.Vector3(...pose.pos) : pose.pos.clone();
    const toT = Array.isArray(pose.target) ? new THREE.Vector3(...pose.target) : pose.target.clone();
    tween.current = { fromP: camera.position.clone(), fromT: target().clone(), fromFov: cam.fov, toP, toT, toFov: pose.fov ?? cam.fov, t: 0, dur, onDone };
    followGoal.current.on = false;
  };
  const snap = (pose: Pose) => {
    const camera = cameraNow();
    const cam = camera;
    camera.position.set(...pose.pos);
    target().set(...pose.target);
    if (pose.fov) cam.fov = pose.fov;
    cam.updateProjectionMatrix();
    camera.lookAt(target());
    tween.current = null;
  };

  // Intro: the "camera feed" boots straight onto the overview with a slow focus pull
  // (the overlay in FeedBoot.tsx covers the first moments with signal acquisition).
  const introStarted = useRef(false);
  useEffect(() => {
    const { setPhase, setCameraMode } = useApp.getState();
    if (phase === "exterior" && !introStarted.current) {
      introStarted.current = true;
      const end = dollhousePose(plan, aspect);
      const [tx, ty, tz] = end.target;
      const [px, py, pz] = end.pos;
      // Start 12% further out and slightly rotated, then settle — like a PTZ camera locking on.
      snap({ pos: [tx + (px - tx) * 1.12 + 1.5, ty + (py - ty) * 1.12, tz + (pz - tz) * 1.12], target: end.target, fov: (end.fov ?? 45) + 6 });
      holdUntil.current = clock.current + 1.4;
      seq.current = [
        {
          ...end,
          dur: 2.4,
          onDone: () => {
            setPhase("inside");
            setCameraMode("dollhouse");
          },
        },
      ];
    }
    if (phase === "inside" && seq.current.length) {
      // Intro skipped.
      seq.current = [];
      tweenTo(dollhousePose(plan, aspect), 1.1);
    }
    if (phase === "map" || phase === "flying") introStarted.current = false;
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode / preset changes (re-run when the viewport reshapes so framing holds on rotate).
  const prevMode = useRef(mode);
  useEffect(() => {
    const camera = cameraNow();
    const cam = camera;
    if (prevMode.current === "fps" && mode !== "fps") {
      const ahead = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(3).add(camera.position);
      target().copy(ahead);
    }
    prevMode.current = mode;
    if (phase !== "inside" || seq.current.length) return;
    if (mode === "dollhouse") tweenTo(dollhousePose(plan, aspect));
    else if (mode === "top") tweenTo(topPose(plan, aspect));
    else if (mode === "tour") {
      tourIdx.current = 0;
      tourNext.current = 0;
    } else if (mode === "fps") {
      tween.current = null;
      const inside = sim.grid.isWalkable(camera.position.x, camera.position.z) && camera.position.y < plan.dimensions.height;
      const start = inside ? [camera.position.x, camera.position.z] : plan.anchors.entrance;
      camera.position.set(start[0], 1.6, start[1]);
      cam.fov = 70;
      cam.updateProjectionMatrix();
      camera.lookAt(start[0], 1.5, start[1] + 3);
    }
  }, [mode, phase, aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Camera domes live on layer 1: visible in the main view, never inside a virtual camera's own image.
  useEffect(() => {
    const camera = cameraNow();
    if (mode === "cctv" || mode === "tour") camera.layers.disable(1);
    else camera.layers.enable(1);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Virtual cameras switch near-instantly.
  useEffect(() => {
    if (mode !== "cctv" || !activeCameraId) return;
    const c = plan.cameras.find((x) => x.id === activeCameraId);
    if (!c) return;
    const p = virtualPose(c, camAdjust);
    tweenTo({ pos: p.pos, target: p.target, fov: p.fov }, camAdjust ? 0.15 : 0.45);
  }, [mode, activeCameraId, camAdjust]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus requests (equipment, alerts, AI navigation…).
  useEffect(() => {
    if (!request || phase !== "inside") return;
    const camera = cameraNow();
    const t = new THREE.Vector3(...request.target);
    let p: THREE.Vector3;
    if (request.position) p = new THREE.Vector3(...request.position);
    else {
      // Look down from just above the roofline so walls cut away automatically and never block the shot.
      const dir = camera.position.clone().sub(t).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
      dir.normalize().multiplyScalar(3.4);
      p = t.clone().add(dir).setY(plan.dimensions.height + 2.4);
    }
    tweenTo({ pos: p, target: t, fov: request.fov ?? 52 }, 1.1);
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any user input stops the cinematic tour.
  useEffect(() => {
    if (mode !== "tour") return;
    const stop = () => useApp.getState().setCameraMode("orbit");
    const el = gl.domElement;
    el.addEventListener("pointerdown", stop);
    el.addEventListener("wheel", stop);
    window.addEventListener("keydown", stop);
    return () => {
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [mode, gl]);

  // CCTV mode: wheel zooms (fov), drag nudges yaw/pitch.
  useEffect(() => {
    if (mode !== "cctv" || !activeCameraId) return;
    const el = gl.domElement;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      useTwin.getState().adjust(activeCameraId, { fov: Math.sign(e.deltaY) * 3 });
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      useTwin.getState().adjust(activeCameraId, { yaw: (lx - e.clientX) * 0.15, pitch: (e.clientY - ly) * 0.15 });
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = () => (dragging = false);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [mode, activeCameraId, gl]);

  // FPS keyboard state.
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (mode !== "fps") return;
    const dn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
      keys.current = {};
    };
  }, [mode]);


  useFrame((state, dtRaw) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const cam = camera;
    const dt = Math.min(dtRaw, 0.05);
    clock.current += dt;
    const ctl = controls.current;
    const tgt = target();

    // Intro sequence.
    if (seq.current.length && !tween.current && clock.current >= holdUntil.current) {
      const step = seq.current.shift()!;
      tweenTo(step, step.dur, () => {
        step.onDone?.();
        if (step.hold) holdUntil.current = clock.current + step.hold;
      });
    }

    if (mode === "fps" && phase === "inside") {
      const inp = useTwin.getState().fpsInput;
      const k = keys.current;
      const run = k.ShiftLeft || k.ShiftRight ? 2.6 : 1.4;
      const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + inp.f;
      const r = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + inp.r;
      if (inp.turn) camera.rotateOnWorldAxis(upAxis, -inp.turn * dt * 1.6);
      if (f || r) {
        camera.getWorldDirection(fwd).setY(0).normalize();
        right.crossVectors(fwd, camera.up).normalize();
        const step = run * dt;
        const nx = camera.position.x + (fwd.x * f + right.x * r) * step;
        const nz = camera.position.z + (fwd.z * f + right.z * r) * step;
        // Slide along obstacles: each axis is checked against the navigation grid separately.
        if (sim.grid.isWalkable(nx, camera.position.z)) camera.position.x = nx;
        if (sim.grid.isWalkable(camera.position.x, nz)) camera.position.z = nz;
      }
      camera.position.y = 1.6 + (f || r ? Math.sin(clock.current * 9) * 0.02 : 0);
      return;
    }

    if (mode === "tour" && phase === "inside" && plan.cameras.length && clock.current >= tourNext.current) {
      const c = plan.cameras[tourIdx.current % plan.cameras.length];
      tourIdx.current++;
      tourNext.current = clock.current + 6;
      const p = virtualPose(c);
      tweenTo({ pos: p.pos, target: p.target, fov: p.fov }, 2.2);
    }

    const tw = tween.current;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = ease(tw.t);
      camera.position.lerpVectors(tw.fromP, tw.toP, e);
      tgt.lerpVectors(tw.fromT, tw.toT, e);
      cam.fov = tw.fromFov + (tw.toFov - tw.fromFov) * e;
      cam.updateProjectionMatrix();
      if (ctl?.enabled) ctl.update();
      else camera.lookAt(tgt);
      if (tw.t >= 1) {
        tween.current = null;
        tw.onDone?.();
      }
      return;
    }

    // Follow an order: continuous damped chase from above-behind.
    if (mode === "follow" && (followId || followAgentId) && phase === "inside") {
      const person = followAgentId ? sim.agents.find((a) => a.id === followAgentId && !a.gone) : undefined;
      const loc = person ? person.pos : followId ? sim.orderLocation(followId) : null;
      const fg = followGoal.current;
      if (loc) {
        tmpT.set(loc[0], person ? 1.25 : 0.9, loc[1]);
        if (!fg.on) {
          fg.t.copy(tgt);
          fg.on = true;
        }
        fg.t.lerp(tmpT, 1 - Math.exp(-dt * 3));
        if (person) {
          // Steep chase from behind the person's heading, high enough to look over room walls
          // (interiors are cut away above wall height), so small rooms never block the view.
          const H = plan.dimensions.height;
          fg.p.set(fg.t.x - Math.sin(person.heading) * 3.2, H + 3.6, fg.t.z - Math.cos(person.heading) * 3.2);
        } else fg.p.set(fg.t.x - 2.2, 4.6, fg.t.z - 3.4);
      }
      if (fg.on) {
        const k = 1 - Math.exp(-dt * 3.5);
        camera.position.lerp(fg.p, k);
        tgt.lerp(fg.t, k);
        if (Math.abs(cam.fov - 55) > 0.1) {
          cam.fov += (55 - cam.fov) * k;
          cam.updateProjectionMatrix();
        }
        camera.lookAt(tgt);
      }
    } else if (!ctl?.enabled) {
      camera.lookAt(tgt);
    }
  });

  const orbitEnabled = phase === "inside" && (mode === "orbit" || mode === "dollhouse" || mode === "top" || mode === "focus");
  const { width: W, length: L } = plan.dimensions;
  return (
    <>
      {mode === "fps" && phase === "inside" && (
        <PointerLockControls selector="#twin-root canvas" onLock={() => useTwin.getState().setLocked(true)} onUnlock={() => useTwin.getState().setLocked(false)} />
      )}
      <OrbitControls
        ref={controls}
        makeDefault={mode !== "fps"}
        enabled={orbitEnabled}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={Math.max(W, L) * 3 + 20}
        maxPolarAngle={mode === "top" ? 0.35 : Math.PI / 2.08}
        minPolarAngle={0}
        screenSpacePanning
        onStart={() => (tween.current = null)}
      />
    </>
  );
}
