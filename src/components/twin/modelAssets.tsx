"use client";

import { Detailed, useGLTF } from "@react-three/drei";
import { Component, Suspense, useMemo, useSyncExternalStore, type ReactNode } from "react";
import * as THREE from "three";
import type { Equipment } from "@/lib/floorplan/types";
import { useApp } from "@/store/app";
import { cachedBasic } from "./building";
import { EquipmentModel } from "./equipment";
import { counterFrontTexture, fridgeHeaderTexture, labelTexture, menuBoardTexture, stripTexture } from "./materials";
import { seeded } from "./parts";

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
  kind?: "equipment" | "furniture" | "characters" | "props";
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

/** Types whose procedural model carries content the scripted asset lacks (none since the menu board got its screen texture). */
const KEEP_PROCEDURAL = new Set<string>();

/** Distance (m) beyond which the reduced LOD is shown. */
const LOD_DISTANCE = 14;

/**
 * glTF UVs have their origin top-left (the loader keeps flipY = false), canvas textures are made
 * for three's bottom-left convention: quads from the GLBs get an un-flipped copy of the artwork.
 */
function forGltf(make: () => THREE.Texture) {
  return () => {
    const t = make().clone();
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
}

/** Lit (printed vinyl / panel) material for canvas artwork, cached per key. */
const printedCache = new Map<string, THREE.MeshStandardMaterial>();
function printed(key: string, make: () => THREE.Texture) {
  let m = printedCache.get(key);
  if (!m) printedCache.set(key, (m = new THREE.MeshStandardMaterial({ map: forGltf(make)(), roughness: 0.45, metalness: 0.05 })));
  return m;
}

/**
 * Canvas artwork for the UV'd LABEL / SCREEN quads of a type (menu content, signage, the
 * counter-front graphic). `aspect` is the quad's width / height after per-axis scaling.
 */
function quadMaterial(e: Equipment, node: "LABEL" | "SCREEN", aspect: number): THREE.Material | null {
  if (e.type === "menu-board" && node === "SCREEN") {
    const idx = Math.floor(seeded(e.id)() * 4);
    return cachedBasic(`glb:menu:${idx}`, forGltf(() => menuBoardTexture(idx)), { transparent: false });
  }
  if (node !== "LABEL") return null;
  switch (e.type) {
    case "pos-counter": {
      const a = Math.max(2, Math.min(8, Math.round(aspect * 2) / 2));
      return printed(`counterFront:${a}`, () => counterFrontTexture(a));
    }
    case "pickup-counter": {
      const a = Math.round(aspect);
      return printed(`collection:${a}`, () => stripTexture("COLLECTION", "#2b2d31", "#FFD400", a, "#EE1D25"));
    }
    case "dispatch-rack": {
      const a = Math.round(aspect);
      return printed(`dispatch:${a}`, () => stripTexture("DELIVERY DISPATCH", "#EE1D25", "#ffffff", a));
    }
    case "drinks-fridge":
      return cachedBasic("glb:fridgeHeader", forGltf(fridgeHeaderTexture));
    case "handwash":
      return printed("washHands", () => labelTexture("WASH HANDS", "#0b8a3a"));
    default:
      return null;
  }
}

function prepare(root: THREE.Object3D, e: Equipment, a: AssetEntry) {
  const sx = e.size[0] / a.size[0];
  const sy = e.size[1] / a.size[1];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (mesh.name === "LABEL" || mesh.name === "SCREEN") {
      // Quads face +z and the node scale is uniform, so the box gives the aspect directly.
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!;
      const aspect = ((bb.max.x - bb.min.x) * sx) / Math.max(1e-6, (bb.max.y - bb.min.y) * sy);
      const m = quadMaterial(e, mesh.name, aspect);
      if (m) {
        mesh.material = m;
        mesh.castShadow = false;
      }
    }
  });
  return root;
}

function GlbEquipment({ e, a }: { e: Equipment; a: AssetEntry }) {
  const paths = a.lod1 ? [`/${a.path}`, `/${a.lod1}`] : [`/${a.path}`];
  const gltfs = useGLTF(paths, false, true);
  // Clones share geometry and materials with the cached glTF, so many fryers cost one upload.
  const scenes = useMemo(() => gltfs.map((g) => prepare(g.scene.clone(true), e, a)), [gltfs, e, a]);
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
