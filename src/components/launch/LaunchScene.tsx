"use client";

import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, SMAA, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { FloorPlan, Vec3 } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import { zoneStatus, type Level } from "@/lib/sim/zones";
import { LAUNCH } from "@/config/launch";
import { PLATFORM } from "@/config/platform";
import { useApp } from "@/store/app";
import { useLaunch, type QualityTier } from "./launchStore";

/**
 * The launch world, as line art. Black; one point of light; the East Legon floor plan draws
 * itself in thin steel lines (walls radiating out from the centre, then the equipment of each
 * zone in turn), a cage of particles settles onto it, zone status rings lock in, order flows
 * run along the real customer, staff and rider paths, a few live instruments rise, and the
 * camera pulls back to the hero angle for the title. The same drawing idles behind the access
 * gate and flips green on unlock. Real-time, native resolution, any aspect, cheap on phones.
 */
const DUR = LAUNCH.intro.durationSec;
const LEVEL_HEX: Record<Level, string> = { ok: "#3ccf8e", watch: "#f5b02e", act: "#f0483e" };
const ACCENT = "#ee1d25";
type Theme = "dark" | "light";
/** One neutral for all line work per theme; the accent only on flows and line tips (light); status only on rings. */
const PALETTE = {
  dark: { bg: "#03050a", line: "#a9bfdc", tip: "#ffffff", wall: 0.78, box: 0.5, grid: 0.085, spark: [1.8, 1.8, 1.8] as const, blending: THREE.AdditiveBlending, bloom: true, vignette: 0.7, grain: 0.16 },
  light: { bg: "#eef1f5", line: "#2a3b57", tip: ACCENT, wall: 0.85, box: 0.62, grid: 0.14, spark: [0.16, 0.22, 0.34] as const, blending: THREE.NormalBlending, bloom: false, vignette: 0.32, grain: 0.1 },
} as const;
const useTheme = () => useApp((s) => s.resolvedTheme) as Theme;
/** When each beat lands (seconds into the intro). */
const BEAT = { walls: [0.8, 4.8] as const, grid: [1.4, 4] as const, kitchen: 4.8, counter: 6.8, dining: 8.6, bay: 10.2, flows: 6.6, chips: 10.6, hero: DUR - 1.4 };
const ZONE_BEAT: Record<string, number> = { kitchen: BEAT.kitchen, "front-counter": BEAT.counter, dining: BEAT.dining, "pickup-bay": BEAT.bay };
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Intro clock for frame code: the intro's second, or "long after" once the gate idles. */
const introT = () => {
  const st = useLaunch.getState();
  return st.phase === "intro" ? st.t : DUR + 5;
};

/* ───────────── line work that draws itself ───────────── */

const lineVert = /* glsl */ `
attribute float aOrder;
varying float vOrder;
varying float vDepth;
void main() {
  vOrder = aOrder;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const lineFrag = /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBoost;
uniform float uDim;
uniform vec3 uTip;
varying float vOrder;
varying float vDepth;
void main() {
  float drawn = 1.0 - smoothstep(uProgress - 0.01, uProgress + 0.002, vOrder);
  float head = (1.0 - smoothstep(0.0, 0.03, abs(vOrder - uProgress))) * step(0.001, uProgress) * (1.0 - step(0.999, uProgress));
  float fog = exp(-vDepth * 0.014);
  float a = (drawn * uOpacity + head * 0.9) * fog * uDim;
  if (a < 0.004) discard;
  vec3 c = mix(uColor, uTip, head * 0.85) * (1.0 + head * 1.6 + uBoost);
  gl_FragColor = vec4(c, a);
}`;

type Seg = [Vec3, Vec3, number, number];
interface Wire {
  geom: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  /** Seconds over which `uProgress` runs 0 → 1. */
  from: number;
  to: number;
}
function wire(segs: Seg[], theme: Theme, opacity: number, from: number, to: number): Wire {
  const pal = PALETTE[theme];
  const pos = new Float32Array(segs.length * 6);
  const ord = new Float32Array(segs.length * 2);
  segs.forEach(([a, b, oa, ob], i) => {
    pos.set(a, i * 6);
    pos.set(b, i * 6 + 3);
    ord[i * 2] = oa;
    ord[i * 2 + 1] = ob;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("aOrder", new THREE.BufferAttribute(ord, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: lineVert,
    fragmentShader: lineFrag,
    uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(pal.line) }, uOpacity: { value: opacity }, uBoost: { value: 0 }, uDim: { value: 1 }, uTip: { value: new THREE.Color(pal.tip) } },
    transparent: true,
    depthWrite: false,
    blending: pal.blending,
    toneMapped: false,
  });
  return { geom, mat, from, to };
}

/** Twelve edges of a box footprint `size` at `p`, turned `rot` about Y; the edges draw one after another. */
function box(p: Vec3, size: Vec3, rot: number, o: number, span: number): Seg[] {
  const [w, h, d] = size;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pt = (lx: number, ly: number, lz: number): Vec3 => [p[0] + c * lx + s * lz, p[1] + ly, p[2] - s * lx + c * lz];
  const x = w / 2;
  const z = d / 2;
  const b = [pt(-x, 0, -z), pt(x, 0, -z), pt(x, 0, z), pt(-x, 0, z)];
  const t = [pt(-x, h, -z), pt(x, h, -z), pt(x, h, z), pt(-x, h, z)];
  const out: Seg[] = [];
  const e = (a: Vec3, bb: Vec3, k: number) => out.push([a, bb, o + (k / 12) * span, o + ((k + 1) / 12) * span]);
  for (let k = 0; k < 4; k++) e(b[k], b[(k + 1) % 4], k);
  for (let k = 0; k < 4; k++) e(b[k], t[k], 4 + k);
  for (let k = 0; k < 4; k++) e(t[k], t[(k + 1) % 4], 8 + k);
  return out;
}

interface Drawing {
  wires: Wire[];
  grid: { geom: THREE.BufferGeometry; mat: THREE.LineBasicMaterial };
}
const drawingCache = new WeakMap<FloorPlan, Partial<Record<Theme, Drawing>>>();
function drawingFor(plan: FloorPlan, sim: BranchSimulation, theme: Theme): Drawing {
  let d = drawingCache.get(plan)?.[theme];
  if (d) return d;
  const pal = PALETTE[theme];
  const { width: W, length: L } = plan.dimensions;
  const cx = W / 2;
  const cz = L / 2;
  const maxR = Math.hypot(cx, cz);

  // Walls: ordered by distance from the centre so the plan radiates outwards; each wall draws along its length.
  const walls: Seg[] = [];
  for (const w of plan.walls) {
    const mx = (w.a[0] + w.b[0]) / 2;
    const mz = (w.a[1] + w.b[1]) / 2;
    const o = (Math.hypot(mx - cx, mz - cz) / maxR) * 0.8;
    const base = w.base ?? 0;
    const a0: Vec3 = [w.a[0], base, w.a[1]];
    const b0: Vec3 = [w.b[0], base, w.b[1]];
    const a1: Vec3 = [w.a[0], w.height, w.a[1]];
    const b1: Vec3 = [w.b[0], w.height, w.b[1]];
    walls.push([a0, b0, o, o + 0.1], [a1, b1, o + 0.04, o + 0.14], [a0, a1, o + 0.1, o + 0.16], [b0, b1, o + 0.14, o + 0.2]);
  }

  // Equipment and tables, grouped by the zone whose cameras watch their room; every zone draws on its beat.
  const zoneOfRoom = new Map<string, string>();
  for (const c of sim.zoneCameras) for (const r of c.roomIds) if (!zoneOfRoom.has(r)) zoneOfRoom.set(r, c.zoneId);
  const items = [
    ...plan.equipment.map((e) => ({ roomId: e.roomId, position: e.position, size: e.size, rotation: e.rotation })),
    ...plan.furniture.map((f) => ({ roomId: f.roomId, position: f.position, size: f.size, rotation: f.rotation })),
  ];
  const byBeat = new Map<number, typeof items>();
  for (const it of items) {
    const when = ZONE_BEAT[zoneOfRoom.get(it.roomId) ?? ""] ?? BEAT.kitchen + 1.1;
    byBeat.set(when, [...(byBeat.get(when) ?? []), it]);
  }
  const wires: Wire[] = [wire(walls, theme, pal.wall, BEAT.walls[0], BEAT.walls[1])];
  for (const [when, list] of byBeat) {
    list.sort((a, b) => a.position[0] + a.position[2] - (b.position[0] + b.position[2]));
    const segs: Seg[] = [];
    list.forEach((it, i) => segs.push(...box(it.position, it.size, it.rotation, (i / list.length) * 0.82, 0.18)));
    wires.push(wire(segs, theme, pal.box, when - 0.2, when + 1.8));
  }

  // A faint 1 m grid under everything: the scientific ground plane.
  const g: number[] = [];
  const pad = 3;
  for (let x = -pad; x <= W + pad; x++) g.push(x, 0, -pad, x, 0, L + pad);
  for (let z = -pad; z <= L + pad; z++) g.push(-pad, 0, z, W + pad, 0, z);
  const gridGeom = new THREE.BufferGeometry();
  gridGeom.setAttribute("position", new THREE.Float32BufferAttribute(g, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: pal.line, transparent: true, opacity: 0, depthWrite: false, blending: pal.blending, toneMapped: false });

  d = { wires, grid: { geom: gridGeom, mat: gridMat } };
  drawingCache.set(plan, { ...drawingCache.get(plan), [theme]: d });
  return d;
}

function Drawing({ plan, sim }: { plan: FloorPlan; sim: BranchSimulation }) {
  const theme = useTheme();
  useFrame((state) => {
    const d = drawingFor(plan, sim, theme);
    const st = useLaunch.getState();
    const t = introT();
    const boost = st.phase === "unlock" ? 0.5 : st.phase === "gate" ? 0.08 + Math.sin(state.clock.elapsedTime * 0.8) * 0.06 : 0;
    // The drawing steps back while the title resolves, and sits quieter behind the gate card.
    const dim = st.phase === "intro" ? 1 - smooth(BEAT.hero - 0.2, BEAT.hero + 1, t) * 0.55 : 0.6;
    for (const w of d.wires) {
      w.mat.uniforms.uProgress.value = smooth(w.from, w.to, t);
      w.mat.uniforms.uBoost.value = boost;
      w.mat.uniforms.uDim.value = dim;
    }
    d.grid.mat.opacity = PALETTE[theme].grid * smooth(BEAT.grid[0], BEAT.grid[1], t) * dim;
  });
  const d = drawingFor(plan, sim, theme);
  return (
    <group>
      {d.wires.map((w, i) => (
        <lineSegments key={`${theme}-${i}`} geometry={w.geom} material={w.mat} frustumCulled={false} />
      ))}
      <lineSegments key={`${theme}-grid`} geometry={d.grid.geom} material={d.grid.mat} frustumCulled={false} />
    </group>
  );
}

/* ───────────── the point of light ───────────── */

const sparkGeom = new THREE.PlaneGeometry(1, 1);
const sparkMats: Partial<Record<Theme, THREE.MeshBasicMaterial>> = {};
const sparkMaterial = (theme: Theme) =>
  (sparkMats[theme] ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(...PALETTE[theme].spark), transparent: true, opacity: 0, map: discSprite(), depthWrite: false, blending: PALETTE[theme].blending, toneMapped: false }));
function Spark({ plan }: { plan: FloorPlan }) {
  const ref = useRef<THREE.Mesh>(null);
  const theme = useTheme();
  useFrame((state) => {
    const t = introT();
    const m = ref.current;
    if (!m) return;
    // Appears out of black, swells as the lines start, then dims to a pilot light once the plan is drawn.
    const k = smooth(0.15, 0.9, t) * (1 - smooth(3, 4.6, t));
    sparkMaterial(theme).opacity = k;
    const s = 0.25 + k * 0.75 + Math.sin(state.clock.elapsedTime * 3) * 0.04;
    m.scale.setScalar(s);
    m.quaternion.copy(state.camera.quaternion);
  });
  return <mesh key={theme} ref={ref} geometry={sparkGeom} material={sparkMaterial(theme)} position={[plan.dimensions.width / 2, 0.4, plan.dimensions.length / 2]} renderOrder={6} />;
}

/* ───────────── camera path ───────────── */

interface Key {
  t: number;
  pos: Vec3;
  target: Vec3;
  fov: number;
}

function keyframes(plan: FloorPlan, sim: BranchSimulation): Key[] {
  const { width: W, length: L } = plan.dimensions;
  const cx = W / 2;
  const cz = L / 2;
  const D = Math.hypot(W, L);
  const at = (angle: number, r: number, h: number): Vec3 => [cx + Math.sin(angle) * r, h, cz + Math.cos(angle) * r];
  const centre: Vec3 = [cx, 0.4, cz];
  let last = -0.7;
  const unwrap = (a: number) => {
    while (a - last > Math.PI) a -= Math.PI * 2;
    while (last - a > Math.PI) a += Math.PI * 2;
    last = a;
    return a;
  };
  // Each zone beat looks across the plan at that zone from outside it, keeping the orbit turning the short way.
  const zone = (id: string, t: number, r: number, h: number, fov: number): Key => {
    const c = sim.zoneCameras.find((z) => z.zoneId === id);
    const tg: Vec3 = c ? [c.target[0], 0.6, c.target[2]] : centre;
    const a = unwrap(c ? Math.atan2(tg[0] - cx, tg[2] - cz) + 0.5 : last + 0.6);
    return { t, pos: at(a, r, h), target: tg, fov };
  };
  const far: Key = { t: 0, pos: at(-0.7, D * 1.35, D * 1.25), target: centre, fov: 34 };
  const over: Key = { t: 2.6, pos: at(unwrap(-0.45), D * 0.95, D * 0.9), target: centre, fov: 36 };
  const keys = [far, over, zone("kitchen", BEAT.kitchen, D * 0.62, D * 0.4, 44), zone("front-counter", BEAT.counter, D * 0.58, D * 0.34, 46), zone("dining", BEAT.dining, D * 0.6, D * 0.36, 46), zone("pickup-bay", BEAT.bay, D * 0.62, D * 0.4, 44)];
  const ha = unwrap(-0.55);
  const hero: Key = { t: BEAT.hero, pos: at(ha, D * 0.95, D * 0.58), target: centre, fov: 40 };
  keys.push(hero, { ...hero, t: DUR + 4, pos: at(ha - 0.06, D * 0.97, D * 0.6) });
  return keys;
}

function LaunchRig({ plan, sim }: { plan: FloorPlan; sim: BranchSimulation }) {
  const keys = useMemo(() => keyframes(plan, sim), [plan, sim]);
  const posCurve = useMemo(() => new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.pos)), false, "centripetal", 0.6), [keys]);
  const tgtCurve = useMemo(() => new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.target)), false, "centripetal", 0.6), [keys]);
  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const tmpT = useMemo(() => new THREE.Vector3(), []);
  const orbit = useRef({ angle: 0, started: false, radius: 20, height: 9, cx: 0, cz: 0 });
  const { width: W, length: L } = plan.dimensions;
  const D = Math.hypot(W, L);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useLaunch.getState();
    const camera = state.camera as THREE.PerspectiveCamera;
    if (st.phase === "intro") {
      const t = st.t;
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i];
      const b = keys[i + 1];
      const f = Math.max(0, Math.min(1, (t - a.t) / Math.max(0.01, b.t - a.t)));
      const u = (i + f) / (keys.length - 1);
      // getPoint (not getPointAt): parameter by keyframe index, so each beat lands on its second.
      posCurve.getPoint(Math.max(0, Math.min(1, u)), tmpP);
      tgtCurve.getPoint(Math.max(0, Math.min(1, u)), tmpT);
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
    // Gate and unlock: a slow orbit around the plan with a breathing height.
    const o = orbit.current;
    if (!o.started) {
      o.started = true;
      o.cx = W / 2;
      o.cz = L / 2;
      o.angle = Math.atan2(camera.position.x - o.cx, camera.position.z - o.cz);
      o.radius = Math.max(D * 0.8, Math.hypot(camera.position.x - o.cx, camera.position.z - o.cz));
      o.height = Math.max(D * 0.5, camera.position.y);
    }
    o.angle += dt * (st.phase === "unlock" ? 0.12 : 0.035);
    const dolly = st.phase === "unlock" ? Math.max(0.78, 1 - dt * 0.5) : 1;
    o.radius *= dolly;
    const y = o.height + Math.sin(state.clock.elapsedTime * 0.35) * 0.35;
    const k = 1 - Math.exp(-dt * 1.4);
    tmpP.set(o.cx + Math.sin(o.angle) * o.radius, y, o.cz + Math.cos(o.angle) * o.radius);
    camera.position.lerp(tmpP, k);
    tmpT.set(o.cx, 0.4, o.cz);
    camera.lookAt(tmpT);
    const fov = 40;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/* ───────────── particles that settle onto the drawing ───────────── */

const N_POINTS = 3200;
interface Holo {
  geom: THREE.BufferGeometry;
  targets: Float32Array;
  starts: Float32Array;
  delays: Float32Array;
  mats: Partial<Record<Theme, THREE.PointsMaterial>>;
}
const holoCache = new WeakMap<FloorPlan, Holo>();
const holoMat = (h: Holo, theme: Theme) =>
  (h.mats[theme] ??= new THREE.PointsMaterial({ color: PALETTE[theme].line, size: 0.09, sizeAttenuation: true, map: discSprite(), alphaTest: 0.02, transparent: true, opacity: 0, depthWrite: false, blending: PALETTE[theme].blending, toneMapped: false }));
let disc: THREE.Texture | null = null;
/** A soft radial disc for sprites (a bare PointsMaterial draws hard squares). */
function discSprite(): THREE.Texture | null {
  if (disc || typeof document === "undefined") return disc;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  disc = new THREE.CanvasTexture(c);
  return disc;
}

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
    delays[i] = 0.4 + rnd() * 3.2;
    i++;
  };
  for (const w of plan.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n = Math.max(2, Math.round(len / 0.5));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      put(w.a[0] + (w.b[0] - w.a[0]) * f, 0.02 + rnd() * w.height, w.a[1] + (w.b[1] - w.a[1]) * f);
    }
  }
  for (const e of plan.equipment) for (let k = 0; k < 6; k++) put(e.position[0] + (rnd() - 0.5) * e.size[0], e.position[1] + e.size[1], e.position[2] + (rnd() - 0.5) * e.size[2]);
  while (i < N_POINTS) put(rnd() * plan.dimensions.width, 0.02 + rnd() * H, rnd() * plan.dimensions.length);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(starts), 3));
  h = {
    geom,
    targets,
    starts,
    delays,
    mats: {},
  };
  holoCache.set(plan, h);
  return h;
}

function Hologram({ plan }: { plan: FloorPlan }) {
  const ref = useRef<THREE.Points>(null);
  const theme = useTheme();
  useFrame(() => {
    const h = holoFor(plan);
    const t = introT();
    const p = ref.current;
    if (!p) return;
    const arr = h.geom.attributes.position.array as Float32Array;
    for (let i = 0; i < N_POINTS; i++) {
      const k = smooth(h.delays[i], h.delays[i] + 1.8, t);
      const e = 1 - Math.pow(1 - k, 3);
      arr[i * 3] = h.starts[i * 3] + (h.targets[i * 3] - h.starts[i * 3]) * e;
      arr[i * 3 + 1] = h.starts[i * 3 + 1] + (h.targets[i * 3 + 1] - h.starts[i * 3 + 1]) * e;
      arr[i * 3 + 2] = h.starts[i * 3 + 2] + (h.targets[i * 3 + 2] - h.starts[i * 3 + 2]) * e;
    }
    h.geom.attributes.position.needsUpdate = true;
    const m = holoMat(h, theme);
    m.opacity = 0.7 * smooth(0.3, 1.6, t) * (1 - smooth(5, 7.4, t));
    p.visible = m.opacity > 0.01;
  });
  const h = holoFor(plan);
  return <points key={theme} ref={ref} geometry={h.geom} material={holoMat(h, theme)} frustumCulled={false} />;
}

/* ───────────── zone status rings ───────────── */

const ringGeom = new THREE.RingGeometry(1.15, 1.3, 64);
const discGeom = new THREE.CircleGeometry(1.15, 48);
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
    when: ZONE_BEAT[c.zoneId] ?? BEAT.bay + 0.8,
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
    const t = introT();
    if (st.phase === "unlock" && unlockAt.current === null) unlockAt.current = state.clock.elapsedTime;
    if (st.phase !== "unlock") unlockAt.current = null;
    rings.forEach((r, i) => {
      const g = groups.current[i];
      if (!g) return;
      const live = smooth(r.when - 0.4, r.when + 0.3, t);
      const pulse = st.phase === "intro" ? Math.max(0, 1 - Math.abs(t - r.when) / 1.4) : (Math.sin(state.clock.elapsedTime * 1.4 + i) + 1) * 0.25;
      const unlocking = unlockAt.current !== null ? state.clock.elapsedTime - unlockAt.current : -1;
      const flip = unlocking >= 0 ? smooth(i * 0.08, i * 0.08 + 0.5, unlocking) : 0;
      const color = flip > 0.5 ? "#3ccf8e" : LEVEL_HEX[r.level];
      r.ringMat.color.set(color);
      r.discMat.color.set(color);
      g.scale.setScalar(1 + pulse * 0.35 + (unlocking >= 0 ? Math.max(0, 1 - Math.abs(unlocking - i * 0.08 - 0.3) / 0.4) * 0.5 : 0));
      const dim = st.phase === "intro" ? 1 - smooth(BEAT.hero - 0.2, BEAT.hero + 1, t) * 0.5 : 1;
      r.ringMat.opacity = (0.35 + pulse * 0.6) * live * dim;
      r.discMat.opacity = (0.05 + pulse * 0.14) * live * dim;
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

/* ───────────── flows: dots running the real paths ───────────── */

const DOTS_PER_PATH = 7;
interface Flows {
  curves: Array<{ curve: THREE.CatmullRomCurve3; speed: number }>;
  geom: THREE.BufferGeometry;
  mats: Partial<Record<Theme, THREE.PointsMaterial>>;
}
const flowCache = new WeakMap<FloorPlan, Flows>();
const flowMat = (f: Flows, theme: Theme) =>
  (f.mats[theme] ??= new THREE.PointsMaterial({ color: ACCENT, size: 0.26, sizeAttenuation: true, map: discSprite(), alphaTest: 0.02, transparent: true, opacity: 0, depthWrite: false, blending: PALETTE[theme].blending, toneMapped: false }));
function flowsFor(plan: FloorPlan): Flows {
  let f = flowCache.get(plan);
  if (f) return f;
  const curves = plan.navigationPaths
    .filter((p) => p.points.length >= 2)
    .map((p) => ({
      curve: new THREE.CatmullRomCurve3(
        p.points.map(([x, z]) => new THREE.Vector3(x, 0.08, z)),
        false,
        "centripetal",
      ),
      speed: p.kind === "delivery" ? 0.11 : p.kind === "staff" ? 0.14 : 0.08,
    }));
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(curves.length * DOTS_PER_PATH * 3), 3));
  f = { curves, geom, mats: {} };
  flowCache.set(plan, f);
  return f;
}
function FlowDots({ plan }: { plan: FloorPlan }) {
  const ref = useRef<THREE.Points>(null);
  const theme = useTheme();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const f = flowsFor(plan);
    const t = introT();
    const p = ref.current;
    if (!p) return;
    const arr = f.geom.attributes.position.array as Float32Array;
    const clock = state.clock.elapsedTime;
    f.curves.forEach((c, ci) => {
      for (let k = 0; k < DOTS_PER_PATH; k++) {
        const u = (clock * c.speed + k / DOTS_PER_PATH + ci * 0.13) % 1;
        c.curve.getPointAt(u, tmp);
        const j = (ci * DOTS_PER_PATH + k) * 3;
        arr[j] = tmp.x;
        arr[j + 1] = tmp.y;
        arr[j + 2] = tmp.z;
      }
    });
    f.geom.attributes.position.needsUpdate = true;
    const m = flowMat(f, theme);
    m.opacity = 0.9 * smooth(BEAT.flows, BEAT.flows + 1.2, t);
    p.visible = m.opacity > 0.01;
  });
  const f = flowsFor(plan);
  return <points key={theme} ref={ref} geometry={f.geom} material={flowMat(f, theme)} frustumCulled={false} />;
}

/* ───────────── instrumentation rising out of the drawing ───────────── */

function Instrumentation({ sim }: { sim: BranchSimulation }) {
  const t = useLaunch((s) => s.t);
  const phase = useLaunch((s) => s.phase);
  const plan = sim.plan;
  const items = useMemo(() => {
    const out: Array<{ id: string; pos: Vec3; text: string; tone: string; at: number }> = [];
    const q = plan.anchors.queueHead;
    const front = zoneStatus(sim, "front-counter");
    out.push({ id: "queue", pos: [q[0], 2.2, q[1]], text: `Queue ${front.metrics[0].display} · longest ${front.metrics[1].display}`, tone: LEVEL_HEX[front.metrics[0].tone], at: BEAT.chips });
    const fry = plan.workstations.find((w) => w.type === "fryer");
    if (fry) out.push({ id: "fry", pos: [fry.standPoint[0], 2.4, fry.standPoint[1]], text: `Fryers · oil ${zoneStatus(sim, "kitchen").metrics.find((m) => m.key === "oil")?.display ?? "—"}`, tone: "#eceef1", at: BEAT.chips + 0.35 });
    const cold = plan.equipment.find((e) => e.type === "walk-in-cold");
    if (cold) out.push({ id: "cold", pos: [cold.position[0], cold.size[1] + 1, cold.position[2]], text: `Cold room ${zoneStatus(sim, "cold-room").metrics[0].display}`, tone: LEVEL_HEX[zoneStatus(sim, "cold-room").metrics[0].tone], at: BEAT.chips + 0.7 });
    const o = sim.activeOrders()[0];
    if (o) out.push({ id: "tk", pos: [plan.anchors.pickup[0], 2.2, plan.anchors.pickup[1]], text: `#${o.number} · ${Math.max(1, Math.round((sim.t - o.createdAt) / 60))} min`, tone: "#3ccf8e", at: BEAT.chips + 1 });
    return out;
  }, [sim, plan]);
  if (phase !== "intro" || t < BEAT.chips - 0.2) return null;
  return (
    <>
      {items.map((it) => {
        const k = smooth(it.at, it.at + 0.7, t) * (1 - smooth(BEAT.hero - 0.4, BEAT.hero + 0.8, t) * 0.85);
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

/* ───────────── post, clock, scene ───────────── */

function Post({ tier }: { tier: QualityTier }) {
  const phase = useLaunch((s) => s.phase);
  const pal = PALETTE[useTheme()];
  if (tier === "lite" || tier === "none") return null;
  return (
    <EffectComposer multisampling={0}>
      {pal.bloom ? <Bloom mipmapBlur luminanceThreshold={0.55} luminanceSmoothing={0.35} intensity={phase === "unlock" ? 1.3 : 0.8} radius={0.8} /> : <></>}
      {tier === "cinema" ? <ChromaticAberration offset={new THREE.Vector2(0.00022, 0.00016)} radialModulation modulationOffset={0.4} /> : <></>}
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={pal.grain} />
      <Vignette eskil={false} offset={0.2} darkness={pal.vignette} />
      <SMAA />
    </EffectComposer>
  );
}

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

function Background() {
  const get = useThree((s) => s.get);
  const bg = PALETTE[useTheme()].bg;
  useEffect(() => {
    const scene = get().scene;
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.FogExp2(bg, 0.012);
    return () => {
      scene.fog = null;
    };
  }, [get, bg]);
  return null;
}

export default function LaunchScene({ sim, onIntroEnd }: { sim: BranchSimulation; onIntroEnd: () => void }) {
  const tier = useLaunch((s) => s.tier);
  const plan = sim.plan;
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
  return (
    <Canvas dpr={dpr} shadows={false} gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }} camera={{ fov: 34, near: 0.1, far: 400, position: [12, 40, -40] }} onCreated={({ gl }) => (gl.toneMapping = THREE.NoToneMapping)}>
      <Background />
      <Drawing plan={plan} sim={sim} />
      <Spark plan={plan} />
      <Hologram plan={plan} />
      <ZoneRings sim={sim} />
      <FlowDots plan={plan} />
      <Instrumentation sim={sim} />
      <LaunchRig plan={plan} sim={sim} />
      <IntroClock onEnd={onIntroEnd} />
      <Post tier={tier} />
    </Canvas>
  );
}

export const LAUNCH_TITLE = { name: PLATFORM.name, tagline: PLATFORM.tagline };
