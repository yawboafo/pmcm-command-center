import { dayMultiplier, weatherAt } from "./calendar";
import { demandFactor } from "./engine";
import { hashString, Rng } from "./rng";
import type { ZoneId } from "./zones";

/**
 * Modelled comparison baselines for zone metrics: "same time yesterday" and "same time
 * last week". There is no stored history yet, so the baseline is the demand model
 * (hour curve × weekday × payday × weather for that day) with seeded day-to-day noise,
 * deterministic per branch and date. Labelled MODELLED in the UI; a connected history
 * store replaces this function without touching the UI.
 */
type Model = (d: number, scale: number) => number;

const MODELS: Partial<Record<ZoneId, Record<string, Model>>> = {
  "front-counter": { queue: (d, s) => Math.max(0, 0.6 + 4.2 * d * s - 0.8), frontWait: (d) => 40 + 150 * d, service: (d) => 42 + 6 * d, tills: (_d, s) => Math.round(1 + s) },
  kitchen: { tickets: (d, s) => Math.max(0, 1.5 + 7.5 * d * s), oldest: (d) => 3 + 5.5 * d, fryers: (d, s) => Math.min(4, 0.8 + 2.2 * d * s), oil: () => 62 },
  pass: { underLamp: (d, s) => Math.max(0, 0.5 + 3.2 * d * s), lampTime: (d) => 60 + 170 * d, holdTemp: () => 68, qc: () => 96 },
  dining: { occupancy: (d, s) => Math.max(0, 2 + 14 * d * s), waiting: (d, s) => Math.max(0, 1 + 4 * d * s) },
  "pickup-bay": { riders: (d, s) => Math.max(0, 0.4 + 2.4 * d * s), riderWait: (d) => 60 + 160 * d, ordersWaiting: (d, s) => Math.max(0, 0.3 + 1.4 * d * s), handover: () => 75 },
  "cold-room": { temp: () => 3.4, opens: (d, s) => Math.round(6 + 9 * d * s) },
  entrance: { footfall: (d, s) => Math.round(6 + 22 * d * s), arrivals10: (d, s) => Math.round(1 + 3.6 * d * s), walkouts: (d) => (d > 1.4 ? 1 : 0) },
  "back-door": { opens: (d) => Math.round(2 + 3 * d) },
};

export interface Baseline {
  yesterday: number | null;
  lastWeek: number | null;
  /** Human label for the comparison basis. */
  basis: "modelled";
}

const DAY = 86_400_000;

function modelled(zoneId: ZoneId, key: string, atMs: number, seed: number, branchId: string, scale: number): number | null {
  const fn = MODELS[zoneId]?.[key];
  if (!fn) return null;
  const d = new Date(atMs);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const w = weatherAt(atMs, seed);
  const walk = ["front-counter", "dining", "entrance"].includes(zoneId) ? 1 - 0.45 * w.intensity : 1 + 0.2 * w.intensity;
  const demand = demandFactor(hour) * dayMultiplier(atMs, seed) * walk;
  const dayKey = d.toISOString().slice(0, 10);
  const noise = new Rng(hashString(`${seed}:${branchId}:${dayKey}:${zoneId}:${key}`)).range(0.88, 1.12);
  const v = fn(demand, scale) * noise;
  return Math.round(v * 10) / 10;
}

export function baselineFor(zoneId: ZoneId, key: string, atMs: number, seed: number, branchId: string, format: string): Baseline {
  const scale = format === "C" ? 1.6 : format === "A" ? 0.7 : 1;
  return { yesterday: modelled(zoneId, key, atMs - DAY, seed, branchId, scale), lastWeek: modelled(zoneId, key, atMs - 7 * DAY, seed, branchId, scale), basis: "modelled" };
}
