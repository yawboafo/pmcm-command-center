"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { BranchSimulation } from "@/lib/sim/engine";
import { useApp } from "@/store/app";

const COLOR = { live: "#34d399", virtual: "#e879f9", lost: "#fbbf24" } as const;
const ring = new THREE.RingGeometry(0.36, 0.42, 40);
const disc = new THREE.CircleGeometry(1, 40);

/**
 * Floor markers for badge-tracked staff: a ring coloured by source (LIVE green, SIM DEVICE
 * magenta, signal lost amber) and a faint disc sized to the fix accuracy. Positions follow the
 * engine every frame; membership refreshes at the panel rate.
 */
export default function BadgeMarkers({ sim }: { sim: BranchSimulation }) {
  useApp((s) => s.tick);
  const groups = useRef(new Map<string, THREE.Group>());
  const tracked = sim.agents.filter((a) => a.tracked && !a.gone);
  useFrame(() => {
    for (const a of tracked) {
      const g = groups.current.get(a.id);
      if (!g) continue;
      g.position.set(a.pos[0], 0.03, a.pos[1]);
      const d = g.children[1];
      const r = Math.max(0.15, a.tracked?.accuracy ?? 0.3);
      d.scale.set(r, r, r);
    }
  });
  return (
    <group>
      {tracked.map((a) => {
        const c = a.tracked!.lost ? COLOR.lost : COLOR[a.tracked!.source];
        return (
          <group
            key={a.id}
            ref={(g) => {
              if (g) groups.current.set(a.id, g);
              else groups.current.delete(a.id);
            }}
            position={[a.pos[0], 0.03, a.pos[1]]}
          >
            <mesh geometry={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
              <meshBasicMaterial color={c} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh geometry={disc} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
              <meshBasicMaterial color={c} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
