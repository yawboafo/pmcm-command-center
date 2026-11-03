"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Btn, Glass, LiveBadge, SectionTitle, SimBadge, SimDeviceBadge, StatusDot, cx } from "@/components/ui/primitives";
import { ago } from "@/lib/format";
import { useLive } from "@/lib/integration/liveClient";
import { useIntegrationStatus, type IntegrationStatus } from "@/lib/integration/useStatus";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import LiveCameraPlayer from "./LiveCameraPlayer";

type Device = IntegrationStatus["devices"][number];
type Fault = NonNullable<IntegrationStatus["simulator"]>["faults"][number];

function deviceState(d: Device, fault?: Fault): { label: string; dot: "ok" | "warning" | "offline" | "critical"; key: "online" | "offline" | "fault" | "never" | "nokey" } {
  if (!d.keyConfigured) return { label: "No key", dot: "critical", key: "nokey" };
  if (fault && d.online) return { label: "Online · fault", dot: "warning", key: "fault" };
  if (d.online) return { label: "Online", dot: "ok", key: "online" };
  if (d.lastSeenAt) return { label: "Offline", dot: "warning", key: "offline" };
  return { label: "Never seen", dot: "offline", key: "never" };
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]", on ? "border-emerald-400/30 text-emerald-200" : "border-white/10 text-white/45")}>
      <StatusDot status={on ? "ok" : "offline"} /> {label}
    </span>
  );
}

const ORIGINS = [
  ["all", "All"],
  ["physical", "Physical"],
  ["virtual", "Simulated"],
] as const;
const STATES = [
  ["all", "Any status"],
  ["online", "Online"],
  ["offline", "Offline / never seen"],
  ["fault", "Simulated fault"],
] as const;

const branchName = (id: string) => BRANCH_BY_ID.get(id)?.name ?? id;

/**
 * Settings → Integrations: health of every bound device (physical and simulated), POS
 * sources and cameras, the live stream connection, and how to connect real hardware.
 * Reads only the status API (never secrets or stream addresses).
 */
export default function IntegrationsPanel() {
  const { status, error } = useIntegrationStatus();
  const live = useLive();
  const [watching, setWatching] = useState<string | null>(null);
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number][0]>("all");
  const [state, setState] = useState<(typeof STATES)[number][0]>("all");
  const [branch, setBranch] = useState("all");
  const [query, setQuery] = useState("");
  const now = status?.serverTime ?? 0;
  const devices = useMemo(() => status?.devices ?? [], [status]);
  const sim = status?.simulator ?? null;
  const faults = useMemo(() => new Map((sim?.running ? sim.faults : []).map((f) => [f.deviceId, f])), [sim]);
  const physical = devices.filter((d) => !d.virtual);
  const virtual = devices.filter((d) => d.virtual);
  const physicalOnline = physical.filter((d) => d.online).length;
  const virtualOnline = virtual.filter((d) => d.online).length;
  const branches = [...new Set(devices.map((d) => d.branchId))];

  const shown = devices.filter((d) => {
    if (origin !== "all" && (origin === "virtual") !== d.virtual) return false;
    if (branch !== "all" && d.branchId !== branch) return false;
    const k = deviceState(d, faults.get(d.deviceId)).key;
    if (state === "online" && k !== "online" && k !== "fault") return false;
    if (state === "offline" && k !== "offline" && k !== "never") return false;
    if (state === "fault" && !faults.has(d.deviceId)) return false;
    const q = query.trim().toLowerCase();
    return !q || `${d.deviceId} ${d.target ?? ""} ${d.metric} ${d.model ?? ""}`.toLowerCase().includes(q);
  });
  const groups = branches.map((b) => ({ branchId: b, rows: shown.filter((d) => d.branchId === b) })).filter((g) => g.rows.length);

  return (
    <>
      <Glass className="p-4 lg:col-span-2">
        <SectionTitle
          right={
            <span className="flex flex-wrap items-center gap-1.5">
              {physicalOnline > 0 ? <LiveBadge label={`${physicalOnline} DEVICE${physicalOnline > 1 ? "S" : ""} LIVE`} /> : <SimBadge label="NO LIVE DEVICES" />}
              {virtualOnline > 0 && <SimDeviceBadge label={`${virtualOnline} SIM DEVICE${virtualOnline > 1 ? "S" : ""}`} />}
            </span>
          }
        >
          Integrations
        </SectionTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          <Flag on={live.status === "connected"} label={`Telemetry stream: ${live.status}${live.readings ? ` · ${live.readings} readings` : ""}`} />
          <Flag on={!!status?.cameraGatewayConfigured} label="Camera gateway" />
          <Flag on={!!status?.virtualCameraGatewayConfigured} label="Simulated camera gateway" />
          <Flag on={!!status?.posWebhookConfigured} label="POS webhook secret" />
          <Flag on={!!status?.virtualFleetConfigured} label="Simulated fleet key" />
          <Flag on={!!sim?.running} label={sim?.running ? `Hardware simulator: running ${sim.speed}× · ${sim.devices} devices, ${sim.terminals} POS` : "Hardware simulator: not running"} />
          <Flag on={!!status?.assistantConfigured} label="AI assistant key" />
        </div>
        {!sim?.running && (
          <p className="mb-2 text-[11px] text-white/55">
            Simulated hardware: run <code className="text-white/85">npm run hardware:sim</code> (sensors, controllers, POS) and <code className="text-white/85">npm run camera:sim</code> (cameras) — data arrives through the real pipeline and shows as <SimDeviceBadge />, never LIVE.
          </p>
        )}
        {live.unmatched > 0 && <p className="mb-2 text-[11px] text-amber-300">{live.unmatched} reading(s) could not be matched to equipment in the branch floor plan — check the bindings.</p>}
        {error && <p className="mb-2 text-[11px] text-red-300">Integration status unavailable ({error}).</p>}

        {/* Fleet health at a glance: physical vs simulated, per branch. */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <FleetTile label="Physical devices" online={physicalOnline} total={physical.length} badge={physicalOnline > 0 ? <LiveBadge /> : null} />
          <FleetTile label="Simulated devices" online={virtualOnline} total={virtual.length} badge={virtual.length ? <SimDeviceBadge /> : null} />
          {branches
            .filter((b) => virtual.some((d) => d.branchId === b))
            .slice(0, 2)
            .map((b) => {
              const ds = devices.filter((d) => d.branchId === b);
              return <FleetTile key={b} label={branchName(b)} online={ds.filter((d) => d.online).length} total={ds.length} sub={`${ds.filter((d) => faults.has(d.deviceId)).length} simulated fault(s)`} />;
            })}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter devices">
          {ORIGINS.map(([k, label]) => (
            <Btn key={k} size="xs" active={origin === k} onClick={() => setOrigin(k)}>
              {label}
            </Btn>
          ))}
          <select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/80">
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {branchName(b)}
              </option>
            ))}
          </select>
          <select aria-label="Status" value={state} onChange={(e) => setState(e.target.value as typeof state)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/80">
            {STATES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input aria-label="Search devices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search id, equipment, metric…" className="min-w-[160px] flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/30" />
          <span className="text-[10.5px] text-white/40">
            {shown.length} of {devices.length}
          </span>
        </div>

        <div className="scroll-thin max-h-[560px] overflow-auto">
          <table className="w-full min-w-[1040px] text-left text-[11.5px]">
            <thead className="sticky top-0 z-[1] bg-black/80 text-[10px] uppercase tracking-wider text-white/40">
              <tr>
                {["Device", "Bound to", "Metric", "Status", "Last seen", "Battery", "Signal", "Firmware", "Msgs · dup · late · rej", "Simulated fault"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-white/75">
              {groups.map((g) => (
                <BranchRows key={g.branchId} branchId={g.branchId} rows={g.rows} faults={faults} now={now} />
              ))}
              {status && shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-2 py-3 text-white/45">
                    {devices.length ? "No device matches the filter." : "No devices are bound yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!!status?.posTerminals.length && (
          <div className="mt-3">
            <SectionTitle>Order sources (POS / ordering platforms)</SectionTitle>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[11.5px]">
                <thead className="text-[10px] uppercase tracking-wider text-white/40">
                  <tr>
                    {["Source", "Branch", "Last event", "Orders", "Duplicates", ""].map((h) => (
                      <th key={h} className="px-2 py-1.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-white/75">
                  {status.posTerminals
                    .filter((t) => (origin === "all" || (origin === "virtual") === t.virtual) && (branch === "all" || t.branchId === branch))
                    .map((t) => (
                      <tr key={t.sourceId} className="border-t border-white/5">
                        <td className="px-2 py-1.5 font-mono text-white">
                          {t.sourceId}
                          <div className="font-sans text-[10px] text-white/40">{t.name}</div>
                        </td>
                        <td className="px-2 py-1.5">{branchName(t.branchId)}</td>
                        <td className="px-2 py-1.5">{t.lastSeenAt ? ago(t.lastSeenAt, now) : "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{t.orders}</td>
                        <td className="px-2 py-1.5 font-mono">{t.duplicates}</td>
                        <td className="px-2 py-1.5">{t.virtual ? <SimDeviceBadge /> : <LiveBadge label="PHYSICAL" />}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Glass>

      <Glass className="p-4 lg:col-span-2">
        <SectionTitle>Cameras</SectionTitle>
        <p className="mb-3 text-[11px] text-white/55">
          Virtual cameras render the simulated 3D model only. Real cameras appear here once they are registered with a written authorisation, privacy notice and retention period, and streamed through the camera gateway. Simulated cameras (SIM CAMERA) stream a synthetic test pattern through the same proxy. Camera video always plays in this separate, clearly labelled player — never blended into the simulation.
        </p>
        {status?.cameras.length ? (
          <div className="space-y-2">
            {status.cameras.map((c) => {
              const playable = c.protocol === "webrtc-whep" || c.protocol === "mjpeg";
              return (
                <div key={c.cameraId} className="rounded-lg border border-white/10 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-white/75">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {c.virtual && <SimDeviceBadge label="SIM CAMERA" />}
                      <span className="font-mono text-white">{c.cameraId}</span> · {c.name} · {branchName(c.branchId)}
                      {c.virtualCameraId && <span className="text-white/40"> · matches {c.virtualCameraId}</span>}
                      <span className="text-white/40"> · {c.virtual ? "synthetic video (no one filmed)" : `authorised by ${c.authorisedBy}`}</span>
                    </span>
                    <Btn size="xs" disabled={!c.enabled || !playable} title={!playable ? "Only WebRTC (WHEP) and MJPEG playback are implemented in the prototype" : undefined} onClick={() => setWatching(watching === c.cameraId ? null : c.cameraId)}>
                      {watching === c.cameraId ? "Stop" : !c.enabled ? "Disabled" : c.virtual ? "Watch" : "Watch live"}
                    </Btn>
                  </div>
                  {watching === c.cameraId && <LiveCameraPlayer cameraId={c.cameraId} name={c.name} protocol={c.protocol} virtual={c.virtual} className="mt-2 aspect-video" />}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-white/45">No cameras registered.</p>
        )}
      </Glass>

      <Glass className="p-4 lg:col-span-2">
        <SectionTitle>Connecting real equipment</SectionTitle>
        <ol className="list-decimal space-y-1.5 pl-4 text-[11.5px] text-white/65">
          <li>Install the sensor and bind it in <code className="text-white/85">src/data/devices.json</code> to the floor-plan equipment it monitors (<code>equipmentId</code>, stable across layout edits) or a sensor code, with its calibration offset and reporting interval.</li>
          <li>Give the device (or its gateway) a secret of at least 16 characters in <code className="text-white/85">DEVICE_KEYS</code> on the server — never in the browser or the repository.</li>
          <li>
            The device signs each message and posts it to <code className="text-white/85">POST /api/ingest/telemetry</code> (or publishes to MQTT topic <code>pmcm/v1/&#123;branchCode&#125;/&#123;deviceId&#125;/telemetry</code> through the bridge). Bench-test first with{" "}
            <code className="text-white/85">npx tsx scripts/device-sim.ts --device &lt;id&gt; --value 3.2</code>, or exercise the whole pipeline with the simulated fleet (<code className="text-white/85">npm run hardware:sim</code>).
          </li>
          <li>The first reading through the pipeline switches the console to the real wall clock; a physical sensor then shows LIVE, a simulated one SIM DEVICE, and both use the same food-safety limits and alert delays as the simulation.</li>
          <li>Cameras: register them with their authorisation in <code className="text-white/85">devices.json → cameras</code>, run a media gateway (e.g. MediaMTX, RTSP in → WebRTC out) and set <code className="text-white/85">CAMERA_GATEWAY_URL</code>.</li>
        </ol>
        <p className="mt-2 text-[11px] text-white/45">Full contracts, the simulated fleet, recommended hardware, production architecture and privacy obligations: docs/INTEGRATION.md.</p>
      </Glass>
    </>
  );
}

function FleetTile({ label, online, total, sub, badge }: { label: string; online: number; total: number; sub?: string; badge?: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/45">
        {label}
        {badge}
      </div>
      <div className="font-display text-lg font-semibold tabular-nums text-white">
        {online}
        <span className="text-[12px] text-white/40"> / {total} online</span>
      </div>
      {sub && <div className="text-[10.5px] text-white/45">{sub}</div>}
    </div>
  );
}

function BranchRows({ branchId, rows, faults, now }: { branchId: string; rows: Device[]; faults: Map<string, Fault>; now: number }) {
  const online = rows.filter((d) => d.online).length;
  return (
    <>
      <tr className="border-t border-white/10 bg-white/[0.04]">
        <td colSpan={10} className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/60">
          {branchName(branchId)} · {online}/{rows.length} online · {rows.filter((d) => d.virtual).length} simulated
        </td>
      </tr>
      {rows.map((d) => {
        const f = faults.get(d.deviceId);
        const s = deviceState(d, f);
        return (
          <tr key={`${d.deviceId}:${d.metric}`} className="border-t border-white/5">
            <td className="px-2 py-1.5 font-mono text-white">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {d.virtual && <SimDeviceBadge label="SIM" />}
                {d.deviceId}
              </span>
              {d.model && <div className="font-sans text-[10px] text-white/40">{d.model}</div>}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 font-mono">{d.target ?? "—"}</td>
            <td className="whitespace-nowrap px-2 py-1.5 font-mono">{d.metric}</td>
            <td className="px-2 py-1.5">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <StatusDot status={s.dot} pulse={d.online && !d.virtual} /> {s.label}
              </span>
            </td>
            <td className="whitespace-nowrap px-2 py-1.5">{d.lastSeenAt ? ago(d.lastSeenAt, now) : "—"}</td>
            <td className={cx("px-2 py-1.5 font-mono", d.battery !== null && d.battery < 20 && "text-amber-300")}>{d.battery !== null ? `${d.battery}%` : d.lastSeenAt ? "mains" : "—"}</td>
            <td className={cx("whitespace-nowrap px-2 py-1.5 font-mono", d.rssi !== null && d.rssi < -110 && "text-amber-300")}>{d.rssi !== null ? `${d.rssi} dBm` : "—"}</td>
            <td className="px-2 py-1.5 font-mono">{d.firmware ?? "—"}</td>
            <td className="whitespace-nowrap px-2 py-1.5 font-mono text-white/60" title="Accepted messages · retries de-duplicated · late (buffered catch-up) · rejected (clock skew)">
              {d.messages} · {d.duplicates} · {d.late} · {d.rejected}
            </td>
            <td className="px-2 py-1.5">{f ? <span className="font-mono text-amber-300">{f.kind}{f.injected ? " (injected)" : ""}</span> : <span className="text-white/30">—</span>}</td>
          </tr>
        );
      })}
    </>
  );
}
