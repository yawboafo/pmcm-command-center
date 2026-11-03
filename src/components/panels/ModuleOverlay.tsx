"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { SimBadge, cx } from "@/components/ui/primitives";
import { useBranchSim } from "@/lib/hooks/useSim";
import { useApp } from "@/store/app";
import InventoryModule from "./InventoryModule";
import KitchenDisplay, { OrderComposer } from "./KitchenDisplay";
import OrdersBoard from "./OrdersBoard";
import { CustomersModule, DeliveryModule, StaffModule } from "./PeopleModules";
import SafetyModule from "./SafetyModule";

const TITLES: Record<string, { title: string; sub: string }> = {
  kitchen: { title: "Kitchen Display System", sub: "Tickets per station, live timers and held stock" },
  orders: { title: "Live Orders", sub: "Order management across every channel" },
  safety: { title: "Food Safety", sub: "Sensors, alerts, cleaning and cook checks" },
  inventory: { title: "Inventory", sub: "Stock by storage location, ledger and replenishment" },
  customers: { title: "Customers", sub: "Queue, waiting times and demand" },
  staff: { title: "Staff Operations", sub: "Roster, assignments and utilisation" },
  delivery: { title: "Delivery & Dispatch", sub: "Dispatch pipeline and courier hand-over" },
};

/**
 * Operational module panel floating over the left of the 3D twin, so the
 * restaurant stays the central visual. Bottom sheet on narrow screens.
 */
export default function ModuleOverlay({ section }: { section: string }) {
  const sim = useBranchSim();
  const setSection = useApp((s) => s.setSection);
  const [collapsed, setCollapsed] = useState(false);
  const meta = TITLES[section];
  if (!sim || !meta) return null;
  // Say so when some rows in this module come from connected sources (orders, sensors).
  const sourced = (src: "live" | "virtual") =>
    (section === "orders" || section === "kitchen" || section === "delivery" ? [...sim.orders.values()].some((o) => o.source === src) : false) ||
    (section === "safety" ? [...sim.sensors.values()].some((x) => x.source === src) : false);
  const hasLive = sourced("live");
  const hasVirtual = sourced("virtual");

  return (
    <section
      aria-label={meta.title}
      className={cx(
        "glass animate-fade-in absolute z-20 flex flex-col overflow-hidden",
        "inset-x-2 bottom-2 max-h-[60%] rounded-xl sm:inset-x-auto sm:bottom-3 sm:left-3 sm:top-3 sm:max-h-none sm:w-[460px]",
        collapsed && "sm:bottom-auto",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-[13px] font-bold text-white">{meta.title}</h2>
            {hasLive ? <SimBadge label={hasVirtual ? "SIMULATED + SIM DEVICE + LIVE" : "SIMULATED + LIVE"} /> : hasVirtual ? <SimBadge label="SIMULATED + SIM DEVICE" /> : <SimBadge />}
          </div>
          {!collapsed && <p className="truncate text-[10.5px] text-white/45">{meta.sub} · {sim.branchName}</p>}
        </div>
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white" aria-label={collapsed ? "Expand panel" : "Collapse panel"}>
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <button type="button" onClick={() => setSection("twin")} className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close panel">
          <X size={15} />
        </button>
      </header>
      {!collapsed && (
        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {section === "kitchen" && (
            <>
              <OrderComposer sim={sim} />
              <KitchenDisplay sim={sim} />
            </>
          )}
          {section === "orders" && (
            <>
              <OrdersBoard sim={sim} />
              <OrderComposer sim={sim} />
            </>
          )}
          {section === "safety" && <SafetyModule sim={sim} />}
          {section === "inventory" && <InventoryModule sim={sim} />}
          {section === "customers" && <CustomersModule sim={sim} />}
          {section === "staff" && <StaffModule sim={sim} />}
          {section === "delivery" && <DeliveryModule sim={sim} />}
        </div>
      )}
    </section>
  );
}
