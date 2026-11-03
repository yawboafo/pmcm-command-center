"use client";

import { useEffect, useState } from "react";

export interface IntegrationStatus {
  serverTime: number;
  devices: Array<{ deviceId: string; branchId: string; target: string | null; metric: string; model: string | null; keyConfigured: boolean; lastSeenAt: number | null; online: boolean; battery: number | null; rssi: number | null; firmware: string | null }>;
  cameras: Array<{ cameraId: string; branchId: string; name: string; virtualCameraId: string | null; protocol: string; enabled: boolean; authorisedBy: string }>;
  cameraGatewayConfigured: boolean;
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
