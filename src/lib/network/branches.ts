import raw from "@/data/branches.json";
import type { FloorPlanFormat } from "../floorplan/types";

/** A branch from the official Pizzaman Chickenman outlet directory (see research/RESEARCH.md). */
export interface Branch {
  id: string;
  name: string;
  brand: string;
  region: string;
  city: string;
  lat: number;
  lng: number;
  coordinatePrecision: number | null;
  hours: { storeOpen: string | null; storeClose: string | null; deliveryOpen: string | null; deliveryClose: string | null };
  is24h: boolean;
  pickupOnly: boolean;
  siteContext: string | null;
  phone: string | null;
  courierType: string | null;
  notes: string | null;
  source: string;
  coordinateSource: string;
  lastVerified: string;
  floorPlanType: Exclude<FloorPlanFormat, "custom">;
  floorPlanReason: string;
}

export const BRANCHES: Branch[] = raw as Branch[];
export const BRANCH_BY_ID = new Map(BRANCHES.map((b) => [b.id, b]));

export const GHANA_REGIONS = [
  "Greater Accra",
  "Ashanti",
  "Central",
  "Western",
  "Western North",
  "Eastern",
  "Volta",
  "Oti",
  "Bono",
  "Bono East",
  "Ahafo",
  "Northern",
  "Savannah",
  "North East",
  "Upper East",
  "Upper West",
] as const;

function minutes(hhmm: string | null | undefined) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Open according to the officially published store hours (Africa/Accra = UTC+0). */
export function isBranchOpen(b: Branch, epochMs: number) {
  if (b.is24h) return true;
  const open = minutes(b.hours.storeOpen);
  const close = minutes(b.hours.storeClose);
  if (open === null || close === null) return true;
  const d = new Date(epochMs);
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  return close > open ? now >= open && now <= close : now >= open || now <= close;
}

export function demoBranchIds() {
  return ["East Legon", "Spintex", "KNUST"].map((n) => BRANCHES.find((b) => b.name === n)!.id);
}
