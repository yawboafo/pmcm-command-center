"use client";

import { create } from "zustand";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import type { NormalisedLocation, NormalisedOrderEvent, NormalisedReading, Origin } from "./contracts";

interface LiveState {
  status: "connecting" | "connected" | "reconnecting";
  readings: number;
  lastReadingAt: number | null;
  /** Readings whose binding points at equipment missing from the branch floor plan. */
  unmatched: number;
  /** Branches receiving data from physical devices / systems (shown as LIVE). */
  liveBranches: string[];
  /** Branches receiving data from simulated hardware through the pipeline (shown as SIM DEVICE, never LIVE). */
  virtualBranches: string[];
  /** Staff badge position fixes applied. */
  locations: number;
  /** POS / ordering-system events applied (or ignored as unmappable), physical and virtual. */
  orders: number;
  /** Of `readings` + `orders`, how many came from simulated hardware. */
  virtualEvents: number;
}

export const useLive = create<LiveState>(() => ({ status: "connecting", readings: 0, lastReadingAt: null, unmatched: 0, liveBranches: [], virtualBranches: [], orders: 0, virtualEvents: 0, locations: 0 }));

let source: EventSource | null = null;

function parse<T>(ev: Event): T | null {
  try {
    return JSON.parse((ev as MessageEvent).data) as T;
  } catch {
    return null;
  }
}

const withBranch = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);

/**
 * Accept events only for known branches. The first pipeline event — from a physical device or
 * simulated hardware alike — moves the console to the real clock, because pipeline data is
 * timestamped in real time; the notification says which kind arrived.
 */
function goLive(branchId: string, origin: Origin) {
  if (!BRANCH_BY_ID.has(branchId)) return false;
  if (!sims().realtime) {
    sims().enableRealtime();
    useApp.getState().notify(origin === "virtual" ? "Simulated hardware connected — clock switched to real time (1×)" : "Live data received — clock switched to real time (1×)", "info");
  }
  return true;
}

/** Track which branches get physical (LIVE) vs simulated-hardware (SIM DEVICE) data. */
function branchState(s: LiveState, branchId: string, origin: Origin): Partial<LiveState> {
  return origin === "virtual" ? { virtualBranches: withBranch(s.virtualBranches, branchId), virtualEvents: s.virtualEvents + 1 } : { liveBranches: withBranch(s.liveBranches, branchId) };
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
    const origin: Origin = r?.origin === "virtual" ? "virtual" : "physical";
    if (!r || !goLive(r.branchId, origin)) return;
    const applied = sims().get(r.branchId).ingestReading({ ...r, origin });
    const s = useLive.getState();
    useLive.setState({ readings: s.readings + 1, lastReadingAt: Date.now(), unmatched: s.unmatched + (applied ? 0 : 1), ...branchState(s, r.branchId, origin) });
  });
  source.addEventListener("order", (ev) => {
    const o = parse<NormalisedOrderEvent>(ev);
    const origin: Origin = o?.origin === "virtual" ? "virtual" : "physical";
    if (!o || !goLive(o.branchId, origin)) return;
    const { externalRef, channel, fulfilment, status, lines } = o.event;
    const order = sims().get(o.branchId).ingestOrderEvent({ externalRef, channel, fulfilment, status, lines, origin });
    // Virtual terminals produce steady demo volume; only real orders get a notification each.
    if (order && status === "RECEIVED" && origin === "physical") useApp.getState().notify(`Live order ${externalRef} received from ${o.sourceId} — #${order.number}`, "info");
    const s = useLive.getState();
    useLive.setState({ orders: s.orders + 1, ...branchState(s, o.branchId, origin) });
  });
  source.addEventListener("location", (ev) => {
    const l = parse<NormalisedLocation>(ev);
    const origin: Origin = l?.origin === "virtual" ? "virtual" : "physical";
    if (!l || !goLive(l.branchId, origin)) return;
    sims().get(l.branchId).ingestStaffLocation({ staffId: l.staffId, tagId: l.tagId, x: l.x, z: l.z, accuracy: l.accuracy, technology: l.technology, source: l.source });
    const s = useLive.getState();
    useLive.setState({ locations: s.locations + 1, ...branchState(s, l.branchId, origin) });
  });
  return () => {
    source?.close();
    source = null;
  };
}
