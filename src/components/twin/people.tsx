"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { Agent } from "@/lib/sim/types";
import { BRAND, M, PANTS, SHIRTS, SKIN } from "./materials";
import type { AssetEntry } from "./modelAssets";
import { G } from "./parts";
import { usePropSet, type PropSet } from "./propAssets";
import { drawnAgents } from "@/components/cameras/replay";

/**
 * Blender-built people (blender/build_people.py → public/models/characters/people.glb).
 *
 * The body is a rigid-part rig: every part (head, torso variants, pelvis, upper arm, forearm,
 * hand, thigh, shin, foot, hair / cap / helmet / apron / delivery box) is its own mesh with its
 * pivot at a joint. Each frame the pose of every agent is computed from its simulation state
 * (walk / carry / work / clean / sit / idle) and written straight into one InstancedMesh per
 * part, so the whole crowd costs ~25 draw calls (+ shadow pass) whatever the head-count.
 *
 * Outfits cost nothing: each vertex stores a palette slot (COLOR_0.r), baked AO (.g) and a
 * roughness override (.b); every instance carries its own 8-colour palette (skin, top, bottom,
 * shoes, hair, accent, forearm, shin) that a small shader patch decodes.
 */

export interface RigSpec {
  joints: Record<string, [number, number, number]>;
  armSplay: number;
  parts: Record<string, string>;
}
export type PeopleAsset = AssetEntry & { rig?: RigSpec };

/* ───────────── outfits ───────────── */

// Palette slots (keep in sync with blender/build_people.py).
const S_SKIN = 0;
const S_TOP = 1;
const S_BOTTOM = 2;
const S_SHOES = 3;
const S_HAIR = 4;
const S_ACCENT = 5;
const S_FOREARM = 6;
const S_SHIN = 7;

interface Outfit {
  parts: string[];
  pal: number[];
  height: number;
}

const hex = (h: string) => parseInt(h.slice(1), 16);
const SHOES = ["#e8e8e8", "#1b1c1f", "#8a5a3c", "#3b2a20", "#c9ccd1", "#2f4a7a"];
const HELMETS = ["#1b1c1f", "#f2f2f2", "#c0392b", "#1b1c1f"];
const LIMBS = ["upper_arm", "forearm", "hand", "thigh", "shin", "foot"];

export function outfitFor(a: Agent): Outfit {
  const r = (n: number) => ((a.seed * 9301 + n * 49297) % 233280) / 233280;
  const pick = <T,>(list: readonly T[], n: number) => list[Math.floor(r(n) * list.length) % list.length];
  const skin = pick(SKIN, 1);
  const hair = r(9) > 0.8 ? "#3b2a20" : "#141414";
  const pal = new Array<number>(8).fill(0);
  const set = (slot: number, c: string) => (pal[slot] = hex(c));
  set(S_SKIN, skin);
  set(S_HAIR, hair);
  set(S_FOREARM, skin);
  if (a.kind === "staff") {
    const role = a.role;
    const top = role === "cashier" ? BRAND.red : role === "supervisor" ? "#1d1f24" : "#d61a20";
    set(S_TOP, top);
    set(S_BOTTOM, "#1b1c1f");
    set(S_SHIN, "#1b1c1f");
    set(S_SHOES, "#1b1c1f");
    set(S_ACCENT, role === "supervisor" ? BRAND.yellow : "#1b1c1f");
    const apron = role !== "cashier" && role !== "supervisor";
    const parts = ["head", r(15) > 0.5 ? "hair_bun" : "hair_short", "cap", "torso_polo", "pelvis", ...(apron ? ["apron_bib", "apron_waist"] : [])];
    return { parts, pal, height: 0.95 + r(2) * 0.1 };
  }
  if (a.kind === "rider") {
    const green = r(3) > 0.5;
    const jacket = green ? "#1f9d55" : "#2b2d31";
    set(S_TOP, jacket);
    set(S_FOREARM, jacket);
    set(S_BOTTOM, "#23262b");
    set(S_SHIN, "#23262b");
    set(S_SHOES, "#1b1c1f");
    set(S_HAIR, pick(HELMETS, 16)); // the helmet takes the hair slot
    set(S_ACCENT, green ? jacket : BRAND.red); // insulated delivery box
    return { parts: ["head", "helmet", "torso_jacket", "pelvis", "delivery_box"], pal, height: 1 };
  }
  // customers
  const style = r(10);
  const blouse = style > 0.66;
  const female = blouse || r(11) > 0.72;
  const torso = blouse ? "torso_blouse" : style < 0.42 ? "torso_tee" : "torso_shirt";
  const skirt = female && r(12) > 0.45;
  // A brown top over dark skin reads as bare-chested from the dollhouse: swap it for a contrasting one.
  const top = pick(SHIRTS, 4) === "#8a5a3c" ? "#c0392b" : pick(SHIRTS, 4);
  const bottom = skirt ? pick(SHIRTS, 17) : pick(PANTS, 5);
  set(S_TOP, top);
  set(S_BOTTOM, bottom);
  set(S_SHOES, pick(SHOES, 18));
  set(S_FOREARM, torso === "torso_shirt" && r(14) > 0.4 ? top : skin);
  set(S_SHIN, skirt || (!female && r(13) > 0.84) ? skin : bottom);
  const capped = r(6) > 0.85;
  set(S_ACCENT, capped ? pick(SHIRTS, 7) : pick(SHIRTS, 19));
  let head: string[];
  if (capped) head = ["hair_short", "cap"];
  else if (female) head = [pick(["hair_bun", "headwrap", "hair_afro", "hair_bun", "hair_short"], 20)];
  else head = r(20) > 0.88 ? [] : [r(21) > 0.8 ? "hair_afro" : "hair_short"];
  return { parts: ["head", ...head, torso, skirt ? "pelvis_skirt" : "pelvis"], pal, height: 0.92 + r(8) * 0.14 };
}

/* ───────────── carried items ───────────── */

type Hold = "front" | "hand" | "hang";
const CARRY: Record<string, { prop: string; hold: Hold; color: string; box: [number, number, number] }> = {
  pizza: { prop: "pizza-tray", hold: "front", color: "#d9a25a", box: [0.34, 0.03, 0.34] },
  box: { prop: "pizza-box", hold: "front", color: "#f7f3ea", box: [0.36, 0.05, 0.36] },
  chicken: { prop: "chicken-tray", hold: "front", color: "#b8691f", box: [0.3, 0.06, 0.2] },
  crate: { prop: "crate", hold: "front", color: "#3c7dd9", box: [0.4, 0.22, 0.3] },
  rice: { prop: "rice-pack", hold: "front", color: "#d8642a", box: [0.2, 0.08, 0.15] },
  side: { prop: "side-cup", hold: "hand", color: "#e3a33b", box: [0.09, 0.1, 0.09] },
  drink: { prop: "drink-bottle", hold: "hand", color: "#c0392b", box: [0.066, 0.2, 0.066] },
  bag: { prop: "takeaway-bag", hold: "hang", color: "#f3efe6", box: [0.26, 0.33, 0.15] },
};
export const CARRY_PROPS = [...new Set(Object.values(CARRY).map((c) => c.prop))];

/* ───────────── shader: palette decode ───────────── */

let personMat: THREE.MeshStandardMaterial | null = null;
function personMaterial() {
  if (personMat) return personMat;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
attribute vec4 aSlot;
attribute vec4 aPalA;
attribute vec4 aPalB;
varying vec3 vPersonColor;
varying float vPersonRough;
vec3 pmcmUnpack(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  vec3 c = vec3(r, g, b) / 255.0;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
{
  float slot = floor(aSlot.x * 15.0 + 0.5);
  // 13..15 are darker shades of skin / top / accent
  float base = slot < 8.0 ? slot : (slot == 13.0 ? 0.0 : (slot == 14.0 ? 1.0 : (slot == 15.0 ? 5.0 : -1.0)));
  vec3 col;
  if (base < 0.0) {
    col = slot == 8.0 ? vec3(0.007) : slot == 9.0 ? vec3(0.888, 0.888, 0.855) : slot == 10.0 ? vec3(0.855, 0.012, 0.018)
        : slot == 11.0 ? vec3(1.0, 0.658, 0.0) : vec3(0.012, 0.02, 0.033);
  } else {
    float p = base < 4.0 ? (base < 2.0 ? (base < 1.0 ? aPalA.x : aPalA.y) : (base < 3.0 ? aPalA.z : aPalA.w))
                         : (base < 6.0 ? (base < 5.0 ? aPalB.x : aPalB.y) : (base < 7.0 ? aPalB.z : aPalB.w));
    col = pmcmUnpack(p);
  }
  col *= slot == 13.0 ? 0.45 : slot == 14.0 ? 0.55 : slot == 15.0 ? 0.6 : 1.0;
  vPersonColor = col * aSlot.y;
  float rough = slot == 0.0 ? 0.55 : slot == 3.0 ? 0.45 : slot == 4.0 ? 0.95 : slot >= 8.0 ? 0.5 : 0.82;
  vPersonRough = aSlot.z > 0.004 ? aSlot.z : rough;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPersonColor;\nvarying float vPersonRough;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( vPersonColor, opacity );")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vPersonRough;");
  };
  m.customProgramCacheKey = () => "pmcm-person-v1";
  personMat = m;
  return m;
}

/* ───────────── rig + pose ───────────── */

const JN = ["pelvis", "torso", "head", "hip", "hip", "knee", "knee", "ankle", "ankle", "shoulder", "shoulder", "elbow", "elbow", "wrist", "wrist"] as const;
const J_PELVIS = 0;
const J_TORSO = 1;
const J_HEAD = 2;
const J_HIP = 3; // +0 left (+x), +1 right
const J_KNEE = 5;
const J_ANKLE = 7;
const J_SHOULDER = 9;
const J_ELBOW = 11;
const J_WRIST = 13;
const PAIRED = new Set(["hip", "knee", "ankle", "shoulder", "elbow", "wrist"]);
const jointIndex = (joint: string, side: number) => JN.indexOf(joint as (typeof JN)[number]) + (PAIRED.has(joint) && side < 0 ? 1 : 0);

interface Pose {
  bodyY: number;
  sway: number;
  twist: number;
  lean: number;
  headYaw: number;
  headPitch: number;
  hip: [number, number];
  knee: [number, number];
  ankle: [number, number];
  sh: [number, number];
  shZ: [number, number];
  el: [number, number];
  wr: [number, number];
}

interface AgentState {
  x: number;
  z: number;
  heading: number;
  phase: number;
  outfit: Outfit;
  root: THREE.Matrix4;
  jm: THREE.Matrix4[];
  pose: Pose;
}

const newPose = (): Pose => ({ bodyY: 0, sway: 0, twist: 0, lean: 0, headYaw: 0, headPitch: 0, hip: [0, 0], knee: [0, 0], ankle: [0, 0], sh: [0, 0], shZ: [0, 0], el: [0, 0], wr: [0, 0] });

/** Joint rotations for the agent's current animation (same states the procedural people used). */
function poseAgent(a: Agent, st: AgentState, H: number, t: number) {
  const p = st.pose;
  const moving = a.anim === "walk" || a.anim === "carry";
  const ph = st.phase;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  p.bodyY = 0;
  p.sway = 0;
  p.twist = 0;
  p.lean = 0;
  p.headYaw = 0;
  p.headPitch = 0;
  p.hip[0] = p.hip[1] = p.knee[0] = p.knee[1] = p.ankle[0] = p.ankle[1] = 0;
  p.shZ[0] = p.shZ[1] = 0;
  p.wr[0] = p.wr[1] = 0;
  if (moving) {
    p.bodyY = Math.abs(c) * 0.03;
    p.hip[0] = 0.5 * s;
    p.hip[1] = -0.5 * s;
    p.knee[0] = 0.08 + 0.7 * Math.max(0, -c);
    p.knee[1] = 0.08 + 0.7 * Math.max(0, c);
    p.ankle[0] = -0.3 * p.knee[0] + 0.15 * Math.max(0, s);
    p.ankle[1] = -0.3 * p.knee[1] + 0.15 * Math.max(0, -s);
    p.sh[0] = -0.42 * s;
    p.sh[1] = 0.42 * s;
    p.el[0] = -0.22 - 0.18 * Math.max(0, s);
    p.el[1] = -0.22 - 0.18 * Math.max(0, -s);
    p.twist = 0.06 * s;
  } else if (a.anim === "sit") {
    p.bodyY = 0.52 / H - 0.905;
    p.hip[0] = p.hip[1] = -1.5;
    p.knee[0] = p.knee[1] = 1.45;
    p.ankle[0] = p.ankle[1] = 0.05;
    p.sh[0] = p.sh[1] = -0.62;
    p.el[0] = p.el[1] = -0.75;
    p.headPitch = 0.12 + Math.sin(t * 0.5 + a.seed) * 0.08;
    p.headYaw = Math.sin(t * 0.3 + a.seed) * 0.35;
  } else if (a.anim === "work") {
    p.lean = 0.12;
    p.headPitch = 0.28;
    p.sh[0] = -0.72 + s * 0.2;
    p.sh[1] = -0.72 - s * 0.2;
    p.el[0] = -0.65 - c * 0.12;
    p.el[1] = -0.65 + c * 0.12;
    p.wr[0] = p.wr[1] = 0.25;
    p.knee[0] = p.knee[1] = 0.05;
  } else if (a.anim === "clean") {
    p.lean = 0.28;
    p.headPitch = 0.3;
    p.sh[1] = -0.85;
    p.el[1] = -0.35;
    p.shZ[1] = s * 0.45;
    p.sh[0] = -0.25;
    p.el[0] = -0.2;
    p.knee[0] = p.knee[1] = 0.12;
    p.hip[0] = p.hip[1] = -0.08;
  } else {
    // idle / wait: weight shift, breathing, looking around
    p.sway = Math.sin(ph * 0.5) * 0.02;
    p.sh[0] = s * 0.03;
    p.sh[1] = -s * 0.03;
    p.el[0] = p.el[1] = -0.12;
    p.headYaw = Math.sin(t * 0.35 + a.seed) * 0.35;
    p.headPitch = a.anim === "wait" ? 0.05 : 0;
  }
  const carry = a.carrying ? CARRY[a.carrying] : undefined;
  if (carry?.hold === "front") {
    p.sh[0] = p.sh[1] = -0.55;
    p.el[0] = p.el[1] = -0.78;
    p.wr[0] = p.wr[1] = 0.35;
    p.shZ[0] = p.shZ[1] = 0.04;
  } else if (carry?.hold === "hand") {
    p.sh[1] = -0.3;
    p.el[1] = -1.15;
    p.wr[1] = 0;
  } else if (carry?.hold === "hang") {
    p.sh[1] *= 0.35;
    p.el[1] = -0.08;
    p.shZ[1] = 0.12;
  }
}

/* ───────────── layer ───────────── */

interface PartMesh {
  name: string;
  joint: string;
  paired: boolean;
  mesh: THREE.InstancedMesh;
  offset: THREE.Matrix4;
  palA: THREE.InstancedBufferAttribute;
  palB: THREE.InstancedBufferAttribute;
  n: number;
}

interface CarryMesh {
  mesh: THREE.InstancedMesh;
  node: THREE.Matrix4;
  size: [number, number, number];
  n: number;
}

const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const local = new THREE.Matrix4();
const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();

function setLocal(m: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  tmpE.set(rx, ry, rz, "XYZ");
  m.makeRotationFromEuler(tmpE);
  m.setPosition(x, y, z);
  return m;
}

const shadowMat = new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.18, depthWrite: false });
const pickMat = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Owns the instanced meshes of one people layer and writes every agent's pose into them each
 * frame. A plain class (not hook state) because it is mutated 60 times a second.
 */
class PeopleRuntime {
  readonly group = new THREE.Group();
  readonly pick: THREE.InstancedMesh;
  readonly ids: string[] = [];
  private parts = new Map<string, PartMesh>();
  private carry = new Map<string, CarryMesh>();
  private blobs: THREE.InstancedMesh;
  private ring: THREE.Mesh;

  constructor(
    scene: THREE.Object3D,
    private rig: RigSpec,
    readonly cap: number,
    props: PropSet,
  ) {
    scene.updateMatrixWorld(true);
    const mat = personMaterial();
    scene.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      const name = src.name in rig.parts ? src.name : (src.parent?.name ?? "");
      const joint = rig.parts[name];
      if (!joint) return;
      const paired = PAIRED.has(joint);
      const n = paired ? cap * 2 : cap;
      // Own geometry wrapper: shares the cached vertex buffers, adds per-instance palettes.
      const sg = src.geometry;
      const g = new THREE.BufferGeometry();
      g.setIndex(sg.index);
      g.setAttribute("position", sg.getAttribute("position"));
      g.setAttribute("normal", sg.getAttribute("normal"));
      g.setAttribute("aSlot", sg.getAttribute("color"));
      const palA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const palB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aPalA", palA);
      g.setAttribute("aPalB", palB);
      const mesh = this.instanced(g, mat, n, true);
      mesh.name = `person:${name}`;
      const j = rig.joints[joint];
      const offset = new THREE.Matrix4().makeTranslation(-j[0], -j[1], -j[2]).multiply(src.matrixWorld);
      this.parts.set(name, { name, joint, paired, mesh, offset, palA, palB, n: 0 });
    });
    const byProp = new Map<string, CarryMesh>();
    for (const [kind, spec] of Object.entries(CARRY)) {
      const prop = props[spec.prop];
      const key = prop ? spec.prop : `box:${kind}`;
      let cm = byProp.get(key);
      if (!cm) {
        // Missing prop model: a plain coloured box of the old size.
        const node = prop ? prop.node : new THREE.Matrix4().makeTranslation(0, spec.box[1] / 2, 0).scale(new THREE.Vector3(...spec.box));
        const mesh = this.instanced(prop ? prop.geometry : G.box, prop ? prop.material : M.plastic(spec.color), cap, true);
        cm = { mesh, node, size: prop ? prop.size : spec.box, n: 0 };
        byProp.set(key, cm);
      }
      this.carry.set(kind, cm);
    }
    this.blobs = this.instanced(G.circle, shadowMat, cap, false);
    this.pick = new THREE.InstancedMesh(G.capsule, pickMat, cap);
    this.pick.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pick.frustumCulled = false;
    this.pick.count = 0;
    this.ring = new THREE.Mesh(G.ring, M.emissive("#FFD400", 2));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private instanced(g: THREE.BufferGeometry, m: THREE.Material, n: number, shadow: boolean) {
    const mesh = new THREE.InstancedMesh(g, m, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // instances move every frame; the layer is always near the camera
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }

  dispose() {
    for (const p of this.parts.values()) {
      p.mesh.geometry.dispose();
      p.mesh.dispose();
    }
    for (const c of new Set(this.carry.values())) c.mesh.dispose();
    this.blobs.dispose();
    this.pick.dispose();
  }

  /** Poses every agent; returns the capacity needed when the crowd outgrows this layer, else 0. */
  frame(sim: BranchSimulation, states: Map<string, AgentState>, t: number, dt: number, selectedId?: string | null): number {
    const { parts, carry, blobs, pick, ring, ids, rig } = this;
    const agents = drawnAgents(sim) ?? sim.agents;
    let live = 0;
    for (const a of agents) if (!a.gone) live++;
    if (live > this.cap) return Math.max(this.cap * 2, Math.ceil(live / 32) * 32);
    for (const p of parts.values()) p.n = 0;
    for (const c of carry.values()) c.n = 0;
    ring.visible = false;
    let n = 0;
    const k = 1 - Math.exp(-dt * 14);
    const kh = 1 - Math.exp(-dt * 10);
    const J = rig.joints;
    for (const a of agents) {
      if (a.gone) continue;
      let st = states.get(a.id);
      if (!st) {
        st = { x: a.pos[0], z: a.pos[1], heading: a.heading, phase: a.seed % 100, outfit: outfitFor(a), root: new THREE.Matrix4(), jm: JN.map(() => new THREE.Matrix4()), pose: newPose() };
        states.set(a.id, st);
      }
      // Ease toward the simulated position (engine steps are 0.25 s of sim time).
      const [x, z] = a.pos;
      const dx = x - st.x;
      const dz = z - st.z;
      if (dx * dx + dz * dz > 9) {
        st.x = x;
        st.z = z;
      } else {
        st.x += dx * k;
        st.z += dz * k;
      }
      const moving = a.anim === "walk" || a.anim === "carry";
      let target = a.heading;
      if (!moving && a.look) target = Math.atan2(a.look[0] - x, a.look[1] - z);
      let diff = target - st.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      st.heading += diff * kh;
      st.phase += dt * (moving ? 7.5 * a.speed : a.anim === "work" ? 6 : a.anim === "clean" ? 4 : 1.5);

      const H = st.outfit.height;
      poseAgent(a, st, H, t);
      const p = st.pose;
      const jm = st.jm;
      // root (position, heading, height) → pelvis → torso → head; legs hang off the pelvis, arms off the torso
      tmpQ.setFromAxisAngle(UP, st.heading);
      st.root.compose(tmpV.set(st.x, 0, st.z), tmpQ, tmpS.set(H, H, H));
      setLocal(local, 0, p.bodyY + J.pelvis[1], 0, 0, p.twist * 0.4, p.sway);
      jm[J_PELVIS].multiplyMatrices(st.root, local);
      setLocal(local, J.torso[0] - J.pelvis[0], J.torso[1] - J.pelvis[1], J.torso[2] - J.pelvis[2], p.lean, -p.twist, 0);
      jm[J_TORSO].multiplyMatrices(jm[J_PELVIS], local);
      setLocal(local, J.head[0] - J.torso[0], J.head[1] - J.torso[1], J.head[2] - J.torso[2], p.headPitch - p.lean * 0.5, p.headYaw + p.twist * 0.5, 0);
      jm[J_HEAD].multiplyMatrices(jm[J_TORSO], local);
      for (let si = 0; si < 2; si++) {
        const side = si === 0 ? 1 : -1;
        setLocal(local, J.hip[0] * side - J.pelvis[0], J.hip[1] - J.pelvis[1], J.hip[2] - J.pelvis[2], p.hip[si], 0, 0);
        jm[J_HIP + si].multiplyMatrices(jm[J_PELVIS], local);
        setLocal(local, 0, J.knee[1] - J.hip[1], J.knee[2] - J.hip[2], p.knee[si], 0, 0);
        jm[J_KNEE + si].multiplyMatrices(jm[J_HIP + si], local);
        setLocal(local, 0, J.ankle[1] - J.knee[1], J.ankle[2] - J.knee[2], p.ankle[si], 0, 0);
        jm[J_ANKLE + si].multiplyMatrices(jm[J_KNEE + si], local);
        setLocal(local, J.shoulder[0] * side - J.torso[0], J.shoulder[1] - J.torso[1], J.shoulder[2] - J.torso[2], p.sh[si], 0, (rig.armSplay + p.shZ[si]) * side);
        jm[J_SHOULDER + si].multiplyMatrices(jm[J_TORSO], local);
        setLocal(local, 0, J.elbow[1] - J.shoulder[1], J.elbow[2] - J.shoulder[2], p.el[si], 0, 0);
        jm[J_ELBOW + si].multiplyMatrices(jm[J_SHOULDER + si], local);
        setLocal(local, 0, J.wrist[1] - J.elbow[1], J.wrist[2] - J.elbow[2], p.wr[si], 0, 0);
        jm[J_WRIST + si].multiplyMatrices(jm[J_ELBOW + si], local);
      }

      // body + clothing parts
      const pal = st.outfit.pal;
      const emit = (part: PartMesh, joint: number) => {
        const i = part.n++;
        tmpM.multiplyMatrices(jm[joint], part.offset);
        part.mesh.setMatrixAt(i, tmpM);
        part.palA.setXYZW(i, pal[0], pal[1], pal[2], pal[3]);
        part.palB.setXYZW(i, pal[4], pal[5], pal[6], pal[7]);
      };
      for (const name of st.outfit.parts) {
        const part = parts.get(name);
        if (part) emit(part, jointIndex(part.joint, 1));
      }
      for (const name of LIMBS) {
        const part = parts.get(name);
        if (!part) continue;
        emit(part, jointIndex(part.joint, 1));
        emit(part, jointIndex(part.joint, -1));
      }

      // carried item
      const spec = a.carrying ? CARRY[a.carrying] : undefined;
      const cm = a.carrying ? carry.get(a.carrying) : undefined;
      if (spec && cm) {
        const h = cm.size[1];
        if (spec.hold === "front") {
          // held in front of the waist, centre ~8 cm above the torso pivot
          setLocal(local, 0, 0.08 - h / 2, 0.3, 0, 0, 0);
          tmpM.multiplyMatrices(jm[J_TORSO], local);
        } else {
          // right hand; undo the arm's rotations so the item stays upright
          const si = 1;
          const sp = -(rig.armSplay + p.shZ[si]);
          setLocal(local, 0, -0.08, 0.012, 0, 0, 0);
          tmpM.multiplyMatrices(jm[J_WRIST + si], local);
          tmpM.multiply(setLocal(tmpM2, 0, 0, 0, -(p.el[si] + p.wr[si]), 0, 0));
          tmpM.multiply(setLocal(tmpM2, 0, 0, 0, 0, 0, -sp));
          tmpM.multiply(setLocal(tmpM2, 0, 0, 0, -p.sh[si] - p.lean, 0, 0));
          if (spec.hold === "hang") tmpM.multiply(setLocal(tmpM2, 0, -h, 0, 0, Math.PI / 2, 0));
          else tmpM.multiply(setLocal(tmpM2, 0, -h * 0.45, 0, 0, 0, 0));
        }
        tmpM.multiply(cm.node);
        cm.mesh.setMatrixAt(cm.n++, tmpM);
      }

      // blob shadow, pick proxy, selection ring
      tmpQ.setFromAxisAngle(tmpV.set(1, 0, 0), -Math.PI / 2);
      tmpM.compose(tmpV.set(st.x, 0.006, st.z), tmpQ, tmpS.set(0.55 * H, 0.55 * H, 0.55 * H));
      blobs.setMatrixAt(n, tmpM);
      setLocal(local, 0, a.anim === "sit" ? 0.7 : 0.87, 0, 0, 0, 0).scale(tmpS.set(0.55, 0.85, 0.45));
      tmpM.multiplyMatrices(st.root, local);
      pick.setMatrixAt(n, tmpM);
      ids[n] = a.id;
      if (selectedId === a.id) {
        ring.visible = true;
        ring.position.set(st.x, 0.02, st.z);
        ring.scale.setScalar(0.9 * H);
      }
      n++;
    }
    ids.length = n;
    for (const part of parts.values()) {
      flush(part.mesh, part.n);
      for (const attr of [part.palA, part.palB]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, part.n * 4);
        attr.needsUpdate = true;
      }
    }
    for (const c of new Set(carry.values())) flush(c.mesh, c.n);
    flush(blobs, n);
    flush(pick, n);
    pick.visible = true; // never drawn (invisible material), only ray-cast
    pick.boundingSphere = null; // recomputed lazily on the next click
    if (states.size > n * 2 + 16) {
      const keep = new Set(ids);
      for (const id of states.keys()) if (!keep.has(id)) states.delete(id);
    }
    return 0;
  }
}

function flush(m: THREE.InstancedMesh, count: number) {
  m.count = count;
  m.visible = count > 0;
  m.instanceMatrix.clearUpdateRanges();
  m.instanceMatrix.addUpdateRange(0, count * 16);
  m.instanceMatrix.needsUpdate = true;
}

export function InstancedPeople({
  sim,
  asset,
  propAssets,
  selectedId,
  onSelect,
}: {
  sim: BranchSimulation;
  asset: PeopleAsset;
  propAssets: Record<string, AssetEntry>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { scene } = useGLTF(`/${asset.path}`, false, true);
  const props = usePropSet(propAssets);
  const [cap, setCap] = useState(64);
  const rt = useMemo(() => new PeopleRuntime(scene, asset.rig!, cap, props), [scene, asset.rig, cap, props]);
  useEffect(() => () => rt.dispose(), [rt]);
  // Per-agent smoothing / phase / outfit, kept across capacity rebuilds; reset with the simulation.
  const states = useRef(new Map<string, AgentState>());
  const simRef = useRef(sim);
  useFrame((state, dt) => {
    if (simRef.current !== sim) {
      simRef.current = sim;
      states.current.clear();
    }
    // Dev probe for QA scripts (camera framing); not set in production builds.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __opsTwin?: unknown }).__opsTwin = { state, people: rt };
    const need = rt.frame(sim, states.current, state.clock.elapsedTime, dt, selectedId);
    if (need) setCap(need);
  });
  return (
    <group>
      <primitive object={rt.group} />
      <primitive
        object={rt.pick}
        onClick={
          onSelect
            ? (e: ThreeEvent<MouseEvent>) => {
                if (e.delta > 4 || e.instanceId === undefined) return;
                const id = rt.ids[e.instanceId];
                if (!id) return;
                e.stopPropagation();
                onSelect(id);
              }
            : undefined
        }
      />
    </group>
  );
}
