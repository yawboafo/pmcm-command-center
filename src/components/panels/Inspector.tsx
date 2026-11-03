"use client";

import { X } from "lucide-react";
import { useBranchSim } from "@/lib/hooks/useSim";
import { useApp } from "@/store/app";
import { findSimFor } from "./common";
import InspectAlert from "./InspectAlert";
import { BranchLive, InspectBranch, NationalSummary } from "./InspectBranch";
import InspectEquipment from "./InspectEquipment";
import { InspectAgent, InspectCamera, InspectRoom, InspectSensor, InspectWorkstation } from "./InspectMisc";
import InspectOrder from "./InspectOrder";

/** Right-panel inspector: renders details for whatever is selected. */
export default function Inspector() {
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const sim = useBranchSim();

  let body: React.ReactNode = null;
  if (!selection) {
    body = sim ? <BranchLive sim={sim} /> : <NationalSummary />;
  } else if (selection.kind === "branch") {
    body = <InspectBranch id={selection.id} />;
  } else {
    // Orders/alerts may be selected from the network feed while outside a branch.
    const s =
      selection.kind === "order"
        ? findSimFor((x) => x.orders.has(selection.id))
        : selection.kind === "alert"
          ? findSimFor((x) => x.alerts.some((a) => a.id === selection.id))
          : sim;
    if (!s) body = <p className="p-4 text-xs text-white/50">Open a branch twin to inspect this item.</p>;
    else
      switch (selection.kind) {
        case "equipment":
          body = <InspectEquipment sim={s} id={selection.id} />;
          break;
        case "alert":
          body = <InspectAlert sim={s} id={selection.id} />;
          break;
        case "order":
          body = <InspectOrder sim={s} id={selection.id} />;
          break;
        case "agent":
          body = <InspectAgent sim={s} id={selection.id} />;
          break;
        case "camera":
          body = <InspectCamera sim={s} id={selection.id} />;
          break;
        case "workstation":
          body = <InspectWorkstation sim={s} id={selection.id} />;
          break;
        case "room":
          body = <InspectRoom sim={s} id={selection.id} />;
          break;
        case "sensor":
          body = <InspectSensor sim={s} id={selection.id} />;
          break;
      }
  }

  return (
    <div className="relative">
      {selection && (
        <button type="button" onClick={() => select(null)} className="absolute right-2 top-2 z-10 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white" aria-label="Clear selection">
          <X size={14} />
        </button>
      )}
      {body}
    </div>
  );
}
