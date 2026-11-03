"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

export interface PerfSample {
  fps: number;
  /** Draw calls and triangles of the last rendered frame. */
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/**
 * Development aid: once a second publishes frame rate and renderer statistics on
 * `window.__opsPerf`, so scene changes (e.g. procedural vs glTF equipment) can be
 * measured from the console or a test script. Renders nothing.
 */
export default function PerfProbe() {
  const get = useThree((s) => s.get);
  const acc = useRef({ frames: 0, since: 0 });
  // Count every pass of a frame (scene, CCTV tiles, post-processing), not just the last one.
  useEffect(() => {
    const { info } = get().gl;
    info.autoReset = false;
    return () => {
      info.autoReset = true;
    };
  }, [get]);
  useFrame(({ gl }) => gl.info.reset(), -10);
  // Read after the scene and post-processing have drawn (later priority).
  useFrame(({ gl }, dt) => {
    const a = acc.current;
    a.frames++;
    a.since += dt;
    if (a.since < 1) return;
    const info = gl.info;
    (window as unknown as { __opsPerf?: PerfSample }).__opsPerf = { fps: Math.round(a.frames / a.since), calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
    a.frames = 0;
    a.since = 0;
  }, 10);
  return null;
}
