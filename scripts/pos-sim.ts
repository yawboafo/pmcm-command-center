/**
 * Bench-test order source: posts signed PosOrderEvents to /api/ingest/pos exactly as a
 * POS, the Chris B app backend or a delivery partner would. Sends RECEIVED, then
 * ACCEPTED, then (optionally) a final status, for one order.
 *
 *   npx tsx scripts/pos-sim.ts --branch branch-015 [--ref CB-1001] [--source chris-b] \
 *       [--channel chris-b-app] [--fulfilment delivery] [--final CANCELLED] [--url http://localhost:3000]
 *
 * The secret is read from POS_WEBHOOK_SECRET (env or .env.local).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sign } from "../src/lib/integration/signing";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

let secret = process.env.POS_WEBHOOK_SECRET;
if (!secret && existsSync(".env.local")) secret = readFileSync(".env.local", "utf8").match(/^POS_WEBHOOK_SECRET=(.*)$/m)?.[1]?.replace(/^'|'$/g, "");
if (!secret) {
  console.error("POS_WEBHOOK_SECRET is not set");
  process.exit(1);
}

const url = `${arg("url", "http://localhost:3000")}/api/ingest/pos`;
const source = arg("source", "chris-b")!;
const base = {
  v: 1,
  branchId: arg("branch", "branch-015"),
  externalRef: arg("ref", `CB-${Date.now().toString().slice(-6)}`),
  channel: arg("channel", "chris-b-app"),
  fulfilment: arg("fulfilment", "delivery"),
  lines: [
    { menuId: "pz-chicken-l", qty: 1, unitPriceGhs: 150 },
    { menuId: "rc-playman-jollof", qty: 1, unitPriceGhs: 79 },
  ],
};

async function post(status: string) {
  const body = JSON.stringify({ ...base, status, idempotencyKey: randomUUID(), ts: new Date().toISOString() });
  const ts = Date.now();
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-pmcm-source": source, "x-pmcm-timestamp": String(ts), "x-pmcm-signature": sign(secret!, ts, body) }, body });
  console.log(`${new Date().toISOString()} ${base.externalRef} ${status} → ${res.status} ${await res.text()}`);
}

async function main() {
  const final = arg("final");
  await post("RECEIVED");
  await new Promise((r) => setTimeout(r, 1500));
  await post("ACCEPTED");
  if (final) {
    await new Promise((r) => setTimeout(r, 1500));
    await post(final);
  }
}

main();
