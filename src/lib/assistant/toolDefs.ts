import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tools the operations assistant can call. They execute in the browser against
 * the running simulation (the source of truth for this prototype) and the
 * verified branch directory, and every result carries provenance + freshness.
 * In production the same tool names would call authorised, branch-scoped APIs.
 */
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "network_summary",
    description: "National totals across all branches the user may view: branches open, active orders, orders and simulated sales today, average prep time, kitchen load, critical/warning counts.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "list_branches",
    description: "List branches with simulated live metrics, optionally filtered and sorted. Use for 'which branch…', rankings, delayed orders, alerts by branch.",
    input_schema: {
      type: "object",
      properties: {
        region: { type: ["string", "null"], description: "One of Ghana's 16 regions, e.g. 'Greater Accra', 'Ashanti'." },
        city: { type: ["string", "null"], description: "City, e.g. 'Accra', 'Kumasi'." },
        status: { anyOf: [{ type: "string", enum: ["normal", "warning", "critical", "closed"] }, { type: "null" }] },
        sort_by: { anyOf: [{ type: "string", enum: ["sales", "orders", "active_orders", "delayed", "alerts", "prep_time"] }, { type: "null" }] },
        limit: { type: ["integer", "null"], description: "Max rows (default 10)." },
      },
      required: ["region", "city", "status", "sort_by", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "compare",
    description: "Compare simulated performance between branches, cities, regions or restaurant formats (A compact, B standard, C flagship).",
    input_schema: {
      type: "object",
      properties: {
        dimension: { type: "string", enum: ["branch", "city", "region", "format"] },
        names: { type: "array", items: { type: "string" }, description: "2–4 names to compare (e.g. ['Accra','Kumasi'] or ['A','C'])." },
      },
      required: ["dimension", "names"],
      additionalProperties: false,
    },
  },
  {
    name: "branch_details",
    description: "Verified directory facts (location, hours, source) plus simulated live status for one branch. If the branch's full kitchen simulation is running, includes kitchen queues, equipment and inventory issues.",
    input_schema: { type: "object", properties: { branch: { type: "string", description: "Branch name, e.g. 'East Legon'." } }, required: ["branch"], additionalProperties: false },
  },
  {
    name: "safety_alerts",
    description: "Open food-safety and equipment alerts (simulated). Optionally limited to one branch.",
    input_schema: { type: "object", properties: { branch: { type: ["string", "null"] } }, required: ["branch"], additionalProperties: false },
  },
  {
    name: "equipment_status",
    description: "Equipment state for a branch with a running simulation: faults, offline sensors, temperatures, oil quality, maintenance. Starts the branch simulation if needed.",
    input_schema: { type: "object", properties: { branch: { type: "string" }, only_issues: { type: "boolean" } }, required: ["branch", "only_issues"], additionalProperties: false },
  },
  {
    name: "inventory_status",
    description: "Inventory levels, low-stock and expiring items, and pending replenishments for a branch (simulated). Starts the branch simulation if needed.",
    input_schema: { type: "object", properties: { branch: { type: "string" } }, required: ["branch"], additionalProperties: false },
  },
  {
    name: "demand_forecast",
    description: "Short-term simulated demand forecast (orders per hour) for a branch over the next N hours, from the demand curve and branch format. Indicative only.",
    input_schema: { type: "object", properties: { branch: { type: "string" }, hours: { type: "integer" } }, required: ["branch", "hours"], additionalProperties: false },
  },
  {
    name: "open_branch",
    description: "ACTION: fly the map to a branch and enter its 3D digital twin.",
    input_schema: { type: "object", properties: { branch: { type: "string" } }, required: ["branch"], additionalProperties: false },
  },
  {
    name: "show_in_3d",
    description: "ACTION: inside the open branch twin, move the 3D camera to a place or piece of equipment, e.g. 'pizza oven', 'frying station', 'dispatch', 'refrigerator with alert', 'cold room', 'entrance', 'packaging'.",
    input_schema: { type: "object", properties: { target: { type: "string" } }, required: ["target"], additionalProperties: false },
  },
  {
    name: "open_view",
    description: "ACTION: open an application view.",
    input_schema: {
      type: "object",
      properties: { view: { type: "string", enum: ["network", "branches", "twin", "cameras", "kitchen", "orders", "safety", "inventory", "customers", "staff", "delivery", "central", "analytics", "editor"] } },
      required: ["view"],
      additionalProperties: false,
    },
  },
];

