import { LocationMessage } from "@/lib/integration/contracts";
import { ingestLocation, tagSecret, wearableFor } from "@/lib/integration/hub";
import { verify } from "@/lib/integration/signing";

/**
 * Staff wearable positions from an RTLS (UWB / BLE badge system), one signed fix per request:
 * `x-ops-device` = tag id, signature as for device telemetry (see signing.ts). Positions are
 * calibrated to the branch floor plan with the tag's binding. See docs/INTEGRATION.md.
 *
 *  401 unknown tag / bad signature / stale   400 schema / clock skew   413 too large
 *  202 accepted   200 duplicate
 */
export async function POST(req: Request) {
  const tagId = req.headers.get("x-ops-device") ?? "";
  const raw = await req.text();
  if (raw.length > 4_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  const secret = tagSecret(tagId);
  if (!secret) return Response.json({ error: "unknown_tag" }, { status: 401 });
  const v = verify(secret, { timestamp: req.headers.get("x-ops-timestamp"), signature: req.headers.get("x-ops-signature") }, raw);
  if (!v.ok) return Response.json({ error: v.reason }, { status: 401 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = LocationMessage.safeParse(json);
  if (!parsed.success) return Response.json({ error: "schema", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  if (parsed.data.tagId !== tagId || !wearableFor(tagId)) return Response.json({ error: "tag_mismatch" }, { status: 401 });
  if (Date.parse(parsed.data.ts) - Date.now() > 2 * 60 * 1000) return Response.json({ error: "clock_skew" }, { status: 400 });
  const result = ingestLocation(parsed.data);
  return Response.json(result, { status: result.status === "duplicate" ? 200 : 202 });
}
