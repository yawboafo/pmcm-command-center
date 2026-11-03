import type { Level } from "@/lib/sim/zones";

/** Display formatting for zone metric values recorded in history frames (numbers only). */
export function formatMetric(key: string, v: number | null): string {
  if (v === null) return "—";
  if (/wait|lampTime|service|handover/i.test(key) || key === "door") return v >= 60 ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}` : `${Math.round(v)} s`;
  if (key === "oil" || key === "qc" || key === "weather") return `${Math.round(v)}%`;
  if (key === "temp" || key === "holdTemp") return `${v.toFixed(1)} °C`;
  if (key === "oldest" || key === "cleaning" || key === "lastOpen") return `${Math.round(v)} min`;
  if (key === "drawer") return v ? "Open" : "Closed";
  return String(Math.round(v));
}

export const LEVEL_COLOR: Record<Level, string> = { ok: "var(--ok)", watch: "var(--watch)", act: "var(--act)" };
export const LEVEL_TEXT: Record<Level, string> = { ok: "text-[var(--ok)]", watch: "text-[var(--watch)]", act: "text-[var(--act)]" };

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
export const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 19);
export const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
