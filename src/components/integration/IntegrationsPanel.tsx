"use client";

import { useState } from "react";
import { Btn, Glass, LiveBadge, SectionTitle, SimBadge, StatusDot, cx } from "@/components/ui/primitives";
import { ago } from "@/lib/format";
import { useLive } from "@/lib/integration/liveClient";
import { useIntegrationStatus, type IntegrationStatus } from "@/lib/integration/useStatus";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import LiveCameraPlayer from "./LiveCameraPlayer";

type Device = IntegrationStatus["devices"][number];

function deviceState(d: Device): { label: string; dot: "ok" | "warning" | "offline" | "critical" } {
  if (!d.keyConfigured) return { label: "No key", dot: "critical" };
  if (d.online) return { label: "Online", dot: "ok" };
  if (d.lastSeenAt) return { label: "Offline", dot: "warning" };
  return { label: "Never seen", dot: "offline" };
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]", on ? "border-emerald-400/30 text-emerald-200" : "border-white/10 text-white/45")}>
      <StatusDot status={on ? "ok" : "offline"} /> {label}
    </span>
  );
}

/**
 * Settings → Integrations: health of every bound device and authorised camera,
 * the live stream connection, and how to connect real hardware. Reads only the
 * status API (never secrets or stream addresses).
 */
export default function IntegrationsPanel() {
  const { status, error } = useIntegrationStatus();
  const live = useLive();
  const [watching, setWatching] = useState<string | null>(null);
  const now = status?.serverTime ?? 0;
  const online = status?.devices.filter((d) => d.online).length ?? 0;

  return (
    <>
      <Glass className="p-4 lg:col-span-2">
        <SectionTitle right={online > 0 ? <LiveBadge label={`${online} DEVICE${online > 1 ? "S" : ""} LIVE`} /> : <SimBadge label="NO LIVE DEVICES" />}>Integrations</SectionTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          <Flag on={live.status === "connected"} label={`Telemetry stream: ${live.status}${live.readings ? ` · ${live.readings} readings` : ""}`} />
          <Flag on={!!status?.cameraGatewayConfigured} label="Camera gateway" />
          <Flag on={!!status?.posWebhookConfigured} label="POS webhook secret" />
          <Flag on={!!status?.assistantConfigured} label="AI assistant key" />
        </div>
        {live.unmatched > 0 && <p className="mb-2 text-[11px] text-amber-300">{live.unmatched} live reading(s) could not be matched to equipment in the branch floor plan — check the bindings.</p>}
        {error && <p className="mb-2 text-[11px] text-red-300">Integration status unavailable ({error}).</p>}

        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[11.5px]">
            <thead className="text-[10px] uppercase tracking-wider text-white/40">
              <tr>
                {["Device", "Branch", "Bound to", "Metric", "Status", "Last seen", "Battery", "Signal", "Firmware"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-white/75">
              {status?.devices.map((d) => {
                const s = deviceState(d);
                return (
                  <tr key={`${d.deviceId}:${d.metric}`} className="border-t border-white/5">
                    <td className="px-2 py-1.5 font-mono text-white">
                      {d.deviceId}
                      {d.model && <div className="font-sans text-[10px] text-white/40">{d.model}</div>}
                    </td>
                    <td className="px-2 py-1.5">{BRANCH_BY_ID.get(d.branchId)?.name ?? d.branchId}</td>
                    <td className="px-2 py-1.5 font-mono">{d.target ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{d.metric}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status={s.dot} pulse={d.online} /> {s.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{d.lastSeenAt ? ago(d.lastSeenAt, now) : "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{d.battery !== null ? `${d.battery}%` : "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{d.rssi !== null ? `${d.rssi} dBm` : "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{d.firmware ?? "—"}</td>
                  </tr>
                );
              })}
              {status && status.devices.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-3 text-white/45">No devices are bound yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Glass>

      <Glass className="p-4 lg:col-span-2">
        <SectionTitle>Physical cameras</SectionTitle>
        <p className="mb-3 text-[11px] text-white/55">
          Virtual cameras render the simulated 3D model only. Real cameras appear here once they are registered with a written authorisation, privacy notice and retention period, and streamed through the camera gateway. Live video always plays in this separate, clearly labelled player — never blended into the simulation.
        </p>
        {status?.cameras.length ? (
          <div className="space-y-2">
            {status.cameras.map((c) => (
              <div key={c.cameraId} className="rounded-lg border border-white/10 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-white/75">
                  <span>
                    <span className="font-mono text-white">{c.cameraId}</span> · {c.name} · {BRANCH_BY_ID.get(c.branchId)?.name ?? c.branchId}
                    {c.virtualCameraId && <span className="text-white/40"> · matches {c.virtualCameraId}</span>}
                    <span className="text-white/40"> · authorised by {c.authorisedBy}</span>
                  </span>
                  <Btn size="xs" disabled={!c.enabled || c.protocol !== "webrtc-whep"} title={c.protocol !== "webrtc-whep" ? "Only WebRTC (WHEP) playback is implemented in the prototype" : undefined} onClick={() => setWatching(watching === c.cameraId ? null : c.cameraId)}>
                    {watching === c.cameraId ? "Stop" : c.enabled ? "Watch live" : "Disabled"}
                  </Btn>
                </div>
                {watching === c.cameraId && <LiveCameraPlayer cameraId={c.cameraId} name={c.name} className="mt-2 aspect-video" />}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-white/45">No physical cameras registered.</p>
        )}
      </Glass>

      <Glass className="p-4 lg:col-span-2">
        <SectionTitle>Connecting real equipment</SectionTitle>
        <ol className="list-decimal space-y-1.5 pl-4 text-[11.5px] text-white/65">
          <li>Install the sensor and bind it in <code className="text-white/85">src/data/devices.json</code> to the floor-plan equipment it monitors (<code>equipmentId</code>, stable across layout edits) or a sensor code, with its calibration offset and reporting interval.</li>
          <li>Give the device (or its gateway) a secret of at least 16 characters in <code className="text-white/85">DEVICE_KEYS</code> on the server — never in the browser or the repository.</li>
          <li>
            The device signs each message and posts it to <code className="text-white/85">POST /api/ingest/telemetry</code> (or publishes to MQTT topic <code>pmcm/v1/&#123;branchCode&#125;/&#123;deviceId&#125;/telemetry</code> through the bridge). Bench-test first with{" "}
            <code className="text-white/85">npx tsx scripts/device-sim.ts --device &lt;id&gt; --value 3.2</code>.
          </li>
          <li>The first live reading switches the console to the real wall clock; that sensor then shows LIVE and uses the same food-safety limits and alert delays as the simulation.</li>
          <li>Cameras: register them with their authorisation in <code className="text-white/85">devices.json → cameras</code>, run a media gateway (e.g. MediaMTX, RTSP in → WebRTC out) and set <code className="text-white/85">CAMERA_GATEWAY_URL</code>.</li>
        </ol>
        <p className="mt-2 text-[11px] text-white/45">Full contracts, recommended hardware, production architecture and privacy obligations: docs/INTEGRATION.md.</p>
      </Glass>
    </>
  );
}
