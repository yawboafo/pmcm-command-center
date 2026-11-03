"use client";

import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import RestaurantModel from "@/components/twin/RestaurantModel";
import { setDoorStateProvider } from "@/components/twin/doorState";
import type { FloorPlan, Vec3 } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import { zoneStatus, type Level } from "@/lib/sim/zones";
import { LAUNCH } from "@/config/launch";
import { PLATFORM } from "@/config/platform";
import { useLaunch, type QualityTier } from "./launchStore";

/**
 * The launch world: the real East Legon twin, lit from black by a single key light while a
 * holographic cage of particles settles onto its walls, then a slow camera sweep through the
 * fryer line, the counter, the dining room and the rider bay, instrumentation rising out of
 * the scene, and a pull-back to the hero wide. The same scene idles behind the access gate
 * and flips every status ring green on unlock. Real-time, native resolution, any aspect.
 */
const DUR = LAUNCH.intro.durationSec;
const LEVEL_HEX: Record<Level, string> = { ok: "#3ccf8e", watch: "#f5b02e", act: "#f0483e" };
const STEEL = new THREE.Color("#a9bfdc");

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ───────────── camera path ───────────── */

interface Key {
  t: number;
  pos: Vec3;
  target: Vec3;
  fov: number;
}

function keyframes(plan: FloorPlan, sim: BranchSimulation): Key[] {
  const { width: W, length: L, height: H } = plan.dimensions;
  const cam = (zone: string) => sim.zoneCameras.find((c) => c.zoneId === zone);
  const low = (zone: string, fallback: Key, fov = 50): Key => {
    const c = cam(zone);
    if (!c) return fallback;
    const p = new THREE.Vector3(...c.position);
    const tg = new THREE.Vector3(...c.target);
    // A dolly a little lower and closer than the mounted camera, so the shot feels hand-held, not surveillance.
    const dir = tg.clone().sub(p).setY(0).normalize();
    p.add(dir.multiplyScalar(0.9)).setY(Math.min(2.1, p.y - 0.5));
    return { t: fallback.t, pos: [p.x, p.y, p.z], target: [tg.x, 1.0, tg.z], fov };
  };
  const hero: Key = { t: DUR - 1.2, pos: [W * 0.62, H * 2.7, -L * 0.72], target: [W / 2, 0.6, L * 0.42], fov: 42 };
  const far: Key = { t: 0, pos: [W * 0.55, H * 4.2 + 8, -L * 1.5], target: [W / 2, 0.8, L * 0.45], fov: 36 };
  const kitchen = low("kitchen", { t: 4.5, pos: [W * 0.8, 2.1, L * 0.55], target: [W * 0.95, 1, L * 0.55], fov: 52 }, 54);
  const counter = low("front-counter", { t: 7.5, pos: [W * 0.7, 2.1, L * 0.2], target: [W * 0.75, 1, L * 0.35], fov: 52 }, 56);
  const dining = low("dining", { t: 10.5, pos: [W * 0.1, 2.1, L * 0.1], target: [W * 0.35, 0.8, L * 0.3], fov: 56 }, 60);
  const bay = low("pickup-bay", { t: 13, pos: [W * 0.15, 2.1, L * 0.65], target: [W * 0.05, 1, L * 0.6], fov: 52 }, 54);
  kitchen.t = 4.5;
  counter.t = 7.5;
  dining.t = 10.5;
  bay.t = 13.2;
  return [far, kitchen, counter, dining, bay, hero, { ...hero, t: DUR + 4, pos: [hero.pos[0] - 1.5, hero.pos[1] + 0.4, hero.pos[2] - 1] }];
}

function LaunchRig({ plan, sim }: { plan: FloorPlan; sim: BranchSimulation }) {
  const keys = useMemo(() => keyframes(plan, sim), [plan, sim]);
  const posCurve = useMemo(() => new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.pos)), false, "centripetal", 0.6), [keys]);
  const tgtCurve = useMemo(() => new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.target)), false, "centripetal", 0.6), [keys]);
  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const tmpT = useMemo(() => new THREE.Vector3(), []);
  const orbit = useRef({ angle: 0, started: false, radius: 20, height: 9, cx: 0, cz: 0 });
  const { width: W, length: L, height: H } = plan.dimensions;

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useLaunch.getState();
    const camera = state.camera as THREE.PerspectiveCamera;
    if (st.phase === "intro") {
      const t = Math.min(st.t, keys[keys.length - 1].t);
      // Piecewise-linear time → curve parameter, so every keyframe is hit at its second.
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i];
      const b = keys[i + 1];
      const f = Math.max(0, Math.min(1, (t - a.t) / Math.max(0.01, b.t - a.t)));
      const u = (i + f) / (keys.length - 1);
      posCurve.getPointAt(Math.max(0, Math.min(1, u)), tmpP);
      tgtCurve.getPointAt(Math.max(0, Math.min(1, u)), tmpT);
      // Hand-held breath: tiny drift so nothing is ever perfectly still.
      const breathe = Math.sin(state.clock.elapsedTime * 0.7) * 0.03;
      camera.position.set(tmpP.x, tmpP.y + breathe, tmpP.z);
      camera.lookAt(tmpT);
      const fov = a.fov + (b.fov - a.fov) * f;
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      orbit.current.started = false;
      return;
    }
    // Gate and unlock: a slow orbit around the hero target with a breathing height.
    const o = orbit.current;
    if (!o.started) {
      o.started = true;
      o.cx = W / 2;
      o.cz = L * 0.42;
      o.angle = Math.atan2(camera.position.x - o.cx, camera.position.z - o.cz);
      o.radius = Math.max(14, Math.hypot(camera.position.x - o.cx, camera.position.z - o.cz));
      o.height = Math.max(H * 2.2, camera.position.y);
    }
    o.angle += dt * (st.phase === "unlock" ? 0.12 : 0.035);
    const dolly = st.phase === "unlock" ? Math.max(0.78, 1 - dt * 0.5) : 1;
    o.radius *= dolly;
    const y = o.height + Math.sin(state.clock.elapsedTime * 0.35) * 0.35;
    const k = 1 - Math.exp(-dt * 1.4);
    tmpP.set(o.cx + Math.sin(o.angle) * o.radius, y, o.cz + Math.cos(o.angle) * o.radius);
    camera.position.lerp(tmpP, k);
    tmpT.set(o.cx, 0.6, o.cz);
    camera.lookAt(tmpT);
    const fov = 42;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/* ───────────── lights that come on as the camera passes ───────────── */

function IntroLights({ plan, sim }: { plan: FloorPlan; sim: BranchSimulation }) {
  const key = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const zoneLights = useRef<Array<THREE.PointLight | null>>([]);
  const { width: W, length: L, height: H } = plan.dimensions;
  const zones = useMemo(() => {
    const at = (zone: string, when: number, color: string) => {
      const c = sim.zoneCameras.find((x) => x.zoneId === zone);
      return c ? { pos: [c.target[0], H - 0.5, c.target[2]] as Vec3, when, color } : null;
    };
    return [at("kitchen", 4.2, "#ffb36a"), at("front-counter", 7.2, "#ffe2b8"), at("dining", 10.2, "#ffd7a1"), at("pickup-bay", 12.7, "#dbe8ff")].filter((z): z is NonNullable<typeof z> => !!z);
  }, [sim, H]);
  useFrame((state) => {
    const st = useLaunch.getState();
    const t = st.phase === "intro" ? st.t : DUR + 2;
    const breathe = 0.85 + Math.sin(state.clock.elapsedTime * 0.5) * 0.15;
    if (key.current) {
      // A single source resolves out of black, then settles as the key light.
      const resolve = smooth(0.6, 3.2, t);
      key.current.intensity = (st.phase === "unlock" ? 420 : 260) * resolve * (st.phase === "intro" ? 1 : breathe);
      key.current.position.set(W / 2 + Math.sin(t * 0.15) * 4, H * 4.5, L * 0.4 - 6);
    }
    if (hemi.current) hemi.current.intensity = 0.05 + 0.5 * smooth(13, DUR, t) * (st.phase === "intro" ? 1 : breathe) + (st.phase === "unlock" ? 0.25 : 0);
    zones.forEach((z, i) => {
      const l = zoneLights.current[i];
      if (!l) return;
      l.intensity = 26 * smooth(z.when - 0.4, z.when + 1.2, t) * (st.phase === "intro" ? 1 : breathe);
    });
  });
  return (
    <>
      <spotLight ref={key} position={[W / 2, H * 4.5, L * 0.4 - 6]} angle={0.75} penumbra={0.9} intensity={0} color="#f4ead9" distance={120} decay={1.4} castShadow={false} />
      <hemisphereLight ref={hemi} args={["#9fb3c8", "#141a24", 0.05]} />
      {zones.map((z, i) => (
        <pointLight key={i} ref={(el) => void (zoneLights.current[i] = el)} position={z.pos} color={z.color} intensity={0} distance={11} decay={1.7} />
      ))}
    </>
  );
}

/* ───────────── holographic cage: particles settling onto the walls, wire edges ───────────── */

const N_POINTS = 5200;

interface Holo {
  geom: THREE.BufferGeometry;
  targets: Float32Array;
  starts: Float32Array;
  delays: Float32Array;
  pointsMat: THREE.PointsMaterial;
  edgeGeom: THREE.BufferGeometry;
  edgeMat: THREE.LineBasicMaterial;
}
// Animation state lives outside React (built once per floor plan, mutated every frame).
const holoCache = new WeakMap<FloorPlan, Holo>();
function holoFor(plan: FloorPlan): Holo {
  let h = holoCache.get(plan);
  if (h) return h;
  const targets = new Float32Array(N_POINTS * 3);
  const starts = new Float32Array(N_POINTS * 3);
  const delays = new Float32Array(N_POINTS);
  const H = plan.dimensions.height;
  const rnd = () => Math.random();
  let i = 0;
  const put = (x: number, y: number, z: number) => {
    if (i >= N_POINTS) return;
    targets[i * 3] = x;
    targets[i * 3 + 1] = y;
    targets[i * 3 + 2] = z;
    const dir = new THREE.Vector3(rnd() - 0.5, rnd() * 0.6 + 0.2, rnd() - 0.5).normalize().multiplyScalar(6 + rnd() * 22);
    starts[i * 3] = x + dir.x;
    starts[i * 3 + 1] = y + dir.y;
    starts[i * 3 + 2] = z + dir.z;
    delays[i] = 0.4 + rnd() * 3.6;
    i++;
  };
  // Walls: points along every wall at several heights.
  for (const w of plan.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n = Math.max(2, Math.round(len / 0.35));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const x = w.a[0] + (w.b[0] - w.a[0]) * f;
      const z = w.a[1] + (w.b[1] - w.a[1]) * f;
      for (const y of [0.02, w.height * 0.5, w.height]) put(x, y, z);
    }
  }
  // Equipment: a few points on every item's top face.
  for (const e of plan.equipment) {
    const [w, hh, dd] = e.size;
    for (let k = 0; k < 10; k++) {
      const lx = (rnd() - 0.5) * w;
      const lz = (rnd() - 0.5) * dd;
      put(e.position[0] + Math.cos(e.rotation) * lx + Math.sin(e.rotation) * lz, e.position[1] + hh, e.position[2] - Math.sin(e.rotation) * lx + Math.cos(e.rotation) * lz);
    }
  }
  while (i < N_POINTS) put(rnd() * plan.dimensions.width, 0.02 + rnd() * H, rnd() * plan.dimensions.length);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(starts), 3));
  const pts: number[] = [];
  for (const w of plan.walls) {
    const [ax, az] = w.a;
    const [bx, bz] = w.b;
    pts.push(ax, w.height, az, bx, w.height, bz, ax, 0, az, ax, w.height, az, bx, 0, bz, bx, w.height, bz);
  }
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  h = {
    geom,
    targets,
    starts,
    delays,
    pointsMat: new THREE.PointsMaterial({ color: STEEL, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    edgeGeom,
    edgeMat: new THREE.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  };
  holoCache.set(plan, h);
  return h;
}

function Hologram({ plan }: { plan: FloorPlan }) {
  const ref = useRef<THREE.Points>(null);
  const edges = useRef<THREE.LineSegments>(null);
  useFrame(() => {
    const h = holoFor(plan);
    const st = useLaunch.getState();
    const t = st.phase === "intro" ? st.t : DUR + 5;
    const p = ref.current;
    if (p) {
      const arr = h.geom.attributes.position.array as Float32Array;
      for (let i = 0; i < N_POINTS; i++) {
        const k = smooth(h.delays[i], h.delays[i] + 1.8, t);
        const e = 1 - Math.pow(1 - k, 3);
        arr[i * 3] = h.starts[i * 3] + (h.targets[i * 3] - h.starts[i * 3]) * e;
        arr[i * 3 + 1] = h.starts[i * 3 + 1] + (h.targets[i * 3 + 1] - h.starts[i * 3 + 1]) * e;
        arr[i * 3 + 2] = h.starts[i * 3 + 2] + (h.targets[i * 3 + 2] - h.starts[i * 3 + 2]) * e;
      }
      h.geom.attributes.position.needsUpdate = true;
      h.pointsMat.opacity = 0.85 * smooth(0.2, 1.4, t) * (1 - smooth(5.2, 7.6, t));
      p.visible = h.pointsMat.opacity > 0.01;
    }
    if (edges.current) {
      h.edgeMat.opacity = 0.55 * smooth(1.6, 3.4, t) * (1 - smooth(6.5, 9, t));
      edges.current.visible = h.edgeMat.opacity > 0.01;
    }
  });
  const h = holoFor(plan);
  return (
    <>
      <points ref={ref} geometry={h.geom} material={h.pointsMat} frustumCulled={false} />
      <lineSegments ref={edges} geometry={h.edgeGeom} material={h.edgeMat} frustumCulled={false} />
    </>
  );
}

/* ───────────── zone status rings on the floor ───────────── */

const ringGeom = new THREE.RingGeometry(0.86, 1.0, 64);
const discGeom = new THREE.CircleGeometry(0.86, 48);

interface RingDef {
  zoneId: string;
  pos: Vec3;
  when: number;
  level: Level;
  ringMat: THREE.MeshBasicMaterial;
  discMat: THREE.MeshBasicMaterial;
}
const ringCache = new WeakMap<BranchSimulation, RingDef[]>();
function ringsFor(sim: BranchSimulation): RingDef[] {
  let r = ringCache.get(sim);
  if (r) return r;
  r = sim.zoneCameras.map((c) => ({
    zoneId: c.zoneId,
    pos: [c.target[0], 0.03, c.target[2]] as Vec3,
    when: ({ kitchen: 4.5, "front-counter": 7.5, dining: 10.5, "pickup-bay": 13.2 } as Record<string, number>)[c.zoneId] ?? 14.5,
    level: zoneStatus(sim, c.zoneId).level,
    ringMat: new THREE.MeshBasicMaterial({ color: "#3ccf8e", transparent: true, opacity: 0, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
    discMat: new THREE.MeshBasicMaterial({ color: "#3ccf8e", transparent: true, opacity: 0, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
  }));
  ringCache.set(sim, r);
  return r;
}

function ZoneRings({ sim }: { sim: BranchSimulation }) {
  const groups = useRef<Array<THREE.Group | null>>([]);
  const unlockAt = useRef<number | null>(null);
  useFrame((state) => {
    const rings = ringsFor(sim);
    const st = useLaunch.getState();
    const t = st.phase === "intro" ? st.t : DUR + 5;
    if (st.phase === "unlock" && unlockAt.current === null) unlockAt.current = state.clock.elapsedTime;
    if (st.phase !== "unlock") unlockAt.current = null;
    rings.forEach((r, i) => {
      const g = groups.current[i];
      if (!g) return;
      const live = smooth(r.when - 0.5, r.when + 0.3, t);
      const pulse = st.phase === "intro" ? Math.max(0, 1 - Math.abs(t - r.when) / 1.4) : (Math.sin(state.clock.elapsedTime * 1.4 + i) + 1) * 0.25;
      const unlocking = unlockAt.current !== null ? state.clock.elapsedTime - unlockAt.current : -1;
      const flip = unlocking >= 0 ? smooth(i * 0.08, i * 0.08 + 0.5, unlocking) : 0;
      const color = flip > 0.5 ? "#3ccf8e" : LEVEL_HEX[r.level];
      r.ringMat.color.set(color);
      r.discMat.color.set(color);
      g.scale.setScalar(1 + pulse * 0.35 + (unlocking >= 0 ? Math.max(0, 1 - Math.abs(unlocking - i * 0.08 - 0.3) / 0.4) * 0.5 : 0));
      r.ringMat.opacity = (0.35 + pulse * 0.6) * live * (st.phase === "intro" ? 1 - smooth(DUR - 0.5, DUR + 1, t) * 0.4 : 1);
      r.discMat.opacity = (0.06 + pulse * 0.16) * live;
    });
  });
  const rings = ringsFor(sim);
  return (
    <group>
      {rings.map((r, i) => (
        <group key={r.zoneId} ref={(el) => void (groups.current[i] = el)} position={r.pos}>
          <mesh geometry={ringGeom} material={r.ringMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5} />
          <mesh geometry={discGeom} material={r.discMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4} />
        </group>
      ))}
    </group>
  );
}

/* ───────────── fryer ignition glow ───────────── */

function FryerGlow({ plan }: { plan: FloorPlan }) {
  const lights = useRef<Array<THREE.PointLight | null>>([]);
  const fryers = useMemo(() => plan.equipment.filter((e) => e.type === "fryer").slice(0, 4), [plan]);
  useFrame((state) => {
    const st = useLaunch.getState();
    const t = st.phase === "intro" ? st.t : DUR + 5;
    const on = smooth(3.9, 4.8, t);
    lights.current.forEach((l, i) => {
      if (l) l.intensity = on * (4 + Math.sin(state.clock.elapsedTime * 9 + i * 1.7) * 1.2);
    });
  });
  return (
    <>
      {fryers.map((e, i) => (
        <pointLight key={e.id} ref={(el) => void (lights.current[i] = el)} position={[e.position[0], e.position[1] + e.size[1] + 0.3, e.position[2]]} color="#ff7a26" intensity={0} distance={3.2} decay={2} />
      ))}
    </>
  );
}

/* ───────────── instrumentation rising out of the scene ───────────── */

function Instrumentation({ sim }: { sim: BranchSimulation }) {
  const t = useLaunch((s) => s.t);
  const phase = useLaunch((s) => s.phase);
  const plan = sim.plan;
  const items = useMemo(() => {
    const out: Array<{ id: string; pos: Vec3; text: string; tone: string; at: number }> = [];
    const q = plan.anchors.queueHead;
    const front = zoneStatus(sim, "front-counter");
    out.push({ id: "queue", pos: [q[0], 1.9, q[1]], text: `Queue ${front.metrics[0].display} · longest ${front.metrics[1].display}`, tone: LEVEL_HEX[front.metrics[0].tone], at: 12.2 });
    const fry = plan.workstations.find((w) => w.type === "fryer");
    if (fry) out.push({ id: "fry", pos: [fry.standPoint[0], 1.8, fry.standPoint[1]], text: `Fryers · oil ${zoneStatus(sim, "kitchen").metrics.find((m) => m.key === "oil")?.display ?? "—"}`, tone: "#eceef1", at: 12.6 });
    const pass = plan.equipment.find((e) => e.type === "hot-holding");
    if (pass) out.push({ id: "pass", pos: [pass.position[0], pass.size[1] + 0.5, pass.position[2]], text: `Hot holding ${zoneStatus(sim, "pass").metrics.find((m) => m.key === "holdTemp")?.display ?? "—"}`, tone: "#eceef1", at: 13 });
    const cold = plan.equipment.find((e) => e.type === "walk-in-cold");
    if (cold) out.push({ id: "cold", pos: [cold.position[0], cold.position[1] + 0.6, cold.position[2]], text: `Cold room ${zoneStatus(sim, "cold-room").metrics[0].display}`, tone: LEVEL_HEX[zoneStatus(sim, "cold-room").metrics[0].tone], at: 13.4 });
    const o = sim.activeOrders().slice(0, 2);
    const pz = plan.workstations.find((w) => w.type === "pizza-prep");
    if (pz && o[0]) out.push({ id: "tk", pos: [pz.standPoint[0], 1.7, pz.standPoint[1]], text: `#${o[0].number} · ${Math.max(1, Math.round((sim.t - o[0].createdAt) / 60))} min`, tone: "#3ccf8e", at: 12.9 });
    return out;
  }, [sim, plan]);
  if (phase !== "intro" || t < 12) return null;
  return (
    <>
      {items.map((it) => {
        const k = smooth(it.at, it.at + 0.7, t) * (1 - smooth(DUR - 0.6, DUR + 0.4, t) * 0.6);
        if (k <= 0) return null;
        return (
          <Html key={it.id} position={it.pos} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div className="launch-instrument" style={{ opacity: k, transform: `translateY(${(1 - k) * 14}px)`, borderColor: it.tone }}>
              <span className="launch-instrument-dot" style={{ background: it.tone }} />
              {it.text}
            </div>
          </Html>
        );
      })}
    </>
  );
}

/* ───────────── post-processing by tier ───────────── */

function Post({ tier }: { tier: QualityTier }) {
  const phase = useLaunch((s) => s.phase);
  const { width: W, length: L } = useMemo(() => ({ width: 24, length: 17 }), []);
  const intro = phase === "intro";
  if (tier === "lite" || tier === "video") return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.3} intensity={intro ? 1.05 : phase === "unlock" ? 1.6 : 0.75} radius={0.75} />
      {tier === "cinema" ? <DepthOfField target={[W / 2, 0.8, L * 0.45]} focalLength={0.025} bokehScale={2.6} height={480} /> : <></>}
      {tier === "cinema" ? <ChromaticAberration offset={new THREE.Vector2(0.0007, 0.0005)} radialModulation modulationOffset={0.35} /> : <></>}
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.35} />
      <Vignette eskil={false} offset={0.22} darkness={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  );
}

/* ───────────── clock + scene ───────────── */

function IntroClock({ onEnd }: { onEnd: () => void }) {
  const ended = useRef(false);
  useFrame((_, dtRaw) => {
    const st = useLaunch.getState();
    if (st.phase !== "intro") return;
    if ((window as unknown as { __opsLaunchPaused?: boolean }).__opsLaunchPaused) return;
    const t = st.t + Math.min(dtRaw, 0.1);
    st.setT(t);
    if (t >= DUR + 1.1 && !ended.current) {
      ended.current = true;
      onEnd();
    }
  });
  return null;
}

function Fog() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const scene = get().scene;
    scene.background = new THREE.Color("#03050a");
    scene.fog = new THREE.FogExp2("#03050a", 0.016);
    return () => {
      scene.fog = null;
    };
  }, [get]);
  return null;
}

export default function LaunchScene({ sim, onIntroEnd }: { sim: BranchSimulation; onIntroEnd: () => void }) {
  const tier = useLaunch((s) => s.tier);
  const phase = useLaunch((s) => s.phase);
  const plan = sim.plan;
  useEffect(() => {
    setDoorStateProvider((id) => sim.doors.get(id)?.open ?? false);
    return () => setDoorStateProvider(null);
  }, [sim]);
  // Dev hook for frame capture: window.__opsLaunch.seek(t) renders the intro at a fixed second.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __opsLaunch?: unknown }).__opsLaunch = {
      seek: (t: number) => {
        (window as unknown as { __opsLaunchPaused?: boolean }).__opsLaunchPaused = true;
        useLaunch.getState().setT(t);
      },
      resume: () => {
        (window as unknown as { __opsLaunchPaused?: boolean }).__opsLaunchPaused = false;
      },
      phase: (p: "intro" | "gate" | "unlock") => useLaunch.getState().setPhase(p),
    };
  }, []);
  const dpr = tier === "cinema" ? Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) : tier === "standard" ? 1.5 : 1;
  const lights = phase === "intro" ? undefined : 1;
  return (
    <Canvas dpr={dpr} shadows={false} gl={{ antialias: tier === "lite", powerPreference: "high-performance", preserveDrawingBuffer: true }} camera={{ fov: 38, near: 0.1, far: 300, position: [12, 30, -40] }} onCreated={({ gl }) => (gl.toneMapping = THREE.ACESFilmicToneMapping)}>
      <Fog />
      <Suspense fallback={null}>
        <LightsScaled plan={plan} sim={sim} fixed={lights} />
      </Suspense>
      <IntroLights plan={plan} sim={sim} />
      <FryerGlow plan={plan} />
      <Hologram plan={plan} />
      <ZoneRings sim={sim} />
      <Instrumentation sim={sim} />
      <LaunchRig plan={plan} sim={sim} />
      <IntroClock onEnd={onIntroEnd} />
      <Post tier={tier} />
    </Canvas>
  );
}

/** The twin with its interior lights brought up from darkness as the camera sweeps. */
function LightsScaled({ plan, sim, fixed }: { plan: FloorPlan; sim: BranchSimulation; fixed?: number }) {
  const t = useLaunch((s) => s.t);
  const phase = useLaunch((s) => s.phase);
  const tick = useLaunch((s) => Math.floor(s.t * 4));
  const scale = fixed ?? (phase === "intro" ? 0.02 + 0.98 * smooth(4, 15, t) : 1);
  return <RestaurantModel plan={plan} sim={sim} cutaway={false} environment={false} hour={20} lightsScale={scale} quality="balanced" overlays={false} version={tick} />;
}

export const LAUNCH_TITLE = { name: PLATFORM.name, tagline: PLATFORM.tagline };
