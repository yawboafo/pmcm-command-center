import { hashString, Rng } from "./rng";

/**
 * Daily and weekly demand patterns on top of the hour-of-day curve in engine.ts:
 * weekday vs weekend, payday weekends, and seeded rain episodes that move walk-ins
 * to delivery. Everything is a pure function of (date, seed) so a replay is identical.
 * Ghana context: Accra is UTC+0; two rainy seasons (April–July, September–October).
 */

export const WEEKDAY_FACTOR = [1.1, 0.85, 0.85, 0.9, 0.95, 1.2, 1.3]; // Sun … Sat

export interface RainEpisode {
  /** Hours (decimal) of the day, UTC. */
  from: number;
  to: number;
  /** 0.3 light … 1 heavy. */
  intensity: number;
}

export interface DayProfile {
  dayKey: string;
  weekday: number;
  weekend: boolean;
  payday: boolean;
  weekdayFactor: number;
  paydayFactor: number;
  rain: RainEpisode[];
}

const dayKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Payday effect: the last three days of the month and the first two (salaries land, volume spikes). */
function isPayday(d: Date) {
  const day = d.getUTCDate();
  return day >= daysInMonth(d.getUTCFullYear(), d.getUTCMonth()) - 2 || day <= 2;
}

const profileCache = new Map<string, DayProfile>();

export function dayProfile(epochMs: number, seed: number): DayProfile {
  const d = new Date(epochMs);
  const key = `${seed}:${dayKeyOf(d)}`;
  const hit = profileCache.get(key);
  if (hit) return hit;
  const weekday = d.getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const payday = isPayday(d);
  const rng = new Rng(hashString(key));
  const month = d.getUTCMonth();
  const rainySeason = (month >= 3 && month <= 6) || month === 8 || month === 9;
  const rain: RainEpisode[] = [];
  const episodes = rng.chance(rainySeason ? 0.55 : 0.15) ? (rng.chance(0.3) ? 2 : 1) : 0;
  for (let i = 0; i < episodes; i++) {
    const from = rng.range(10.5, 19.5);
    rain.push({ from, to: from + rng.range(0.6, 2.4), intensity: Math.round(rng.range(0.35, 1) * 100) / 100 });
  }
  const profile: DayProfile = {
    dayKey: dayKeyOf(d),
    weekday,
    weekend,
    payday,
    weekdayFactor: WEEKDAY_FACTOR[weekday],
    paydayFactor: payday ? (weekday === 5 || weekend ? 1.22 : 1.1) : 1,
    rain,
  };
  if (profileCache.size > 400) profileCache.clear();
  profileCache.set(key, profile);
  return profile;
}

export interface Weather {
  rain: boolean;
  /** 0 when dry. */
  intensity: number;
  label: "Dry" | "Light rain" | "Rain" | "Heavy rain";
  /** Minutes until the current episode ends (or the next starts), if any. */
  changesInMin?: number;
}

export function weatherAt(epochMs: number, seed: number): Weather {
  const p = dayProfile(epochMs, seed);
  const d = new Date(epochMs);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const now = p.rain.find((r) => h >= r.from && h < r.to);
  if (now) {
    const label = now.intensity < 0.5 ? "Light rain" : now.intensity < 0.8 ? "Rain" : "Heavy rain";
    return { rain: true, intensity: now.intensity, label, changesInMin: Math.round((now.to - h) * 60) };
  }
  const next = p.rain.filter((r) => r.from > h).sort((a, b) => a.from - b.from)[0];
  return { rain: false, intensity: 0, label: "Dry", changesInMin: next ? Math.round((next.from - h) * 60) : undefined };
}

/** Multiplier applied to the hourly demand curve for this moment (weekday × payday). */
export function dayMultiplier(epochMs: number, seed: number) {
  const p = dayProfile(epochMs, seed);
  return p.weekdayFactor * p.paydayFactor;
}

/** Walk-in share lost to the weather, and the delivery share gained (as fractions). */
export function rainShift(w: Weather) {
  return { walkIn: 1 - 0.45 * w.intensity, deliveryBoost: 0.25 * w.intensity };
}

/** Shift boundaries (hour of day) used for the "shift change" timeline marker. */
export const SHIFT_CHANGES = [8, 15, 23];
