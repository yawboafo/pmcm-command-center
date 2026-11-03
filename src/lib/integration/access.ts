import { timingSafeEqual } from "node:crypto";

/**
 * Guard for browser-facing integration endpoints (live stream, status).
 * If CONSOLE_ACCESS_TOKEN is set, requests must present it as a Bearer token,
 * the `pmcm_console` cookie, or `?token=` (EventSource cannot set headers).
 * Production replaces this with authenticated sessions + branch-scoped RBAC.
 */
export function consoleAccessAllowed(req: Request): boolean {
  const expected = process.env.CONSOLE_ACCESS_TOKEN;
  if (!expected) return true;
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === "pmcm_console")?.[1];
  const given = bearer || cookie || url.searchParams.get("token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
