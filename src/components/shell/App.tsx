"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect } from "react";
import Assistant from "@/components/assistant/Assistant";
import Inspector from "@/components/panels/Inspector";
import { cx } from "@/components/ui/primitives";
import { useApp } from "@/store/app";
import BottomPanel from "./BottomPanel";
import MainView from "./MainView";
import SimDriver from "./SimDriver";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function App() {
  const right = useApp((s) => s.panels.right);
  const toggle = useApp((s) => s.togglePanel);
  const section = useApp((s) => s.section);
  const fullBleed = section === "editor" || section === "analytics" || section === "settings";

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink text-white">
      <SimDriver />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="relative flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <MainView />
          </main>
          {!fullBleed && (
            <aside className={cx("glass relative z-20 h-full shrink-0 rounded-none border-y-0 border-r-0 transition-all", right ? "w-[340px]" : "w-0 border-l-0")} aria-label="Inspector">
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
    </div>
  );
}

function Toast() {
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useApp.setState({ toast: null }), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  const tone = { info: "border-white/15", success: "border-emerald-400/40", warning: "border-amber-400/40", critical: "border-red-500/50" }[toast.tone];
  return (
    <div role="status" className={cx("glass animate-fade-in fixed bottom-60 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm text-white", tone)}>
      {toast.text}
    </div>
  );
}
