import { TelemetryMessage } from "@/lib/integration/contracts";
import { bindingsFor, deviceSecret, ingest, noteRejected } from "@/lib/integration/hub";
import { verify } from "@/lib/integration/signing";

/**
 * Device telemetry ingestion (HTTPS). Devices or an MQTT bridge POST signed
 * TelemetryMessage JSON. See docs/INTEGRATION.md for the contract. Simulated
 * hardware (scripts/hardware-sim.ts) uses this exact route; the hub marks its
 * readings `origin: "virtual"` from the registry.
 *
 *  401 unknown device / bad signature / stale timestamp
 *  400 schema violation      413 too large      202 accepted      200 duplicate
 */
export async function POST(req: Request) {
  const deviceId = req.headers.get("x-pmcm-device") ?? "";
  const raw = await req.text();
  if (raw.length > 32_000) return Response.json({ error: "payload_too_large" }, { status: 413 });

  const secret = deviceSecret(deviceId);
  if (!secret || bindingsFor(deviceId).length === 0) return Response.json({ error: "unknown_device" }, { status: 401 });
  const v = verify(secret, { timestamp: req.headers.get("x-pmcm-timestamp"), signature: req.headers.get("x-pmcm-signature") }, raw);
  if (!v.ok) return Response.json({ error: v.reason }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = TelemetryMessage.safeParse(json);
  if (!parsed.success) return Response.json({ error: "schema", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  if (parsed.data.deviceId !== deviceId) return Response.json({ error: "device_mismatch" }, { status: 401 });
  // Reject readings timestamped far in the future (device clock not synchronised).
  if (Date.parse(parsed.data.ts) - Date.now() > 2 * 60 * 1000) {
    noteRejected(deviceId, "clock_skew");
    return Response.json({ error: "clock_skew" }, { status: 400 });
  }

  const result = ingest(parsed.data);
  if (result.status === "duplicate") return Response.json({ status: "duplicate" }, { status: 200 });
  if (result.status === "unbound") return Response.json({ error: "unbound_metric", metrics: result.metrics }, { status: 422 });
  return Response.json(result, { status: 202 });
}
