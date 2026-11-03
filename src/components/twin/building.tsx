"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import type { FloorPlan, Room, Wall } from "@/lib/floorplan/types";
import { M, badgeTexture, floorMaterial, labelTexture, posterTexture, signTexture, taglineTexture } from "./materials";
import { Box, Cyl, G, Slab } from "./parts";

const DOOR_H = 2.15;

export function cachedBasic(key: string, make: () => THREE.Texture, opts: Partial<THREE.MeshBasicMaterialParameters> = {}) {
  const k = `basic:${key}`;
  const store = basicCache;
  let m = store.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: make(), transparent: true, toneMapped: false, ...opts });
    store.set(k, m);
  }
  return m;
}
const basicCache = new Map<string, THREE.MeshBasicMaterial>();

/* ───────────────────────── floors ───────────────────────── */

export const Floors = memo(function Floors({ plan, onRoom }: { plan: FloorPlan; onRoom?: (id: string, delta: number) => void }) {
  const { width: W, length: L } = plan.dimensions;
  return (
    <group>
      {/* structural slab under the whole building */}
      <Box p={[W / 2, -0.06, L / 2]} s={[W + 0.5, 0.12, L + 0.5]} m={M.wallTop()} shadow={false} />
      {plan.rooms.map((r) => (
        <mesh
          key={r.id}
          geometry={G.plane}
          material={floorMaterial(r.type, r.w, r.d)}
          position={[r.x + r.w / 2, 0.002, r.z + r.d / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[r.w, r.d, 1]}
          receiveShadow
          onClick={onRoom ? (e) => (e.stopPropagation(), onRoom(r.id, e.delta)) : undefined}
        />
      ))}
    </group>
  );
});

/** Room names painted on the floor, visible in dollhouse/top views. */
export const RoomLabels = memo(function RoomLabels({ rooms }: { rooms: Room[] }) {
  return (
    <group>
      {rooms.map((r) => {
        const mat = cachedBasic(`roomlabel:${r.name}`, () => floorLabelTexture(r.name), { opacity: 0.85, depthWrite: false });
        const width = Math.min(r.w * 0.85, r.name.length * 0.16 + 0.4);
        return <mesh key={r.id} geometry={G.plane} material={mat} position={[r.x + r.w / 2, 0.012, r.z + Math.min(r.d - 0.35, 0.45)]} rotation={[-Math.PI / 2, 0, Math.PI]} scale={[width, width / 8, 1]} renderOrder={2} />;
      })}
    </group>
  );
});

function floorLabelTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.font = "800 72px Montserrat, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(20,22,26,0.55)";
  ctx.fillText(text.toUpperCase(), 512, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ───────────────────────── walls ───────────────────────── */

function wallTransform(w: Wall, cutH?: number) {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  const base = w.base ?? 0;
  const full = base === 0 && w.height > 1.5;
  // Extend full-height walls by half the thickness so corners close cleanly.
  const ext = full ? w.thickness / 2 : 0;
  let h = w.height;
  if (cutH !== undefined) {
    if (base > cutH) return null;
    h = Math.min(h, cutH - base);
  }
  const alongX = Math.abs(dz) < 1e-6;
  return {
    position: [(w.a[0] + w.b[0]) / 2, base + h / 2, (w.a[1] + w.b[1]) / 2] as [number, number, number],
    scale: (alongX ? [len + ext * 2, h, w.thickness] : [w.thickness, h, len + ext * 2]) as [number, number, number],
  };
}

/**
 * Two wall sets: full height (seen from inside / CCTV / exterior) and cut at
 * 1.15 m with a dark section cap (dollhouse). The rig toggles which is visible.
 */
export const Walls = memo(function Walls({ walls, xray, mode }: { walls: Wall[]; xray: boolean; mode: "full" | "cut" }) {
  const cutH = 1.15;
  const items = useMemo(() => walls.map((w) => ({ w, t: wallTransform(w, mode === "cut" ? cutH : undefined) })).filter((x) => x.t), [walls, mode]);
  const interior = xray ? xrayWall : M.wall();
  const exterior = xray ? xrayWall : M.wallExterior();
  return (
    <group>
      {items.map(({ w, t }) => (
        <group key={w.id}>
          <mesh geometry={G.box} material={w.exterior ? exterior : interior} position={t!.position} scale={t!.scale} castShadow={!xray} receiveShadow />
          {mode === "cut" && !xray && <mesh geometry={G.box} material={M.wallTop()} position={[t!.position[0], t!.position[1] + t!.scale[1] / 2 + 0.006, t!.position[2]]} scale={[t!.scale[0] + 0.004, 0.012, t!.scale[2] + 0.004]} />}
          {mode === "full" && !xray && w.exterior && (w.base ?? 0) === 0 && w.height > 1.5 && (
            // Skirting band on exterior walls.
            <mesh geometry={G.box} material={M.plastic("#3a3d42")} position={[t!.position[0], 0.15, t!.position[2]]} scale={[t!.scale[0] + 0.02, 0.3, t!.scale[2] + 0.02]} />
          )}
        </group>
      ))}
    </group>
  );
});

const xrayWall = new THREE.MeshStandardMaterial({ color: "#9fc6ff", transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.3 });

/* ───────────────────────── doors & windows ───────────────────────── */

export const Doors = memo(function Doors({ plan, showHeaders }: { plan: FloorPlan; showHeaders: boolean }) {
  const H = plan.dimensions.height;
  // In the cut-away view door frames and leaves are trimmed to the wall cut height.
  const DH = showHeaders ? DOOR_H : 1.15;
  return (
    <group>
      {plan.doors.map((d) => {
        const rot = d.axis === "x" ? 0 : Math.PI / 2;
        const ext = (d.axis === "x" && (d.z < 0.01 || d.z > plan.dimensions.length - 0.01)) || (d.axis === "z" && (d.x < 0.01 || d.x > plan.dimensions.width - 0.01));
        const t = ext ? 0.25 : 0.15;
        const glassDoor = d.kind === "entrance";
        return (
          <group key={d.id} position={[d.x, 0, d.z]} rotation={[0, rot, 0]}>
            {/* jambs */}
            {[-1, 1].map((s) => (
              <Box key={s} p={[s * (d.width / 2 + 0.02), DH / 2, 0]} s={[0.05, DH, t + 0.02]} m={M.frame()} />
            ))}
            {showHeaders && (
              <>
                <Box p={[0, DOOR_H + 0.03, 0]} s={[d.width + 0.1, 0.06, t + 0.02]} m={M.frame()} />
                <Box p={[0, (DOOR_H + H) / 2 + 0.03, 0]} s={[d.width + 0.04, H - DOOR_H - 0.06, t]} m={ext ? M.wallExterior() : M.wall()} />
              </>
            )}
            {glassDoor ? (
              // Sliding glass doors, parked open behind the side panels.
              [-1, 1].map((s) => (
                <group key={s} position={[s * d.width * 0.36, 0, -0.03]}>
                  <Box p={[0, DH / 2, 0]} s={[d.width * 0.46, DH - 0.04, 0.02]} m={M.glass()} shadow={false} />
                  <Box p={[0, DH / 2, 0]} s={[d.width * 0.46, 0.05, 0.03]} m={M.frame()} />
                  <Box p={[0, DH - 0.04, 0]} s={[d.width * 0.46, 0.05, 0.03]} m={M.frame()} />
                </group>
              ))
            ) : (
              // Hinged leaf swung open ~75°.
              <group position={[-d.width / 2, 0, 0]} rotation={[0, d.kind === "emergency" ? -1.3 : 1.3, 0]}>
                <Box p={[d.width / 2, DH / 2, 0]} s={[d.width - 0.04, DH - 0.04, 0.045]} m={d.kind === "emergency" ? M.plastic("#c9ccd1") : d.kind === "delivery" ? M.plastic("#d9d9d9") : M.door()} />
                <Box p={[d.width - 0.12, 1.05, 0.04]} s={[0.12, 0.025, 0.025]} m={M.steelDark()} />
              </group>
            )}
            {d.kind === "emergency" && showHeaders && (
              <mesh geometry={G.plane} material={cachedBasic("exit", () => labelTexture("EXIT", "#0b8a3a"))} position={[0, DOOR_H + 0.2, t / 2 + 0.02]} scale={[0.5, 0.16, 1]} />
            )}
            {d.kind === "delivery" && showHeaders && (
              <mesh geometry={G.plane} material={cachedBasic("riders", () => labelTexture("DELIVERY RIDERS", "#FFD400", "#111"))} position={[0, DOOR_H + 0.22, -(t / 2 + 0.02)]} rotation={[0, Math.PI, 0]} scale={[0.9, 0.22, 1]} />
            )}
          </group>
        );
      })}
    </group>
  );
});

export const Windows = memo(function Windows({ plan }: { plan: FloorPlan }) {
  return (
    <group>
      {plan.windows.map((w) => {
        const rot = w.axis === "x" ? 0 : Math.PI / 2;
        const mullions = Math.max(1, Math.round(w.width / 1.2));
        return (
          <group key={w.id} position={[w.x, 0, w.z]} rotation={[0, rot, 0]}>
            <Box p={[0, w.sill + w.height / 2, 0]} s={[w.width, w.height, 0.03]} m={M.glass()} shadow={false} />
            <Box p={[0, w.sill + 0.02, 0]} s={[w.width + 0.04, 0.05, 0.12]} m={M.frame()} />
            <Box p={[0, w.sill + w.height - 0.02, 0]} s={[w.width + 0.04, 0.05, 0.12]} m={M.frame()} />
            {Array.from({ length: mullions + 1 }).map((_, i) => (
              <Box key={i} p={[-w.width / 2 + (i * w.width) / mullions, w.sill + w.height / 2, 0]} s={[0.05, w.height, 0.1]} m={M.frame()} />
            ))}
          </group>
        );
      })}
    </group>
  );
});

/* ───────────────────────── ceilings & roof ───────────────────────── */

export const Ceilings = memo(function Ceilings({ plan }: { plan: FloorPlan }) {
  const H = plan.dimensions.height;
  const lights = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (const r of plan.rooms) {
      const nx = Math.max(1, Math.round(r.w / 2.2));
      const nz = Math.max(1, Math.round(r.d / 2.2));
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) out.push([r.x + ((i + 0.5) * r.w) / nx, r.z + ((k + 0.5) * r.d) / nz]);
    }
    return out;
  }, [plan.rooms]);
  const kitchenish = (t: string) => !["dining", "customer"].includes(t);
  return (
    <group>
      {plan.rooms.map((r) => (
        <mesh key={r.id} geometry={G.plane} material={kitchenish(r.type) ? M.white() : M.ceiling()} position={[r.x + r.w / 2, H - 0.002, r.z + r.d / 2]} rotation={[Math.PI / 2, 0, 0]} scale={[r.w, r.d, 1]} />
      ))}
      {lights.map(([x, z], i) => (
        <mesh key={i} geometry={G.circle} material={M.emissive("#fff3dc", 2.2)} position={[x, H - 0.01, z]} rotation={[Math.PI / 2, 0, 0]} scale={0.28} />
      ))}
    </group>
  );
});

/** Roof slab, parapet and the street-facing brand facade. */
export const Exterior = memo(function Exterior({ plan }: { plan: FloorPlan }) {
  const { width: W, length: L, height: H } = plan.dimensions;
  const fasciaH = 1.1;
  const entrance = plan.doors.find((d) => d.kind === "entrance" && d.z < 0.01) ?? plan.doors.find((d) => d.kind === "entrance");
  const signW = Math.min(7.2, W * 0.5);
  const signX = Math.min(W - signW / 2 - 1.5, Math.max(signW / 2 + 0.8, entrance ? entrance.x - 0.4 : W / 2));
  const signMat = useMemo(() => new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, toneMapped: false }), []);
  const tagMat = useMemo(() => new THREE.MeshBasicMaterial({ map: taglineTexture(), transparent: true, toneMapped: false }), []);
  const badgeMat = useMemo(() => new THREE.MeshBasicMaterial({ map: badgeTexture(), transparent: true, toneMapped: false }), []);
  const posterMat = useMemo(() => new THREE.MeshBasicMaterial({ map: posterTexture(), toneMapped: false }), []);
  const southWindows = plan.windows.filter((w) => w.axis === "x" && w.z < 0.01);
  return (
    <group>
      {/* roof slab + parapet */}
      <Box p={[W / 2, H + 0.08, L / 2]} s={[W + 0.3, 0.16, L + 0.3]} m={M.plastic("#4a4d52")} />
      <Box p={[W / 2, H + fasciaH / 2, L + 0.1]} s={[W + 0.3, fasciaH, 0.15]} m={M.plastic("#d9d4cc")} />
      <Box p={[-0.1, H + fasciaH / 2, L / 2]} s={[0.15, fasciaH, L + 0.3]} m={M.plastic("#d9d4cc")} />
      <Box p={[W + 0.1, H + fasciaH / 2, L / 2]} s={[0.15, fasciaH, L + 0.3]} m={M.plastic("#d9d4cc")} />
      {/* rooftop plant */}
      <Slab p={[W * 0.7, H + 0.16, L * 0.6]} s={[1.4, 0.9, 1.0]} m={M.plastic("#b9bcc0")} />
      <Slab p={[W * 0.3, H + 0.16, L * 0.7]} s={[1.0, 0.7, 0.9]} m={M.plastic("#b9bcc0")} />
      <Cyl p={[W * 0.45, H + 0.7, L * 0.45]} radius={0.35} h={1.1} m={M.brushed()} />
      {/* red ACP fascia band across the frontage */}
      <Box p={[W / 2, H + fasciaH / 2 - 0.15, -0.2]} s={[W + 0.5, fasciaH + 0.3, 0.3]} m={M.redCladding()} />
      <Box p={[W / 2, H - 0.42, -0.36]} s={[W + 0.5, 0.06, 0.04]} m={M.white()} />
      {/* box frames / pilasters around the glazed storefront */}
      {[-0.1, W + 0.1].map((x) => (
        <Box key={x} p={[x, H / 2, -0.2]} s={[0.4, H, 0.32]} m={M.redCladding()} />
      ))}
      {southWindows.map((w) => (
        <Box key={w.id} p={[w.x, w.sill + w.height + 0.08, -0.2]} s={[w.width + 0.3, 0.16, 0.3]} m={M.redCladding()} />
      ))}
      {/* entrance canopy */}
      {entrance && entrance.z < 0.01 && (
        <group position={[entrance.x, 0, 0]}>
          <Box p={[0, 2.55, -0.75]} s={[entrance.width + 1.4, 0.18, 1.5]} m={M.redCladding()} />
          <Box p={[0, 2.45, -0.75]} s={[entrance.width + 1.2, 0.02, 1.3]} m={M.emissive("#fff2d6", 1.2)} shadow={false} />
          <mesh geometry={G.plane} material={cachedBasic("welcome", () => labelTexture("WELCOME", "#EE1D25"))} position={[0, 2.55, -1.51]} rotation={[0, Math.PI, 0]} scale={[1.2, 0.16, 1]} />
          {/* artificial-turf entrance strip, as seen at several branches */}
          <mesh geometry={G.plane} material={M.plastic("#3f8a2f")} position={[0, 0.008, -1.2]} rotation={[-Math.PI / 2, 0, 0]} scale={[entrance.width + 0.6, 2.2, 1]} receiveShadow />
        </group>
      )}
      {/* illuminated channel letters + Pizzaman badge, facing the street (-z) */}
      <group position={[signX, H + 0.38, -0.37]} rotation={[0, Math.PI, 0]}>
        <mesh geometry={G.plane} material={signMat} scale={[signW, signW / 4, 1]} />
        <mesh geometry={G.plane} material={tagMat} position={[signW * 0.12, -signW * 0.11, 0.001]} scale={[signW * 0.32, signW * 0.06, 1]} />
        <group position={[signW / 2 + 0.75, 0.05, -0.02]}>
          <mesh geometry={G.circle} material={badgeMat} scale={1.05} />
          <mesh geometry={G.ring} material={M.emissive("#4aa8ff", 1.6)} position={[0, 0, -0.01]} scale={1.12} />
        </group>
      </group>
      {/* "Good food is here" banner on the side wall */}
      <mesh geometry={G.plane} material={posterMat} position={[-0.14, 1.9, Math.min(2.4, L * 0.25)]} rotation={[0, -Math.PI / 2, 0]} scale={[1.4, 2.1, 1]} />
    </group>
  );
});

/* ───────────────────────── site ───────────────────────── */

export const Site = memo(function Site({ plan }: { plan: FloorPlan }) {
  const { width: W, length: L } = plan.dimensions;
  const lot = Math.max(12, W * 0.9);
  const palms = useMemo(() => {
    const xs = [-3.2, W + 3.2];
    return [...xs.map((x) => [x, -2.6] as [number, number]), [W + 3.2, L * 0.6] as [number, number], [-3.2, L * 0.7] as [number, number]];
  }, [W, L]);
  const bays = Math.floor(lot / 2.6);
  return (
    <group>
      {/* ground */}
      <mesh geometry={G.plane} material={M.grass()} position={[W / 2, -0.03, L / 2 - 6]} rotation={[-Math.PI / 2, 0, 0]} scale={[W + 60, L + 60, 1]} receiveShadow />
      {/* pavement apron around the building */}
      <mesh geometry={G.plane} material={M.pavement()} position={[W / 2, -0.01, L / 2 - 1]} rotation={[-Math.PI / 2, 0, 0]} scale={[W + 8, L + 6, 1]} receiveShadow />
      {/* car park */}
      <mesh geometry={G.plane} material={M.asphalt()} position={[W / 2, -0.005, -7.5]} rotation={[-Math.PI / 2, 0, 0]} scale={[W + 8, 7, 1]} receiveShadow />
      {Array.from({ length: bays + 1 }).map((_, i) => (
        <mesh key={i} geometry={G.plane} material={M.lineWhite()} position={[W / 2 - lot / 2 + i * 2.6, 0.001, -6.2]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.08, 4.4, 1]} />
      ))}
      {/* road with centre line */}
      <mesh geometry={G.plane} material={M.asphalt()} position={[W / 2, -0.004, -14.5]} rotation={[-Math.PI / 2, 0, 0]} scale={[W + 80, 7, 1]} receiveShadow />
      {Array.from({ length: 14 }).map((_, i) => (
        <mesh key={i} geometry={G.plane} material={M.lineYellow()} position={[W / 2 - 39 + i * 6, 0.002, -14.5]} rotation={[-Math.PI / 2, 0, 0]} scale={[3, 0.14, 1]} />
      ))}
      <Box p={[W / 2, 0.06, -11.1]} s={[W + 80, 0.14, 0.25]} m={M.pavement()} />
      {/* parked cars + rider motorbike */}
      {carSpots(plan, lot).map(([x, color]) => (
        <Car key={x} p={[x, -5.6]} color={color} />
      ))}
      <Motorbike p={riderParking(plan)} />
      {palms.map(([x, z], i) => (
        <Palm key={i} p={[x, z]} s={1 + (i % 2) * 0.2} />
      ))}
      {/* planters along the frontage */}
      {[1.2, W - 1.2].map((x) => (
        <group key={x} position={[x, 0, -1.6]}>
          <Box p={[0, 0.25, 0]} s={[1.2, 0.5, 0.5]} m={M.plastic("#3a3d42")} />
          <Box p={[0, 0.55, 0]} s={[1.0, 0.25, 0.35]} m={M.leaf()} />
        </group>
      ))}
    </group>
  );
});

/** Parked cars in the bays, keeping the view line to the main entrance clear for the intro shot. */
function carSpots(plan: FloorPlan, lot: number): Array<[number, string]> {
  const W = plan.dimensions.width;
  const e = plan.doors.find((d) => d.kind === "entrance" && d.z < 0.01);
  const colors = ["#c9ccd1", "#1f3b5c", "#7a1a1a", "#f0f0f0"];
  const bays = Math.floor(lot / 2.6);
  const out: Array<[number, string]> = [];
  for (let i = 0; i < bays && out.length < 4; i += 2) {
    const x = W / 2 - lot / 2 + 1.3 + i * 2.6;
    if (e && x > e.x - 3 && x < e.x + 7) continue;
    out.push([x, colors[out.length % colors.length]]);
  }
  return out;
}

function riderParking(plan: FloorPlan): [number, number] {
  const d = plan.doors.find((x) => x.kind === "delivery");
  if (!d) return [plan.dimensions.width + 1.5, -1.5];
  if (d.axis === "x") return [d.x + 1.6, d.z - 2.2];
  return [d.x - 2.4, d.z + 1.2];
}

function Car({ p, color }: { p: [number, number]; color: string }) {
  const body = M.plastic(color);
  return (
    <group position={[p[0], 0, p[1]]}>
      <Box p={[0, 0.55, 0]} s={[1.8, 0.55, 4.2]} m={body} />
      <Box p={[0, 0.84, 0]} s={[1.76, 0.06, 4.1]} m={body} />
      <Box p={[0, 1.08, -0.25]} s={[1.56, 0.44, 2.1]} m={body} />
      <Box p={[0, 1.08, -0.25]} s={[1.6, 0.32, 1.9]} m={M.blackGloss()} />
      <Box p={[0, 1.31, -0.25]} s={[1.5, 0.04, 2.0]} m={body} />
      <Box p={[0, 0.4, -2.11]} s={[1.7, 0.16, 0.04]} m={M.steelDark()} />
      {[-0.65, 0.65].map((x) => (
        <Box key={x} p={[x, 0.68, -2.11]} s={[0.3, 0.1, 0.02]} m={M.emissive("#ff3030", 1.2)} />
      ))}
      {[-0.8, 0.8].flatMap((x) => [-1.35, 1.35].map((z) => <Cyl key={`${x}${z}`} p={[x, 0.33, z]} radius={0.33} h={0.24} m={M.rubber()} r={[0, 0, Math.PI / 2]} low />))}
      <Box p={[0, 0.55, 2.11]} s={[1.5, 0.12, 0.02]} m={M.emissive("#fff6d8", 0.6)} shadow={false} />
    </group>
  );
}

function Motorbike({ p }: { p: [number, number] }) {
  return (
    <group position={[p[0], 0, p[1]]} rotation={[0, 0.4, 0]}>
      {[-0.6, 0.6].map((z) => (
        <Cyl key={z} p={[0, 0.3, z]} radius={0.3} h={0.1} m={M.rubber()} r={[0, 0, Math.PI / 2]} low />
      ))}
      <Box p={[0, 0.6, 0]} s={[0.25, 0.3, 1.1]} m={M.plastic("#1b1c1f")} />
      <Box p={[0, 0.85, -0.45]} s={[0.5, 0.5, 0.45]} m={M.red()} />
      <Box p={[0, 1.0, 0.55]} s={[0.6, 0.04, 0.04]} m={M.steelDark()} />
    </group>
  );
}

function Palm({ p, s }: { p: [number, number]; s: number }) {
  const fronds = 7;
  return (
    <group position={[p[0], 0, p[1]]} scale={s}>
      <Cyl p={[0, 2.2, 0]} radius={0.14} h={4.4} m={M.trunk()} low />
      {Array.from({ length: fronds }).map((_, i) => {
        const a = (i / fronds) * Math.PI * 2;
        return (
          <group key={i} position={[0, 4.35, 0]} rotation={[0, a, 0]}>
            <mesh geometry={G.sphereLow} material={M.leaf()} position={[0.9, -0.25, 0]} rotation={[0, 0, -0.45]} scale={[2.0, 0.06, 0.45]} castShadow />
          </group>
        );
      })}
    </group>
  );
}
