import { SimulatorReport } from "@/lib/integration/contracts";
import { SIMULATOR_ID } from "@/lib/integration/fleet";
import { reportSimulator, simulatorSecret } from "@/lib/integration/hub";
import { verify } from "@/lib/integration/signing";

/**
 * Heartbeat from the hardware simulator (scripts/hardware-sim.ts): which branches it runs,
 * at what speed, and which faults it is currently simulating, for Settings → Integrations.
 * Signed like a device (`x-pmcm-device: hardware-sim`) with HMAC(VIRTUAL_FLEET_SECRET, "hardware-sim").
 * Carries no readings — telemetry always goes through /api/ingest/telemetry.
 */
export async function POST(req: Request) {
  const secret = simulatorSecret();
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (req.headers.get("x-pmcm-device") !== SIMULATOR_ID) return Response.json({ error: "unknown_device" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 64_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  const v = verify(secret, { timestamp: req.headers.get("x-pmcm-timestamp"), signature: req.headers.get("x-pmcm-signature") }, raw);
  if (!v.ok) return Response.json({ error: v.reason }, { status: 401 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = SimulatorReport.safeParse(json);
  if (!parsed.success) return Response.json({ error: "schema", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  reportSimulator(parsed.data);
  return Response.json({ status: "ok" }, { status: 202 });
}
