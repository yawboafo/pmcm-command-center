"use client";

import { create } from "zustand";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import type { NormalisedOrderEvent, NormalisedReading } from "./contracts";

interface LiveState {
  status: "connecting" | "connected" | "reconnecting";
  readings: number;
  lastReadingAt: number | null;
  /** Readings whose binding points at equipment missing from the branch floor plan. */
  unmatched: number;
  liveBranches: string[];
  /** Live POS / ordering-system events applied (or ignored as unmappable). */
  orders: number;
}

export const useLive = create<LiveState>(() => ({ status: "connecting", readings: 0, lastReadingAt: null, unmatched: 0, liveBranches: [], orders: 0 }));

let source: EventSource | null = null;

function parse<T>(ev: Event): T | null {
  try {
    return JSON.parse((ev as MessageEvent).data) as T;
  } catch {
    return null;
  }
}

const withBranch = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);

/** Accept events only for known branches; the first live event moves the console to the real clock. */
function goLive(branchId: string) {
  if (!BRANCH_BY_ID.has(branchId)) return false;
  if (!sims().realtime) {
    sims().enableRealtime();
    useApp.getState().notify("Live data received — clock switched to real time (1×)", "info");
  }
  return true;
}

/**
 * Subscribe the command center to live device telemetry and POS order events (SSE). EventSource
 * reconnects on its own and sends Last-Event-ID, so the server replays any
 * readings missed while the connection was down.
 */
export function startLiveTelemetry() {
  if (source || typeof EventSource === "undefined") return () => {};
  source = new EventSource("/api/stream/telemetry");
  source.onopen = () => useLive.setState({ status: "connected" });
  source.onerror = () => useLive.setState({ status: "reconnecting" });
  source.addEventListener("reading", (ev) => {
    const r = parse<NormalisedReading>(ev);
    if (!r || !goLive(r.branchId)) return;
    const applied = sims().get(r.branchId).ingestReading(r);
    const s = useLive.getState();
    useLive.setState({ readings: s.readings + 1, lastReadingAt: Date.now(), unmatched: s.unmatched + (applied ? 0 : 1), liveBranches: withBranch(s.liveBranches, r.branchId) });
  });
  source.addEventListener("order", (ev) => {
    const o = parse<NormalisedOrderEvent>(ev);
    if (!o || !goLive(o.branchId)) return;
    const { externalRef, channel, fulfilment, status, lines } = o.event;
    const order = sims().get(o.branchId).ingestOrderEvent({ externalRef, channel, fulfilment, status, lines });
    if (order && status === "RECEIVED") useApp.getState().notify(`Live order ${externalRef} received from ${o.sourceId} — #${order.number}`, "info");
    const s = useLive.getState();
    useLive.setState({ orders: s.orders + 1, liveBranches: withBranch(s.liveBranches, o.branchId) });
  });
  return () => {
    source?.close();
    source = null;
  };
}
