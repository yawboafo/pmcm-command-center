"use client";

import { useEffect } from "react";
import { useTwin } from "@/components/twin/twinStore";
import { useApp, type CameraMode } from "@/store/app";

const MODES: CameraMode[] = ["dollhouse", "orbit", "fps", "top", "tour"];

export const SHORTCUTS: Array<[string, string, "anywhere" | "twin"]> = [
  ["⌘K  /", "Command palette", "anywhere"],
  ["?", "This list", "anywhere"],
  ["Esc", "Close / clear selection", "anywhere"],
  ["M", "Back to the Ghana map", "twin"],
  ["1–5", "Dollhouse · Free · Walk · Top · Tour", "twin"],
  ["V", "Live 2D floor plan / back to 3D", "twin"],
  ["S", "Stations & zones", "twin"],
  ["G", "Virtual camera grid", "twin"],
  ["X", "X-ray walls", "twin"],
  ["P", "Show paths", "twin"],
];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Global keyboard shortcuts (ignored while typing in a field). Renders nothing. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        app.setPaletteOpen(!app.paletteOpen);
        return;
      }
      if (e.key === "Escape") {
        if (app.paletteOpen || app.shortcutsOpen) return app.paletteOpen ? app.setPaletteOpen(false) : app.setShortcutsOpen(false);
        if (app.selection) app.select(null);
        return;
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || app.paletteOpen) return;
      if (e.key === "/") return (e.preventDefault(), app.setPaletteOpen(true));
      if (e.key === "?") return app.setShortcutsOpen(!app.shortcutsOpen);
      const inside = app.enteredBranchId && app.phase === "inside";
      if (!inside) return;
      // First-person walk uses WASD; leave keys alone while the pointer is locked.
      if (app.cameraMode === "fps" && useTwin.getState().fpsLocked) return;
      const k = e.key.toLowerCase();
      if (k >= "1" && k <= "5") return (app.setCctv(false), app.setView2d(false), app.setCameraMode(MODES[+k - 1]));
      if (k === "v") return app.setView2d(!app.view2d);
      if (k === "m") return app.exitToMap();
      if (k === "g") return app.setCctv(!app.cctvOpen);
      if (k === "x") return app.toggle("xray");
      if (k === "p") return app.toggle("showPaths");
      if (k === "s") return useTwin.getState().setStationsOpen(!useTwin.getState().stationsOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function ShortcutsHelp() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4" onMouseDown={() => setOpen(false)} role="presentation">
      <div role="dialog" aria-label="Keyboard shortcuts" className="glass animate-fade-in w-full max-w-sm rounded-xl p-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Keyboard shortcuts</div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, what, where]) => (
            <div key={keys} className="flex items-center gap-3 text-[12px]">
              <dt className="w-16 shrink-0">
                <kbd className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-white/80">{keys}</kbd>
              </dt>
              <dd className="flex-1 text-white/75">{what}</dd>
              {where === "twin" && <span className="font-mono text-[9px] uppercase tracking-wider text-white/30">in branch</span>}
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
