"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Agent } from "@/lib/sim/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import { M, PANTS, SHIRTS, SKIN } from "./materials";
import { G } from "./parts";

interface Look {
  shirt: THREE.Material;
  pants: THREE.Material;
  skin: THREE.Material;
  hat: THREE.Material | null;
  apron: THREE.Material | null;
  helmet: boolean;
  backpack: boolean;
  height: number;
  hair: THREE.Material;
}

function lookFor(a: Agent): Look {
  const r = (n: number) => ((a.seed * 9301 + n * 49297) % 233280) / 233280;
  const skin = M.plastic(SKIN[Math.floor(r(1) * SKIN.length)]);
  const hair = M.plastic(r(9) > 0.8 ? "#3b2a20" : "#141414");
  if (a.kind === "staff") {
    const role = a.role;
    const shirt = role === "cashier" ? M.red() : role === "supervisor" ? M.plastic("#1d1f24") : M.plastic("#d61a20");
    return { shirt, pants: M.plastic("#1b1c1f"), skin, hair, hat: role === "supervisor" ? M.plastic("#FFD400") : M.black(), apron: role === "cashier" || role === "supervisor" ? null : M.plastic("#1b1c1f"), helmet: false, backpack: false, height: 0.95 + r(2) * 0.1 };
  }
  if (a.kind === "rider") {
    return { shirt: M.plastic(r(3) > 0.5 ? "#1f9d55" : "#2b2d31"), pants: M.plastic("#23262b"), skin, hair, hat: null, apron: null, helmet: true, backpack: true, height: 1 };
  }
  return { shirt: M.plastic(SHIRTS[Math.floor(r(4) * SHIRTS.length)]), pants: M.plastic(PANTS[Math.floor(r(5) * PANTS.length)]), skin, hair, hat: r(6) > 0.85 ? M.plastic(SHIRTS[Math.floor(r(7) * SHIRTS.length)]) : null, apron: null, helmet: false, backpack: false, height: 0.92 + r(8) * 0.14 };
}

const CARRY_COLORS: Record<string, string> = { pizza: "#d9a25a", chicken: "#b8691f", rice: "#d8642a", side: "#e3a33b", drink: "#c0392b", bag: "#f3efe6", box: "#f7f3ea", crate: "#3c7dd9" };

/** Stylised low-poly person; pose and position are driven from the agent each frame. */
const Person = memo(function Person({ agent, onSelect, selected }: { agent: Agent; onSelect?: (id: string) => void; selected: boolean }) {
  const look = useMemo(() => lookFor(agent), [agent]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const carry = useRef<THREE.Mesh>(null);
  const carryMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.7 }), []);
  const phase = useRef(agent.seed % 100);
  const init = useRef(false);
  const heading = useRef(0);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    if (agent.gone) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const [x, z] = agent.pos;
    if (!init.current) {
      g.position.set(x, 0, z);
      heading.current = agent.heading;
      init.current = true;
    }
    // Ease toward the simulated position (engine steps are 0.25 s of sim time).
    const k = 1 - Math.exp(-dt * 14);
    const dx = x - g.position.x;
    const dz = z - g.position.z;
    if (dx * dx + dz * dz > 9) g.position.set(x, 0, z);
    else {
      g.position.x += dx * k;
      g.position.z += dz * k;
    }
    const moving = agent.anim === "walk" || agent.anim === "carry";
    let target = agent.heading;
    if (!moving && agent.look) target = Math.atan2(agent.look[0] - x, agent.look[1] - z);
    let diff = target - heading.current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    heading.current += diff * (1 - Math.exp(-dt * 10));
    g.rotation.y = heading.current;

    phase.current += dt * (moving ? 7.5 * agent.speed : agent.anim === "work" ? 6 : agent.anim === "clean" ? 4 : 1.5);
    const s = Math.sin(phase.current);
    const sitting = agent.anim === "sit";
    if (body.current) body.current.position.y = sitting ? -0.42 : moving ? Math.abs(Math.cos(phase.current)) * 0.035 : 0;
    if (legL.current && legR.current) {
      const swing = moving ? s * 0.55 : 0;
      legL.current.rotation.x = sitting ? -1.45 : swing;
      legR.current.rotation.x = sitting ? -1.45 : -swing;
    }
    if (armL.current && armR.current) {
      if (agent.carrying) {
        armL.current.rotation.x = -1.1;
        armR.current.rotation.x = -1.1;
      } else if (agent.anim === "work") {
        armL.current.rotation.x = -0.9 + s * 0.25;
        armR.current.rotation.x = -0.9 - s * 0.25;
      } else if (agent.anim === "clean") {
        armR.current.rotation.x = -0.6;
        armR.current.rotation.z = s * 0.5;
        armL.current.rotation.x = -0.2;
      } else if (moving) {
        armL.current.rotation.x = -s * 0.5;
        armR.current.rotation.x = s * 0.5;
        armR.current.rotation.z = 0;
      } else {
        armL.current.rotation.x = sitting ? -0.6 : s * 0.03;
        armR.current.rotation.x = sitting ? -0.6 : -s * 0.03;
        armR.current.rotation.z = 0;
      }
    }
    if (carry.current) {
      const c = agent.carrying;
      carry.current.visible = !!c;
      if (c) {
        carryMat.color.set(CARRY_COLORS[c] ?? "#fff");
        const flat = c === "pizza" || c === "box";
        carry.current.scale.set(flat ? 0.38 : 0.26, flat ? 0.06 : c === "bag" ? 0.3 : 0.2, flat ? 0.38 : 0.2);
      }
    }
  });

  const H = look.height;
  return (
    <group
      ref={root}
      onClick={
        onSelect
          ? (e) => {
              if (e.delta > 4) return;
              e.stopPropagation();
              onSelect(agent.id);
            }
          : undefined
      }
      scale={H}
    >
      {selected && <mesh geometry={G.ring} material={M.emissive("#FFD400", 2)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={0.9} />}
      <mesh geometry={G.circle} material={shadowMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} scale={0.55} />
      <group ref={body}>
        {/* legs pivot at the hip */}
        {[-1, 1].map((sx) => (
          <group key={sx} ref={sx < 0 ? legL : legR} position={[sx * 0.09, 0.82, 0]}>
            <mesh geometry={G.capsule} material={look.pants} position={[0, -0.4, 0]} scale={[0.13, 0.48, 0.13]} castShadow />
            <mesh geometry={G.box} material={M.black()} position={[0, -0.8, 0.04]} scale={[0.11, 0.06, 0.2]} />
          </group>
        ))}
        {/* torso */}
        <mesh geometry={G.capsule} material={look.shirt} position={[0, 1.13, 0]} scale={[0.36, 0.32, 0.22]} castShadow />
        {look.apron && <mesh geometry={G.box} material={look.apron} position={[0, 0.98, 0.11]} scale={[0.3, 0.5, 0.02]} />}
        {look.backpack && <mesh geometry={G.box} material={M.red()} position={[0, 1.2, -0.25]} scale={[0.42, 0.42, 0.34]} castShadow />}
        {/* arms pivot at the shoulder */}
        {[-1, 1].map((sx) => (
          <group key={sx} ref={sx < 0 ? armL : armR} position={[sx * 0.22, 1.36, 0]}>
            <mesh geometry={G.capsule} material={look.shirt} position={[0, -0.18, 0]} scale={[0.09, 0.2, 0.09]} castShadow />
            <mesh geometry={G.capsule} material={look.skin} position={[0, -0.42, 0]} scale={[0.075, 0.18, 0.075]} />
          </group>
        ))}
        <mesh ref={carry} geometry={G.box} material={carryMat} position={[0, 1.08, 0.36]} visible={false} castShadow />
        {/* head */}
        <mesh geometry={G.sphere} material={look.skin} position={[0, 1.55, 0]} scale={[0.22, 0.25, 0.23]} castShadow />
        <mesh geometry={G.sphere} material={look.hair} position={[0, 1.6, -0.02]} scale={[0.23, 0.18, 0.23]} />
        {look.hat && (
          <>
            <mesh geometry={G.cylLow} material={look.hat} position={[0, 1.68, 0]} scale={[0.25, 0.07, 0.25]} />
            <mesh geometry={G.box} material={look.hat} position={[0, 1.655, 0.14]} scale={[0.2, 0.02, 0.12]} />
          </>
        )}
        {look.helmet && <mesh geometry={G.sphere} material={M.plastic("#1b1c1f")} position={[0, 1.62, 0]} scale={[0.28, 0.26, 0.3]} />}
      </group>
    </group>
  );
});

const shadowMat = new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.18, depthWrite: false });

export function AgentsLayer({ sim, version, selectedId, onSelect }: { sim: BranchSimulation; version: number; selectedId?: string | null; onSelect?: (id: string) => void }) {
  // Recomputed on the throttled tick: new arrivals appear, departed agents unmount.
  const list = useMemo(() => sim.agents.filter((a) => !a.gone), [sim, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {list.map((a) => (
        <Person key={a.id} agent={a} onSelect={onSelect} selected={selectedId === a.id} />
      ))}
    </group>
  );
}
