"use client";

import { Detailed, useGLTF } from "@react-three/drei";
import { Component, Suspense, useMemo, useSyncExternalStore, type ReactNode } from "react";
import * as THREE from "three";
import type { Equipment } from "@/lib/floorplan/types";
import { useApp } from "@/store/app";
import { EquipmentModel } from "./equipment";

/**
 * Blender-built glTF equipment (see blender/ and docs/ASSETS.md) with the procedural model
 * as the fallback while loading, on any load error, for types without an asset, and when
 * Settings → Graphics → 3D assets is set to procedural.
 *
 * Assets follow one contract: metres, origin at the footprint's floor centre (elevated items:
 * the item's bottom centre), front facing +z, modelled at the catalogue default size — so a
 * per-axis scale fits them to whatever size the floor plan gives the equipment.
 */
export interface AssetEntry {
  path: string;
  lod1: string | null;
  size: [number, number, number];
}
interface Manifest {
  assets: Record<string, AssetEntry>;
}

// Manifest store: fetched once, shared by every equipment instance.
let manifest: Manifest | null = null;
let requested = false;
const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  if (!requested && typeof window !== "undefined") {
    requested = true;
    fetch("/models/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Manifest | null) => {
        manifest = m?.assets ? m : null;
        listeners.forEach((f) => f());
      })
      .catch(() => {});
  }
  return () => listeners.delete(l);
}
export const useManifest = () => useSyncExternalStore(subscribe, () => manifest, () => null);

export class AssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Types whose procedural model carries content the scripted asset lacks (the menu board shows the real menu). */
const KEEP_PROCEDURAL = new Set(["menu-board"]);

/** Distance (m) beyond which the reduced LOD is shown. */
const LOD_DISTANCE = 14;

function prepare(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

function GlbEquipment({ e, a }: { e: Equipment; a: AssetEntry }) {
  const paths = a.lod1 ? [`/${a.path}`, `/${a.lod1}`] : [`/${a.path}`];
  const gltfs = useGLTF(paths, false, true);
  // Clones share geometry and materials with the cached glTF, so many fryers cost one upload.
  const scenes = useMemo(() => gltfs.map((g) => prepare(g.scene.clone(true))), [gltfs]);
  const scale: [number, number, number] = [e.size[0] / a.size[0], e.size[1] / a.size[1], e.size[2] / a.size[2]];
  return (
    <group scale={scale}>
      {scenes.length > 1 ? (
        <Detailed distances={[0, LOD_DISTANCE]}>
          <primitive object={scenes[0]} />
          <primitive object={scenes[1]} />
        </Detailed>
      ) : (
        <primitive object={scenes[0]} />
      )}
    </group>
  );
}

export function EquipmentAsset({ e }: { e: Equipment }) {
  const m = useManifest();
  const mode = useApp((s) => s.assetMode);
  const fallback = <EquipmentModel e={e} />;
  const a = mode === "models" && !KEEP_PROCEDURAL.has(e.type) ? m?.assets[e.type] : undefined;
  if (!a) return fallback;
  return (
    <AssetBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GlbEquipment e={e} a={a} />
      </Suspense>
    </AssetBoundary>
  );
}
