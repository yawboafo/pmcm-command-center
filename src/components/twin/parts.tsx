"use client";

import * as THREE from "three";
import type { ReactNode } from "react";

/** Shared unit geometries — every box/cylinder in the twin scales these, so the GPU holds one copy. */
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  cylLow: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 16),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  sphereLow: new THREE.SphereGeometry(0.5, 8, 6),
  plane: new THREE.PlaneGeometry(1, 1),
  circle: new THREE.CircleGeometry(0.5, 32),
  ring: new THREE.RingGeometry(0.42, 0.5, 40),
  torus: new THREE.TorusGeometry(0.5, 0.06, 8, 24),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 4, 10),
};

type V3 = [number, number, number];

interface BoxProps {
  p: V3;
  s: V3;
  m: THREE.Material;
  r?: V3;
  shadow?: boolean;
}

/** Box positioned by its centre. */
export function Box({ p, s, m, r, shadow = true }: BoxProps) {
  return <mesh geometry={G.box} material={m} position={p} scale={s} rotation={r} castShadow={shadow} receiveShadow />;
}

/** Box positioned by its bottom-centre (easier for furniture-style stacking). */
export function Slab({ p, s, m, r, shadow = true }: BoxProps) {
  return <mesh geometry={G.box} material={m} position={[p[0], p[1] + s[1] / 2, p[2]]} scale={s} rotation={r} castShadow={shadow} receiveShadow />;
}

export function Cyl({ p, radius, h, m, r, low, shadow = true }: { p: V3; radius: number; h: number; m: THREE.Material; r?: V3; low?: boolean; shadow?: boolean }) {
  return <mesh geometry={low ? G.cylLow : G.cyl} material={m} position={p} scale={[radius * 2, h, radius * 2]} rotation={r} castShadow={shadow} receiveShadow />;
}

export function Ball({ p, radius, m, s, low }: { p: V3; radius: number; m: THREE.Material; s?: V3; low?: boolean }) {
  return <mesh geometry={low ? G.sphereLow : G.sphere} material={m} position={p} scale={s ? [s[0] * radius * 2, s[1] * radius * 2, s[2] * radius * 2] : radius * 2} castShadow receiveShadow />;
}

/** Four table/stand legs inset from the footprint corners. */
export function Legs({ w, d, h, m, inset = 0.05, t = 0.04 }: { w: number; d: number; h: number; m: THREE.Material; inset?: number; t?: number }) {
  const xs = [-w / 2 + inset + t / 2, w / 2 - inset - t / 2];
  const zs = [-d / 2 + inset + t / 2, d / 2 - inset - t / 2];
  return (
    <>
      {xs.flatMap((x) => zs.map((z) => <Box key={`${x}:${z}`} p={[x, h / 2, z]} s={[t, h, t]} m={m} />))}
    </>
  );
}

export function Group({ children, p, r }: { children: ReactNode; p?: V3; r?: V3 }) {
  return (
    <group position={p} rotation={r}>
      {children}
    </group>
  );
}

/** Stable pseudo-random from a string id (for prop variation). */
export function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
