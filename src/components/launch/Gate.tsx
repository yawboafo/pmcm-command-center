"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LAUNCH } from "@/config/launch";
import { PLATFORM, TENANT } from "@/config/platform";
import { gate as makeGate } from "@/lib/auth/gate";

/**
 * The access gate: one frosted card over the idling drawing. Mark, one heading, the key field
 * with show / hide, one primary button, the keep-me-signed-in switch. Nothing else. Follows the
 * app theme.
 */
export default function Gate({ onUnlocked, onDeny, unlocking }: { onUnlocked: (keep: boolean) => void; onDeny: () => void; unlocking: boolean }) {
  const g = makeGate();
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState<boolean>(LAUNCH.gate.keepSignedInDefault);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [lock, setLock] = useState(() => g.lockState());
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);
  // Cooldown countdown.
  useEffect(() => {
    if (!lock.locked) return;
    const id = setInterval(() => {
      const s = g.lockState();
      setLock(s);
      if (!s.locked) setError(null);
    }, 250);
    return () => clearInterval(id);
  }, [lock.locked, g]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || unlocking || lock.locked) return;
    setBusy(true);
    let ok: boolean;
    try {
      ok = await g.verify(value, keep);
    } catch (err) {
      // The key was not judged (server unreachable or rate limited), so it doesn't count as a failure.
      setBusy(false);
      setError(err instanceof Error ? err.message : "Try again.");
      return;
    }
    setBusy(false);
    if (ok) {
      g.resetAttempts();
      g.startSession(keep);
      setError(null);
      onUnlocked(keep);
      return;
    }
    const s = g.recordFailure();
    setLock(s);
    setValue("");
    setShake((n) => n + 1);
    setError(s.locked ? "Too many attempts" : "Incorrect password");
    onDeny();
    input.current?.focus();
  };

  return (
    <div className="launch-gate absolute inset-0 z-20 flex items-center justify-center px-4" style={{ minHeight: "100dvh" }}>
      <form onSubmit={submit} className={`launch-card w-full max-w-[380px] p-6 sm:p-7 ${unlocking ? "launch-card-unlock" : ""}`} key={shake} data-shake={shake > 0 ? "1" : undefined} aria-label="Access gate">
        <div className="flex items-center gap-3">
          <div className="launch-mark" aria-hidden>
            {PLATFORM.mark}
            <span className="launch-mark-tick" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[13px] font-semibold tracking-[0.08em] text-white">{PLATFORM.name.toUpperCase()}</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">{TENANT.name}</div>
          </div>
        </div>
        <div className="launch-eyebrow mt-7 text-left">Restricted · access key</div>
        <h1 className="mt-1.5 font-display text-[22px] font-semibold tracking-tight text-white">Enter access key</h1>
        <label className="mt-5 block">
          <span className="sr-only">Access key</span>
          <div className="relative">
            <input
              ref={input}
              type={show ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={lock.locked || unlocking}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Access key"
              aria-invalid={!!error}
              aria-describedby={error ? "gate-error" : undefined}
              className="launch-field h-12 w-full pl-4 pr-20 text-[16px] text-white outline-none placeholder:text-white/30 disabled:opacity-50"
            />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide key" : "Show key"} className="launch-field-toggle absolute right-1 top-1 h-10 px-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/55 hover:text-white">
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <div id="gate-error" role="status" aria-live="polite" className="mt-2 min-h-[18px] font-mono text-[11px] tracking-[0.02em] text-[var(--act)]">
          {lock.locked ? `Too many attempts · try again in ${lock.remainingSec} s` : error}
          {!lock.locked && !error && lock.attemptsLeft < LAUNCH.gate.maxAttempts && <span className="text-white/45">{lock.attemptsLeft} attempts left</span>}
        </div>
        <button type="submit" disabled={lock.locked || unlocking || busy} className="btn-primary mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg border text-[14px] font-semibold tracking-[0.02em] text-white disabled:opacity-50">
          {unlocking ? "Unlocking" : "Unlock"}
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
            <path d="M1 6h13M9.5 1.5L14 6l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <label className="mt-5 flex cursor-pointer items-center justify-between gap-3 text-[13px] text-white/75">
          Keep me signed in
          <span className="relative inline-flex h-7 w-12 shrink-0 items-center">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="peer sr-only" />
            <span className="absolute inset-0 rounded-full bg-white/15 transition-colors peer-checked:bg-[var(--ok)]/70 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-white/60" />
            <span className={`absolute left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${keep ? "translate-x-5" : ""}`} />
          </span>
        </label>
      </form>
    </div>
  );
}
