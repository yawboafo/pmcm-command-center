"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect } from "react";
import Assistant from "@/components/assistant/Assistant";
import Inspector from "@/components/panels/Inspector";
import { cx } from "@/components/ui/primitives";
import { BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import BottomPanel from "./BottomPanel";
import CommandPalette from "./CommandPalette";
import PrototypeNotice from "./PrototypeNotice";
import MainView from "./MainView";
import { ShortcutsHelp, useShortcuts } from "./Shortcuts";
import SimDriver from "./SimDriver";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function App() {
  const right = useApp((s) => s.panels.right);
  const toggle = useApp((s) => s.togglePanel);
  const section = useApp((s) => s.section);
  const cctvOpen = useApp((s) => s.cctvOpen);
  // The camera centre is a full-bleed control-room surface: no inspector or activity feed beside it.
  const fullBleed = section === "editor" || section === "analytics" || section === "settings" || (section === "cameras" && cctvOpen);
  usePhoneLayout();
  useShortcuts();
  useCriticalAlertWatch();
  useThemeSync();

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--bg)] text-white">
      <SimDriver />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="relative flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <MainView />
          </main>
          {!fullBleed && (
            <aside className={cx("glass relative z-20 h-full shrink-0 rounded-none border-y-0 border-r-0 transition-all max-md:absolute max-md:right-0 max-md:top-0", right ? "w-[340px] max-md:w-[min(340px,calc(100vw-4.5rem))]" : "w-0 border-l-0")} aria-label="Inspector">
              <button type="button" onClick={() => toggle("right")} className="glass absolute -left-8 top-3 z-10 rounded-l-lg rounded-r-none border-r-0 p-1.5 text-white/60 hover:text-white" aria-label={right ? "Collapse inspector" : "Expand inspector"}>
                {right ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </button>
              {right && (
                <div className="scroll-thin h-full overflow-y-auto">
                  <Inspector />
                </div>
              )}
            </aside>
          )}
        </div>
        {!fullBleed && <BottomPanel />}
      </div>
      <Assistant />
      <Toast />
      <CommandPalette />
      <PrototypeNotice />
      <ShortcutsHelp />
    </div>
  );
}

/** Phones (below md): the folded inspector slides in whenever something is selected. */
function usePhoneLayout() {
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (window.innerWidth < 768 && s.selection && s.selection !== prev.selection && !s.panels.right) useApp.setState({ panels: { ...s.panels, right: true } });
      }),
    [],
  );
}

/** Apply the resolved theme to <html data-theme> and follow the OS while the preference is "auto". */
function useThemeSync() {
  const theme = useApp((s) => s.theme);
  const resolved = useApp((s) => s.resolvedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => useApp.getState().setResolvedTheme(mq.matches ? "light" : "dark");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
}

/**
 * Raise a toast only for critical alerts that open while the console is running — not for
 * alerts that already existed when a branch simulation started — with a one-click jump.
 */
const seenAlerts = new Map<string, Set<string>>();
function useCriticalAlertWatch() {
  const tick = useApp((s) => s.tick);
  useEffect(() => {
    for (const sim of sims().sims.values()) {
      let seen = seenAlerts.get(sim.branchId);
      const fresh = !seen;
      if (!seen) seenAlerts.set(sim.branchId, (seen = new Set()));
      for (const a of sim.alerts) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        if (fresh || a.severity !== "critical" || a.status !== "open") continue;
        const name = BRANCH_BY_ID.get(sim.branchId)?.name ?? sim.branchId;
        useApp.getState().notify(`${name}: ${a.title}`, "critical", {
          label: "Inspect",
          run: () => {
            const app = useApp.getState();
            if (app.enteredBranchId !== sim.branchId) app.enterBranch(sim.branchId);
            app.select({ kind: "alert", id: a.id });
          },
        });
      }
    }
  }, [tick]);
}

function Toast() {
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    // Critical alerts stay long enough to act on.
    const id = setTimeout(() => useApp.setState({ toast: null }), toast.tone === "critical" ? 9000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  const tone = { info: "border-white/15", success: "border-emerald-400/40", warning: "border-amber-400/40", critical: "border-red-500/60" }[toast.tone];
  return (
    <div role={toast.tone === "critical" ? "alert" : "status"} className={cx("glass animate-fade-in fixed left-1/2 top-16 z-50 flex max-w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2 text-sm text-white", tone)}>
      {toast.tone === "critical" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />}
      <span className="min-w-0">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            useApp.setState({ toast: null });
          }}
          className="shrink-0 rounded-md border border-white/20 px-2 py-0.5 text-[12px] font-medium hover:bg-white/10"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
