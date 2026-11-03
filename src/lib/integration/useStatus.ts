"use client";

import { useEffect, useState } from "react";

export interface IntegrationStatus {
  serverTime: number;
  devices: Array<{
    deviceId: string;
    branchId: string;
    target: string | null;
    metric: string;
    model: string | null;
    /** Simulated hardware (SIM DEVICE). */
    virtual: boolean;
    expectedIntervalSec: number;
    keyConfigured: boolean;
    lastSeenAt: number | null;
    online: boolean;
    battery: number | null;
    rssi: number | null;
    firmware: string | null;
    messages: number;
    duplicates: number;
    late: number;
    rejected: number;
  }>;
  posTerminals: Array<{ sourceId: string; branchId: string; name: string; model: string | null; virtual: boolean; keyConfigured: boolean; lastSeenAt: number | null; orders: number; duplicates: number }>;
  cameras: Array<{ cameraId: string; branchId: string; name: string; virtualCameraId: string | null; protocol: string; enabled: boolean; virtual: boolean; authorisedBy: string }>;
  /** Latest heartbeat from scripts/hardware-sim.ts, if it has run since the server started. */
  simulator: {
    startedAt: string;
    speed: number;
    branches: string[];
    devices: number;
    terminals: number;
    faults: Array<{ deviceId: string; kind: string; since: string; injected: boolean }>;
    offline: string[];
    receivedAt: number;
    running: boolean;
  } | null;
  cameraGatewayConfigured: boolean;
  virtualCameraGatewayConfigured: boolean;
  virtualFleetConfigured: boolean;
  posWebhookConfigured: boolean;
  assistantConfigured: boolean;
}

/** Polls /api/integration/status (device registry health; never includes secrets). */
export function useIntegrationStatus(intervalMs = 10_000) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/integration/status")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => alive && (setStatus(d), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return { status, error };
}
