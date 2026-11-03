"use client";

import { canSeeBranch } from "@/lib/auth/rbac";
import { clock } from "@/lib/format";
import { BRANCHES, BRANCH_BY_ID, isBranchOpen, type Branch } from "@/lib/network/branches";
import { allSnapshots, type BranchSnapshot } from "@/lib/network/network";
import { demandFactor } from "@/lib/sim/engine";
import { ARRIVAL_PRESETS, TWIN_SECTIONS, useApp, type Section } from "@/store/app";
import { sims } from "@/store/sims";

export { TOOL_DEFS } from "./toolDefs";

type Json = Record<string, unknown>;

function scoped(): Branch[] {
  const user = useApp.getState().user;
  return BRANCHES.filter((b) => canSeeBranch(user, b));
}

function snapshots(): BranchSnapshot[] {
  const preset = useApp.getState().arrivalPreset;
  const ids = new Set(scoped().map((b) => b.id));
  return allSnapshots(sims().clock, ARRIVAL_PRESETS[preset] / 20, sims().seed, sims().sims).filter((s) => ids.has(s.branchId));
}

function findBranch(name: string): Branch | undefined {
  const n = name.toLowerCase().replace(/branch/g, "").trim();
  const pool = scoped();
  return pool.find((b) => b.name.toLowerCase() === n) ?? pool.find((b) => b.name.toLowerCase().includes(n)) ?? pool.find((b) => n.includes(b.name.toLowerCase()));
}

const meta = () => ({ source: "simulation (demo data, not live operations)", as_of_sim_time: `${clock(sims().clock)} GMT`, sim_clock_iso: new Date(sims().clock).toISOString() });

function row(s: BranchSnapshot) {
  const b = BRANCH_BY_ID.get(s.branchId)!;
  return {
    branch: b.name,
    region: b.region,
    city: b.city,
    format: b.floorPlanType,
    status: s.status,
    issue: s.issue ?? null,
    sales_today_ghs: s.salesToday,
    orders_today: s.ordersToday,
    active_orders: s.activeOrders,
    delayed_orders: s.delayed,
    avg_prep_min: s.avgPrepMin,
    kitchen_load_pct: Math.round(s.kitchenLoad * 100),
    staff_on_duty: s.staffOnDuty,
    alerts: s.equipmentAlerts,
    full_simulation_running: s.live,
  };
}

function aggregate(list: BranchSnapshot[]) {
  const open = list.filter((s) => s.open);
  const sum = (f: (s: BranchSnapshot) => number) => list.reduce((a, s) => a + f(s), 0);
  return {
    branches: list.length,
    open_now: open.length,
    active_orders: sum((s) => s.activeOrders),
    orders_today: sum((s) => s.ordersToday),
    sales_today_ghs: sum((s) => s.salesToday),
    avg_prep_min: open.length ? Math.round((open.reduce((a, s) => a + s.avgPrepMin, 0) / open.length) * 10) / 10 : 0,
    avg_kitchen_load_pct: open.length ? Math.round((open.reduce((a, s) => a + s.kitchenLoad, 0) / open.length) * 100) : 0,
    staff_on_duty: sum((s) => s.staffOnDuty),
    critical: list.filter((s) => s.status === "critical").length,
    warning: list.filter((s) => s.status === "warning").length,
    delayed_orders: sum((s) => s.delayed),
  };
}

const SORT: Record<string, (s: BranchSnapshot) => number> = {
  sales: (s) => s.salesToday,
  orders: (s) => s.ordersToday,
  active_orders: (s) => s.activeOrders,
  delayed: (s) => s.delayed,
  alerts: (s) => s.equipmentAlerts + (s.status === "critical" ? 10 : s.status === "warning" ? 5 : 0),
  prep_time: (s) => s.avgPrepMin,
};

/** Resolve a free-text place to a camera pose inside the entered twin. */
function locate(target: string): { position: [number, number, number]; target: [number, number, number]; label: string; equipmentId?: string } | null {
  const id = useApp.getState().enteredBranchId;
  if (!id) return null;
  const sim = sims().get(id);
  const t = target.toLowerCase();
  const plan = sim.plan;
  if (/alert|fault|warning|problem/.test(t)) {
    const alert = sim.alerts.find((a) => a.status !== "resolved" && a.equipmentId);
    const faulty = alert?.equipmentId ?? [...sim.equipment.values()].find((e) => e.fault)?.id;
    if (faulty) {
      const e = sim.eqById.get(faulty)!;
      return { position: [e.position[0] + Math.sin(e.rotation) * 2.6, 2.2, e.position[2] + Math.cos(e.rotation) * 2.6], target: [e.position[0], 1, e.position[2]], label: e.name, equipmentId: e.id };
    }
  }
  const words: Array<[RegExp, (n: string) => boolean]> = [
    [/oven|bak/, (n) => n.includes("oven")],
    [/fry|fryer|chicken cook/, (n) => n.includes("fryer") || n.includes("frying")],
    [/pizza|make.?line|topping/, (n) => n.includes("pizza") || n.includes("make-line")],
    [/rice|jollof/, (n) => n.includes("rice")],
    [/pack/, (n) => n.includes("packag")],
    [/dispatch|rider|delivery/, (n) => n.includes("dispatch")],
    [/fridge|refrigerat|cold/, (n) => n.includes("cold") || n.includes("fridge") || n.includes("refriger")],
    [/freez/, (n) => n.includes("freez")],
    [/counter|order|cashier|pos/, (n) => n.includes("counter")],
    [/entrance|door|front/, (n) => n.includes("entrance")],
    [/kitchen/, (n) => n.includes("kitchen")],
    [/stor|inventory|dry/, (n) => n.includes("storage") || n.includes("store")],
    [/wait|dining|seat/, (n) => n.includes("waiting") || n.includes("dining")],
  ];
  for (const [re, match] of words) {
    if (!re.test(t)) continue;
    const cam = plan.cameras.find((c) => match(c.name.toLowerCase()));
    if (cam) return { position: cam.position, target: cam.target, label: `${cam.code} ${cam.name}` };
    const e = plan.equipment.find((x) => match(x.name.toLowerCase()) || match(x.type));
    if (e) return { position: [e.position[0] + Math.sin(e.rotation) * 2.6, 2.2, e.position[2] + Math.cos(e.rotation) * 2.6], target: [e.position[0], 1, e.position[2]], label: e.name, equipmentId: e.id };
  }
  return null;
}

export async function executeTool(name: string, input: Json): Promise<{ result: Json; isError?: boolean }> {
  const app = useApp.getState();
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "network_summary":
      return { result: { ...meta(), scope: app.user.roleLabel, ...aggregate(snapshots()) } };
    case "list_branches": {
      let list = snapshots();
      if (str("region")) list = list.filter((s) => BRANCH_BY_ID.get(s.branchId)!.region.toLowerCase() === str("region").toLowerCase());
      if (str("city")) list = list.filter((s) => BRANCH_BY_ID.get(s.branchId)!.city.toLowerCase() === str("city").toLowerCase());
      if (str("status")) list = list.filter((s) => s.status === str("status"));
      const key = str("sort_by") || "sales";
      list = [...list].sort((a, b) => (SORT[key] ?? SORT.sales)(b) - (SORT[key] ?? SORT.sales)(a));
      const limit = typeof input.limit === "number" ? input.limit : 10;
      return { result: { ...meta(), total_matching: list.length, branches: list.slice(0, Math.max(1, Math.min(70, limit))).map(row) } };
    }
    case "compare": {
      const dim = str("dimension");
      const names = Array.isArray(input.names) ? (input.names as string[]) : [];
      const all = snapshots();
      const groups = names.map((n) => {
        const k = n.toLowerCase().replace(/^model\s*/, "");
        const members = all.filter((s) => {
          const b = BRANCH_BY_ID.get(s.branchId)!;
          if (dim === "branch") return b.name.toLowerCase() === k || b.name.toLowerCase().includes(k);
          if (dim === "city") return b.city.toLowerCase() === k;
          if (dim === "region") return b.region.toLowerCase() === k;
          return b.floorPlanType.toLowerCase() === k;
        });
        return { name: n, ...aggregate(members), avg_sales_per_branch_ghs: members.length ? Math.round(members.reduce((a, s) => a + s.salesToday, 0) / members.length) : 0 };
      });
      return { result: { ...meta(), dimension: dim, groups } };
    }
    case "branch_details": {
      const b = findBranch(str("branch"));
      if (!b) return { result: { error: `No branch matching '${str("branch")}' that this user can view.` }, isError: true };
      const s = snapshots().find((x) => x.branchId === b.id)!;
      const sim = sims().peek(b.id);
      const live = sim
        ? {
            kitchen_queue: Object.fromEntries([...sim.tasks.values()].filter((t) => t.state === "pending").reduce((m, t) => m.set(t.ws, (m.get(t.ws) ?? 0) + 1), new Map<string, number>())),
            hot_holding_pieces: sim.chickenStock,
            rice_warmer_kg: Math.round(sim.riceStockKg * 10) / 10,
            open_alerts: sim.alerts.filter((a) => a.status !== "resolved").map((a) => ({ title: a.title, status: a.status })),
            low_stock: sim.inventory.filter((i) => i.status !== "OK").map((i) => `${i.name}: ${i.status}`),
          }
        : "Full kitchen simulation not running for this branch (open its twin to start it); figures are from the lightweight network model.";
      return {
        result: {
          ...meta(),
          verified: { name: b.name, region: b.region, city: b.city, store_hours: `${b.hours.storeOpen}–${b.hours.storeClose}`, open_now: isBranchOpen(b, sims().clock), source: b.source, last_verified: b.lastVerified },
          conceptual_layout: `Model ${b.floorPlanType} (${b.floorPlanReason}) — not an official plan`,
          simulated: row(s),
          live_kitchen: live,
        },
      };
    }
    case "safety_alerts": {
      const b = str("branch") ? findBranch(str("branch")) : undefined;
      const list = snapshots().filter((s) => (b ? s.branchId === b.id : true) && (s.status === "critical" || s.status === "warning"));
      const detailed = [...sims().sims.values()].filter((s) => !b || s.branchId === b.id).flatMap((s) => s.alerts.filter((a) => a.status !== "resolved").map((a) => ({ branch: s.branchName, severity: a.severity, title: a.title, issue: a.issue, status: a.status, opened: clock(a.openedAt) })));
      return { result: { ...meta(), branches_with_issues: list.map((s) => ({ branch: BRANCH_BY_ID.get(s.branchId)!.name, status: s.status, issue: s.issue })), detailed_alerts_from_running_simulations: detailed } };
    }
    case "equipment_status": {
      const b = findBranch(str("branch"));
      if (!b) return { result: { error: "Branch not found or not permitted." }, isError: true };
      const sim = sims().get(b.id);
      const items = sim.plan.equipment.map((e) => {
        const st = sim.equipment.get(e.id)!;
        return { name: e.name, type: e.type, status: st.status, fault: st.fault?.kind ?? null, temp_c: st.tempC !== undefined ? Math.round(st.tempC * 10) / 10 : null, oil_quality_pct: st.oilQualityPct !== undefined ? Math.round(st.oilQualityPct) : null };
      });
      return { result: { ...meta(), branch: b.name, equipment: input.only_issues ? items.filter((i) => i.fault || i.status === "offline" || (i.oil_quality_pct !== null && i.oil_quality_pct < sim.safety.oilQualityMinPct)) : items } };
    }
    case "inventory_status": {
      const b = findBranch(str("branch"));
      if (!b) return { result: { error: "Branch not found or not permitted." }, isError: true };
      const sim = sims().get(b.id);
      return {
        result: {
          ...meta(),
          branch: b.name,
          attention: sim.inventory.filter((i) => i.status !== "OK").map((i) => ({ item: i.name, sku: i.sku, qty: i.qty, unit: i.unit, reorder_level: i.reorderLevel, status: i.status, location: i.locationName, on_order: i.onOrder })),
          replenishments: sim.replenishments.filter((r) => r.status !== "received").map((r) => ({ sku: r.sku, qty: r.qty, eta: clock(sim.clockStart + r.etaAt * 1000), source: r.source })),
          items_tracked: sim.inventory.length,
        },
      };
    }
    case "demand_forecast": {
      const b = findBranch(str("branch"));
      if (!b) return { result: { error: "Branch not found or not permitted." }, isError: true };
      const hours = Math.max(1, Math.min(12, Number(input.hours) || 3));
      const base = { A: 14, B: 22, C: 34 }[b.floorPlanType] * (ARRIVAL_PRESETS[app.arrivalPreset] / 20);
      const d = new Date(sims().clock);
      const h0 = d.getUTCHours() + d.getUTCMinutes() / 60;
      const forecast = Array.from({ length: hours }, (_, i) => {
        const at = sims().clock + (i + 1) * 3600e3;
        return { hour: clock(at), expected_orders: isBranchOpen(b, at) ? Math.round(base * demandFactor(h0 + i + 1)) : 0 };
      });
      return { result: { ...meta(), branch: b.name, method: "demo demand curve × format base rate × demand setting — indicative, not a trained forecast", forecast } };
    }
    case "open_branch": {
      const b = findBranch(str("branch"));
      if (!b) return { result: { error: "Branch not found or not permitted." }, isError: true };
      app.enterBranch(b.id);
      return { result: { ok: true, opened: b.name, note: "Map is flying to the branch; the 3D twin opens after the transition." } };
    }
    case "show_in_3d": {
      if (!app.enteredBranchId) return { result: { error: "No branch twin is open. Call open_branch first." }, isError: true };
      if (app.phase !== "inside") useApp.setState({ phase: "inside" });
      const loc = locate(str("target"));
      if (!loc) return { result: { error: `Could not find '${str("target")}' in this layout.` }, isError: true };
      if (TWIN_SECTIONS.indexOf(app.section) < 0) app.setSection("twin");
      app.requestCamera({ position: loc.position, target: loc.target });
      if (loc.equipmentId) app.select({ kind: "equipment", id: loc.equipmentId });
      return { result: { ok: true, showing: loc.label } };
    }
    case "open_view": {
      const v = str("view") as Section;
      app.setSection(v);
      if (v === "cameras") app.setCctv(true, 4);
      return { result: { ok: true, view: v, note: TWIN_SECTIONS.includes(v) && !app.enteredBranchId ? "This view needs an open branch twin." : undefined } };
    }
  }
  return { result: { error: `Unknown tool ${name}` }, isError: true };
}

/**
 * Offline mode (no API key configured): a small rule-based intent matcher that
 * calls the same tools and formats the result. Clearly labelled in the UI.
 */
export async function offlineAnswer(q: string): Promise<string> {
  const t = q.toLowerCase();
  const branch = BRANCHES.find((b) => t.includes(b.name.toLowerCase()));
  const ghs = (n: unknown) => `GH₵${Number(n).toLocaleString()}`;
  if (/take me|show|go to|switch to|open the/.test(t) && /oven|fry|frying|pizza|rice|dispatch|fridge|refrigerat|freez|counter|entrance|kitchen|packag|cold|storage/.test(t)) {
    if (/camera/.test(t) && /kitchen/.test(t)) {
      await executeTool("open_view", { view: "cameras" });
      return "Opened the virtual camera grid.";
    }
    if (branch && useApp.getState().enteredBranchId !== branch.id) await executeTool("open_branch", { branch: branch.name });
    const r = await executeTool("show_in_3d", { target: t });
    return r.isError ? String(r.result.error) : `Moved the 3D camera to ${r.result.showing}.`;
  }
  if (branch && /(show|open|take me|enter)/.test(t)) {
    await executeTool("open_branch", { branch: branch.name });
    return `Opening the ${branch.name} digital twin…`;
  }
  if (/delay/.test(t)) {
    const r = (await executeTool("list_branches", { region: null, city: null, status: null, sort_by: "delayed", limit: 10 })).result as { branches: Array<ReturnType<typeof row>> };
    const d = r.branches.filter((b) => b.delayed_orders > 0);
    return d.length ? `Branches with delayed orders:\n${d.map((b) => `• ${b.branch}: ${b.delayed_orders} delayed, ${b.active_orders} active`).join("\n")}` : "No branches currently report delayed orders.";
  }
  if (/safety|alert/.test(t)) {
    const r = (await executeTool("safety_alerts", { branch: branch?.name ?? null })).result as { branches_with_issues: Array<{ branch: string; status: string; issue: string }> };
    return r.branches_with_issues.length ? `Branches with food-safety or equipment issues:\n${r.branches_with_issues.map((b) => `• ${b.branch} — ${b.status.toUpperCase()}: ${b.issue}`).join("\n")}` : "No open safety alerts.";
  }
  if (/offline/.test(t)) {
    const out: string[] = [];
    for (const s of sims().sims.values()) for (const [id, e] of s.equipment) if (e.fault) out.push(`• ${s.branchName}: ${s.eqById.get(id)?.name} (${e.fault.kind})`);
    return out.length ? `Equipment with faults or offline sensors in running simulations:\n${out.join("\n")}` : "No offline equipment in the running branch simulations. (Only branches you've opened run full equipment simulation.)";
  }
  if (/compare/.test(t) && /accra|kumasi/.test(t)) {
    const r = (await executeTool("compare", { dimension: "city", names: ["Accra", "Kumasi"] })).result as { groups: Array<Json> };
    return `Accra vs Kumasi (today so far):\n${r.groups.map((g) => `• ${g.name}: ${g.branches} branches, ${ghs(g.sales_today_ghs)} sales, ${g.orders_today} orders, avg prep ${g.avg_prep_min} min`).join("\n")}`;
  }
  if (/best|highest|top|revenue|performing/.test(t)) {
    const r = (await executeTool("list_branches", { region: null, city: null, status: null, sort_by: "sales", limit: 5 })).result as { branches: Array<ReturnType<typeof row>> };
    return `Top branches by sales today:\n${r.branches.map((b, i) => `${i + 1}. ${b.branch} — ${ghs(b.sales_today_ghs)} (${b.orders_today} orders)`).join("\n")}`;
  }
  if (/how many|being prepared|active orders|across ghana|summary|overview/.test(t)) {
    const r = (await executeTool("network_summary", {})).result;
    return `Across ${r.branches} branches (${r.open_now} open): ${r.active_orders} active orders, ${r.orders_today} orders today, ${ghs(r.sales_today_ghs)} sales, avg prep ${r.avg_prep_min} min, ${r.critical} critical / ${r.warning} warning.`;
  }
  return "Offline mode understands: branch rankings, delayed orders, safety alerts, offline equipment, Accra vs Kumasi, network summary, 'show me the kitchen at <branch>', and 'take me to the pizza oven / frying station / dispatch / refrigerator with the alert'. Add ANTHROPIC_API_KEY to enable the full AI assistant.";
}
