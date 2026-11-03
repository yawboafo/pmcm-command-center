"use client";

import {
  Bot,
  Boxes,
  Building2,
  Camera,
  ChartLine,
  ChefHat,
  Cuboid,
  Factory,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  ReceiptText,
  Settings,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui/primitives";
import { PLATFORM, TENANT } from "@/config/platform";
import { useSnapshots } from "@/lib/hooks/useSim";
import { useApp, type Section } from "@/store/app";

export const NAV: Array<{ id: Section; label: string; icon: LucideIcon; group: string }> = [
  { id: "network", label: "Ghana Network", icon: MapIcon, group: "Network" },
  { id: "branches", label: "Restaurant Branches", icon: Building2, group: "Network" },
  { id: "twin", label: "3D Digital Twin", icon: Cuboid, group: "Restaurant" },
  { id: "cameras", label: "Virtual Cameras", icon: Camera, group: "Restaurant" },
  { id: "kitchen", label: "Kitchen Operations", icon: ChefHat, group: "Restaurant" },
  { id: "orders", label: "Live Orders", icon: ReceiptText, group: "Restaurant" },
  { id: "safety", label: "Food Safety", icon: ShieldCheck, group: "Restaurant" },
  { id: "inventory", label: "Inventory", icon: Boxes, group: "Restaurant" },
  { id: "customers", label: "Customers", icon: UserRound, group: "Restaurant" },
  { id: "staff", label: "Staff", icon: Users, group: "Restaurant" },
  { id: "delivery", label: "Delivery", icon: Truck, group: "Restaurant" },
  { id: "central", label: "Central Kitchens", icon: Factory, group: "Supply" },
  { id: "analytics", label: "Analytics", icon: ChartLine, group: "Insights" },
  { id: "assistant", label: "AI Assistant", icon: Bot, group: "Insights" },
  { id: "editor", label: "Floor Plan Editor", icon: PencilRuler, group: "Admin" },
  { id: "settings", label: "Settings", icon: Settings, group: "Admin" },
];

export default function Sidebar() {
  const section = useApp((s) => s.section);
  const setSection = useApp((s) => s.setSection);
  const open = useApp((s) => s.panels.left);
  const toggle = useApp((s) => s.togglePanel);
  const snaps = useSnapshots();
  const crit = snaps.filter((s) => s.status === "critical").length;
  const warn = snaps.filter((s) => s.status === "warning").length;
  const go = (id: Section) => {
    setSection(id);
    // On phones the open sidebar covers the view; close it once a section is chosen.
    if (open && window.innerWidth < 768) toggle("left");
  };

  return (
    // Below md the collapsed rail keeps its 3.5 rem in the layout and the open menu overlays the view.
    <div className="relative h-full shrink-0 max-md:w-14">
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => toggle("left")} aria-hidden />}
      <nav aria-label="Main" className={cx("glass z-30 flex h-full flex-col rounded-none border-y-0 border-l-0 transition-all max-md:absolute max-md:left-0 max-md:top-0 max-md:z-40", open ? "w-60" : "w-14")}>
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-3">
          {/* Platform mark (the product), with the customer workspace underneath. */}
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 bg-gradient-to-br from-white/[0.14] to-white/[0.03] font-mono text-[11px] font-semibold tracking-tight text-white" aria-hidden>
            {PLATFORM.mark}
          </div>
          {open && (
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-[12.5px] font-bold tracking-wide text-white">{PLATFORM.name}</div>
              <div className="flex items-center gap-1.5 truncate text-[10px] text-white/50" title={`Workspace: ${TENANT.name} (${TENANT.plan})`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-red" aria-hidden />
                <span className="truncate">{TENANT.name}</span>
              </div>
            </div>
          )}
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
          {NAV.map((n, i) => {
            const header = open && (i === 0 || NAV[i - 1].group !== n.group) ? n.group : null;
            const Icon = n.icon;
            const active = section === n.id;
            return (
              <div key={n.id}>
                {header && <div className="px-2 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/30">{header}</div>}
                <button
                  type="button"
                  onClick={() => go(n.id)}
                  title={n.label}
                  aria-current={active ? "page" : undefined}
                  className={cx("group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition", active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white")}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-red" />}
                  <Icon size={16} className={active ? "text-brand-red" : ""} />
                  {open && <span className="truncate">{n.label}</span>}
                  {open && n.id === "network" && (crit > 0 || warn > 0) && (
                    <span className="ml-auto flex gap-1">
                      {crit > 0 && <span className="rounded bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-300">{crit}</span>}
                      {warn > 0 && <span className="rounded bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-200">{warn}</span>}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => toggle("left")} className="flex items-center gap-2 border-t border-white/5 px-4 py-3 text-xs text-white/50 hover:text-white" aria-label={open ? "Collapse sidebar" : "Expand sidebar"}>
          {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          {open && "Collapse"}
        </button>
      </nav>
    </div>
  );
}
