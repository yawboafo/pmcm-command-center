import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "@/app/api/session/route";
import { POST as assistant } from "@/app/api/assistant/route";
import { LAUNCH } from "@/config/launch";
import { hashKey } from "../gate";
import { attemptWait, clientIp, issueSession, recordKeyFailure, resetSessionLimits, SESSION_COOKIE, sessionCookie, sessionFromRequest } from "../session";

const KEY = "test-access-key";
const signIn = (key: string, opts: { keep?: boolean; ip?: string } = {}) =>
  POST(new Request("https://ops.test/api/session", { method: "POST", headers: { "x-real-ip": opts.ip ?? "10.0.0.1" }, body: JSON.stringify({ key, keep: opts.keep ?? true }) }));
const withCookie = (token: string) => new Request("https://ops.test/api/assistant", { headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}` } });
const ask = (cookie?: string) =>
  assistant(new Request("https://ops.test/api/assistant", { method: "POST", headers: cookie ? { cookie } : {}, body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }) }));
const tokenFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

beforeEach(async () => {
  resetSessionLimits();
  vi.stubEnv("ACCESS_KEY_HASH", await hashKey(KEY));
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});
afterEach(() => vi.unstubAllEnvs());

describe("session sign-in", () => {
  it("sets an HttpOnly, SameSite cookie for the right key and nothing for a wrong one", async () => {
    const ok = await signIn(`  ${KEY.toUpperCase()} `);
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`Max-Age=${LAUNCH.gate.sessionDays * 86_400}`);
    const wrong = await signIn("nope");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("uses a browser-session cookie when keep me signed in is off", async () => {
    expect((await signIn(KEY, { keep: false })).headers.get("set-cookie")).not.toContain("Max-Age");
  });

  it("refuses even the right key during the cooldown, per caller", async () => {
    for (let i = 0; i < LAUNCH.gate.maxAttempts; i++) expect((await signIn("nope")).status).toBe(401);
    const locked = await signIn(KEY);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn(KEY, { ip: "10.0.0.2" })).status).toBe(200);
  });

  it("caps failures across callers, so rotating addresses does not help", () => {
    const now = 1_000_000;
    for (let i = 0; i < 60; i++) recordKeyFailure(`10.0.1.${i}`, now);
    expect(attemptWait("10.9.9.9", now + 1000)).toBe(59);
    expect(attemptWait("10.9.9.9", now + 60_000)).toBe(0);
  });

  it("clears the cookie on sign-out", async () => {
    const res = await DELETE(new Request("https://ops.test/api/session", { method: "DELETE" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=; .*Max-Age=0`));
  });

  it("omits Secure on plain http so local servers can sign in", () => {
    expect(sessionCookie(new Request("http://localhost:3001/api/session"), "t", 60)).not.toContain("Secure");
    expect(sessionCookie(new Request("http://internal/api/session", { headers: { "x-forwarded-proto": "https" } }), "t", 60)).toContain("Secure");
  });

  it("prefers the proxy's address over the caller-controlled start of x-forwarded-for", () => {
    expect(clientIp(new Request("https://ops.test", { headers: { "x-forwarded-for": "6.6.6.6, 10.0.0.9" } }))).toBe("10.0.0.9");
    expect(clientIp(new Request("https://ops.test", { headers: { "x-real-ip": "10.0.0.8", "x-forwarded-for": "6.6.6.6" } }))).toBe("10.0.0.8");
  });
});

describe("session verification", () => {
  it("accepts its own token and rejects tampered, expired or foreign ones", () => {
    const now = 5_000_000;
    const token = issueSession(now);
    expect(sessionFromRequest(withCookie(token), now)?.sid).toBeTruthy();
    expect(sessionFromRequest(new Request("https://ops.test"), now)).toBeNull();
    expect(sessionFromRequest(withCookie("junk"), now)).toBeNull();
    const [sid, exp, sig] = token.split(".");
    expect(sessionFromRequest(withCookie(`${sid}.${Number(exp) + 86_400_000}.${sig}`), now)).toBeNull();
    expect(sessionFromRequest(withCookie(token), Number(exp) + 1)).toBeNull();
    vi.stubEnv("SESSION_SECRET", "t".repeat(32));
    expect(sessionFromRequest(withCookie(token), now)).toBeNull();
  });

  it("falls back to a per-process secret when SESSION_SECRET is missing or short", () => {
    vi.stubEnv("SESSION_SECRET", "short");
    const now = 5_000_000;
    expect(sessionFromRequest(withCookie(issueSession(now)), now)).not.toBeNull();
  });
});

describe("assistant route", () => {
  it("refuses callers without a session before doing anything else", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await ask();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_required" });
    expect((await ask(`${SESSION_COOKIE}=forged.9999999999999.signature`)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("lets a signed-in caller through", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const res = await ask(tokenFrom(await signIn(KEY)));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no_credentials" });
  });
});
