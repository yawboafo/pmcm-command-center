"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { AssetEntry } from "./modelAssets";

/**
 * Blender-built food / packaging props (blender/build_props.py → public/models/props/*.glb).
 * Each file is a single BODY mesh on one vertex-coloured material with its origin at the
 * item's bottom centre. `node` is that mesh's transform inside the file (meshopt quantisation
 * stores the dequantisation there) and must be applied under whatever places the prop.
 */
export interface PropGeo {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  node: THREE.Matrix4;
  size: [number, number, number];
}
export type PropSet = Partial<Record<string, PropGeo>>;

export const LIVE_PROPS = [
  "pizza",
  "pizza-raw",
  "pizza-tray",
  "pizza-box",
  "pizza-box-open",
  "chicken-drum",
  "chicken-basket",
  "chicken-bucket",
  "chicken-tray",
  "rice-pack",
  "side-cup",
  "drink-bottle",
  "takeaway-bag",
] as const;

/** Loads the given props (suspends) and extracts geometry / material / node transform. */
export function usePropSet(entries: Record<string, AssetEntry>): PropSet {
  const names = Object.keys(entries).sort();
  const gltfs = useGLTF(names.map((n) => `/${entries[n].path}`), false, true);
  return useMemo(() => {
    const out: PropSet = {};
    names.forEach((n, i) => {
      const root = gltfs[i].scene;
      root.updateMatrixWorld(true);
      let mesh: THREE.Mesh | null = null;
      root.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) return;
      const m = mesh as THREE.Mesh;
      out[n] = { geometry: m.geometry, material: m.material as THREE.Material, node: m.matrixWorld.clone(), size: entries[n].size };
    });
    return out;
  }, [gltfs]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A prop placed by its bottom centre (put it inside a positioned / scaled group). */
export function PropMesh({ prop, material, shadow = false }: { prop: PropGeo; material?: THREE.Material; shadow?: boolean }) {
  return <mesh geometry={prop.geometry} material={material ?? prop.material} matrix={prop.node} matrixAutoUpdate={false} castShadow={shadow} />;
}
