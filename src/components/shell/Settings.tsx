"use client";

import { useState } from "react";
import IntegrationsPanel from "@/components/integration/IntegrationsPanel";
import MenuCatalogue from "@/components/menu/MenuCatalogue";
import { Btn, ConceptBadge, Glass, LiveBadge, SectionTitle, VerifiedBadge } from "@/components/ui/primitives";
import { gate, introPrefs, relaunch } from "@/lib/auth/gate";
import { DEMO_USERS, can } from "@/lib/auth/rbac";
import { DEFAULT_SAFETY_PROFILE, type SafetyProfile } from "@/lib/sim/catalog";
import { SIMULATION_ASSUMPTIONS } from "@/lib/sim/menu";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

const FIELDS: Array<[keyof SafetyProfile, string, string]> = [
  ["chilledMaxC", "Chilled storage maximum", "°C"],
  ["frozenMaxC", "Frozen storage maximum", "°C"],
  ["hotHoldingMinC", "Hot-holding minimum", "°C"],
  ["cookCoreMinC", "Cooked chicken core minimum", "°C"],
  ["oilQualityMinPct", "Fryer oil quality minimum", "%"],
  ["alertDelayMin", "Out-of-range time before alert", "min"],
  ["cleaningIntervalMin", "Cleaning checklist interval", "min"],
];

export default function Settings() {
  const { user, setUser, graphics, setGraphics, assetMode, setAssetMode, theme, setTheme, notify } = useApp();
  const [profile, setProfile] = useState<SafetyProfile>(sims().safety ?? DEFAULT_SAFETY_PROFILE);
  const [seed, setSeed] = useState(String(sims().seed));
  const isAdmin = can(user, "admin") || can(user, "act:safety");

  return (
    <div className="scroll-thin h-full overflow-y-auto p-6">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
        <Glass className="p-4 lg:col-span-2">
          <SectionTitle right={<Btn size="xs" onClick={() => useApp.getState().setNoticeOpen(true)}>About this prototype</Btn>}>Data provenance</SectionTitle>
          <ul className="space-y-2 text-xs text-white/70">
            <li className="flex gap-2"><VerifiedBadge /> Branch names, regions, coordinates and opening hours — official outlet directory at pizzamanchickenman.com/outlets (verified 2026-11-03). Menu names and prices — published Chris B catalogue, per-item source and date under Menu &amp; prices.</li>
            <li className="flex gap-2"><ConceptBadge /> All floor plans, equipment layouts, central-kitchen locations (except the publicly named Nyankyerenase warehouse town) and kitchen workflows are conceptual design assumptions.</li>
            <li className="flex gap-2"><LiveBadge /> Readings from physical devices bound under Integrations below. They replace the twin&apos;s value for that sensor only and are never mixed into its earlier history.</li>
          </ul>
        </Glass>

        <Glass className="p-4">
          <SectionTitle right={<span className="text-[10px] text-white/40">{profile.name}</span>}>Food-safety thresholds</SectionTitle>
          <p className="mb-3 text-[11px] text-white/50">Demo defaults mirror common HACCP reference points. Replace them with limits from the branch&apos;s approved food-safety procedures and applicable Ghana FDA requirements.</p>
          <div className="space-y-2">
            {FIELDS.map(([k, label, unit]) => (
              <label key={k} className="flex items-center justify-between gap-3 text-xs text-white/75">
                {label}
                <span className="flex items-center gap-1">
                  <input type="number" disabled={!isAdmin} value={profile[k] as number} onChange={(e) => setProfile({ ...profile, [k]: Number(e.target.value), name: "Custom profile (edited)" })} className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right font-mono text-white disabled:opacity-50" />
                  <span className="w-6 text-white/40">{unit}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Btn tone="red" disabled={!isAdmin} onClick={() => (sims().setSafety(profile), notify("Safety thresholds applied to running simulations", "success"))}>Apply thresholds</Btn>
            <Btn onClick={() => setProfile(DEFAULT_SAFETY_PROFILE)}>Reset defaults</Btn>
          </div>
        </Glass>

        <Glass className="p-4">
          <SectionTitle>Simulation</SectionTitle>
          <label className="flex items-center justify-between text-xs text-white/75">
            Random seed (deterministic replay)
            <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} className="w-32 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right font-mono text-white" />
          </label>
          <Btn className="mt-2" onClick={() => (sims().seed = Number(seed) || 1, sims().restartAll(), notify("Simulations restarted with new seed", "info"))}>Apply seed &amp; restart</Btn>
          <SectionTitle>
            <span className="mt-4 block">Simulation assumptions</span>
          </SectionTitle>
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-white/55">
            {SIMULATION_ASSUMPTIONS.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Glass>

        <Glass className="p-4">
          <SectionTitle>Launch &amp; access</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => relaunch({ forceIntro: true })}>Play intro</Btn>
            <Btn active={!introPrefs.skipOnLaunch()} onClick={() => (introPrefs.setSkipOnLaunch(!introPrefs.skipOnLaunch()), notify(introPrefs.skipOnLaunch() ? "Intro will be skipped on launch on this device" : "Intro will play on launch", "info"))}>
              Intro on launch
            </Btn>
            <Btn onClick={() => (introPrefs.setMuted(!introPrefs.muted()), notify(introPrefs.muted() ? "Intro sound off" : "Intro sound on", "info"))}>Intro sound</Btn>
            <Btn tone="red" onClick={() => (gate().endSession(), relaunch())}>Sign out</Btn>
          </div>
          <p className="mt-2 text-[11px] text-white/45">The access key is stored hashed in src/config/launch.ts; sessions are kept per device for 7 days. How to change the key or swap in real sign-in: docs/LAUNCH.md.</p>
        </Glass>

        <Glass className="p-4">
          <SectionTitle>Graphics quality</SectionTitle>
          <div className="flex gap-2">
            {(["high", "balanced", "low"] as const).map((g) => (
              <Btn key={g} active={graphics === g} onClick={() => setGraphics(g)}>
                {g[0].toUpperCase() + g.slice(1)}
              </Btn>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/45">High enables soft shadows and higher pixel ratio; Low disables shadows and caps resolution for mobile devices.</p>
          <div className="mt-3 text-[11px] text-white/60">Appearance</div>
          <div className="mt-1 flex gap-2">
            {(["dark", "light", "auto"] as const).map((t) => (
              <Btn key={t} active={theme === t} onClick={() => setTheme(t)}>
                {t === "auto" ? "Auto (system)" : t[0].toUpperCase() + t.slice(1)}
              </Btn>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-white/60">3D equipment</div>
          <div className="mt-1 flex gap-2">
            <Btn active={assetMode === "models"} onClick={() => setAssetMode("models")}>Blender models</Btn>
            <Btn active={assetMode === "procedural"} onClick={() => setAssetMode("procedural")}>Procedural</Btn>
          </div>
          <p className="mt-2 text-[11px] text-white/45">Blender models are script-generated glTF assets (see docs/ASSETS.md); equipment without a model keeps its procedural stand-in.</p>
        </Glass>

        <Glass className="p-4">
          <SectionTitle>Demo identity &amp; access</SectionTitle>
          <select value={user.id} onChange={(e) => setUser(e.target.value)} className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white">
            {DEMO_USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.roleLabel}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] text-white/45">Switching roles demonstrates branch-scoped visibility and permissions in the UI. A production deployment must enforce the same rules server-side with authenticated sessions and audit logging.</p>
        </Glass>

        <MenuCatalogue />

        <IntegrationsPanel />
      </div>
    </div>
  );
}
