"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { FloorPlan } from "@/lib/floorplan/types";

const N = 520;
const streakMat = new THREE.MeshBasicMaterial({ color: "#dfe7f0", transparent: true, opacity: 0.35, depthWrite: false });
const streak = new THREE.BoxGeometry(0.012, 0.5, 0.012);
const wetMat = new THREE.MeshBasicMaterial({ color: "#0b1016", transparent: true, opacity: 0.0, depthWrite: false });

interface Drop {
  x: number;
  z: number;
  y: number;
  s: number;
}
// Drop positions are animation state, not React state: kept per building width outside the component.
const dropCache = new Map<number, Drop[]>();
function dropsFor(W: number): Drop[] {
  let d = dropCache.get(W);
  if (!d) dropCache.set(W, (d = Array.from({ length: N }, (_, i) => ({ x: -6 + ((i * 7.31) % (W + 12)), z: -16 + ((i * 3.17) % 15.5), y: (i * 1.37) % 9, s: 5.5 + (i % 7) * 0.4 }))));
  return d;
}

/** Rain over the forecourt and street side (seen by the entrance camera), with a wet-ground darkening. */
export default function RainLayer({ plan, intensity }: { plan: FloorPlan; intensity: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const wet = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const { width: W } = plan.dimensions;
  useFrame((_, dt) => {
    const im = ref.current;
    if (!im) return;
    const drops = dropsFor(W);
    const count = Math.round(N * Math.min(1, 0.35 + intensity));
    for (let i = 0; i < N; i++) {
      const d = drops[i];
      if (i < count) {
        d.y -= d.s * dt;
        if (d.y < 0) d.y += 9;
        tmp.position.set(d.x + Math.sin(i) * 0.1, d.y, d.z);
        tmp.rotation.set(0.12, 0, 0.05);
        tmp.scale.setScalar(1);
      } else tmp.scale.setScalar(0);
      tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    if (wet.current) (wet.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.25 * intensity;
  });
  return (
    <group>
      <instancedMesh ref={ref} args={[streak, streakMat, N]} frustumCulled={false} />
      <mesh ref={wet} material={wetMat} rotation={[-Math.PI / 2, 0, 0]} position={[W / 2, 0.012, -8]}>
        <planeGeometry args={[W + 14, 16]} />
      </mesh>
    </group>
  );
}
