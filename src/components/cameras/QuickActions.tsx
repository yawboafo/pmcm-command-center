"use client";

import { Camera, Clapperboard, Flag, Send, StickyNote } from "lucide-react";
import { useState } from "react";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { ZoneId } from "@/lib/sim/zones";
import { useIncidents } from "@/lib/ops/incidents";
import { useApp } from "@/store/app";
import { tileRegistry, useFeed } from "./feedStore";

/**
 * Five one-tap actions on the current moment: snapshot, 30-second clip, share to the branch
 * manager, flag an incident, add a note. All are saved and appear on the timeline.
 */
export default function QuickActions({ sim, zoneId, tileId }: { sim: BranchSimulation; zoneId: ZoneId; tileId: string }) {
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const add = useIncidents((s) => s.add);
  const [note, setNote] = useState<string | null>(null);
  const replayT = useFeed((s) => s.replay.t);
  const atSimS = () => replayT ?? sim.t;
  const atMs = () => sim.clockStart + atSimS() * 1000;
  const base = () => ({ branchId: sim.branchId, zoneId, atMs: atMs(), atSimS: atSimS(), by: user.name });

  const capture = (cb: (img?: string) => void) => {
    let done = false;
    tileRegistry.capture(tileId, (img) => {
      done = true;
      cb(img);
    });
    // The renderer answers on the tile's next refresh; never block the action on it.
    setTimeout(() => !done && cb(undefined), 900);
  };

  const actions = [
    { icon: Camera, label: "Snapshot", run: () => capture((image) => (add({ ...base(), kind: "snapshot", image }), notify("Snapshot saved to the timeline", "success"))) },
    { icon: Clapperboard, label: "30 s clip", run: () => capture((image) => (add({ ...base(), kind: "clip", image, clip: { fromSimS: Math.max(0, atSimS() - 30), toSimS: atSimS() } }), notify("Clip saved — the last 30 seconds", "success"))) },
    { icon: Send, label: "Share", run: () => capture((image) => (add({ ...base(), kind: "share", image, sharedWith: "Branch manager" }), notify("Shared with the branch manager", "success"))) },
    { icon: Flag, label: "Flag", run: () => capture((image) => (add({ ...base(), kind: "flag", image, note: "Flagged for follow-up" }), notify("Incident flagged", "warning"))) },
    { icon: StickyNote, label: "Note", run: () => setNote("") },
  ];
  return (
    <div className="cam-panel p-2">
      <div className="grid grid-cols-5 gap-1">
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.run} className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-white/80 hover:bg-white/10 hover:text-white">
            <a.icon size={18} />
            <span className="text-[11px]">{a.label}</span>
          </button>
        ))}
      </div>
      {note !== null && (
        <div className="cam-slide-in mt-2 flex gap-2 border-t border-white/10 pt-2">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNote(null);
              if (e.key === "Enter" && note.trim()) {
                add({ ...base(), kind: "note", note: note.trim() });
                setNote(null);
                notify("Note saved", "success");
              }
            }}
            placeholder="What did you see?"
            className="h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 text-[13px] text-white placeholder:text-white/30"
          />
          <button type="button" disabled={!note.trim()} onClick={() => (add({ ...base(), kind: "note", note: note.trim() }), setNote(null), notify("Note saved", "success"))} className="h-11 rounded-lg bg-[var(--accent)] px-3 text-[13px] font-semibold text-white disabled:opacity-40">
            Save
          </button>
        </div>
      )}
    </div>
  );
}
