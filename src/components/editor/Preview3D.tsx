"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import RestaurantModel from "@/components/twin/RestaurantModel";
import { footprint } from "@/lib/floorplan/derive";
import type { FloorPlan, Vec2 } from "@/lib/floorplan/types";
import { snap, type SelItem } from "./model";
import { placeItem, startPositions } from "./ops";
import { useEditor } from "./store";

interface Props {
  plan: FloorPlan;
  readOnly: boolean;
  highlightIds: string[];
}

/**
 * Live 3D preview of the draft layout. Pressing on equipment selects it (synced with 2D);
 * dragging moves it across the floor (raycast to y = 0) with the same grid snapping.
 */
export default function Preview3D({ plan, readOnly, highlightIds }: Props) {
  const [dragging, setDragging] = useState(false);
  const W = plan.dimensions.width;
  const L = plan.dimensions.length;
  const span = Math.max(W, L);

  return (
    <div className="relative h-full w-full bg-[#0b0e14]">
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [W / 2 + span * 0.15, span * 0.95, L + span * 0.55], fov: 45, near: 0.1, far: 500 }}>
        <color attach="background" args={["#0b0e14"]} />
        <Scene plan={plan} readOnly={readOnly} highlightIds={highlightIds} onDrag={setDragging} />
        <OrbitControls makeDefault enabled={!dragging} target={[W / 2, 0, L / 2]} maxPolarAngle={Math.PI / 2.05} minDistance={2} maxDistance={span * 3} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/50 px-2 py-1 text-[10px] text-white/60">3D preview · {readOnly ? "read-only" : "press on an item and drag it across the floor"}</div>
    </div>
  );
}

function Scene({ plan, readOnly, highlightIds, onDrag }: Props & { onDrag: (d: boolean) => void }) {
  const { camera, gl } = useThree();
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const drag = useRef<{ startWorld: Vec2; items: Array<{ s: SelItem; p: Vec2 }>; primary: Vec2; started: boolean } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  const floorPoint = (clientX: number, clientY: number): Vec2 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
  };

  const beginDrag = (s: SelItem, clientX: number, clientY: number) => {
    const st = useEditor.getState();
    const already = st.selection.some((x) => x.id === s.id);
    const sel = already ? st.selection : [s];
    if (!already) setSelection(sel);
    if (readOnly || !st.draft) return;
    const p = floorPoint(clientX, clientY);
    const start = startPositions(st.draft, sel);
    const primary = start.find((x) => x.s.id === s.id)?.p;
    if (!p || !primary) return;
    drag.current = { startWorld: p, items: start, primary, started: false };
    onDrag(true);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const p = floorPoint(e.clientX, e.clientY);
      if (!p) return;
      const { snapStep, mutate, checkpoint } = useEditor.getState();
      if (!d.started) {
        if (Math.hypot(p[0] - d.startWorld[0], p[1] - d.startWorld[1]) < 0.05) return;
        d.started = true;
        checkpoint();
      }
      const dx = snap(d.primary[0] + p[0] - d.startWorld[0], snapStep) - d.primary[0];
      const dz = snap(d.primary[1] + p[1] - d.startWorld[1], snapStep) - d.primary[1];
      mutate((plan) => d.items.forEach(({ s, p: start }) => placeItem(plan, s, start, dx, dz)), { undo: false });
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      onDrag(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const selectedId = selection.length === 1 ? selection[0].id : null;
  const furnitureSel = selection
    .filter((s) => s.kind === "furniture")
    .map((s) => plan.furniture.find((f) => f.id === s.id))
    .filter((f): f is NonNullable<typeof f> => !!f);

  return (
    <>
      <RestaurantModel
        plan={plan}
        cutaway
        selectOnPointerDown
        selectedId={selectedId}
        highlightIds={highlightIds}
        quality="balanced"
        overlays={false}
        onSelectEquipment={(id, e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation?.();
          beginDrag({ kind: "equipment", id }, e.nativeEvent?.clientX ?? 0, e.nativeEvent?.clientY ?? 0);
        }}
        onSelectFurniture={(id, e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation?.();
          beginDrag({ kind: "furniture", id }, e.nativeEvent?.clientX ?? 0, e.nativeEvent?.clientY ?? 0);
        }}
        onSelectRoom={(id) => setSelection([{ kind: "room", id }])}
      />
      {/* Furniture handles (the model has no furniture selection box). */}
      {furnitureSel.map((f) => {
        const { hw, hd } = footprint(f.size, f.rotation);
        return (
          <mesh
            key={f.id}
            position={[f.position[0], 0.5, f.position[2]]}
            onPointerDown={(e) => {
              e.stopPropagation();
              beginDrag({ kind: "furniture", id: f.id }, e.nativeEvent.clientX, e.nativeEvent.clientY);
            }}
          >
            <boxGeometry args={[hw * 2 + 0.06, 1, hd * 2 + 0.06]} />
            <meshBasicMaterial color="#EE1D25" transparent opacity={0.2} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}
