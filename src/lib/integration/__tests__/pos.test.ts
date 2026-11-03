import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ingest/pos/route";
import { __resetHub, backlog } from "../hub";
import { sign } from "../signing";

const SECRET = "pos-secret-0123456789abcdef";
const event = (over: Record<string, unknown> = {}) => ({
  v: 1,
  idempotencyKey: "key-00000001",
  branchId: "branch-015",
  externalRef: "CB-1",
  channel: "chris-b-app",
  fulfilment: "delivery",
  status: "RECEIVED",
  lines: [{ menuId: "pz-chicken-l", qty: 1, unitPriceGhs: 150 }],
  ts: new Date().toISOString(),
  ...over,
});

function call(body: unknown, { secret = SECRET, source = "chris-b", ts = Date.now() } = {}) {
  const raw = JSON.stringify(body);
  return POST(new Request("http://localhost/api/ingest/pos", { method: "POST", body: raw, headers: { "x-ops-source": source, "x-ops-timestamp": String(ts), "x-ops-signature": sign(secret, ts, raw) } }));
}

describe("POS webhook", () => {
  beforeEach(() => {
    __resetHub();
    vi.stubEnv("POS_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a signed event once and streams it", async () => {
    expect((await call(event())).status).toBe(202);
    expect((await call(event())).status).toBe(200);
    expect(backlog("branch-015", 0).map((e) => e.type)).toEqual(["order"]);
  });

  it("rejects bad signatures, unknown ids and malformed events", async () => {
    expect((await call(event(), { secret: "wrong-secret-0123456789" })).status).toBe(401);
    expect((await call(event(), { ts: Date.now() - 10 * 60 * 1000 })).status).toBe(401);
    expect((await call(event({ branchId: "branch-999" }))).status).toBe(422);
    expect((await call(event({ lines: [{ menuId: "mystery", qty: 1, unitPriceGhs: 1 }] }))).status).toBe(422);
    expect((await call(event({ status: "COOKING" }))).status).toBe(400);
    expect(backlog(null, 0)).toHaveLength(0);
  });

  it("is closed until a secret is configured", async () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "");
    expect((await call(event())).status).toBe(503);
  });
});
