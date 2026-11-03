"use client";

import { useEffect, useMemo, useRef } from "react";
import { ROLE_LABEL, type BranchSimulation } from "@/lib/sim/engine";
import type { Agent } from "@/lib/sim/types";
import { inRooms, zoneRooms, type ZoneId } from "@/lib/sim/zones";
import { useApp } from "@/store/app";
import { projectToTile, useFeed, type Layer } from "./feedStore";
import { mmss } from "./format";
import { replayAgentsFor } from "./replay";

/**
 * Instrumentation drawn on the feed: people boxes with role and time-at-post, the queue line
 * with its count and longest wait, order tags that age green → amber → red, door and
 * temperature badges anchored to the equipment, and an occupancy heat map from the last ten
 * minutes of history. Membership refreshes at the panel rate (≈4 Hz); positions are
 * projected through the tile's camera every animation frame straight into the DOM.
 */
const KITCHEN = new Set(["KITCHEN_QUEUE", "PREPARATION", "COOKING", "QUALITY_CHECK", "PACKAGING"]);

interface Box {
  id: string;
  kind: Agent["kind"];
  label: string;
  sub?: string;
  x: number;
  z: number;
  height: number;
  tone?: "ok" | "watch" | "act";
}
interface Tag {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  tone: "ok" | "watch" | "act" | "neutral";
  kind: "ticket" | "door" | "temp";
}
interface Blob {
  id: string;
  x: number;
  z: number;
  w: number;
}

export default function FeedOverlay({ tileId, zoneId, sim, compact = false }: { tileId: string; zoneId: ZoneId; sim: BranchSimulation; compact?: boolean }) {
  const tick = useApp((s) => s.tick);
  const layers = useFeed((s) => s.layers);
  const replayT = useFeed((s) => s.replay.t);
  const root = useRef<HTMLDivElement>(null);
  const queuePath = useRef<SVGPathElement>(null);
  const queueLabel = useRef<HTMLDivElement>(null);
  const plan = sim.plan;
  const rooms = useMemo(() => zoneRooms(plan, zoneId), [plan, zoneId]);
  const cam = sim.zoneCameras.find((c) => c.zoneId === zoneId);

  // ── membership (4 Hz) ──
  const model = useMemo(() => {
    const t = replayT ?? sim.t;
    const agents = replayT === null ? sim.agents.filter((a) => !a.gone) : replayAgentsFor(sim, replayT);
    const inZone = (a: Agent) => (zoneId === "entrance" ? a.pos[1] < 0.9 : zoneId === "back-door" ? (cam?.doorId ? Math.hypot(a.pos[0] - (plan.doors.find((d) => d.id === cam.doorId)?.x ?? 0), a.pos[1] - (plan.doors.find((d) => d.id === cam.doorId)?.z ?? 0)) < 4.5 : false) : inRooms(plan, rooms, a.pos));
    const boxes: Box[] = [];
    if (layers.people) {
      for (const a of agents) {
        if (!inZone(a)) continue;
        const live = replayT === null ? a : undefined;
        let label = a.kind === "staff" ? (a.role ? ROLE_LABEL[a.role] : "Staff") : a.kind === "rider" ? "Rider" : "Customer";
        let sub: string | undefined;
        let tone: Box["tone"];
        let quiet = false;
        if (live) {
          if (a.kind === "customer" && sim.queue.includes(a.id)) {
            const w = t - a.arrivedAt;
            tone = w > 300 ? "act" : w > 180 ? "watch" : undefined;
            // In a queue only the front customer (and anyone waiting too long) carries a label: the queue marker has the count.
            quiet = sim.queue[0] !== a.id && w <= 180;
            sub = quiet ? undefined : `waited ${mmss(w)}`;
          } else if (a.kind === "rider" && (a.phase === "waiting" || a.phase === "to-wait")) {
            const w = t - a.arrivedAt;
            sub = `waiting ${mmss(w)}`;
            tone = w > 480 ? "act" : w > 300 ? "watch" : undefined;
          } else if (a.kind === "staff") {
            const m = sim.staff.get(a.id);
            label = a.name.split(" ")[0] + " · " + label;
            if (a.breakUntil !== undefined) {
              sub = "on break";
              tone = "watch";
            } else if (m?.offPostSince !== undefined && t - m.offPostSince > 60) {
              sub = `away ${mmss(t - m.offPostSince)}`;
              tone = t - m.offPostSince > 180 ? "watch" : undefined;
            } else if (a.phase === "working") sub = "at post";
          }
        } else if (a.kind === "staff") label = a.name.split(" ")[0] + " · " + label;
        else quiet = true; // replay: boxes only for customers and riders, the numbers panel carries the counts
        boxes.push({ id: a.id, kind: a.kind, label: quiet ? "" : label, sub, x: a.pos[0], z: a.pos[1], height: 1.72, tone });
      }
    }
    const tags: Tag[] = [];
    if (layers.tickets && replayT === null && !compact) {
      const seen = new Map<string, number>();
      for (const [wsId, v] of sim.activeWorkstations()) {
        const ws = sim.wsById.get(wsId);
        if (!ws || !rooms.some((r) => r.id === ws.roomId)) continue;
        for (const oid of v.orderIds) {
          const o = sim.orders.get(oid);
          if (!o || o.acceptedAt === undefined || !KITCHEN.has(o.status)) continue;
          const n = (seen.get(wsId) ?? 0) + 1;
          seen.set(wsId, n);
          const age = t - o.acceptedAt;
          tags.push({ id: `tk:${oid}`, x: ws.standPoint[0], y: 1.5 + n * 0.22, z: ws.standPoint[1], text: `#${o.number} · ${mmss(age)}`, tone: age > 720 ? "act" : age > 360 ? "watch" : "ok", kind: "ticket" });
        }
      }
      if (zoneId === "pass" || zoneId === "pickup-bay") {
        const ready = [...sim.orders.values()].filter((o) => o.status === "READY" && o.readyAt !== undefined && (zoneId === "pickup-bay" ? o.fulfilment === "delivery" : o.fulfilment !== "delivery"));
        const ws = plan.workstations.find((w) => w.type === (zoneId === "pickup-bay" ? "dispatch" : "pickup"));
        ready.slice(0, 5).forEach((o, i) => {
          const age = t - o.readyAt!;
          if (ws) tags.push({ id: `rd:${o.id}`, x: ws.standPoint[0], y: 1.45 + i * 0.22, z: ws.standPoint[1], text: `#${o.number} · ${mmss(age)}`, tone: age > 600 ? "act" : age > 300 ? "watch" : "ok", kind: "ticket" });
        });
      }
    }
    if (layers.doors) {
      const doorIds = new Set<string>();
      if (cam?.doorId && !compact) doorIds.add(cam.doorId);
      for (const id of doorIds) {
        const d = plan.doors.find((x) => x.id === id);
        if (!d) continue;
        const open = replayT === null ? sim.doors.get(id)?.open : !!sim.frameAt(replayT)?.doors[id];
        const since = replayT === null ? sim.doors.get(id)?.since ?? t : t;
        const dur = open && replayT === null ? t - since : 0;
        const after = !sim.isOpen();
        tags.push({ id: `door:${id}`, x: d.x, y: 2.05, z: d.z, text: open ? `Door open${dur > 20 ? ` · ${mmss(dur)}` : ""}` : "Door closed", tone: open ? (after || dur > 90 ? "act" : dur > 30 ? "watch" : "neutral") : "neutral", kind: "door" });
      }
      for (const s of plan.sensors) {
        if (compact || !rooms.some((r) => r.id === s.roomId) || !s.equipmentId) continue;
        const e = sim.eqById.get(s.equipmentId);
        const st = sim.sensors.get(s.id);
        if (!e || !st) continue;
        if (s.kind === "fridge-temp" || s.kind === "freezer-temp" || s.kind === "hot-holding-temp") {
          if (st.value === null) tags.push({ id: `tp:${s.id}`, x: e.position[0], y: e.position[1] + e.size[1] + 0.25, z: e.position[2], text: "Sensor offline", tone: "watch", kind: "temp" });
          else tags.push({ id: `tp:${s.id}`, x: e.position[0], y: e.position[1] + e.size[1] + 0.25, z: e.position[2], text: `${st.value.toFixed(1)} °C`, tone: st.status === "critical" ? "act" : st.status === "warning" ? "watch" : "ok", kind: "temp" });
        }
      }
      // Fryers sit in a row: one badge for the worst oil, anchored to that fryer, instead of four overlapping ones.
      const oils = plan.sensors
        .filter((s) => s.kind === "oil-quality" && rooms.some((r) => r.id === s.roomId) && s.equipmentId)
        .map((s) => ({ s, st: sim.sensors.get(s.id), e: sim.eqById.get(s.equipmentId!) }))
        .filter((x): x is { s: (typeof plan.sensors)[number]; st: NonNullable<typeof x.st>; e: NonNullable<typeof x.e> } => !!x.st && !!x.e && x.st.value !== null)
        .sort((a, b) => (a.st.value ?? 0) - (b.st.value ?? 0));
      if (oils.length) {
        const { s, st, e } = oils[0];
        tags.push({ id: `oil:${s.id}`, x: e.position[0], y: e.position[1] + e.size[1] + 0.25, z: e.position[2], text: `Oil ${Math.round(st.value!)}%${oils.length > 1 ? " · lowest" : ""}`, tone: st.status === "critical" ? "act" : st.status === "warning" ? "watch" : "ok", kind: "temp" });
      }
    }
    let blobs: Blob[] = [];
    if (layers.heat) {
      const cells = new Map<string, { x: number; z: number; n: number }>();
      const frames = sim.history.filter((f) => f.t >= t - 600 && f.t <= t && f.t % 5 === 0);
      for (const f of frames)
        for (const p of f.people) {
          const x = p[3];
          const z = p[4];
          if (!(zoneId === "entrance" ? z < 0.9 : inRooms(plan, rooms, [x, z]))) continue;
          const key = `${Math.floor(x * 2)}:${Math.floor(z * 2)}`;
          const c = cells.get(key) ?? { x: Math.floor(x * 2) / 2 + 0.25, z: Math.floor(z * 2) / 2 + 0.25, n: 0 };
          c.n++;
          cells.set(key, c);
        }
      const max = Math.max(1, ...[...cells.values()].map((c) => c.n));
      blobs = [...cells.entries()].map(([id, c]) => ({ id, x: c.x, z: c.z, w: c.n / max })).filter((b) => b.w > 0.08).slice(0, 160);
    }
    const queue = layers.queue && zoneId === "front-counter" && replayT === null ? sim.queue.map((_, i) => queueSlot(plan, i)) : null;
    const queueInfo = queue && sim.queue.length ? { count: sim.queue.length, wait: Math.max(...sim.queue.map((id) => t - (sim.agents.find((a) => a.id === id)?.arrivedAt ?? t))) } : null;
    return { boxes, tags, blobs, queue, queueInfo };
  }, [tick, replayT, layers, sim, plan, rooms, zoneId, cam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── projection (every frame) ──
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const r = root.current;
      if (r) {
        for (const node of r.querySelectorAll<HTMLElement>("[data-p]")) {
          const [x, y, z, h] = node.dataset.p!.split(",").map(Number);
          const feet = projectToTile(tileId, x, y, z);
          if (!feet || !feet.visible) {
            node.style.display = "none";
            continue;
          }
          node.style.display = "";
          if (node.dataset.kind === "box") {
            const head = projectToTile(tileId, x, y + h, z)!;
            const ph = Math.max(14, feet.y - head.y);
            const pw = Math.max(12, ph * 0.46);
            node.style.transform = `translate(${(feet.x - pw / 2).toFixed(1)}px, ${head.y.toFixed(1)}px)`;
            node.style.width = `${pw.toFixed(1)}px`;
            node.style.height = `${ph.toFixed(1)}px`;
          } else if (node.dataset.kind === "blob") {
            const edge = projectToTile(tileId, x + 0.45, y, z)!;
            const rad = Math.max(8, Math.abs(edge.x - feet.x) * 1.6);
            node.style.transform = `translate(${(feet.x - rad).toFixed(1)}px, ${(feet.y - rad * 0.55).toFixed(1)}px)`;
            node.style.width = `${(rad * 2).toFixed(1)}px`;
            node.style.height = `${(rad * 1.1).toFixed(1)}px`;
          } else node.style.transform = `translate(${feet.x.toFixed(1)}px, ${feet.y.toFixed(1)}px) translate(-50%, -100%)`;
        }
        if (queuePath.current && model.queue) {
          const pts = model.queue.map((p) => projectToTile(tileId, p[0], 0.05, p[1])).filter((p): p is NonNullable<typeof p> => !!p && p.visible);
          queuePath.current.setAttribute("d", pts.length > 1 ? pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "");
          if (queueLabel.current) {
            const head = pts[0];
            queueLabel.current.style.display = head ? "" : "none";
            if (head) queueLabel.current.style.transform = `translate(${(head.x + 8).toFixed(1)}px, ${(head.y - 34).toFixed(1)}px)`;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tileId, model.queue]);

  const toneColor = (tone?: string) => (tone === "act" ? "var(--act)" : tone === "watch" ? "var(--watch)" : tone === "ok" ? "var(--ok)" : "rgba(255,255,255,0.75)");
  const fs = compact ? "text-[9px]" : "text-[11px]";
  return (
    <div ref={root} className="absolute inset-0 overflow-hidden">
      {model.blobs.map((b) => (
        <div key={b.id} data-p={`${b.x},0.02,${b.z},0`} data-kind="blob" className="absolute left-0 top-0 rounded-full" style={{ display: "none", opacity: 0.18 + b.w * 0.5, background: `radial-gradient(closest-side, rgba(238,29,37,${0.55 + b.w * 0.4}), rgba(238,29,37,0))` }} />
      ))}
      {model.queue && (
        <>
          <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <path ref={queuePath} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} strokeDasharray="4 4" />
          </svg>
          {model.queueInfo && (
            <div ref={queueLabel} className={`absolute left-0 top-0 whitespace-nowrap rounded-md border border-white/25 bg-black/70 px-1.5 py-0.5 font-mono ${fs} text-white`} style={{ display: "none" }}>
              Queue {model.queueInfo.count} · longest <span style={{ color: toneColor(model.queueInfo.wait > 300 ? "act" : model.queueInfo.wait > 180 ? "watch" : undefined) }}>{mmss(model.queueInfo.wait)}</span>
            </div>
          )}
        </>
      )}
      {model.boxes.map((b) => (
        <div key={b.id} data-p={`${b.x},0,${b.z},${b.height}`} data-kind="box" className="absolute left-0 top-0 rounded-[3px] border" style={{ display: "none", borderColor: b.tone ? toneColor(b.tone) : b.kind === "staff" ? "rgba(238,29,37,0.8)" : "rgba(255,255,255,0.55)", borderWidth: 1 }}>
          {b.label && (!compact || b.sub) ? (
            <div className={`absolute -top-[18px] left-0 whitespace-nowrap rounded-[4px] bg-black/70 px-1 py-px font-mono ${fs} leading-[14px] text-white/90`}>
              {b.label}
              {b.sub && (
                <span className="ml-1" style={{ color: toneColor(b.tone) }}>
                  {b.sub}
                </span>
              )}
            </div>
          ) : null}
        </div>
      ))}
      {model.tags.map((tg) => (
        <div key={tg.id} data-p={`${tg.x},${tg.y},${tg.z},0`} data-kind="tag" className={`absolute left-0 top-0 whitespace-nowrap rounded-md border bg-black/70 px-1.5 py-0.5 font-mono ${fs} text-white`} style={{ display: "none", borderColor: tg.tone === "neutral" ? "rgba(255,255,255,0.3)" : toneColor(tg.tone) }}>
          {tg.kind === "ticket" && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: toneColor(tg.tone) }} />}
          {tg.text}
        </div>
      ))}
    </div>
  );
}

function queueSlot(plan: BranchSimulation["plan"], i: number): [number, number] {
  const { queueHead: h, queueDir: d } = plan.anchors;
  return [h[0] + d[0] * i * 0.75 + (i % 2 ? 0.12 : -0.12), h[1] + d[1] * i * 0.75];
}

export const LAYER_ORDER: Layer[] = ["people", "queue", "tickets", "heat", "doors"];
