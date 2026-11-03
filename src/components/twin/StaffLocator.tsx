"use client";

import { Camera, Radio, Users, X } from "lucide-react";
import { useTwin } from "./twinStore";
import { SourceBadge, cx } from "@/components/ui/primitives";
import { can } from "@/lib/auth/rbac";
import { badgeLine, cameraFor, locationProvenance, onShiftStaff, staffLabel } from "@/lib/ops/staffLocation";
import { ROLE_LABEL, type BranchSimulation } from "@/lib/sim/engine";
import type { Agent } from "@/lib/sim/types";
import { useApp } from "@/store/app";

function roleOf(a: Agent) {
  return a.role ? ROLE_LABEL[a.role] : "Staff";
}

/** Where a staff member is and what they are doing, in one short line. */
function whereLine(sim: BranchSimulation, a: Agent) {
  const room = sim.roomAtPoint(a.pos)?.name ?? "—";
  if (a.tracked) return room;
  const task = a.taskId ? sim.tasks.get(a.taskId) : undefined;
  return task ? `${room} · ${task.label}` : room;
}

/**
 * Staff locator (HUD): everyone on shift with where they are and whether that position comes
 * from a worn badge (LIVE / SIM DEVICE) or the simulation. Locate flies the camera to them and
 * follows. Named locations are limited to roles with `view:staff-location`.
 */
export function StaffLocator({ sim }: { sim: BranchSimulation }) {
  const open = useTwin((s) => s.staffOpen);
  const setOpen = useTwin((s) => s.setStaffOpen);
  const user = useApp((s) => s.user);
  const followAgent = useApp((s) => s.followAgent);
  const followId = useApp((s) => s.followAgentId);
  useApp((s) => s.tick);
  const allowed = can(user, "view:staff-location");
  const staff = onShiftStaff(sim).sort((a, b) => Number(!!b.tracked) - Number(!!a.tracked) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const tracked = staff.filter((a) => a.tracked && !a.tracked.lost).length;

  return (
    <div className="pointer-events-auto relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="glass flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-semibold text-white hover:bg-white/10">
        <Users size={14} className="text-emerald-300" /> Staff
        <span className="font-mono text-[10px] font-normal text-white/45">
          {staff.length}
          {tracked > 0 && ` · ${tracked} badge${tracked > 1 ? "s" : ""}`}
        </span>
      </button>
      {open && (
        <div className="glass animate-fade-in absolute left-0 top-full mt-2 w-80 rounded-xl p-1">
          {!allowed && <p className="px-3 py-2 text-[10.5px] text-amber-200/80">Named staff locations need a manager or supervisor role. Showing anonymised staff; locate is disabled.</p>}
          <ul className="scroll-thin max-h-[55vh] overflow-y-auto">
            {staff.map((a) => {
              const line = badgeLine(a, sim.t);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={!allowed}
                    onClick={() => {
                      followAgent(a.id);
                      setOpen(false);
                    }}
                    className={cx("flex w-full items-start gap-2 rounded-lg px-3 py-1.5 text-left disabled:cursor-not-allowed", followId === a.id ? "bg-white/10" : "hover:bg-white/[0.07]")}
                  >
                    <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", a.tracked ? (a.tracked.lost ? "bg-amber-400" : "bg-emerald-400") : "bg-white/25")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] text-white">{staffLabel(user, a, roleOf(a))}</span>
                        <SourceBadge source={locationProvenance(a)} />
                      </span>
                      <span className="block truncate text-[10.5px] text-white/45">
                        {allowed ? `${roleOf(a)} · ${whereLine(sim, a)}` : roleOf(a)}
                      </span>
                      {line && allowed && (
                        <span className="flex items-center gap-1 font-mono text-[9.5px] text-white/40">
                          <Radio size={10} /> {a.tracked!.tagId} · {line}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-white/[0.06] px-3 py-1.5 text-[9.5px] leading-snug text-white/35">Badge positions are personal data: shown on shift and on premises only, to authorised roles.</p>
        </div>
      )}
    </div>
  );
}

/** Banner while the camera follows a person: who, where, badge quality, and the best virtual camera. */
export function PersonFollowBanner({ sim }: { sim: BranchSimulation }) {
  const id = useApp((s) => s.followAgentId);
  const mode = useApp((s) => s.cameraMode);
  const user = useApp((s) => s.user);
  const followAgent = useApp((s) => s.followAgent);
  const goToCamera = useApp((s) => s.useVirtualCamera);
  const select = useApp((s) => s.select);
  useApp((s) => s.tick);
  if (mode !== "follow" || !id) return null;
  const a = sim.agents.find((x) => x.id === id && !x.gone);
  if (!a) return null;
  const room = sim.roomAtPoint(a.pos);
  const cam = cameraFor(sim.plan, a.pos[0], a.pos[1], room?.id);
  const line = badgeLine(a, sim.t);
  return (
    <div className="glass pointer-events-auto absolute bottom-14 left-1/2 flex max-w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl px-3 py-2 text-[12px] text-white">
      <Users size={14} className="shrink-0 text-emerald-300" />
      <button type="button" className="truncate font-semibold hover:underline" onClick={() => select({ kind: "agent", id })}>
        {a.kind === "staff" ? staffLabel(user, a, roleOf(a)) : a.name}
      </button>
      <SourceBadge source={locationProvenance(a)} />
      <span className="truncate text-white/55">
        {room?.name ?? "—"}
        {line && ` · ${line}`}
      </span>
      {cam && (
        <button type="button" onClick={() => goToCamera(cam.id)} title="Switch to the virtual camera with the best view of this person" className="flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[11px] hover:bg-white/10">
          <Camera size={12} /> {cam.code}
        </button>
      )}
      <button type="button" onClick={() => followAgent(null)} className="shrink-0 rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Stop following">
        <X size={13} />
      </button>
    </div>
  );
}
