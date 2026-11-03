"use client";

import dynamic from "next/dynamic";
import { PLATFORM, TENANT } from "@/config/platform";

const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[var(--bg)]">
      <div className="text-center">
        <div className="font-display text-sm font-bold tracking-[0.3em] text-white/80">{PLATFORM.name.toUpperCase()}</div>
        <div className="mt-2 text-xs text-white/40">Loading {TENANT.name} workspace…</div>
      </div>
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
