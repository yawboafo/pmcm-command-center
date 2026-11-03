import { LAUNCH } from "@/config/launch";
import { attemptWait, checkAccessKey, clearKeyFailures, clientIp, issueSession, recordKeyFailure, sessionCookie } from "@/lib/auth/session";

/**
 * Access gate sign-in. POST { key, keep } checks the key and sets the session cookie;
 * DELETE clears it.
 *
 *  200 unlocked   401 wrong key   400 bad request   429 too many attempts
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const wait = attemptWait(ip);
  if (wait > 0) return Response.json({ error: "too_many_attempts", retryAfterSec: wait }, { status: 429, headers: { "Retry-After": String(wait) } });

  const raw = await req.text();
  if (raw.length > 4_000) return Response.json({ error: "payload_too_large" }, { status: 400 });
  let body: { key?: unknown; keep?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.key !== "string") return Response.json({ error: "missing_key" }, { status: 400 });

  if (!(await checkAccessKey(body.key))) {
    recordKeyFailure(ip);
    return Response.json({ error: "wrong_key" }, { status: 401 });
  }
  clearKeyFailures(ip);
  // "Keep me signed in" outlives the browser; otherwise the cookie goes when the browser closes.
  const maxAge = body.keep === true ? LAUNCH.gate.sessionDays * 86_400 : null;
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(req, issueSession(), maxAge) } });
}

export async function DELETE(req: Request) {
  return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(req, "", 0) } });
}
