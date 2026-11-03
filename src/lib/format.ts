export const ghs = (n: number) => `GH₵${Math.round(n).toLocaleString("en-GH")}`;
export const ghsCompact = (n: number) => (n >= 1e6 ? `GH₵${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `GH₵${(n / 1e3).toFixed(1)}k` : ghs(n));
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);
export const clockSec = (ms: number) => new Date(ms).toISOString().slice(11, 19);
export const mins = (sec: number) => (sec < 60 ? `${Math.round(sec)}s` : `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, "0")}s`);
export const ago = (fromMs: number, nowMs: number) => {
  const s = Math.max(0, (nowMs - fromMs) / 1000);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
};
