import { describe, expect, it } from "vitest";
import { hashKey, makeGate, normaliseKey, verifyKey, type KV } from "../gate";

const kv = (): KV => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
};

describe("access gate", () => {
  it("accepts the key case-insensitively and trimmed, never in plain text", async () => {
    const hash = await hashKey("test-key");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(normaliseKey("  TeSt-KeY ")).toBe("test-key");
    expect(await verifyKey("  TeSt-KeY ", hash)).toBe(true);
    expect(await verifyKey("test-keys", hash)).toBe(false);
    expect(await verifyKey("", hash)).toBe(false);
  });

  it("locks for the cooldown after five failures and counts down", async () => {
    const g = makeGate({ local: kv(), session: kv(), maxAttempts: 5, cooldownSec: 30 });
    const t0 = 1_000_000;
    for (let i = 1; i <= 4; i++) expect(g.recordFailure(t0 + i).locked).toBe(false);
    expect(g.lockState(t0 + 5).attemptsLeft).toBe(1);
    const fifth = g.recordFailure(t0 + 5);
    expect(fifth.locked).toBe(true);
    expect(fifth.remainingSec).toBe(30);
    expect(g.lockState(t0 + 5 + 20_000).remainingSec).toBe(10);
    expect(g.lockState(t0 + 31_000).locked).toBe(false);
    expect(g.lockState(t0 + 31_000).attemptsLeft).toBe(5);
    g.resetAttempts();
    expect(g.lockState(t0 + 31_000).attemptsLeft).toBe(5);
  });

  it("remembers the session for seven days when kept, only for the tab otherwise", async () => {
    const local = kv();
    const session = kv();
    const g = makeGate({ local, session, sessionDays: 7 });
    const t0 = 5_000_000;
    g.startSession(true, t0);
    expect(g.sessionValid(t0 + 6 * 86_400_000)).toBe(true);
    expect(g.sessionValid(t0 + 8 * 86_400_000)).toBe(false);
    expect(session.get("ops.session.v1")).toBeNull();
    g.startSession(false, t0);
    expect(local.get("ops.session.v1")).toBeNull();
    expect(session.get("ops.session.v1")).not.toBeNull();
    g.endSession();
    expect(g.sessionValid(t0)).toBe(false);
  });
});
