"use client";

import { create } from "zustand";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import type { NormalisedReading } from "./contracts";

interface LiveState {
  status: "connecting" | "connected" | "reconnecting";
  readings: number;
  lastReadingAt: number | null;
  /** Readings whose binding points at equipment missing from the branch floor plan. */
  unmatched: number;
  liveBranches: string[];
}

export const useLive = create<LiveState>(() => ({ status: "connecting", readings: 0, lastReadingAt: null, unmatched: 0, liveBranches: [] }));

let source: EventSource | null = null;

/**
 * Subscribe the command center to live device telemetry (SSE). EventSource
 * reconnects on its own and sends Last-Event-ID, so the server replays any
 * readings missed while the connection was down.
 */
export function startLiveTelemetry() {
  if (source || typeof EventSource === "undefined") return () => {};
  source = new EventSource("/api/stream/telemetry");
  source.onopen = () => useLive.setState({ status: "connected" });
  source.onerror = () => useLive.setState({ status: "reconnecting" });
  source.addEventListener("reading", (ev) => {
    let r: NormalisedReading;
    try {
      r = JSON.parse((ev as MessageEvent).data);
    } catch {
      return;
    }
    if (!BRANCH_BY_ID.has(r.branchId)) return;
    if (!sims().realtime) {
      sims().enableRealtime();
      useApp.getState().notify("Live device data received — clock switched to real time (1×)", "info");
    }
    const applied = sims().get(r.branchId).ingestReading(r);
    const s = useLive.getState();
    useLive.setState({
      readings: s.readings + 1,
      lastReadingAt: Date.now(),
      unmatched: s.unmatched + (applied ? 0 : 1),
      liveBranches: s.liveBranches.includes(r.branchId) ? s.liveBranches : [...s.liveBranches, r.branchId],
    });
  });
  return () => {
    source?.close();
    source = null;
  };
}
