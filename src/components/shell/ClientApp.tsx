"use client";

import dynamic from "next/dynamic";

const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#07090d]">
      <div className="text-center">
        <div className="font-display text-sm font-bold tracking-[0.3em] text-white/80">PIZZAMAN · CHICKENMAN</div>
        <div className="mt-2 text-xs text-white/40">Loading operations command center…</div>
      </div>
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
