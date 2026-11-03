"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { footprint } from "@/lib/floorplan/derive";
import type { Equipment } from "@/lib/floorplan/types";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { Task } from "@/lib/sim/types";
import { useApp } from "@/store/app";
import { M } from "./materials";
import { AssetBoundary, useManifest, type AssetEntry } from "./modelAssets";
import { G } from "./parts";
import { LIVE_PROPS, PropMesh, usePropSet, type PropSet } from "./propAssets";

/* ───────────── per-frame task index (built once per frame, shared) ───────────── */

interface Job {
  task: Task;
  progress: number;
}

export class LiveIndex {
  jobs = new Map<string, Job[]>();
  private frame = -1;
  constructor(private sim: BranchSimulation) {}
  update(frame: number) {
    if (frame === this.frame) return;
    this.frame = frame;
    for (const list of this.jobs.values()) list.length = 0;
    const sim = this.sim;
    for (const t of sim.tasks.values()) {
      if (!t.wsId || (t.state !== "working" && t.state !== "machine")) continue;
      const ws = sim.wsById.get(t.wsId);
      if (!ws) continue;
      const eqId = ws.equipmentIds[(t.slot ?? 0) % ws.equipmentIds.length];
      let progress = 0;
      if (t.state === "machine" && t.endsAt !== undefined) progress = 1 - (t.endsAt - sim.t) / t.duration;
      else if (t.startedAt !== undefined && t.endsAt !== undefined) progress = (sim.t - t.startedAt) / Math.max(0.1, t.endsAt - t.startedAt);
      let list = this.jobs.get(eqId);
      if (!list) this.jobs.set(eqId, (list = []));
      list.push({ task: t, progress: Math.max(0, Math.min(1, progress)) });
    }
  }
  get(eqId: string) {
    return this.jobs.get(eqId) ?? EMPTY;
  }
}
const EMPTY: Job[] = [];

function placed(e: Equipment) {
  return { position: e.position, rotation: [0, e.rotation, 0] as [number, number, number] };
}

/* ───────────── equipment-specific animated props ───────────── */

function OvenLive({ e, index, frameRef, props }: { e: Equipment; index: LiveIndex; frameRef: { current: number }; props: PropSet | null }) {
  const pizzas = useRef<Array<THREE.Object3D | null>>([]);
  const raws = useRef<Array<THREE.Object3D | null>>([]);
  const [w, h] = e.size;
  const standH = h * 0.32;
  const deckH = (h - standH) / 2 - 0.02;
  const glow = useRef<THREE.Mesh>(null);
  const baked = props?.pizza;
  const raw = props?.["pizza-raw"];
  // One material per belt slot so each pizza browns on its own schedule.
  const mats = useMemo(
    () => Array.from({ length: 6 }, () => (baked ? (baked.material as THREE.MeshStandardMaterial).clone() : new THREE.MeshStandardMaterial({ color: "#f1dcae", roughness: 0.8 }))),
    [baked],
  );
  useFrame(() => {
    index.update(frameRef.current);
    const jobs = index.get(e.id);
    let n = 0;
    for (const j of jobs) {
      if (j.task.state !== "machine") continue;
      const m = pizzas.current[n];
      if (!m) break;
      const deck = n % 2;
      const x = -w / 2 + 0.15 + j.progress * (w - 0.3);
      const y = standH + deck * (deckH + 0.02) + deckH * 0.3 + 0.025;
      const mat = mats[n] as THREE.MeshStandardMaterial;
      if (baked) {
        // Model origin is the pizza's underside (the old disc was centred and 2.5 cm tall).
        const r = raws.current[n];
        const rawPhase = !!raw && j.progress < 0.35;
        m.visible = !rawPhase;
        m.position.set(x, y - 0.0125, 0.06);
        if (r) {
          r.visible = rawPhase;
          r.position.copy(m.position);
        }
        const k = Math.max(0, (j.progress - 0.35) / 0.65);
        mat.color.setRGB(1.12 - k * 0.2, 1.1 - k * 0.24, 1.0 - k * 0.22);
      } else {
        m.visible = true;
        m.position.set(x, y, 0.06);
        mat.color.setRGB(0.95 - j.progress * 0.15, 0.82 - j.progress * 0.25, 0.55 - j.progress * 0.25);
      }
      n++;
    }
    for (let i = n; i < pizzas.current.length; i++) {
      if (pizzas.current[i]) pizzas.current[i]!.visible = false;
      if (raws.current[i]) raws.current[i]!.visible = false;
    }
    if (glow.current) (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity = n ? 1.6 + Math.sin(performance.now() / 300) * 0.3 : 0.2;
  });
  return (
    <group {...placed(e)}>
      {mats.map((m, i) =>
        baked ? (
          <group key={i}>
            <group ref={(el) => void (pizzas.current[i] = el)} visible={false}>
              <PropMesh prop={baked} material={m} />
            </group>
            {raw && (
              <group ref={(el) => void (raws.current[i] = el)} visible={false}>
                <PropMesh prop={raw} />
              </group>
            )}
          </group>
        ) : (
          <mesh key={i} ref={(el) => void (pizzas.current[i] = el)} geometry={G.cylLow} material={m} scale={[0.34, 0.025, 0.34]} visible={false} />
        ),
      )}
      <mesh ref={glow} geometry={G.box} position={[0, standH + deckH * 0.42, 0.06]} scale={[w * 0.6 + 0.02, deckH * 0.18, 0.02]}>
        <meshStandardMaterial color="#ff6a1a" emissive="#ff6a1a" emissiveIntensity={0.2} toneMapped={false} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function FryerLive({ e, index, frameRef, props }: { e: Equipment; index: LiveIndex; frameRef: { current: number }; props: PropSet | null }) {
  const basket = props?.["chicken-basket"];
  const [w, h, d] = e.size;
  const top = h * 0.82;
  const baskets = useRef<Array<THREE.Group | null>>([]);
  const bubbles = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    index.update(frameRef.current);
    const jobs = index.get(e.id).filter((j) => j.task.state === "machine");
    const active = jobs.length;
    baskets.current.forEach((b, i) => {
      if (!b) return;
      const down = i < active;
      const targetY = down ? top - 0.14 : top + 0.18;
      b.position.y += (targetY - b.position.y) * (1 - Math.exp(-dt * 4));
      b.rotation.x = down ? 0 : -0.5;
    });
    const im = bubbles.current;
    if (im) {
      const t = performance.now() / 1000;
      for (let i = 0; i < 24; i++) {
        const well = i % 2 ? 0.24 : -0.24;
        const on = (i % 2 ? active > 1 : active > 0) ? 1 : 0;
        const ph = (t * (1.5 + (i % 5) * 0.3) + i * 0.37) % 1;
        tmp.position.set(well * w + Math.sin(i * 12.9) * w * 0.17, top + ph * 0.012, 0.03 + Math.cos(i * 7.3) * d * 0.25);
        tmp.scale.setScalar(on * (0.012 + ph * 0.012));
        tmp.updateMatrix();
        im.setMatrixAt(i, tmp.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group {...placed(e)}>
      {[-0.24, 0.24].map((x, i) => (
        <group key={x} ref={(el) => void (baskets.current[i] = el)} position={[x * w, top + 0.18, 0.03]}>
          {basket ? (
            // Wire basket + fried chicken, modelled for the catalogue fryer and scaled to this one (origin = basket underside).
            <group position={[0, -0.07, 0]} scale={[(w * 0.36) / 0.324, 1, (d * 0.5) / 0.4]}>
              <PropMesh prop={basket} />
            </group>
          ) : (
            <>
              <mesh geometry={G.box} material={basketMat} scale={[w * 0.36, 0.14, d * 0.5]} />
              <mesh geometry={G.box} material={M.black()} position={[0, 0.06, d * 0.32]} scale={[0.03, 0.03, d * 0.25]} />
            </>
          )}
        </group>
      ))}
      <instancedMesh ref={bubbles} args={[G.sphereLow, bubbleMat, 24]} />
    </group>
  );
}
const basketMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", metalness: 0.7, roughness: 0.4, wireframe: true });
const bubbleMat = new THREE.MeshStandardMaterial({ color: "#f1c96b", roughness: 0.1, transparent: true, opacity: 0.8 });

function SteamLive({ e, index, frameRef, kind }: { e: Equipment; index: LiveIndex; frameRef: { current: number }; kind: "stove" | "warmer" }) {
  const [w, h] = e.size;
  const ref = useRef<THREE.InstancedMesh>(null);
  const burners = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const N = 18;
  useFrame(() => {
    index.update(frameRef.current);
    const active = index.get(e.id).length > 0 || kind === "warmer";
    const t = performance.now() / 1000;
    const im = ref.current;
    if (im) {
      for (let i = 0; i < N; i++) {
        const ph = (t * 0.35 + i / N) % 1;
        const x = kind === "stove" ? (i % 2 ? 0.25 : -0.25) * w : (-0.33 + (i % 3) * 0.33) * w;
        const base = kind === "stove" ? h * 0.5 + 0.5 : h * 0.85;
        tmp.position.set(x + Math.sin(t + i) * 0.05, base + ph * 0.8, Math.cos(t * 0.7 + i) * 0.05);
        tmp.scale.setScalar(active ? (0.08 + ph * 0.22) * (kind === "warmer" ? 0.5 : 1) : 0);
        tmp.updateMatrix();
        im.setMatrixAt(i, tmp.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    if (burners.current) burners.current.visible = active && kind === "stove";
  });
  return (
    <group {...placed(e)}>
      <instancedMesh ref={ref} args={[G.sphereLow, steamMat, N]} />
      {kind === "stove" && (
        <mesh ref={burners} geometry={G.box} material={M.emissive("#ff6a1a", 2)} position={[0, h * 0.5 + 0.005, 0]} scale={[w * 0.8, 0.01, 0.04]} />
      )}
    </group>
  );
}
const steamMat = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.18, depthWrite: false, roughness: 1 });

function HoldingLive({ e, sim, props }: { e: Equipment; sim: BranchSimulation; props: PropSet | null }) {
  const [w, h, d] = e.size;
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const drum = props?.["chicken-drum"];
  const MAX = 36;
  useFrame(() => {
    const im = ref.current;
    if (!im) return;
    const stock = sim.chickenStock.wing + sim.chickenStock.drum;
    // Show held stock proportionally across the cabinet trays.
    const holders = sim.plan.equipment.filter((x) => x.type === "hot-holding").length || 1;
    const n = Math.min(MAX, Math.round(stock / holders / 1.2));
    for (let i = 0; i < MAX; i++) {
      const tray = Math.floor(i / 12);
      const k = i % 12;
      const y = h * [0.33, 0.53, 0.73][tray];
      tmp.rotation.set(0, i * 1.3, 0);
      if (drum) {
        // Fried drumsticks resting on the tray (model origin = underside).
        tmp.position.set((-0.38 + (k % 6) * 0.15) * w, y + 0.004, (k < 6 ? -0.12 : 0.08) * d);
        tmp.scale.setScalar(i < n ? 1 : 0);
        tmp.updateMatrix();
        tmp.matrix.multiply(drum.node);
      } else {
        tmp.position.set((-0.38 + (k % 6) * 0.15) * w, y + 0.03, (k < 6 ? -0.12 : 0.08) * d);
        tmp.scale.set(i < n ? 0.11 : 0, 0.06, 0.07);
        tmp.updateMatrix();
      }
      im.setMatrixAt(i, tmp.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <group {...placed(e)}>
      <instancedMesh key={drum ? "drum" : "blob"} ref={ref} args={drum ? [drum.geometry, drum.material, MAX] : [G.sphereLow, M.chicken(), MAX]} />
    </group>
  );
}

/** Which prop stands for a task's item on the QC pass / packing bench. */
function itemProp(sim: BranchSimulation, t: Task, kind: "pack" | "qc"): string {
  const unitKind = (id?: string) => (id ? sim.units.get(id)?.kind : undefined);
  if (kind === "qc") {
    if (t.kind === "chicken-batch") return "chicken-tray";
    const k = unitKind(t.unitId);
    return k === "chicken" ? "chicken-bucket" : k === "rice" ? "rice-pack" : k === "side" ? "side-cup" : k === "drink" ? "drink-bottle" : "pizza-tray";
  }
  const order = t.orderId ? sim.orders.get(t.orderId) : undefined;
  const kinds = new Set(order?.unitIds.map((id) => unitKind(id)) ?? []);
  return kinds.has("pizza") ? "pizza-box" : kinds.has("chicken") ? "chicken-bucket" : kinds.has("rice") ? "rice-pack" : "takeaway-bag";
}

const WORK_PROPS: Record<"makeline" | "pack" | "prep" | "qc", string[]> = {
  makeline: ["pizza-raw"],
  prep: ["chicken-tray"],
  pack: ["pizza-box-open", "pizza-box", "chicken-bucket", "rice-pack", "takeaway-bag"],
  qc: ["pizza-tray", "chicken-tray", "chicken-bucket", "rice-pack", "side-cup", "drink-bottle"],
};

function WorkItemsLive({ e, sim, index, frameRef, kind, props }: { e: Equipment; sim: BranchSimulation; index: LiveIndex; frameRef: { current: number }; kind: "makeline" | "pack" | "prep" | "qc"; props: PropSet | null }) {
  const [w, h, d] = e.size;
  const items = useRef<Array<THREE.Group | null>>([]);
  const variants = useRef<Array<Record<string, THREE.Object3D | null>>>([{}, {}]);
  const usable = WORK_PROPS[kind].filter((n) => props?.[n]);
  const modelled = usable.length > 0;
  useFrame(() => {
    index.update(frameRef.current);
    const jobs = index.get(e.id).filter((j) => j.task.state === "working");
    items.current.forEach((g, i) => {
      if (!g) return;
      const j = jobs[i];
      g.visible = !!j;
      if (!j) return;
      // Topping/assembly progress grows the item.
      const s = kind === "makeline" ? 0.5 + j.progress * 0.5 : 1;
      g.scale.setScalar(s);
      if (modelled && usable.length > 1) {
        let want = kind === "pack" || kind === "qc" ? itemProp(sim, j.task, kind) : usable[0];
        if (want === "pizza-box" && j.progress < 0.6) want = "pizza-box-open";
        if (!props?.[want]) want = usable[0];
        for (const [name, o] of Object.entries(variants.current[i])) if (o) o.visible = name === want;
      }
    });
  });
  const y = kind === "makeline" ? h * 0.88 + 0.03 : kind === "qc" ? 1.03 : h + 0.01;
  const z = kind === "makeline" ? d * 0.18 : 0.05;
  // Underside of the old procedural stand-ins, so modelled props rest on the same surfaces.
  const base = kind === "makeline" ? -0.01 : kind === "qc" ? 0 : 0.005;
  return (
    <group {...placed(e)}>
      {[-0.25, 0.25].map((x, i) => (
        <group key={x} ref={(el) => void (items.current[i] = el)} position={[x * w, y, z]} visible={false}>
          {modelled ? (
            usable.map((name, k) => (
              <group key={name} ref={(el) => void (variants.current[i][name] = el)} position={[0, base, 0]} visible={k === 0}>
                <PropMesh prop={props![name]!} />
              </group>
            ))
          ) : kind === "makeline" ? (
            <>
              <mesh geometry={G.cylLow} material={M.dough()} scale={[0.34, 0.02, 0.34]} />
              <mesh geometry={G.cylLow} material={M.sauce()} position={[0, 0.012, 0]} scale={[0.29, 0.006, 0.29]} />
              <mesh geometry={G.cylLow} material={M.cheese()} position={[0, 0.017, 0]} scale={[0.26, 0.004, 0.26]} />
            </>
          ) : kind === "pack" ? (
            <mesh geometry={G.box} material={M.boxWhite()} position={[0, 0.03, 0]} scale={[0.36, 0.05, 0.36]} />
          ) : kind === "qc" ? (
            <mesh geometry={G.cylLow} material={M.pizza()} position={[0, 0.01, 0]} scale={[0.34, 0.02, 0.34]} />
          ) : (
            <mesh geometry={G.box} material={M.chicken()} position={[0, 0.03, 0]} scale={[0.3, 0.05, 0.2]} />
          )}
        </group>
      ))}
    </group>
  );
}

/** Bags waiting at the collection counter / dispatch rack for READY orders. */
function ReadyBags({ sim, e, fulfilment, props }: { sim: BranchSimulation; e: Equipment; fulfilment: "pickup" | "delivery"; props: PropSet | null }) {
  const [w, h, d] = e.size;
  const bags = useRef<Array<THREE.Object3D | null>>([]);
  const bag = props?.["takeaway-bag"];
  useFrame(() => {
    let n = 0;
    for (const o of sim.orders.values()) {
      if (o.status !== "READY") continue;
      if ((o.fulfilment === "delivery") !== (fulfilment === "delivery")) continue;
      n++;
    }
    bags.current.forEach((b, i) => b && (b.visible = i < n));
  });
  const slots = fulfilment === "delivery" ? 8 : 5;
  return (
    <group {...placed(e)}>
      {Array.from({ length: slots }).map((_, i) => {
        const pos: [number, number, number] =
          fulfilment === "delivery" ? [(-0.3 + (i % 4) * 0.2) * w, 0.15 + 0.15 + Math.floor(i / 4) * ((h - 0.2) / 3), 0] : [(-0.4 + i * 0.2) * w, h + 0.15, -d * 0.1];
        if (bag) {
          // Paper bag standing on the shelf / worktop (the old box was centred at pos and 0.3 m tall;
          // on the rack it now sits on the wire shelf instead of 1.5 cm into it).
          const seat = fulfilment === "delivery" ? 0.015 : 0;
          return (
            <group key={i} ref={(el) => void (bags.current[i] = el)} position={[pos[0], pos[1] - 0.15 + seat, pos[2]]} rotation={[0, (i % 3) * 0.2 - 0.2, 0]} scale={0.88} visible={false}>
              <PropMesh prop={bag} shadow />
            </group>
          );
        }
        return <mesh key={i} ref={(el) => void (bags.current[i] = el)} geometry={G.box} material={M.bag()} position={pos} scale={[0.22, 0.3, 0.14]} visible={false} castShadow />;
      })}
    </group>
  );
}

/* ───────────── status rings, fault highlight, labels ───────────── */

const ringMats = {
  active: new THREE.MeshBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
  fault: new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
  offline: new THREE.MeshBasicMaterial({ color: "#9ca3af", transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
};

function StatusRing({ e, sim }: { e: Equipment; sim: BranchSimulation }) {
  const ref = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const { hw, hd } = footprint(e.size, e.rotation);
  const r = Math.max(hw, hd) + 0.18;
  const sensorIds = useMemo(() => sim.plan.sensors.filter((s) => s.equipmentId === e.id).map((s) => s.id), [sim, e.id]);
  useFrame(() => {
    const st = sim.equipment.get(e.id);
    const m = ref.current;
    if (!st || !m) return;
    const critical = !!st.fault || sensorIds.some((id) => sim.sensors.get(id)?.status === "critical");
    const status = critical ? (st.status === "offline" ? "offline" : "fault") : st.status === "active" ? "active" : null;
    m.visible = !!status;
    if (status) m.material = ringMats[status as keyof typeof ringMats];
    if (halo.current) {
      halo.current.visible = critical && st.status !== "offline";
      const pulse = 0.25 + (Math.sin(performance.now() / 220) + 1) * 0.2;
      (halo.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  });
  return (
    <group position={[e.position[0], 0, e.position[2]]}>
      <mesh ref={ref} geometry={G.ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} scale={r * 2} visible={false} />
      <mesh ref={halo} geometry={G.box} position={[0, e.position[1] + e.size[1] / 2, 0]} rotation={[0, e.rotation, 0]} scale={[e.size[0] + 0.12, e.size[1] + 0.12, e.size[2] + 0.12]} visible={false}>
        <meshBasicMaterial color="#ff2a2a" transparent opacity={0.3} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Animated food, baskets, bags and equipment status. Uses the Blender-built props
 * (public/models/props) when available and Settings → 3D assets is "Blender models";
 * the procedural stand-ins otherwise (and while loading / on a load error).
 */
export const LiveLayer = memo(function LiveLayer({ sim }: { sim: BranchSimulation }) {
  const manifest = useManifest();
  const mode = useApp((s) => s.assetMode);
  const entries = useMemo(() => {
    if (mode !== "models" || !manifest) return null;
    const out: Record<string, AssetEntry> = {};
    for (const n of LIVE_PROPS) if (manifest.assets[n]) out[n] = manifest.assets[n];
    return Object.keys(out).length ? out : null;
  }, [manifest, mode]);
  const plain = <LiveScene sim={sim} props={null} />;
  if (!entries) return plain;
  return (
    <AssetBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <LiveWithProps sim={sim} entries={entries} />
      </Suspense>
    </AssetBoundary>
  );
});

function LiveWithProps({ sim, entries }: { sim: BranchSimulation; entries: Record<string, AssetEntry> }) {
  const props = usePropSet(entries);
  return <LiveScene sim={sim} props={props} />;
}

function LiveScene({ sim, props }: { sim: BranchSimulation; props: PropSet | null }) {
  const index = useMemo(() => new LiveIndex(sim), [sim]);
  const frameRef = useRef(0);
  useFrame(() => {
    frameRef.current++;
  }, -2);
  const eq = sim.plan.equipment;
  return (
    <group>
      {eq.map((e) => {
        switch (e.type) {
          case "conveyor-oven":
          case "deck-oven":
            return <OvenLive key={e.id} e={e} index={index} frameRef={frameRef} props={props} />;
          case "fryer":
            return <FryerLive key={e.id} e={e} index={index} frameRef={frameRef} props={props} />;
          case "rice-stove":
            return <SteamLive key={e.id} e={e} index={index} frameRef={frameRef} kind="stove" />;
          case "rice-warmer":
            return <SteamLive key={e.id} e={e} index={index} frameRef={frameRef} kind="warmer" />;
          case "hot-holding":
            return <HoldingLive key={e.id} e={e} sim={sim} props={props} />;
          case "pizza-makeline":
            return <WorkItemsLive key={e.id} e={e} sim={sim} index={index} frameRef={frameRef} kind="makeline" props={props} />;
          case "packaging-table":
            return <WorkItemsLive key={e.id} e={e} sim={sim} index={index} frameRef={frameRef} kind="pack" props={props} />;
          case "breading-station":
            return <WorkItemsLive key={e.id} e={e} sim={sim} index={index} frameRef={frameRef} kind="prep" props={props} />;
          case "qc-pass":
            return <WorkItemsLive key={e.id} e={e} sim={sim} index={index} frameRef={frameRef} kind="qc" props={props} />;
          // A prep table's items sit on its worktop, not on the QC pass shelf height.
          case "prep-table":
            return <WorkItemsLive key={e.id} e={e} sim={sim} index={index} frameRef={frameRef} kind="prep" props={props} />;
          case "pickup-counter":
            return <ReadyBags key={e.id} sim={sim} e={e} fulfilment="pickup" props={props} />;
          case "dispatch-rack":
            return <ReadyBags key={e.id} sim={sim} e={e} fulfilment="delivery" props={props} />;
          default:
            return null;
        }
      })}
      {eq
        .filter((e) => !["hood", "menu-board", "shelving", "toilet", "lockers", "mop-sink", "desk"].includes(e.type))
        .map((e) => (
          <StatusRing key={`ring-${e.id}`} e={e} sim={sim} />
        ))}
    </group>
  );
}

/* ───────────── HTML overlays (refreshed on the 4 Hz tick) ───────────── */

const STAGE_SHORT: Record<string, string> = {
  "pizza-prep": "Prep",
  oven: "Bake",
  "chicken-prep": "Bread",
  fryer: "Fry",
  rice: "Rice",
  qc: "QC",
  packaging: "Pack",
  pickup: "Hand-over",
  dispatch: "Dispatch",
  "order-counter": "Order",
};

export function OrderChips({ sim, version, onOrder }: { sim: BranchSimulation; version: number; onOrder?: (id: string) => void }) {
  const chips = useMemo(() => {
    const out: Array<{ wsId: string; pos: [number, number, number]; lines: Array<{ id?: string; label: string; remain: number }> }> = [];
    const byWs = new Map<string, Task[]>();
    for (const t of sim.tasks.values()) {
      if (!t.wsId || (t.state !== "working" && t.state !== "machine")) continue;
      if (t.kind === "serve" || t.kind === "clean") continue;
      const list = byWs.get(t.wsId) ?? [];
      list.push(t);
      byWs.set(t.wsId, list);
    }
    for (const [wsId, tasks] of byWs) {
      const ws = sim.wsById.get(wsId)!;
      const e = sim.eqById.get(ws.equipmentIds[0]);
      const top = e ? e.position[1] + e.size[1] : 1.2;
      out.push({
        wsId,
        pos: [e?.position[0] ?? ws.standPoint[0], Math.max(1.6, top + 0.45), e?.position[2] ?? ws.standPoint[1]],
        lines: tasks.slice(0, 3).map((t) => {
          const o = t.orderId ? sim.orders.get(t.orderId) : undefined;
          const remain = Math.max(0, (t.endsAt ?? sim.t) - sim.t);
          const label = o ? `#${o.number} · ${STAGE_SHORT[t.ws] ?? t.ws}` : t.kind === "chicken-batch" ? `Batch · ${STAGE_SHORT[t.ws] ?? t.ws}` : t.kind === "rice-batch" ? "Rice batch" : STAGE_SHORT[t.ws] ?? t.ws;
          return { id: o?.id, label, remain };
        }),
      });
    }
    return out;
  }, [sim, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {chips.map((c) => (
        <Html key={c.wsId} position={c.pos} center distanceFactor={7} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="flex flex-col gap-0.5">
            {c.lines.map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => l.id && onOrder?.(l.id)}
                style={{ pointerEvents: l.id ? "auto" : "none" }}
                className="whitespace-nowrap rounded-md border border-white/15 bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-lg backdrop-blur"
              >
                <span className="text-amber-300">{l.label}</span> <span className="text-white/70">{fmt(l.remain)}</span>
              </button>
            ))}
          </div>
        </Html>
      ))}
    </>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function FaultLabels({ sim, version, onSelect }: { sim: BranchSimulation; version: number; onSelect?: (id: string) => void }) {
  const faults = useMemo(() => {
    const out: Array<{ e: Equipment; text: string; critical: boolean }> = [];
    for (const e of sim.plan.equipment) {
      const st = sim.equipment.get(e.id);
      const sensor = sim.plan.sensors.find((s) => s.equipmentId === e.id && s.unit === "°C");
      const ss = sensor ? sim.sensors.get(sensor.id) : undefined;
      const alert = sim.alerts.find((a) => a.equipmentId === e.id && a.status !== "resolved");
      if (!st?.fault && ss?.status !== "critical" && !alert) continue;
      const text = st?.fault?.kind === "sensor-offline" ? "SENSOR OFFLINE" : ss?.value !== null && ss?.value !== undefined ? `${ss.value.toFixed(1)} °C · ${alert ? alert.status.toUpperCase() : "OUT OF RANGE"}` : alert?.title ?? "FAULT";
      out.push({ e, text, critical: alert?.severity === "critical" || ss?.status === "critical" });
    }
    return out;
  }, [sim, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {faults.map(({ e, text, critical }) => (
        <Html key={e.id} position={[e.position[0], e.position[1] + e.size[1] + 0.55, e.position[2]]} center distanceFactor={6} zIndexRange={[30, 0]}>
          <button type="button" onClick={() => onSelect?.(e.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-bold text-white shadow-xl ${critical ? "animate-pulse border-red-400 bg-red-600/90" : "border-amber-300 bg-amber-600/90"}`}>
            <span>⚠</span>
            <span>{e.name}</span>
            <span className="font-mono font-semibold text-white/90">{text}</span>
          </button>
        </Html>
      ))}
    </>
  );
}

/** Yellow bracket box around the selected / hovered equipment. */
export function SelectionBox({ e, hover }: { e: Equipment; hover?: boolean }) {
  const ref = useRef<THREE.LineSegments>(null);
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  useFrame(() => {
    if (ref.current && !hover) (ref.current.material as THREE.LineBasicMaterial).opacity = 0.6 + Math.sin(performance.now() / 200) * 0.4;
  });
  return (
    <lineSegments ref={ref} geometry={geo} position={[e.position[0], e.position[1] + e.size[1] / 2, e.position[2]]} rotation={[0, e.rotation, 0]} scale={[e.size[0] + 0.08, e.size[1] + 0.08, e.size[2] + 0.08]}>
      <lineBasicMaterial color={hover ? "#ffffff" : "#FFD400"} transparent opacity={hover ? 0.6 : 1} toneMapped={false} />
    </lineSegments>
  );
}
