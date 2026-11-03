import { PosOrderEvent } from "@/lib/integration/contracts";
import { ingestOrder } from "@/lib/integration/hub";
import { verify } from "@/lib/integration/signing";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { MENU_BY_ID } from "@/lib/sim/menu";

/**
 * Order webhook for POS / Chris B app / delivery partners. The sender signs the raw
 * body with POS_WEBHOOK_SECRET (same scheme as devices, see signing.ts) and names
 * itself in `x-pmcm-source`. Retries are safe: events are idempotent on
 * (source, idempotencyKey). See docs/INTEGRATION.md.
 *
 *  401 bad signature / stale timestamp   400 schema   422 unknown branch or menu id
 *  413 too large   503 not configured    202 accepted 200 duplicate
 */
export async function POST(req: Request) {
  const secret = process.env.POS_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "not_configured" }, { status: 503 });
  const sourceId = req.headers.get("x-pmcm-source") ?? "";
  if (!/^[a-zA-Z0-9._:-]{2,64}$/.test(sourceId)) return Response.json({ error: "missing_source" }, { status: 401 });
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
  const parsed = PosOrderEvent.safeParse(json);
  if (!parsed.success) return Response.json({ error: "schema", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const e = parsed.data;
  if (!BRANCH_BY_ID.has(e.branchId)) return Response.json({ error: "unknown_branch", branchId: e.branchId }, { status: 422 });
  // Menu ids must be mapped to the command-center catalogue before go-live; reject rather than guess.
  const unknown = e.lines.map((l) => l.menuId).filter((id) => !MENU_BY_ID.has(id));
  if (unknown.length) return Response.json({ error: "unknown_menu_items", menuIds: unknown }, { status: 422 });

  const result = ingestOrder(sourceId, e);
  return result.status === "duplicate" ? Response.json(result, { status: 200 }) : Response.json(result, { status: 202 });
}
