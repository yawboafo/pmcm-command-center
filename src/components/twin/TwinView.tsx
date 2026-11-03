"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import CameraRig from "./CameraRig";
import { CameraDevices, CctvOverlay, MultiViewRenderer, PathsOverlay } from "./CctvGrid";
import { CameraList, CctvLabel, DemoMenu, FollowBanner, FpsHud, IntroOverlay, Toolbar } from "./Hud";
import PerfProbe from "./PerfProbe";
import { StationViews } from "./StationViews";
import RestaurantModel from "./RestaurantModel";

const QUALITY = {
  high: { dpr: 2, shadowsHi: true, msaa: 4, effects: true },
  balanced: { dpr: 1.5, shadowsHi: false, msaa: 2, effects: true },
  low: { dpr: 1, shadowsHi: false, msaa: 0, effects: false },
} as const;

/**
 * The branch digital twin: a restaurant generated from its floor plan JSON,
 * animated by that branch's simulation, with camera modes, a virtual camera
 * grid and the map → restaurant cinematic.
 */
export default function TwinView({ branchId }: { branchId: string }) {
  const sim = useMemo(() => sims().get(branchId), [branchId]);
  const graphics = useApp((s) => s.graphics);
  const phase = useApp((s) => s.phase);
  const cctvOpen = useApp((s) => s.cctvOpen);
  const tick = useApp((s) => s.tick);
  const selection = useApp((s) => s.selection);
  const xray = useApp((s) => s.xray);
  const showPaths = useApp((s) => s.showPaths);
  const activeCameraId = useApp((s) => s.activeCameraId);
  const select = useApp((s) => s.select);
  const setPhase = useApp((s) => s.setPhase);
  const mobile = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);
  const ceiling = QUALITY[graphics];
  // PerformanceMonitor adjusts these; the Settings graphics level is always the ceiling.
  const [dprWanted, setDpr] = useState<number>(mobile ? 1.25 : 2);
  const [hiQWanted, setHiQ] = useState<boolean>(!mobile);
  const dpr = Math.min(dprWanted, ceiling.dpr);
  const hiQ = hiQWanted && graphics !== "low";

  // Fallback: if the map never reports arrival (e.g. map failed to load), start the intro anyway.
  useEffect(() => {
    if (phase !== "flying") return;
    const t = setTimeout(() => useApp.getState().phase === "flying" && setPhase("exterior"), 3500);
    return () => clearTimeout(t);
  }, [phase, setPhase]);

  // A restarted simulation (top bar ↺) replaces the engine instance for this branch.
  const live = sims().peek(branchId) ?? sim;

  const selectedEq = selection?.kind === "equipment" ? selection.id : null;
  const highlight = useMemo(() => {
    if (!selection) return undefined;
    const p = live.plan;
    if (selection.kind === "workstation") return p.workstations.find((w) => w.id === selection.id)?.equipmentIds;
    if (selection.kind === "camera") return p.cameras.find((c) => c.id === selection.id)?.workstationIds.flatMap((w) => p.workstations.find((x) => x.id === w)?.equipmentIds ?? []);
    if (selection.kind === "alert") {
      const a = live.alerts.find((x) => x.id === selection.id);
      return a?.equipmentId ? [a.equipmentId] : undefined;
    }
    if (selection.kind === "order") {
      const ids = new Set<string>();
      for (const t of live.tasksFor(selection.id)) {
        if (!t.wsId) continue;
        const ws = live.wsById.get(t.wsId);
        if (ws) ids.add(ws.equipmentIds[(t.slot ?? 0) % ws.equipmentIds.length]);
      }
      return [...ids];
    }
    return undefined;
  }, [selection, live, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const effects = ceiling.effects && hiQ && !cctvOpen;
  const dusk = phase !== "inside";

  return (
    <div id="twin-root" className="relative h-full w-full select-none bg-[#0b0f16]">
      <Canvas
        shadows={graphics === "low" ? false : { type: THREE.PCFShadowMap }}
        dpr={dpr}
        camera={{ fov: 50, near: 0.1, far: 400, position: [0, 20, -30] }}
        gl={{ antialias: !effects, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        onPointerMissed={() => useApp.getState().selection?.kind !== "order" && select(null)}
      >
        {process.env.NODE_ENV !== "production" && <PerfProbe />}
        <PerformanceMonitor
          onDecline={() => {
            setDpr(1);
            setHiQ(false);
          }}
          onIncline={() => {
            setDpr((d) => Math.min(d + 0.25, mobile ? 1.5 : ceiling.dpr));
            if (graphics !== "low") setHiQ(true);
          }}
        />
        <Suspense fallback={null}>
          <RestaurantModel
            plan={live.plan}
            sim={live}
            cutaway
            xray={xray}
            dusk={dusk}
            quality={hiQ ? graphics : "low"}
            version={tick}
            selectedId={selectedEq}
            highlightIds={highlight}
            selectedAgentId={selection?.kind === "agent" ? selection.id : null}
            overlays={!cctvOpen && phase === "inside"}
            onSelectEquipment={(id) => select({ kind: "equipment", id })}
            onSelectAgent={(id) => select({ kind: "agent", id })}
            onSelectRoom={(id) => select({ kind: "room", id })}
            onSelectOrder={(id) => select({ kind: "order", id })}
            onFaultClick={(id) => select({ kind: "equipment", id })}
          />
          <CameraDevices cameras={live.plan.cameras} activeId={activeCameraId} />
          {showPaths && <PathsOverlay plan={live.plan} version={tick} />}
        </Suspense>
        <CameraRig key={live.plan.restaurantId} sim={live} />
        <MultiViewRenderer cameras={live.plan.cameras} composerActive={effects} />
        <EffectComposer enabled={effects} multisampling={ceiling.msaa}>
          <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.45} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <SMAA />
        </EffectComposer>
      </Canvas>

      <CctvOverlay plan={live.plan} />
      <IntroOverlay branchId={branchId} />
      {phase === "inside" && !cctvOpen && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
            <Toolbar />
          </div>
          <div className="pointer-events-none absolute right-3 top-14 z-10">
            <CameraList sim={live} />
          </div>
          <div className="pointer-events-none absolute left-3 top-14 z-10">
            <StationViews plan={live.plan} />
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 z-10">
            <DemoMenu sim={live} />
          </div>
          <CctvLabel sim={live} />
          <FollowBanner sim={live} />
          <FpsHud />
          <Legend />
        </>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-lg bg-black/45 px-3 py-1.5 text-[10px] text-white/70 backdrop-blur md:flex">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Active
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-red-500" /> Fault / alert
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-gray-400" /> Offline
      </span>
      <span className="text-amber-300">◆ Simulated operations · conceptual layout</span>
    </div>
  );
}
