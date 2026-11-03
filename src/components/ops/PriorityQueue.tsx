"use client";

import { requestFlyTo } from "@/components/map/mapState";
import { SectionTitle, SourceBadge, cx } from "@/components/ui/primitives";
import { useSnapshots } from "@/lib/hooks/useSim";
import { rankPriorities, type PriorityItem } from "@/lib/ops/priority";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";

const KIND_LABEL: Record<PriorityItem["kind"], string> = {
  "food-safety": "Food safety",
  "device-offline": "Device",
  equipment: "Equipment",
  "order-delays": "Orders",
  stock: "Stock",
  hygiene: "Hygiene",
  "network-model": "Network",
};

function age(sinceMs: number | undefined, nowMs: number) {
  if (sinceMs === undefined) return "";
  const m = Math.max(0, Math.round((nowMs - sinceMs) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Ranked attention queue (see lib/ops/priority.ts). On the map it covers the whole network;
 * inside a twin pass `branchId` to show only that branch. Clicking jumps to the issue.
 */
export default function PriorityQueue({ branchId, limit = 8 }: { branchId?: string; limit?: number }) {
  const snaps = useSnapshots();
  const select = useApp((s) => s.select);
  const selectBranch = useApp((s) => s.selectBranch);
  const entered = useApp((s) => s.enteredBranchId);
  const now = sims().clock;
  const items = rankPriorities(branchId ? snaps.filter((s) => s.branchId === branchId) : snaps, sims().sims, now, limit);

  const open = (it: PriorityItem) => {
    if (it.target && (it.target.kind === "alert" || it.target.kind === "order")) {
      select({ kind: it.target.kind, id: it.target.id });
      return;
    }
    if (entered === it.branchId) return;
    selectBranch(it.branchId);
    requestFlyTo(it.branchId);
  };

  return (
    <div>
      <SectionTitle right={<span className="font-mono text-[10px] text-white/35">{items.length ? `${items.length} ranked` : ""}</span>}>Priority</SectionTitle>
      {items.length === 0 ? (
        <p className="text-[11px] text-white/40">Nothing needs attention.</p>
      ) : (
        <ol className="space-y-1">
          {items.map((it, i) => (
            <li key={it.id}>
              <button type="button" onClick={() => open(it)} className="group flex w-full items-stretch gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] py-1.5 pr-2 text-left transition hover:border-white/15 hover:bg-white/[0.05]">
                <span className={cx("w-0.5 shrink-0 rounded-full", it.severity === "critical" ? "bg-red-500" : "bg-amber-400")} aria-hidden />
                <span className="w-4 shrink-0 pt-px text-right font-mono text-[10px] text-white/30">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cx("truncate text-[11.5px] font-medium", it.severity === "critical" ? "text-red-200" : "text-white/85")}>{it.title}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/45">
                    <span className="uppercase tracking-wider text-white/35">{KIND_LABEL[it.kind]}</span>
                    {!branchId && <span className="truncate">· {it.branchName}</span>}
                    {it.since !== undefined && <span className="font-mono">· {age(it.since, now)}</span>}
                  </span>
                </span>
                <SourceBadge source={it.provenance} className="self-start" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
