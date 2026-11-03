"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Furniture } from "@/lib/floorplan/types";
import { useApp } from "@/store/app";
import { M } from "./materials";
import { AssetBoundary, useManifest, type AssetEntry } from "./modelAssets";
import { Box, Cyl, G, Slab } from "./parts";

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  mats: THREE.Matrix4[];
  owners: string[];
}

const tmp = new THREE.Object3D();

/**
 * Restaurant seating, instanced per part so a 70-seat dining hall costs a
 * handful of draw calls. Chair placements mirror the simulation's seat
 * offsets so seated customers line up with the chairs.
 */
type OnSelect = (id: string, e: ThreeEvent<PointerEvent>) => void;

export const FurnitureLayer = memo(function FurnitureLayer({ items, onSelect }: { items: Furniture[]; onSelect?: OnSelect }) {
  const manifest = useManifest();
  const mode = useApp((s) => s.assetMode);
  // Every third table keeps the yellow armchairs seen in branch photos (no scripted model for them).
  const armchairs = useMemo(() => new Set(items.filter((f) => f.type === "table-2" || f.type === "table-4").filter((_, i) => i % 3 === 0).map((f) => f.id)), [items]);
  const modelled = (f: Furniture) => mode === "models" && !!manifest?.assets[f.type] && !armchairs.has(f.id);
  const glb = items.filter(modelled);
  const procedural = items.filter((f) => !modelled(f));
  const fallback = <ProceduralFurniture items={glb} armchairs={armchairs} onSelect={onSelect} />;
  return (
    <group>
      <ProceduralFurniture items={procedural} armchairs={armchairs} onSelect={onSelect} />
      {glb.length > 0 && manifest && (
        <AssetBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <GlbFurniture items={glb} assets={manifest.assets} onSelect={onSelect} />
          </Suspense>
        </AssetBoundary>
      )}
    </group>
  );
});

/**
 * Blender-built furniture, still instanced: every mesh of each model becomes one
 * InstancedMesh across all pieces of that type, so the dining room stays a handful of
 * draw calls. Node transforms are kept (meshopt quantisation stores geometry scale there).
 */
function GlbFurniture({ items, assets, onSelect }: { items: Furniture[]; assets: Record<string, AssetEntry>; onSelect?: OnSelect }) {
  const types = [...new Set(items.map((f) => f.type))];
  const gltfs = useGLTF(types.map((t) => `/${assets[t].path}`), false, true);
  const parts = useMemo(() => {
    const out: Part[] = [];
    types.forEach((type, ti) => {
      const a = assets[type];
      const root = gltfs[ti].scene;
      root.updateMatrixWorld(true);
      const mine = items.filter((f) => f.type === type);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const local = mesh.matrixWorld.clone();
        const mats = mine.map((f) => {
          tmp.position.set(...f.position);
          tmp.rotation.set(0, f.rotation, 0);
          tmp.scale.set(f.size[0] / a.size[0], f.size[1] / a.size[1], f.size[2] / a.size[2]);
          tmp.updateMatrix();
          return new THREE.Matrix4().multiplyMatrices(tmp.matrix, local);
        });
        out.push({ geo: mesh.geometry, mat: mesh.material as THREE.Material, mats, owners: mine.map((f) => f.id) });
      });
    });
    return out;
  }, [gltfs, items, assets]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {parts.map((p, i) => (
        <InstancedPart key={i} part={p} onSelect={onSelect} />
      ))}
    </group>
  );
}

function ProceduralFurniture({ items, armchairs, onSelect }: { items: Furniture[]; armchairs: Set<string>; onSelect?: OnSelect }) {
  const parts = useMemo(() => buildParts(items, armchairs), [items, armchairs]);
  const singles = items.filter((f) => ["waiting-bench", "bench", "stool-bar", "plant"].includes(f.type));
  return (
    <group>
      {parts.map((p, i) => (
        <InstancedPart key={i} part={p} onSelect={onSelect} />
      ))}
      {singles.map((f) => (
        <group
          key={f.id}
          position={f.position}
          rotation={[0, f.rotation, 0]}
          onPointerDown={onSelect ? (e) => (e.stopPropagation(), onSelect(f.id, e)) : undefined}
        >
          <Single f={f} />
        </group>
      ))}
    </group>
  );
}

function InstancedPart({ part, onSelect }: { part: Part; onSelect?: (id: string, e: ThreeEvent<PointerEvent>) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    part.mats.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [part]);
  return (
    <instancedMesh
      ref={ref}
      args={[part.geo, part.mat, part.mats.length]}
      castShadow
      receiveShadow
      onPointerDown={onSelect ? (e) => (e.stopPropagation(), e.instanceId !== undefined && onSelect(part.owners[e.instanceId], e)) : undefined}
    />
  );
}

function buildParts(items: Furniture[], armchairs: Set<string>): Part[] {
  const parts = new Map<string, Part>();
  const add = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, owner: string, base: THREE.Matrix4, p: [number, number, number], s: [number, number, number], ry = 0) => {
    let part = parts.get(key);
    if (!part) parts.set(key, (part = { geo, mat, mats: [], owners: [] }));
    tmp.position.set(...p);
    tmp.rotation.set(0, ry, 0);
    tmp.scale.set(...s);
    tmp.updateMatrix();
    part.mats.push(new THREE.Matrix4().multiplyMatrices(base, tmp.matrix));
    part.owners.push(owner);
  };
  items.forEach((f) => {
    if (f.type !== "table-4" && f.type !== "table-2" && f.type !== "booth-4") return;
    tmp.position.set(...f.position);
    tmp.rotation.set(0, f.rotation, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    const base = tmp.matrix.clone();
    if (f.type === "booth-4") {
      add("booth-seat", G.box, M.teal(), f.id, base, [0, 0.22, -0.62], [1.4, 0.44, 0.55]);
      add("booth-seat", G.box, M.teal(), f.id, base, [0, 0.22, 0.62], [1.4, 0.44, 0.55]);
      add("booth-back", G.box, M.teal(), f.id, base, [0, 0.75, -0.86], [1.4, 0.7, 0.14]);
      add("booth-back", G.box, M.teal(), f.id, base, [0, 0.75, 0.86], [1.4, 0.7, 0.14]);
      add("table-top", G.box, M.tableRed(), f.id, base, [0, 0.74, 0], [1.2, 0.04, 0.62]);
      add("pedestal", G.cylLow, M.black(), f.id, base, [0, 0.37, 0], [0.1, 0.72, 0.1]);
      return;
    }
    const four = f.type === "table-4";
    add("table-top", G.box, M.tableRed(), f.id, base, [0, 0.74, 0], four ? [1.15, 0.04, 0.75] : [0.7, 0.04, 0.7]);
    add("table-edge", G.box, M.white(), f.id, base, [0, 0.715, 0], four ? [1.17, 0.012, 0.77] : [0.72, 0.012, 0.72]);
    add("pedestal", G.cylLow, M.black(), f.id, base, [0, 0.36, 0], [0.09, 0.72, 0.09]);
    add("foot", G.cylLow, M.black(), f.id, base, [0, 0.015, 0], [0.55, 0.03, 0.55]);
    const seats: Array<[number, number]> = four ? [[-0.35, -0.62], [0.35, -0.62], [-0.35, 0.62], [0.35, 0.62]] : [[0, -0.55], [0, 0.55]];
    // Alternate the two chair styles seen in branch photos: yellow armchairs and lime shell chairs.
    const armchair = armchairs.has(f.id);
    for (const [x, z] of seats) {
      const face = z < 0 ? 0 : Math.PI;
      const back = z < 0 ? -0.2 : 0.2;
      if (armchair) {
        add("arm-seat", G.box, M.yellowFabric(), f.id, base, [x, 0.42, z], [0.48, 0.14, 0.46], face);
        add("arm-back", G.box, M.yellowFabric(), f.id, base, [x, 0.7, z + back], [0.48, 0.44, 0.1], face);
        add("arm-side", G.box, M.yellowFabric(), f.id, base, [x - 0.22, 0.55, z], [0.06, 0.24, 0.42], face);
        add("arm-side", G.box, M.yellowFabric(), f.id, base, [x + 0.22, 0.55, z], [0.06, 0.24, 0.42], face);
        add("chair-leg", G.cylLow, M.wood(), f.id, base, [x, 0.17, z], [0.36, 0.34, 0.36], face);
      } else {
        add("shell-seat", G.box, M.lime(), f.id, base, [x, 0.45, z], [0.44, 0.05, 0.42], face);
        add("shell-back", G.box, M.lime(), f.id, base, [x, 0.66, z + back * 1.05], [0.44, 0.4, 0.05], face);
        add("chair-leg", G.cylLow, M.woodLight(), f.id, base, [x, 0.22, z], [0.3, 0.44, 0.3], face);
      }
    }
  });
  return [...parts.values()];
}

function Single({ f }: { f: Furniture }) {
  const [w, , d] = f.size;
  switch (f.type) {
    case "waiting-bench":
    case "bench":
      return (
        <group>
          <Box p={[0, 0.44, 0]} s={[w, 0.06, d]} m={M.woodLight()} />
          {f.type === "waiting-bench" && <Box p={[0, 0.72, -d / 2 + 0.04]} s={[w, 0.4, 0.06]} m={M.woodLight()} />}
          {[-0.42, 0.42].map((x) => (
            <Box key={x} p={[x * w, 0.21, 0]} s={[0.05, 0.42, d * 0.9]} m={M.black()} />
          ))}
        </group>
      );
    case "stool-bar":
      return (
        <group>
          <Box p={[0, 1.05, 0]} s={[w, 0.05, 0.4]} m={M.woodLight()} />
          {[-0.45, 0.45].map((x) => (
            <Box key={x} p={[x * w, 0.52, 0]} s={[0.05, 1.04, 0.05]} m={M.black()} />
          ))}
          {[-0.85, -0.3, 0.3, 0.85].map((x) => (
            <group key={x} position={[x, 0, 0.55]}>
              <Cyl p={[0, 0.38, 0]} radius={0.025} h={0.76} m={M.black()} low />
              <Cyl p={[0, 0.77, 0]} radius={0.18} h={0.05} m={M.red()} />
              <Cyl p={[0, 0.01, 0]} radius={0.17} h={0.02} m={M.black()} low />
            </group>
          ))}
        </group>
      );
    case "plant":
      return (
        <group>
          <Cyl p={[0, 0.22, 0]} radius={0.22} h={0.44} m={M.plastic("#2b2d31")} />
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh key={i} geometry={G.sphereLow} material={M.leaf()} position={[Math.cos(i) * 0.12, 0.75 + (i % 3) * 0.12, Math.sin(i) * 0.12]} rotation={[0.4 * Math.cos(i), i, 0.4 * Math.sin(i)]} scale={[0.18, 0.7, 0.06]} castShadow />
          ))}
        </group>
      );
    default:
      return <Slab p={[0, 0, 0]} s={f.size} m={M.wood()} />;
  }
}
