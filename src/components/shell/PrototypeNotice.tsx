"use client";

import { Cpu } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui/primitives";
import { INTEGRATIONS, STATUS_LABEL, type IntegrationStatus } from "@/config/integrations";
import { PLATFORM, TENANT } from "@/config/platform";
import { useApp } from "@/store/app";

export const NOTICE_KEY = "ops.prototypeNotice.v1";

const STATUS_STYLE: Record<IntegrationStatus, string> = {
  ready: "border-emerald-400/30 text-emerald-300",
  designed: "border-sky-400/30 text-sky-300",
  todo: "border-white/15 text-white/45",
};

/**
 * Shown when the app starts: this is a prototype, what in it is real, and the systems and
 * hardware that still have to be connected. After this, the UI does not label simulated data
 * (UI_POLICY); only LIVE data gets a badge.
 */
export default function PrototypeNotice() {
  const open = useApp((s) => s.noticeOpen);
  const setOpen = useApp((s) => s.setNoticeOpen);
  const [dontShow, setDontShow] = useState(false);
  if (!open) return null;
  const close = () => {
    try {
      if (dontShow) window.localStorage.setItem(NOTICE_KEY, "dismissed");
    } catch {
      /* storage unavailable: show again next time */
    }
    setOpen(false);
  };
  const ready = INTEGRATIONS.filter((i) => i.status === "ready").length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation">
      <div role="dialog" aria-modal aria-labelledby="notice-title" className="glass animate-fade-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl">
        <div className="border-b border-white/[0.07] px-6 pb-4 pt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">Prototype</div>
          <h1 id="notice-title" className="mt-1 font-display text-xl font-bold text-white">
            {PLATFORM.name} <span className="font-normal text-white/45">· {TENANT.name} workspace</span>
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-white/70">
            This is a working prototype of the operations platform. Branch locations, opening hours and menu prices are real, taken from {TENANT.name}&apos;s published sources. Floor plans are
            conceptual. Orders, kitchen activity, staff, sensors, cameras and alerts are simulated — nothing is connected to the restaurants yet. To keep the screens clean, simulated data is not labelled
            anywhere else in the app; anything coming from a real device or system is marked <span className="font-mono text-emerald-300">LIVE</span>.
          </p>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3 flex items-center gap-2">
            <Cpu size={14} className="text-white/50" />
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">To complete it — systems and hardware to connect</h2>
            <span className="ml-auto font-mono text-[10px] text-white/35">
              {ready}/{INTEGRATIONS.length} ready to connect
            </span>
          </div>
          <ul className="divide-y divide-white/[0.06]">
            {INTEGRATIONS.map((i) => (
              <li key={i.area} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-start gap-x-4 py-2.5 max-sm:grid-cols-1">
                <div className="text-[12.5px] font-medium text-white">{i.area}</div>
                <div className="min-w-0">
                  <div className="text-[12px] text-white/75">{i.hardware}</div>
                  <div className="text-[11px] text-white/40">{i.what}</div>
                </div>
                <span className={cx("whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider", STATUS_STYLE[i.status])}>{STATUS_LABEL[i.status]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10.5px] leading-snug text-white/35">
            &quot;Ready to connect&quot; means the receiving side is built and tested in this prototype (data contract, signed endpoint, screens), using virtual devices. Details: docs/INTEGRATION.md.
          </p>
        </div>

        <div className="flex items-center gap-4 border-t border-white/[0.07] px-6 py-3">
          <label className="flex items-center gap-2 text-[11.5px] text-white/55">
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="accent-white" />
            Don&apos;t show this again
          </label>
          <button type="button" onClick={close} autoFocus className="ml-auto rounded-lg bg-white px-4 py-2 text-[12.5px] font-semibold text-black hover:bg-white/90">
            Enter the prototype
          </button>
        </div>
      </div>
    </div>
  );
}
