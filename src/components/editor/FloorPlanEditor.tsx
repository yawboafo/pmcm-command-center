"use client";

import {
  Camera,
  Columns2,
  Copy,
  DoorOpen,
  Download,
  ExternalLink,
  History,
  Layers,
  MousePointer2,
  Radio,
  Redo2,
  RotateCw,
  Save,
  Sparkles,
  Square,
  SquareDashed,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Btn, ConceptBadge, SectionTitle, cx } from "@/components/ui/primitives";
import { can, canSeeBranch } from "@/lib/auth/rbac";
import { deriveCameras, deriveSensors } from "@/lib/floorplan/derive";
import { NavGrid } from "@/lib/floorplan/nav";
import { planToSvg } from "@/lib/floorplan/svg";
import type { FloorPlan } from "@/lib/floorplan/types";
import { BRANCHES, BRANCH_BY_ID } from "@/lib/network/branches";
import { useApp } from "@/store/app";
import { TEMPLATES, plans, sims } from "@/store/sims";
import { checkImportedPlan, issueCounts, layoutMetrics, optimise, validate, type Issue, type LayoutMetrics } from "./model";
import { duplicate, nudge, remove, rotate } from "./ops";
import PlanCanvas from "./PlanCanvas";
import { BuildingPanel, IssuesPanel, MetricsStrip, Palette, Properties, WorkstationsPanel } from "./panels";
import { useEditor, type LayerKey } from "./store";

const Preview3D = dynamic(() => import("./Preview3D"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-xs text-white/40">Loading 3D preview…</div> });

const TABS = ["Properties", "Issues", "Workstations", "History"] as const;
const LEFT_TABS = ["Equipment", "Building"] as const;
const LAYER_LABELS: Array<[LayerKey, string]> = [
  ["zones", "Hygiene zones"],
  ["equipment", "Equipment"],
  ["furniture", "Furniture"],
  ["cameras", "Virtual cameras"],
  ["sensors", "Safety sensors"],
  ["paths", "Circulation & exits"],
  ["navgrid", "Walkability grid"],
  ["dimensions", "Dimensions"],
  ["issues", "Issue markers"],
];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FloorPlanEditor() {
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const enterBranch = useApp((s) => s.enterBranch);
  const entered = useApp((s) => s.enteredBranchId);
  const selected = useApp((s) => s.selectedBranchId);
  const ed = useEditor();
  const { branchId, draft, baseline, selection, mode, setMode, snapStep, setSnap, layers, toggleLayer, view, setView, dirty, mutate, undo, redo, setSelection } = ed;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Properties");
  const [leftTab, setLeftTab] = useState<(typeof LEFT_TABS)[number]>("Equipment");
  const [layersOpen, setLayersOpen] = useState(false);
  const [note, setNote] = useState("");
  const [forceDraft, setForceDraft] = useState(false);
  const [optSummary, setOptSummary] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => BRANCHES.filter((b) => canSeeBranch(user, b)), [user]);
  const readOnly = !can(user, "edit:floorplan");

  // Initial branch: entered → selected → East Legon → first visible.
  useEffect(() => {
    if (branchId && visible.some((b) => b.id === branchId)) return;
    const pick = [entered, selected, "branch-015"].find((id) => id && visible.some((b) => b.id === id)) ?? visible[0]?.id;
    if (pick) ed.load(pick);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live analysis: overlap/clearance checks and metrics follow the deferred draft so dragging stays smooth.
  const deferred = useDeferredValue(draft);
  const analysis = useMemo(() => {
    if (!deferred) return null;
    const grid = new NavGrid(deferred);
    return { grid, issues: validate(deferred, { grid }), metrics: layoutMetrics(deferred, grid) };
  }, [deferred]);
  const baseMetrics = useMemo<LayoutMetrics | null>(() => (baseline ? layoutMetrics(baseline) : null), [baseline]);
  const issues: Issue[] = analysis?.issues ?? [];
  const counts = issueCounts(issues);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (e.key === "Escape") {
        st.setMode({ kind: "select" });
        st.setSelection([]);
        return;
      }
      if (readOnly || !st.selection.length) return;
      const step = (st.snapStep || 0.05) * (e.shiftKey ? 5 : 1);
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (arrows[e.key]) {
        e.preventDefault();
        const [dx, dz] = arrows[e.key];
        const sel = st.selection;
        st.mutate((p) => nudge(p, sel, dx, dz), { walls: sel.some((s) => s.kind === "door" || s.kind === "window") });
      } else if (e.key === "r" || e.key === "R") {
        const sel = st.selection;
        st.mutate((p) => rotate(p, sel, e.shiftKey ? -Math.PI / 2 : Math.PI / 2));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const sel = st.selection;
        st.mutate((p) => remove(p, sel), { walls: sel.some((s) => ["room", "door", "window"].includes(s.kind)) });
        st.setSelection([]);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const sel = st.selection;
        let created: typeof sel = [];
        st.mutate((p) => (created = duplicate(p, sel)));
        st.setSelection(created);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly]);

  if (!draft || !branchId) {
    return <div className="flex h-full items-center justify-center text-xs text-white/50">{visible.length ? "Loading floor plan…" : "Your role has no branches in scope."}</div>;
  }

  const branch = BRANCH_BY_ID.get(branchId);
  const history = plans().history(branchId);
  void historyTick;

  const switchBranch = (id: string) => {
    if (dirty && !window.confirm("Discard unsaved layout changes?")) return;
    ed.load(id);
    setOptSummary(null);
  };

  const startFromTemplate = (fmt: "A" | "B" | "C") => {
    if (dirty && !window.confirm("Replace the current draft with a fresh template? Unsaved changes will be lost.")) return;
    const plan = structuredClone(TEMPLATES[fmt]);
    plan.restaurantId = branchId;
    plan.name = `${branch?.name ?? branchId} — ${TEMPLATES[fmt].name}`;
    ed.replaceDraft(plan, true);
    notify(`Draft started from ${TEMPLATES[fmt].name} — save to apply`, "info");
  };

  const save = () => {
    if (readOnly) return;
    if (counts.errors && !forceDraft) {
      setTab("Issues");
      notify(`${counts.errors} blocking issue(s). Fix them or tick "save anyway as draft".`, "warning");
      return;
    }
    const n = note.trim() || (counts.errors ? `Draft with ${counts.errors} unresolved issue(s)` : "Layout update");
    plans().save(branchId, draft, user.name, n);
    sims().restart(branchId);
    ed.markSaved();
    setNote("");
    setForceDraft(false);
    setHistoryTick((t) => t + 1);
    notify(`Layout saved — ${branch?.name} digital twin and simulation now use it`, "success");
  };

  const runOptimise = () => {
    const before = analysis;
    const { plan, moved } = optimise(draft, Math.max(0.05, snapStep));
    const after = validate(plan);
    const am = layoutMetrics(plan);
    ed.checkpoint();
    useEditor.setState({ draft: plan, dirty: true });
    const b = issueCounts(before?.issues ?? []);
    const a = issueCounts(after);
    setOptSummary(`Optimise moved ${moved.length} item(s). Errors ${b.errors} → ${a.errors}, warnings ${b.warnings} → ${a.warnings}. Flow distance ${before?.metrics.flowTotal ?? "—"} m → ${am.flowTotal} m.`);
    if (moved.length) setSelection(moved.map((id) => ({ kind: draft.equipment.some((e) => e.id === id) ? ("equipment" as const) : ("furniture" as const), id })));
  };

  const importJson = async (file: File) => {
    try {
      const res = checkImportedPlan(JSON.parse(await file.text()));
      if (!res.ok) {
        notify(`Import failed: ${res.reason}`, "critical");
        return;
      }
      res.plan.restaurantId = branchId;
      ed.replaceDraft(res.plan, true);
      notify("Floor plan imported into draft — review issues, then save", "success");
    } catch {
      notify("Import failed: invalid JSON", "critical");
    }
  };

  const modeBtn = (m: typeof mode, icon: React.ReactNode, label: string) => (
    <Btn size="xs" active={mode.kind === m.kind} disabled={readOnly && m.kind !== "select"} onClick={() => setMode(mode.kind === m.kind ? { kind: "select" } : m)} title={label}>
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </Btn>
  );

  const sel = selection;
  const canAct = !readOnly && sel.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="glass z-10 flex flex-wrap items-center gap-2 rounded-none border-x-0 border-t-0 px-3 py-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-sm font-bold text-white">Floor Plan Editor</h1>
          <ConceptBadge />
        </div>
        <select value={branchId} onChange={(e) => switchBranch(e.target.value)} className="max-w-52 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white" aria-label="Branch">
          {visible.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.city}){plans().isCustom(b.id) ? " · custom" : ""}
            </option>
          ))}
        </select>
        <select value="" disabled={readOnly} onChange={(e) => e.target.value && startFromTemplate(e.target.value as "A" | "B" | "C")} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white disabled:opacity-40" aria-label="Start from template">
          <option value="">New from template…</option>
          <option value="A">Model A — Compact takeaway (~110 m²)</option>
          <option value="B">Model B — Standard (~208 m²)</option>
          <option value="C">Model C — Flagship (~408 m²)</option>
        </select>
        <span className="mx-1 h-5 w-px bg-white/10" />
        {modeBtn({ kind: "select" }, <MousePointer2 size={13} />, "Select")}
        {modeBtn({ kind: "add-door" }, <DoorOpen size={13} />, "Door")}
        {modeBtn({ kind: "add-window" }, <SquareDashed size={13} />, "Window")}
        {modeBtn({ kind: "add-camera" }, <Camera size={13} />, "Camera")}
        {modeBtn({ kind: "add-sensor" }, <Radio size={13} />, "Sensor")}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <Btn size="xs" disabled={!canAct} onClick={() => mutate((p) => rotate(p, sel))} title="Rotate 90° (R)">
          <RotateCw size={13} />
        </Btn>
        <Btn size="xs" disabled={!canAct} onClick={() => { let c: typeof sel = []; mutate((p) => (c = duplicate(p, sel))); setSelection(c); }} title="Duplicate (Ctrl/⌘+D)">
          <Copy size={13} />
        </Btn>
        <Btn size="xs" disabled={!canAct} onClick={() => { mutate((p) => remove(p, sel), { walls: true }); setSelection([]); }} title="Delete (Del)">
          <Trash2 size={13} />
        </Btn>
        <Btn size="xs" disabled={!ed.undoStack.length} onClick={undo} title="Undo (Ctrl/⌘+Z)">
          <Undo2 size={13} />
        </Btn>
        <Btn size="xs" disabled={!ed.redoStack.length} onClick={redo} title="Redo (Ctrl/⌘+Shift+Z)">
          <Redo2 size={13} />
        </Btn>
        <label className="flex items-center gap-1 text-[10.5px] text-white/50">
          Snap
          <select value={snapStep} onChange={(e) => setSnap(Number(e.target.value))} className="rounded-md border border-white/10 bg-black/40 px-1 py-1 font-mono text-[11px] text-white">
            {[0, 0.05, 0.1, 0.25, 0.5].map((s) => (
              <option key={s} value={s}>
                {s ? `${s} m` : "off"}
              </option>
            ))}
          </select>
        </label>
        <div className="relative">
          <Btn size="xs" active={layersOpen} onClick={() => setLayersOpen(!layersOpen)} title="Layers">
            <Layers size={13} /> Layers
          </Btn>
          {layersOpen && (
            <div className="glass absolute left-0 top-9 z-30 w-48 space-y-1 rounded-lg p-2">
              {LAYER_LABELS.map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-[11.5px] text-white/80">
                  <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} /> {l}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="View">
          {(
            [
              ["2d", <Square key="2" size={13} />, "2D"],
              ["split", <Columns2 key="s" size={13} />, "Split"],
              ["3d", <Camera key="3" size={13} />, "3D"],
            ] as const
          ).map(([v, icon, l]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", view === v ? "bg-white/15 text-white" : "text-white/50 hover:text-white")}>
              {icon}
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn size="xs" disabled={readOnly} onClick={runOptimise} title="Resolve overlaps, keep items in their rooms and snap to grid">
            <Sparkles size={13} /> Optimise
          </Btn>
          <Btn size="xs" onClick={() => enterBranch(branchId)} title={dirty ? "Save first to see changes in the twin" : "Open this branch's digital twin"}>
            <ExternalLink size={13} /> Open twin
          </Btn>
          <Btn size="xs" tone="red" disabled={readOnly || !dirty} onClick={save} title="Save layout (applies to the 3D twin and simulation)">
            <Save size={13} /> Save{dirty ? " *" : ""}
          </Btn>
        </div>
      </div>

      {readOnly && <div className="border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[11.5px] text-amber-100">Read-only: your role ({user.roleLabel}) can view layouts but not edit them. Switch to an administrator or national operations role to edit.</div>}

      <div className="flex min-h-0 flex-1">
        {/* Left: palette */}
        <aside className="glass flex w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0">
          <div className="flex gap-1 border-b border-white/5 p-2">
            {LEFT_TABS.map((t) => (
              <button key={t} type="button" onClick={() => setLeftTab(t)} className={cx("flex-1 rounded-md px-2 py-1 text-[11.5px]", leftTab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}>
                {t}
              </button>
            ))}
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto p-3">{leftTab === "Equipment" ? <Palette readOnly={readOnly} /> : <BuildingPanel plan={draft} readOnly={readOnly} />}</div>
        </aside>

        {/* Centre: canvas(es) */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="scroll-thin shrink-0 overflow-x-auto border-b border-white/5 px-3 py-2">{analysis && <MetricsStrip m={analysis.metrics} base={baseMetrics} errors={counts.errors} warnings={counts.warnings} />}</div>
          {optSummary && (
            <div className="glass absolute bottom-14 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-lg px-3 py-2 text-xs text-white">
              <Sparkles size={12} className="mr-1.5 inline text-brand-yellow" />
              {optSummary}
              <button type="button" className="ml-3 text-white/50 hover:text-white" onClick={() => setOptSummary(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
          <div className={cx("flex min-h-0 flex-1", view === "split" ? "flex-row" : "")}>
            {view !== "3d" && (
              <div className={cx("relative min-w-0", view === "split" ? "w-3/5 border-r border-white/5" : "flex-1")}>
                <div className="absolute inset-0">
                  <PlanCanvas plan={draft} issues={issues} grid={layers.navgrid ? (analysis?.grid ?? null) : null} readOnly={readOnly} />
                </div>
              </div>
            )}
            {view !== "2d" && (
              <div className={cx("relative min-w-0", view === "split" ? "w-2/5" : "flex-1")}>
                <div className="absolute inset-0">
                  <Preview3D plan={draft} readOnly={readOnly} highlightIds={issues.filter((i) => i.severity === "error").flatMap((i) => i.targets.map((t) => t.id))} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: inspector tabs */}
        <aside className="glass flex w-80 shrink-0 flex-col rounded-none border-y-0 border-r-0">
          <div className="flex gap-1 border-b border-white/5 p-2">
            {TABS.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cx("flex-1 rounded-md px-1.5 py-1 text-[11px]", tab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}>
                {t}
                {t === "Issues" && issues.length > 0 && <span className={cx("ml-1 rounded px-1 text-[9.5px]", counts.errors ? "bg-red-500/30 text-red-100" : "bg-amber-500/25 text-amber-100")}>{issues.length}</span>}
              </button>
            ))}
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto p-3">
            {tab === "Properties" && (
              <div className="space-y-4">
                <Properties plan={draft} readOnly={readOnly} />
                {!readOnly && (
                  <div className="border-t border-white/5 pt-3">
                    <SectionTitle>Generators</SectionTitle>
                    <div className="flex flex-wrap gap-2">
                      <Btn size="xs" onClick={() => mutate((p) => (p.cameras = deriveCameras(p)))} title="Replace cameras with an auto-generated network from the layout">
                        <Camera size={12} /> Auto-place cameras
                      </Btn>
                      <Btn size="xs" onClick={() => mutate((p) => (p.sensors = deriveSensors(p)))} title="Replace sensors with auto-generated monitoring points">
                        <Radio size={12} /> Auto-place sensors
                      </Btn>
                    </div>
                    <p className="mt-1.5 text-[10.5px] text-white/35">
                      {draft.cameras.length} virtual cameras · {draft.sensors.length} conceptual sensors. Generators replace manual placements.
                    </p>
                  </div>
                )}
              </div>
            )}
            {tab === "Issues" && <IssuesPanel issues={issues} plan={draft} />}
            {tab === "Workstations" && <WorkstationsPanel plan={draft} readOnly={readOnly} />}
            {tab === "History" && (
              <div className="space-y-4">
                {!readOnly && (
                  <div className="space-y-2">
                    <SectionTitle>Save version</SectionTitle>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (optional)" className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white" />
                    {counts.errors > 0 && (
                      <label className="flex items-center gap-2 text-[11px] text-amber-200">
                        <input type="checkbox" checked={forceDraft} onChange={(e) => setForceDraft(e.target.checked)} />
                        Save anyway as draft ({counts.errors} blocking issue{counts.errors > 1 ? "s" : ""})
                      </label>
                    )}
                    <Btn tone="red" disabled={!dirty} onClick={save}>
                      <Save size={13} /> Save &amp; apply to twin
                    </Btn>
                  </div>
                )}
                <div>
                  <SectionTitle right={<History size={12} className="text-white/40" />}>Version history</SectionTitle>
                  {history.length === 0 ? (
                    <p className="text-[11.5px] text-white/45">No saved versions — this branch uses the unmodified Model {branch?.floorPlanType} template.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {[...history].reverse().map((v, ri) => {
                        const i = history.length - 1 - ri;
                        return (
                          <li key={v.savedAt + ":" + i} className="rounded-lg border border-white/5 bg-white/[0.03] p-2 text-[11px]">
                            <div className="flex justify-between text-white/80">
                              <span>v{i + 1}{ri === 0 ? " · current" : ""}</span>
                              <span className="font-mono text-white/40">{new Date(v.savedAt).toLocaleString()}</span>
                            </div>
                            <div className="text-white/55">{v.note}</div>
                            <div className="text-white/35">by {v.by}</div>
                            <div className="mt-1 flex gap-2">
                              <button type="button" className="text-brand-yellow hover:underline" onClick={() => (ed.replaceDraft(structuredClone(v.plan), true), notify(`Previewing v${i + 1} in draft — save to keep`, "info"))}>
                                Preview
                              </button>
                              {!readOnly && ri > 0 && (
                                <button
                                  type="button"
                                  className="text-white/70 hover:underline"
                                  onClick={() => {
                                    plans().rollback(branchId, i);
                                    sims().restart(branchId);
                                    ed.load(branchId);
                                    setHistoryTick((t) => t + 1);
                                    notify(`Rolled back to v${i + 1}`, "success");
                                  }}
                                >
                                  Roll back
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!readOnly && history.length > 0 && (
                    <Btn
                      size="xs"
                      className="mt-2"
                      onClick={() => {
                        if (!window.confirm("Remove all saved versions and return this branch to its template?")) return;
                        plans().resetToTemplate(branchId);
                        sims().restart(branchId);
                        ed.load(branchId);
                        setHistoryTick((t) => t + 1);
                        notify("Branch reset to template layout", "info");
                      }}
                    >
                      Reset to template
                    </Btn>
                  )}
                </div>
                <div>
                  <SectionTitle>Import / export</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    <Btn size="xs" onClick={() => download(`${branchId}-floorplan.json`, JSON.stringify(draft, null, 1), "application/json")}>
                      <Download size={12} /> JSON
                    </Btn>
                    <Btn size="xs" onClick={() => download(`${branchId}-floorplan.svg`, planToSvg(draft), "image/svg+xml")}>
                      <Download size={12} /> SVG
                    </Btn>
                    <Btn size="xs" disabled={readOnly} onClick={() => fileRef.current?.click()}>
                      <Upload size={12} /> Import JSON
                    </Btn>
                    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-white/35">The JSON is the single source for the 2D plan, 3D twin, camera network, workflow engine and sensor layer. Imported plans are always marked conceptual.</p>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-white/5 px-3 py-2 text-[10.5px] text-white/35">
            {branch?.name} · {draft.dimensions.width} × {draft.dimensions.length} m · {draft.equipment.length} equipment · {draft.rooms.length} rooms
          </div>
        </aside>
      </div>
    </div>
  );
}

export type { FloorPlan };
