"use client";

import { Environment, Html, Lightformer } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { footprint } from "@/lib/floorplan/derive";
import { G } from "./parts";
import { textures } from "./materials";
import type { Equipment, FloorPlan } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import { AgentsLayer } from "./agents";
import { Ceilings, Doors, Exterior, Floors, RoomLabels, Site, Walls, Windows } from "./building";
import { EquipmentModel } from "./equipment";
import { FurnitureLayer } from "./furniture";
import { FaultLabels, LiveLayer, OrderChips, SelectionBox } from "./live";

/**
 * CONTRACT (shared by the digital twin and the floor plan editor's 3D preview):
 * builds the whole restaurant — floors, walls with openings, ceilings, doors,
 * windows, exterior facade, equipment, furniture, lighting — from `plan` alone.
 * When `sim` is given it also renders animated staff/customers/riders, food items
 * and live equipment state. Must be rendered inside an R3F <Canvas>.
 */
export interface RestaurantModelProps {
  plan: FloorPlan;
  sim?: BranchSimulation | null;
  /** Hide ceilings and cut walls (dollhouse) and/or make walls translucent (x-ray). */
  cutaway?: boolean;
  xray?: boolean;
  selectedId?: string | null;
  highlightIds?: string[];
  quality?: "high" | "balanced" | "low";
  onSelectEquipment?: (id: string, e: ThreeEvent<PointerEvent>) => void;
  onSelectFurniture?: (id: string, e: ThreeEvent<PointerEvent>) => void;
  onSelectAgent?: (id: string) => void;
  onSelectRoom?: (id: string) => void;
  /** Fire onSelectEquipment on pointer-down (editor dragging) instead of on click. */
  selectOnPointerDown?: boolean;
  /** Include sun, sky light and reflection environment (default true). */
  environment?: boolean;
  /** Throttled UI tick so HTML overlays and agent lists refresh (twin passes the store tick). */
  version?: number;
  /** Evening lighting for the exterior intro shot. */
  dusk?: boolean;
  /** Selected agent (yellow ring under the person). */
  selectedAgentId?: string | null;
  onSelectOrder?: (id: string) => void;
  /** Render live HTML chips above workstations (off for CCTV-only renders). */
  overlays?: boolean;
  /** Click on a floating fault label. */
  onFaultClick?: (equipmentId: string) => void;
  /**
   * Editor drag feedback: tints the dragged equipment/furniture green (valid) or
   * pulsing red (invalid) and shows the reason above it.
   */
  dragState?: { id: string; valid: boolean; reason?: string } | null;
}

export default function RestaurantModel(props: RestaurantModelProps) {
  const { plan, sim, cutaway = false, xray = false, selectedId, highlightIds, quality = "balanced", environment = true, version = 0, dusk = false, overlays = true } = props;
  const H = plan.dimensions.height;
  const full = useRef<THREE.Group>(null);
  const cut = useRef<THREE.Group>(null);
  const labels = useRef<THREE.Group>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Automatic dollhouse: whenever the camera is above the roofline (or x-ray is on), show cut walls.
  useFrame(({ camera }) => {
    const above = camera.position.y > H + 0.2;
    const useCut = (cutaway && above) || xray;
    if (full.current) full.current.visible = !useCut;
    if (cut.current) cut.current.visible = useCut;
    if (labels.current) labels.current.visible = useCut && above;
  });

  const down = useRef<ThreeEvent<PointerEvent> | null>(null);
  const overhead = useMemo(() => plan.equipment.filter((e) => e.type === "hood"), [plan.equipment]);
  const floorItems = useMemo(() => plan.equipment.filter((e) => e.type !== "hood"), [plan.equipment]);
  const onDown = (id: string, e: ThreeEvent<PointerEvent>) => {
    down.current = e;
    if (props.selectOnPointerDown) props.onSelectEquipment?.(id, e);
  };
  const onClick = (id: string, delta: number) => {
    if (props.selectOnPointerDown || delta > 4 || !down.current) return;
    props.onSelectEquipment?.(id, down.current);
  };
  const eqById = useMemo(() => new Map(plan.equipment.map((e) => [e.id, e])), [plan.equipment]);
  const selectedEq = selectedId ? eqById.get(selectedId) : undefined;
  const hoverEq = hover && hover !== selectedId ? eqById.get(hover) : undefined;

  return (
    <group>
      {environment && <SceneLights plan={plan} quality={quality} dusk={dusk} />}
      <InteriorLights plan={plan} />
      <Site plan={plan} />
      <Floors plan={plan} onRoom={props.onSelectRoom ? (id, delta) => delta < 4 && props.onSelectRoom!(id) : undefined} />
      <Windows plan={plan} />
      <group ref={full}>
        <Walls walls={plan.walls} xray={false} mode="full" />
        <Doors plan={plan} showHeaders />
        <Ceilings plan={plan} />
        <Exterior plan={plan} />
        {/* Overhead hoods would hide the cook line in cut-away views, so they only show with full walls. */}
        <EquipmentLayer items={overhead} highlight={highlightIds} onHover={setHover} onDown={onDown} onClick={onClick} />
      </group>
      <group ref={cut} visible={false}>
        <Walls walls={plan.walls} xray={xray} mode={xray ? "full" : "cut"} />
        <Doors plan={plan} showHeaders={false} />
      </group>
      <group ref={labels} visible={false}>
        <RoomLabels rooms={plan.rooms} />
      </group>

      <EquipmentLayer items={floorItems} highlight={highlightIds} onHover={setHover} onDown={onDown} onClick={onClick} />
      <FurnitureLayer items={plan.furniture} onSelect={props.onSelectFurniture} />
      {props.dragState && <DragTint plan={plan} drag={props.dragState} />}
      {selectedEq && !props.dragState && <SelectionBox e={selectedEq} />}
      {hoverEq && <SelectionBox e={hoverEq} hover />}

      {sim && (
        <>
          <LiveLayer sim={sim} />
          <AgentsLayer sim={sim} version={version} selectedId={props.selectedAgentId} onSelect={props.onSelectAgent} />
          {overlays && <OrderChips sim={sim} version={version} onOrder={props.onSelectOrder} />}
          {overlays && <FaultLabels sim={sim} version={version} onSelect={props.onFaultClick} />}
        </>
      )}
    </group>
  );
}

const EquipmentLayer = memo(function EquipmentLayer({
  items,
  highlight,
  onHover,
  onDown,
  onClick,
}: {
  items: Equipment[];
  highlight?: string[];
  onHover: (id: string | null) => void;
  onDown: (id: string, e: ThreeEvent<PointerEvent>) => void;
  onClick: (id: string, delta: number) => void;
}) {
  return (
    <group>
      {items.map((e) => (
        <group
          key={e.id}
          position={e.position}
          rotation={[0, e.rotation, 0]}
          onPointerOver={(ev) => {
            ev.stopPropagation();
            onHover(e.id);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            onHover(null);
            document.body.style.cursor = "";
          }}
          onPointerDown={(ev) => {
            ev.stopPropagation();
            onDown(e.id, ev);
          }}
          onClick={(ev) => {
            ev.stopPropagation();
            onClick(e.id, ev.delta);
          }}
        >
          <EquipmentModel e={e} />
          {highlight?.includes(e.id) && (
            <mesh position={[0, e.size[1] / 2, 0]} scale={[e.size[0] + 0.1, e.size[1] + 0.1, e.size[2] + 0.1]}>
              <boxGeometry />
              <meshBasicMaterial color="#FFD400" transparent opacity={0.18} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
});

/** Sun, sky, fog and a procedural Lightformer environment (no HDR downloads). */
export function SceneLights({ plan, quality, dusk }: { plan: FloorPlan; quality: "high" | "balanced" | "low"; dusk?: boolean }) {
  const { width: W, length: L } = plan.dimensions;
  // Tight shadow camera around the building plus the street frontage.
  const half = Math.max(W, L) / 2 + 9;
  const mapSize = quality === "high" ? 4096 : 2048;
  const get = useThree((s) => s.get);
  // Background and fog belong to the scene itself (attach= would bind them to our group).
  useEffect(() => {
    const scene = get().scene;
    const t = dusk ? textures().duskSky : textures().sky;
    t.mapping = THREE.EquirectangularReflectionMapping;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.background = t;
    scene.fog = new THREE.Fog(dusk ? "#c9876f" : "#e3ecf4", 45, 160);
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  }, [get, dusk]);
  return (
    <>
      <hemisphereLight args={[dusk ? "#ffc9a0" : "#ffffff", dusk ? "#3a2c3a" : "#c3cbd4", dusk ? 0.45 : 0.8]} />
      <directionalLight
        position={[W / 2 - 14, dusk ? 12 : 40, L / 2 - 24]}
        intensity={dusk ? 1.0 : 2.1}
        color={dusk ? "#ffb27a" : "#ffffff"}
        castShadow={quality !== "low"}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={1}
        shadow-camera-far={140}
        target-position={[W / 2, 0, L / 2 - 4]}
      />
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.6} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[40, 20, 1]} />
        <Lightformer intensity={0.8} position={[-20, 5, 10]} rotation-y={Math.PI / 3} scale={[20, 6, 1]} color="#dbeafe" />
        <Lightformer intensity={0.6} position={[20, 4, -10]} rotation-y={-Math.PI / 2} scale={[20, 6, 1]} color="#fff7ed" />
      </Environment>
    </>
  );
}

const dragMats = {
  ok: new THREE.MeshBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }),
  bad: new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
};

/** Green / pulsing-red tint and floor footprint for the item being dragged in the editor. */
function DragTint({ plan, drag }: { plan: FloorPlan; drag: { id: string; valid: boolean; reason?: string } }) {
  const item = plan.equipment.find((e) => e.id === drag.id) ?? plan.furniture.find((f) => f.id === drag.id);
  const box = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!drag.valid) dragMats.bad.opacity = 0.25 + (Math.sin(performance.now() / 140) + 1) * 0.15;
  });
  if (!item) return null;
  const { hw, hd } = footprint(item.size, item.rotation);
  const mat = drag.valid ? dragMats.ok : dragMats.bad;
  return (
    <group position={[item.position[0], 0, item.position[2]]}>
      <mesh ref={box} geometry={G.box} material={mat} position={[0, item.position[1] + item.size[1] / 2, 0]} rotation={[0, item.rotation, 0]} scale={[item.size[0] + 0.06, item.size[1] + 0.06, item.size[2] + 0.06]} />
      <mesh geometry={G.plane} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={[hw * 2 + 0.2, hd * 2 + 0.2, 1]} />
      {!drag.valid && drag.reason && (
        <Html position={[0, item.position[1] + item.size[1] + 0.4, 0]} center distanceFactor={10}>
          <div className="whitespace-nowrap rounded-md bg-red-600/90 px-2 py-1 text-[11px] font-semibold text-white shadow-lg">{drag.reason}</div>
        </Html>
      )}
    </group>
  );
}

/** A handful of warm interior lights placed in the largest rooms (kept low for performance). */
function InteriorLights({ plan }: { plan: FloorPlan }) {
  const H = plan.dimensions.height;
  const lights = useMemo(
    () =>
      [...plan.rooms]
        .sort((a, b) => b.w * b.d - a.w * a.d)
        .slice(0, 6)
        .map((r) => ({ id: r.id, pos: [r.x + r.w / 2, H - 0.45, r.z + r.d / 2] as [number, number, number], intensity: Math.min(14, 3 + r.w * r.d * 0.12), dist: Math.max(r.w, r.d) * 1.3 + 2, warm: ["dining", "customer", "counter"].includes(r.type) })),
    [plan.rooms, H],
  );
  return (
    <>
      {lights.map((l) => (
        <pointLight key={l.id} position={l.pos} intensity={l.intensity} distance={l.dist} decay={1.6} color={l.warm ? "#ffd7a1" : "#f2f6ff"} />
      ))}
      {/* sign wash */}
      <pointLight position={[plan.dimensions.width / 2, H + 0.4, -2.2]} intensity={6} distance={7} decay={1.8} color="#ff6a5a" />
    </>
  );
}
