"use client";

import { Bot, Loader2, Send, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SimBadge, cx } from "@/components/ui/primitives";
import { executeTool, offlineAnswer } from "@/lib/assistant/tools";
import { clock } from "@/lib/format";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

// Wire format of the Messages API (kept loose: content blocks are echoed back unchanged).
type ApiBlock = { type: string; [k: string]: unknown };
type ApiMessage = { role: "user" | "assistant"; content: string | ApiBlock[] };
type Line = { role: "user" | "assistant" | "tool" | "note"; text: string };

const SUGGESTIONS = [
  "Show me all restaurants with delayed orders.",
  "Which branch is currently performing best?",
  "How many orders are being prepared across Ghana?",
  "Which restaurants have food safety alerts?",
  "Show me the kitchen at the East Legon branch.",
  "Compare restaurant performance in Accra and Kumasi.",
  "Take me to the pizza oven.",
  "Show the refrigerator with the temperature alert.",
];

const TOOL_LABEL: Record<string, string> = {
  network_summary: "Reading national totals",
  list_branches: "Querying branches",
  compare: "Comparing groups",
  branch_details: "Reading branch details",
  safety_alerts: "Checking safety alerts",
  equipment_status: "Checking equipment",
  inventory_status: "Checking inventory",
  demand_forecast: "Forecasting demand",
  open_branch: "Opening branch twin",
  show_in_3d: "Moving 3D camera",
  open_view: "Opening view",
};

function uiContext() {
  const s = useApp.getState();
  const b = s.enteredBranchId ? BRANCH_BY_ID.get(s.enteredBranchId) : null;
  return `[UI context — user role: ${s.user.roleLabel}; view: ${s.section}; ${b ? `inside ${b.name} digital twin` : "on Ghana map"}; sim time ${clock(sims().clock)} GMT]`;
}

export default function Assistant() {
  const section = useApp((s) => s.section);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [input, setInput] = useState("");
  const transcript = useRef<ApiMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // Open when the sidebar's AI Assistant item is chosen (state adjusted during render, not in an effect).
  const [prevSection, setPrevSection] = useState(section);
  if (section !== prevSection) {
    setPrevSection(section);
    if (section === "assistant") setOpen(true);
  }
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [lines]);

  const push = (l: Line) => setLines((x) => [...x, l]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setInput("");
    push({ role: "user", text: q });
    setBusy(true);
    try {
      if (offline) {
        push({ role: "assistant", text: await offlineAnswer(q) });
        return;
      }
      transcript.current.push({ role: "user", content: [{ type: "text", text: `${uiContext()}\n\n${q}` }] });
      for (let step = 0; step < 8; step++) {
        const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: transcript.current }) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 && data.error === "no_credentials") {
          setOffline(true);
          transcript.current = [];
          push({ role: "note", text: "No Anthropic API credential is configured on the server, so the assistant switched to offline mode (rule-based intents over the same tools)." });
          push({ role: "assistant", text: await offlineAnswer(q) });
          return;
        }
        if (!res.ok) {
          transcript.current.pop();
          push({ role: "note", text: `Assistant unavailable (${data.error ?? res.status}). Please try again.` });
          return;
        }
        if (data.stop_reason === "refusal") {
          transcript.current.pop();
          push({ role: "assistant", text: data.text });
          return;
        }
        const content = data.content as ApiBlock[];
        transcript.current.push({ role: "assistant", content });
        const text = content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n").trim();
        const calls = content.filter((b) => b.type === "tool_use");
        if (text && calls.length === 0) push({ role: "assistant", text });
        if (data.stop_reason === "pause_turn") continue;
        if (data.stop_reason !== "tool_use" || calls.length === 0) {
          if (data.stop_reason === "max_tokens") push({ role: "note", text: "Answer was cut short." });
          return;
        }
        if (text) push({ role: "assistant", text });
        // Execute every tool call, then return all results in a single user message.
        const results: ApiBlock[] = [];
        for (const c of calls) {
          push({ role: "tool", text: TOOL_LABEL[String(c.name)] ?? String(c.name) });
          const input = (c.input && typeof c.input === "object" ? c.input : {}) as Record<string, unknown>;
          const { result, isError } = await executeTool(String(c.name), input).catch((e: unknown) => ({ result: { error: String(e) }, isError: true }));
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) });
        }
        transcript.current.push({ role: "user", content: results });
      }
      push({ role: "note", text: "Stopped after several tool steps." });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="fixed bottom-14 right-4 z-40 flex items-center gap-2 rounded-full bg-brand-red px-4 py-2.5 text-sm font-semibold text-white shadow-xl shadow-red-950/50 hover:bg-red-600" aria-label="Open AI assistant">
        <Sparkles size={16} /> Ask Ops AI
      </button>
    );
  }

  return (
    <div className="glass animate-fade-in fixed bottom-14 right-4 z-40 flex h-[min(560px,calc(100vh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col rounded-2xl" role="dialog" aria-label="AI operations assistant">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-brand-red/20 text-brand-red">
          <Bot size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Ops AI Assistant</div>
          <div className="text-[10px] text-white/45">{offline ? "Offline mode · rule-based" : "Claude · grounded in simulation tools"}</div>
        </div>
        <SimBadge label="SIM DATA" />
        <button type="button" onClick={() => (setOpen(false), section === "assistant" && useApp.getState().setSection("network"))} className="rounded p-1 text-white/50 hover:text-white" aria-label="Close assistant">
          <X size={15} />
        </button>
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-3 py-3 text-[12.5px]">
        {lines.length === 0 && (
          <div>
            <p className="mb-2 text-white/55">Ask about branches, orders, safety, inventory or equipment — or tell me where to take you in 3D.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-left text-[11px] text-white/75 hover:bg-white/10 hover:text-white">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.map((l, i) =>
          l.role === "tool" ? (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-white/40">
              <Wrench size={11} /> {l.text}
            </div>
          ) : l.role === "note" ? (
            <div key={i} className="rounded-md border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-[11px] text-amber-200/80">
              {l.text}
            </div>
          ) : (
            <div key={i} className={cx("max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 leading-relaxed", l.role === "user" ? "ml-auto bg-brand-red/90 text-white" : "bg-white/[0.06] text-white/90")}>
              {l.text}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-white/45">
            <Loader2 size={12} className="animate-spin" /> Working…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-white/5 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about operations…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12.5px] text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none" aria-label="Message" />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-brand-red p-2 text-white disabled:opacity-40" aria-label="Send">
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
