import { Rng, hashString } from "../sim/rng";
import { BRANCHES, type Branch } from "./branches";

/**
 * Central kitchens & warehouses.
 * VERIFIED: the company states it runs 9 central kitchens/warehouses supplying all
 * outlets on a 24-hour schedule. The only facility named publicly is a warehouse at
 * Nyankyerenase near Kumasi (2023 court report). Locations of the others are NOT
 * published, so the hubs below (except Nyankyerenase's town) are demo placements.
 */
export interface SupplyHub {
  id: string;
  name: string;
  kind: "central-kitchen" | "warehouse";
  lat: number;
  lng: number;
  verified: boolean;
  note: string;
  capacityPerDay: number;
}

export const SUPPLY_HUBS: SupplyHub[] = [
  { id: "hub-nyankyerenase", name: "Nyankyerenase Warehouse (Kumasi)", kind: "warehouse", lat: 6.735, lng: -1.655, verified: true, note: "Named in a 2023 public court report. Exact site and role in the network are not published; marker is placed at the town.", capacityPerDay: 900 },
  { id: "hub-accra-west", name: "Accra West Central Kitchen (demo)", kind: "central-kitchen", lat: 5.585, lng: -0.29, verified: false, note: "Conceptual hub for the simulation — location not published by the company.", capacityPerDay: 1400 },
  { id: "hub-accra-east", name: "Accra East Central Kitchen (demo)", kind: "central-kitchen", lat: 5.66, lng: -0.12, verified: false, note: "Conceptual hub for the simulation — location not published by the company.", capacityPerDay: 1400 },
  { id: "hub-takoradi", name: "Western Corridor Hub (demo)", kind: "central-kitchen", lat: 5.1, lng: -1.32, verified: false, note: "Conceptual hub for the simulation — location not published by the company.", capacityPerDay: 600 },
  { id: "hub-tamale", name: "Northern Hub (demo)", kind: "warehouse", lat: 9.42, lng: -0.85, verified: false, note: "Conceptual hub for the simulation — location not published by the company.", capacityPerDay: 400 },
];

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function hubFor(b: Branch): { hub: SupplyHub; distanceKm: number } {
  let best = SUPPLY_HUBS[0];
  let bestD = Infinity;
  for (const h of SUPPLY_HUBS) {
    const d = km(b.lat, b.lng, h.lat, h.lng);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return { hub: best, distanceKm: Math.round(bestD) };
}

export interface Transfer {
  id: string;
  hubId: string;
  branchId: string;
  departAt: number;
  arriveAt: number;
  items: Array<{ sku: string; name: string; qty: number; unit: string }>;
  status: "scheduled" | "loading" | "in-transit" | "delivered";
}

const LOAD = [
  { sku: "DGH-001", name: "Pizza dough", unit: "kg", base: 12 },
  { sku: "CHK-WNG", name: "Marinated wings", unit: "kg", base: 25 },
  { sku: "CHK-DRM", name: "Marinated drumsticks", unit: "kg", base: 20 },
  { sku: "CHS-001", name: "Mozzarella", unit: "kg", base: 6 },
  { sku: "JLB-001", name: "Jollof stew base", unit: "L", base: 10 },
  { sku: "COL-001", name: "Coleslaw", unit: "kg", base: 5 },
];

/**
 * Deterministic demo distribution schedule: three runs per branch spread over the
 * 24-hour cycle (one every 8 h from a per-branch offset), so some trucks are on the
 * road at any time of day.
 */
export function transfersForDay(dayStartMs: number, seed: number): Transfer[] {
  const out: Transfer[] = [];
  for (const b of BRANCHES) {
    const { hub, distanceKm } = hubFor(b);
    const r = new Rng(hashString(`${b.id}:supply`) ^ seed);
    const travelMin = 20 + distanceKm * 1.6;
    const offset = r.range(0, 8);
    for (const [i, hour] of [offset, offset + 8, offset + 16].entries()) {
      const departAt = dayStartMs + hour * 3600e3;
      const k = b.floorPlanType === "C" ? 1.6 : b.floorPlanType === "A" ? 0.6 : 1;
      out.push({
        id: `tr-${b.id}-${i}`,
        hubId: hub.id,
        branchId: b.id,
        departAt,
        arriveAt: departAt + travelMin * 60e3,
        items: LOAD.map((l) => ({ sku: l.sku, name: l.name, unit: l.unit, qty: Math.max(1, Math.round(((l.base * 2) / 3) * k * r.range(0.7, 1.3))) })),
        status: "scheduled",
      });
    }
  }
  return out;
}

export function transferStatus(t: Transfer, nowMs: number): Transfer["status"] {
  if (nowMs >= t.arriveAt) return "delivered";
  if (nowMs >= t.departAt) return "in-transit";
  if (nowMs >= t.departAt - 45 * 60e3) return "loading";
  return "scheduled";
}
