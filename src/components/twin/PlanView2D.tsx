"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConceptBadge, SimBadge, cx } from "@/components/ui/primitives";
import type { BranchSimulation } from "@/lib/sim/engine";
import type { EquipStatus } from "@/lib/sim/types";
import { useApp } from "@/store/app";

/**
 * Live 2D operational floor plan: the same engine state as the 3D twin, drawn as a tactical
 * map — rooms, walls, equipment status, station queues, sensors and every person moving in
 * real time. Street frontage (z = 0) is at the bottom. Units are metres.
 */
const ZONE_FILL: Record<string, string> = { public: "#141b26", raw: "#24161a", cooked: "#15211b", storage: "#131d2b", support: "#1a1a22" };
const EQ_FILL: Record<EquipStatus, string> = { idle: "#2b3340", active: "#1d4f7a", fault: "#7f1d1d", offline: "#3a3a3a", cleaning: "#4c1d95" };
const EQ_STROKE: Record<EquipStatus, string> = { idle: "#4b5563", active: "#38bdf8", fault: "#f87171", offline: "#6b7280", cleaning: "#a78bfa" };
const SENSOR_COLOR = { normal: "#34d399", warning: "#fbbf24", critical: "#f87171", offline: "#6b7280" } as const;
const AGENT_COLOR = { staff: "#f0483e", customer: "#e5e7eb", rider: "#facc15" } as const;

type Layers = { labels: boolean; sensors: boolean; cameras: boolean; queues: boolean };

export default function PlanView2D({ sim }: { sim: BranchSimulation }) {
  const plan = sim.plan;
  const { width: W, length: L } = plan.dimensions;
  const select = useApp((s) => s.select);
  const selection = useApp((s) => s.selection);
  useApp((s) => s.tick); // re-render at the panel rate for statuses and queues
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [layers, setLayers] = useState<Layers>({ labels: true, sensors: true, cameras: false, queues: true });
  const svg = useRef<SVGSVGElement>(null);
  const agentEls = useRef(new Map<string, SVGGElement>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const Y = (z: number) => L - z;

  // People move every frame without React: positions are written straight to the SVG nodes.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      for (const a of sim.agents) {
        const el = agentEls.current.get(a.id);
        if (el) el.setAttribute("transform", `translate(${a.pos[0].toFixed(3)} ${(L - a.pos[1]).toFixed(3)})`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim, L]);

  // Pending work per workstation (what the KDS would show as the station's queue).
  const queues = new Map<string, number>();
  for (const t of sim.tasks.values()) if (t.state === "pending" && t.kind !== "clean") for (const w of plan.workstations) if (w.type === t.ws) queues.set(w.id, (queues.get(w.id) ?? 0) + 1 / plan.workstations.filter((x) => x.type === t.ws).length);

  const people = sim.agents.filter((a) => !a.gone);
  const pad = 1.5;
  // Extra headroom at the top so the 3D toolbar never covers the back rooms.
  const padTop = 3.4;
  const vb = `${-pad} ${-padTop} ${W + pad * 2} ${L + pad + padTop}`;

  const onWheel = (e: React.WheelEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const k = Math.min(6, Math.max(1, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // Zoom around the cursor.
    const mx = (e.clientX - r.left) / r.width;
    const my = (e.clientY - r.top) / r.height;
    const scale = k / view.k;
    setView({ k, x: mx - (mx - view.x) * scale, y: my - (my - view.y) * scale });
  };
  const clampView = (v: typeof view) => (v.k === 1 ? { x: 0, y: 0, k: 1 } : v);

  const selId = selection?.id;
  return (
    <div data-theme="dark" className="absolute inset-0 z-10 overflow-hidden bg-[#0a0d12]">
      <svg
        ref={svg}
        viewBox={vb}
        className="h-full w-full touch-none select-none"
        onWheel={onWheel}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || view.k === 1) return;
          const r = svg.current!.getBoundingClientRect();
          const dx = (e.clientX - d.x) / r.width;
          const dy = (e.clientY - d.y) / r.height;
          if (Math.abs(dx) + Math.abs(dy) > 0.004) d.moved = true;
          setView({ ...view, x: d.vx + dx, y: d.vy + dy });
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        role="img"
        aria-label={`Live 2D floor plan of ${sim.branchName}`}
      >
        <defs>
          <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="0.02" />
          </pattern>
        </defs>
        {/* Pan/zoom in viewBox units: translate is a fraction of the visible extent. */}
        <g transform={`translate(${view.x * (W + pad * 2)} ${view.y * (L + pad + padTop)}) scale(${view.k})`}>
          <rect x={-pad} y={-pad} width={W + pad * 2} height={L + pad * 2} fill="url(#plan-grid)" />
          {plan.rooms.map((r) => (
            <g key={r.id} onClick={() => !drag.current?.moved && select({ kind: "room", id: r.id })} className="cursor-pointer">
              <rect x={r.x} y={Y(r.z + r.d)} width={r.w} height={r.d} fill={ZONE_FILL[r.hygieneZone] ?? "#141922"} stroke={selId === r.id ? "#7dd3fc" : "rgba(255,255,255,0.06)"} strokeWidth={selId === r.id ? 0.08 : 0.03} />
              {layers.labels && (
                <text x={r.x + 0.25} y={Y(r.z + r.d) + 0.45} fontSize={Math.min(0.32, (r.w - 0.4) / (r.name.length * 0.66))} fill="rgba(255,255,255,0.38)" fontFamily="var(--font-geist-mono)" letterSpacing={0.03}>
                  {r.name.toUpperCase()}
                </text>
              )}
            </g>
          ))}
          {plan.walls.filter((w) => !w.base).map((w) => (
            <line key={w.id} x1={w.a[0]} y1={Y(w.a[1])} x2={w.b[0]} y2={Y(w.b[1])} stroke={w.exterior ? "#9aa4b2" : "#5b6472"} strokeWidth={Math.max(0.08, w.thickness)} strokeLinecap="square" />
          ))}
          {plan.doors.map((d) => {
            const h = d.width / 2;
            const [x1, y1, x2, y2] = d.axis === "x" ? [d.x - h, Y(d.z), d.x + h, Y(d.z)] : [d.x, Y(d.z - h), d.x, Y(d.z + h)];
            return <line key={d.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={d.kind === "entrance" ? "#34d399" : d.kind === "emergency" ? "#f87171" : "#0a0d12"} strokeWidth={0.22} />;
          })}
          {plan.furniture.map((f) => (
            <rect key={f.id} x={f.position[0] - f.size[0] / 2} y={Y(f.position[2]) - f.size[2] / 2} width={f.size[0]} height={f.size[2]} rx={0.08} fill="rgba(255,255,255,0.05)" transform={`rotate(${(-f.rotation * 180) / Math.PI} ${f.position[0]} ${Y(f.position[2])})`} />
          ))}
          {plan.equipment.map((e) => {
            const st = sim.equipment.get(e.id);
            const status: EquipStatus = st?.fault ? "fault" : (st?.status ?? "idle");
            const elevated = e.position[1] > 1.2;
            const sel = selId === e.id;
            return (
              <g key={e.id} transform={`translate(${e.position[0]} ${Y(e.position[2])}) rotate(${(-e.rotation * 180) / Math.PI})`} onClick={() => !drag.current?.moved && select({ kind: "equipment", id: e.id })} className="cursor-pointer">
                <title>{`${e.name}${st?.tempC !== undefined ? ` · ${st.tempC.toFixed(1)} °C` : ""} · ${status}`}</title>
                <rect x={-e.size[0] / 2} y={-e.size[2] / 2} width={e.size[0]} height={e.size[2]} rx={0.04} fill={elevated ? "none" : EQ_FILL[status]} stroke={sel ? "#ffffff" : EQ_STROKE[status]} strokeWidth={sel ? 0.07 : 0.035} strokeDasharray={elevated ? "0.12 0.08" : undefined} />
                {/* Front edge marker: where the operator stands. */}
                {!elevated && <line x1={-e.size[0] / 2 + 0.05} x2={e.size[0] / 2 - 0.05} y1={e.size[2] / 2 - 0.03} y2={e.size[2] / 2 - 0.03} stroke={EQ_STROKE[status]} strokeWidth={0.04} opacity={0.8} />}
                {status === "fault" && <circle r={0.45} fill="none" stroke="#f87171" strokeWidth={0.05} className="animate-pulse" />}
              </g>
            );
          })}
          {layers.queues &&
            plan.workstations.map((w) => {
              const n = Math.round(queues.get(w.id) ?? 0);
              if (!n) return null;
              return (
                <g key={w.id} transform={`translate(${w.standPoint[0]} ${Y(w.standPoint[1])})`} onClick={() => select({ kind: "workstation", id: w.id })} className="cursor-pointer">
                  <circle r={0.3} fill="#0a0d12" stroke={n > 4 ? "#fbbf24" : "#7dd3fc"} strokeWidth={0.05} />
                  <text textAnchor="middle" dy={0.12} fontSize={0.32} fill="#fff" fontFamily="var(--font-geist-mono)">
                    {n}
                  </text>
                </g>
              );
            })}
          {layers.cameras &&
            plan.cameras.map((c) => {
              const dx = c.target[0] - c.position[0];
              const dz = c.target[2] - c.position[2];
              const ang = Math.atan2(-dz, dx);
              const half = ((c.fov / 2) * Math.PI) / 180;
              const r = 4;
              const [px, py] = [c.position[0], Y(c.position[2])];
              return (
                <g key={c.id} onClick={() => select({ kind: "camera", id: c.id })} className="cursor-pointer">
                  <path d={`M${px},${py} L${px + Math.cos(ang - half) * r},${py - Math.sin(ang - half) * r} A${r},${r} 0 0 1 ${px + Math.cos(ang + half) * r},${py - Math.sin(ang + half) * r} Z`} fill="rgba(125,211,252,0.06)" stroke="rgba(125,211,252,0.25)" strokeWidth={0.02} />
                  <circle cx={px} cy={py} r={0.12} fill="#7dd3fc" />
                </g>
              );
            })}
          {layers.sensors &&
            plan.sensors.map((s) => {
              const st = sim.sensors.get(s.id);
              if (!st) return null;
              const color = st.connected ? SENSOR_COLOR[st.status] : SENSOR_COLOR.offline;
              return (
                <g key={s.id} transform={`translate(${s.position[0]} ${Y(s.position[2])})`} onClick={() => select({ kind: "sensor", id: s.id })} className="cursor-pointer">
                  <title>{`${s.code} ${s.name}${st.value !== null ? ` · ${st.value}${s.unit === "status" ? "" : (s.unit ?? "")}` : ""} · ${st.status}${st.source !== "simulated" ? ` · ${st.source}` : ""}`}</title>
                  {st.status === "critical" && <circle r={0.4} fill={color} opacity={0.25} className="animate-ping" style={{ transformBox: "fill-box", transformOrigin: "center" }} />}
                  <rect x={-0.1} y={-0.1} width={0.2} height={0.2} transform="rotate(45)" fill={color} stroke={st.source !== "simulated" ? "#fff" : "none"} strokeWidth={0.04} />
                </g>
              );
            })}
          {people.map((a) => (
            <g
              key={a.id}
              ref={(el) => {
                if (el) agentEls.current.set(a.id, el);
                else agentEls.current.delete(a.id);
              }}
              transform={`translate(${a.pos[0]} ${Y(a.pos[1])})`}
              onClick={() => select({ kind: "agent", id: a.id })}
              className="cursor-pointer"
            >
              {a.tracked && (
                <>
                  {/* Badge-tracked: accuracy disc and a ring coloured by source (LIVE / SIM DEVICE / lost). */}
                  <circle r={Math.max(0.15, a.tracked.accuracy)} fill={a.tracked.lost ? "#fbbf24" : a.tracked.source === "live" ? "#34d399" : "#e879f9"} opacity={0.15} />
                  <circle r={0.34} fill="none" stroke={a.tracked.lost ? "#fbbf24" : a.tracked.source === "live" ? "#34d399" : "#e879f9"} strokeWidth={0.06} />
                </>
              )}
              <circle r={selId === a.id ? 0.3 : 0.2} fill={AGENT_COLOR[a.kind]} stroke={selId === a.id ? "#7dd3fc" : "#0a0d12"} strokeWidth={0.06} />
              {a.carrying && <circle r={0.08} cx={0.18} cy={-0.18} fill="#fbbf24" />}
            </g>
          ))}
        </g>
      </svg>

      {/* Legend and layer toggles. */}
      <div className="glass pointer-events-auto absolute bottom-3 left-3 rounded-lg px-3 py-2 font-mono text-[10px] text-white/60">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="uppercase tracking-[0.16em] text-white/45">2D operations plan</span>
          <SimBadge />
          <ConceptBadge label="CONCEPTUAL LAYOUT" />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(
            [
              ["#f0483e", "Staff"],
              ["#e5e7eb", "Customer"],
              ["#facc15", "Rider"],
              ["#38bdf8", "Equipment active"],
              ["#f87171", "Fault / critical"],
              ["#34d399", "Sensor OK"],
              ["#e879f9", "Staff badge"],
            ] as const
          ).map(([c, l]) => (
            <span key={l} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1">
          {(Object.keys(layers) as Array<keyof Layers>).map((k) => (
            <button key={k} type="button" aria-pressed={layers[k]} onClick={() => setLayers({ ...layers, [k]: !layers[k] })} className={cx("rounded px-1.5 py-0.5 uppercase tracking-wider", layers[k] ? "bg-white/15 text-white" : "text-white/40 hover:text-white")}>
              {k}
            </button>
          ))}
          <button type="button" onClick={() => setView(clampView({ x: 0, y: 0, k: 1 }))} title="Fit to view" className="ml-1 rounded px-1.5 py-0.5 text-white/50 hover:text-white">
            <Maximize2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
