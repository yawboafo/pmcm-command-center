import Anthropic from "@anthropic-ai/sdk";
import { PLATFORM, TENANT } from "@/config/platform";
import { TOOL_DEFS } from "@/lib/assistant/toolDefs";
import { sessionFromRequest } from "@/lib/auth/session";

/**
 * Operations assistant — one step of a client-executed tool-use loop.
 * The browser holds the operational state (the simulation), so it executes
 * tool calls locally and re-posts the conversation with tool_result blocks.
 * This route only adds the system prompt, tool schemas and the API credential.
 * It spends the API credential, so it requires a session from the access gate (see /api/session).
 */

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are the operations assistant inside ${PLATFORM.name}, a restaurant operations platform. You are working in the ${TENANT.name} workspace: a prototype digital twin of that company's restaurant network in ${TENANT.country}.

Ground every answer in tool results. Do not invent branches, numbers, readings or incidents. Branch names, locations, regions and opening hours come from the official outlet directory (verified). Operational figures — orders, sales, staff, temperatures, alerts, inventory, deliveries — come from the twin. The user already knows this is a prototype running on simulated operations (the app says so on start-up), so do not add "simulated" disclaimers; give the twin time when it matters ("as of 14:05"). If a tool result marks a value as LIVE (from a physical device or system), say so — that is the one provenance worth calling out. Floor plans are conceptual layouts, not official branch plans; say so only if asked about layouts. Never claim that CCTV, POS, IoT sensors or rider GPS are physically connected unless a tool result shows LIVE data.

When the user asks to see, open, show or go to something, use the action tools (open_branch, show_in_3d, open_view) instead of describing it. For "show me the kitchen at X", open the branch then call show_in_3d with "kitchen". For forecasts, state that they are indicative.

Answer concisely for a busy operations manager: lead with the answer, then at most a few bullet points. Use GH₵ for money. If a branch is outside the user's permitted scope, say you can't access it.`;

const tools: Anthropic.Tool[] = TOOL_DEFS.map((t) => ({ ...t, strict: true }));

// Minimal in-memory rate limit (per server instance). Production: Redis-backed, per user.
const PER_SESSION_PER_MIN = 30;
const ALL_SESSIONS_PER_MIN = 120;
const hits = new Map<string, number[]>();
function rateLimited(key: string, limit: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

function validMessages(m: unknown): m is Anthropic.Beta.BetaMessageParam[] {
  return Array.isArray(m) && m.length > 0 && m.length <= 60 && m.every((x) => x && typeof x === "object" && (x.role === "user" || x.role === "assistant") && (typeof x.content === "string" || Array.isArray(x.content)));
}

export async function POST(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return Response.json({ error: "session_required" }, { status: 401 });
  // Anyone holding the key can open more sessions, so the per-session limit needs an overall ceiling.
  if (rateLimited(session.sid, PER_SESSION_PER_MIN) || rateLimited("all", ALL_SESSIONS_PER_MIN)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > 400_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  let body: { messages?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!validMessages(body.messages)) return Response.json({ error: "invalid_messages" }, { status: 400 });

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return Response.json({ error: "no_credentials" }, { status: 503 });
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      // History is append-only (UI context rides inside each user turn), so the prefix caches across loop steps.
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools,
      messages: body.messages,
    });
    if (response.stop_reason === "refusal") {
      return Response.json({ stop_reason: "refusal", content: [], text: "The request was declined. Try rephrasing it as an operations question." });
    }
    return Response.json({ stop_reason: response.stop_reason, content: response.content, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return Response.json({ error: "no_credentials" }, { status: 503 });
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "upstream_rate_limited" }, { status: 429 });
    if (error instanceof Anthropic.BadRequestError) return Response.json({ error: "bad_request", detail: error.message }, { status: 400 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: "upstream_error", status: error.status }, { status: 502 });
    // The SDK raises a plain Error (no typed class) when no credential source resolves at all.
    if (error instanceof Error && error.message.startsWith("Could not resolve authentication")) return Response.json({ error: "no_credentials" }, { status: 503 });
    return Response.json({ error: "assistant_unavailable" }, { status: 503 });
  }
}
