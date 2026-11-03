import type { WorkstationType } from "../floorplan/types";

/**
 * Menu items, names and GH₵ prices come from the public Chris B catalogue
 * (https://chrisb.app/menu, retrieved 2026-11-03 — see research/RESEARCH.md §4).
 * Portion sizes for rice items are published; everything about *how* items are
 * produced (stages, durations, batch sizes) is a documented simulation assumption.
 */

export type UnitKind = "pizza" | "chicken" | "rice" | "side" | "drink";
export type PizzaSize = "S" | "M" | "L" | "J";

export interface ProductionUnitSpec {
  kind: UnitKind;
  label: string;
  pieces?: number;
  size?: PizzaSize;
  /** Cooked rice drawn from the hot-holding warmer, in grams. */
  grams?: number;
  /** Chicken cut drawn from hot-holding. */
  cut?: "wing" | "drum";
  /** Ingredient SKUs consumed per unit (quantities in the ingredient's unit). */
  recipe: Record<string, number>;
}

export interface MenuItem {
  id: string;
  name: string;
  category: "Pizza" | "Rice" | "Chicken" | "Sides" | "Packages" | "Drinks";
  price: number;
  units: ProductionUnitSpec[];
  /** Relative popularity weight for the demand generator (assumption). */
  weight: number;
}

const PIZZA_DOUGH: Record<PizzaSize, number> = { S: 0.22, M: 0.32, L: 0.42, J: 0.6 };
const PIZZA_CHEESE: Record<PizzaSize, number> = { S: 0.1, M: 0.15, L: 0.2, J: 0.3 };
const BOX: Record<PizzaSize, string> = { S: "PKG-PZ-S", M: "PKG-PZ-M", L: "PKG-PZ-L", J: "PKG-PZ-L" };

function pizza(name: string, size: PizzaSize, toppings: Record<string, number>): ProductionUnitSpec {
  const k = PIZZA_DOUGH[size] / PIZZA_DOUGH.M;
  const recipe: Record<string, number> = {
    "DGH-001": PIZZA_DOUGH[size],
    "CHS-001": PIZZA_CHEESE[size],
    "SAU-TOM": round(0.07 * k),
    [BOX[size]]: 1,
  };
  for (const [sku, q] of Object.entries(toppings)) recipe[sku] = round(q * k);
  return { kind: "pizza", label: `${name} (${size})`, size, recipe };
}

function chicken(label: string, pieces: number, sku: "CHK-WNG" | "CHK-DRM"): ProductionUnitSpec {
  const perPiece = sku === "CHK-WNG" ? 0.09 : 0.14;
  return { kind: "chicken", label, pieces, cut: sku === "CHK-WNG" ? "wing" : "drum", recipe: { [sku]: round(perPiece * pieces), "OIL-001": round(0.015 * pieces), "SPC-001": round(0.003 * pieces), "PKG-BKT": pieces > 4 ? 1 : 0 } };
}

function rice(label: string, grams: number, type: "Jollof" | "Fried Rice"): ProductionUnitSpec {
  return { kind: "rice", label: `${type} ${grams} g`, grams, recipe: { "PKG-RC": 1, ...(type === "Jollof" ? {} : { "VEG-001": 0.02 }) } };
}

const plantain: ProductionUnitSpec = { kind: "side", label: "Fried plantain 80 g", recipe: { "PLN-001": 0.08, "OIL-001": 0.01 } };
const coleslaw: ProductionUnitSpec = { kind: "side", label: "Coleslaw", recipe: { "COL-001": 0.1 } };
const drink = (label: string, sku: string): ProductionUnitSpec => ({ kind: "drink", label, recipe: { [sku]: 1 } });

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

export const MENU: MenuItem[] = [
  { id: "pz-chicken-m", name: "Chicken Pizza — Medium", category: "Pizza", price: 130, weight: 6, units: [pizza("Chicken Pizza", "M", { "CHK-BRS": 0.12, "VEG-001": 0.04 })] },
  { id: "pz-chicken-l", name: "Chicken Pizza — Large", category: "Pizza", price: 150, weight: 5, units: [pizza("Chicken Pizza", "L", { "CHK-BRS": 0.12, "VEG-001": 0.04 })] },
  { id: "pz-klarabella-m", name: "Klarabella (Beef) — Medium", category: "Pizza", price: 130, weight: 4, units: [pizza("Klarabella", "M", { "BEF-001": 0.12, "VEG-001": 0.05 })] },
  { id: "pz-chibella-m", name: "Chibella — Medium", category: "Pizza", price: 145, weight: 6, units: [pizza("Chibella", "M", { "CHK-BRS": 0.06, "BEF-001": 0.06, "SSG-001": 0.05 })] },
  { id: "pz-chibella-l", name: "Chibella — Large", category: "Pizza", price: 190, weight: 3, units: [pizza("Chibella", "L", { "CHK-BRS": 0.06, "BEF-001": 0.06, "SSG-001": 0.05 })] },
  { id: "pz-triplec-l", name: "Triple C — Large", category: "Pizza", price: 190, weight: 3, units: [pizza("Triple C", "L", { "CHK-BRS": 0.16 })] },
  { id: "pz-chicham-m", name: "Chicham — Medium", category: "Pizza", price: 135, weight: 2, units: [pizza("Chicham", "M", { "CHK-BRS": 0.07, "HAM-001": 0.06, "VEG-001": 0.04 })] },
  { id: "pz-dukeman-l", name: "Dukeman — Large", category: "Pizza", price: 220, weight: 1, units: [pizza("Dukeman", "L", { "CHK-BRS": 0.05, "BEF-001": 0.05, "HAM-001": 0.04, "SSG-001": 0.04, "TUN-001": 0.04 })] },
  { id: "rc-guyman-jollof", name: "Guyman Metreat Jollof", category: "Rice", price: 49, weight: 9, units: [rice("Guyman", 300, "Jollof"), chicken("1 drumstick", 1, "CHK-DRM")] },
  { id: "rc-guyman-fried", name: "Guyman Metreat Fried Rice", category: "Rice", price: 49, weight: 6, units: [rice("Guyman", 300, "Fried Rice"), chicken("1 drumstick", 1, "CHK-DRM")] },
  { id: "rc-playman-jollof", name: "PlayMan Jollof", category: "Rice", price: 79, weight: 7, units: [rice("PlayMan", 400, "Jollof"), chicken("4 wings", 4, "CHK-WNG"), plantain, coleslaw] },
  { id: "rc-playman-fried", name: "PlayMan Fried Rice", category: "Rice", price: 79, weight: 4, units: [rice("PlayMan", 400, "Fried Rice"), chicken("4 wings", 4, "CHK-WNG"), plantain, coleslaw] },
  { id: "rc-mini-bucket", name: "Jollof Mini Bucket", category: "Rice", price: 150, weight: 3, units: [rice("Mini Bucket", 800, "Jollof"), chicken("8 wings", 8, "CHK-WNG"), plantain, coleslaw] },
  { id: "ck-bucket-5", name: "Chicken Bucket — 5 pcs", category: "Chicken", price: 55, weight: 4, units: [chicken("5 pcs chicken", 5, "CHK-DRM")] },
  { id: "ck-bucket-10", name: "Chicken Bucket — 10 pcs", category: "Chicken", price: 105, weight: 3, units: [chicken("10 pcs chicken", 10, "CHK-DRM")] },
  { id: "ck-wings-10", name: "Wings Bucket — 10 pcs", category: "Chicken", price: 80, weight: 4, units: [chicken("10 tossed wings", 10, "CHK-WNG")] },
  { id: "ck-wings-15", name: "Wings Bucket — 15 pcs", category: "Chicken", price: 125, weight: 2, units: [chicken("8 tossed wings", 8, "CHK-WNG"), chicken("7 tossed wings", 7, "CHK-WNG")] },
  { id: "sd-sweet-potato", name: "Spicy Sweet Potato Bucket", category: "Sides", price: 130, weight: 2, units: [{ kind: "side", label: "Spicy sweet potato bucket", recipe: { "SWP-001": 0.6, "OIL-001": 0.05, "PKG-BKT": 1 } }] },
  { id: "sd-plantain", name: "Extra Plantain", category: "Sides", price: 10, weight: 3, units: [plantain] },
  { id: "pk-genz", name: "Gen-Z Pack", category: "Packages", price: 150, weight: 4, units: [pizza("Chibella", "M", { "CHK-BRS": 0.06, "BEF-001": 0.06, "SSG-001": 0.05 }), rice("Guyman", 300, "Jollof"), chicken("4 wings", 4, "CHK-WNG")] },
  { id: "pk-borgaman", name: "Borgaman Pack", category: "Packages", price: 199, weight: 3, units: [pizza("Kersame", "M", { "CHK-BRS": 0.06, "BEF-001": 0.06, "VEG-001": 0.05 }), chicken("10 wings", 10, "CHK-WNG"), drink("Coke 0.45 L", "DRK-COK")] },
  { id: "pk-complete-guyman", name: "Complete Guyman", category: "Packages", price: 99, weight: 3, units: [rice("Complete Guyman", 400, "Jollof"), chicken("4 wings", 4, "CHK-WNG"), plantain] },
  { id: "dr-coke", name: "Coke 0.45 L", category: "Drinks", price: 15, weight: 6, units: [drink("Coke 0.45 L", "DRK-COK")] },
  { id: "dr-water", name: "Bottle Water", category: "Drinks", price: 5, weight: 4, units: [drink("Bottle Water", "DRK-WTR")] },
  { id: "dr-malt", name: "Malt", category: "Drinks", price: 20, weight: 3, units: [drink("Malt", "DRK-MLT")] },
  { id: "dr-sobolo", name: "Tealeys Sobolo", category: "Drinks", price: 25, weight: 2, units: [drink("Tealeys Sobolo", "DRK-SOB")] },
];

export const MENU_BY_ID = new Map(MENU.map((m) => [m.id, m]));

export interface StageSpec {
  name: string;
  ws: WorkstationType;
  /** Seconds of staff work (or machine time if `machine`). */
  duration: number;
  machine: boolean;
  phase: "PREPARATION" | "COOKING" | "QUALITY_CHECK";
}

/**
 * Production stages per unit — SIMULATION ASSUMPTIONS, not verified company procedures.
 * Durations are typical quick-service values; conveyor-oven bake ≈5.5 min, pressure-less
 * frying ≈8–9 min for bone-in pieces, ≈7 min for wings.
 */
export function stagesFor(u: ProductionUnitSpec): StageSpec[] {
  switch (u.kind) {
    case "pizza":
      return [
        { name: "Dough, sauce & toppings", ws: "pizza-prep", duration: 70 + (u.size === "L" || u.size === "J" ? 15 : 0), machine: false, phase: "PREPARATION" },
        { name: "Conveyor bake", ws: "oven", duration: 330, machine: true, phase: "COOKING" },
        { name: "Cut, inspect & box", ws: "qc", duration: 25, machine: false, phase: "QUALITY_CHECK" },
      ];
    case "chicken":
      // Chicken is batch-fried into hot-holding (see BATCH_STAGES); orders are picked from held stock.
      return [{ name: "Pick from hot-holding, toss & box", ws: "qc", duration: 12 + 1.5 * (u.pieces ?? 1), machine: false, phase: "QUALITY_CHECK" }];
    case "rice":
      return [{ name: "Portion rice & allocate protein", ws: "rice", duration: 35, machine: false, phase: "PREPARATION" }];
    case "side":
      if (u.label.toLowerCase().includes("coleslaw")) return [{ name: "Portion coleslaw", ws: "rice", duration: 10, machine: false, phase: "PREPARATION" }];
      return [
        { name: "Fry", ws: "fryer", duration: u.label.includes("potato") ? 300 : 210, machine: true, phase: "COOKING" },
        { name: "Drain & portion", ws: "qc", duration: 12, machine: false, phase: "QUALITY_CHECK" },
      ];
    case "drink":
      return [];
  }
}

/** Batch production for held products — SIMULATION ASSUMPTIONS. */
export const CHICKEN_BATCH: Record<"wing" | "drum", { pieces: number; stages: StageSpec[] }> = {
  wing: {
    pieces: 16,
    stages: [
      { name: "Bread wings batch", ws: "chicken-prep", duration: 70, machine: false, phase: "PREPARATION" },
      { name: "Fry wings batch", ws: "fryer", duration: 420, machine: true, phase: "COOKING" },
      { name: "Core-temp check & move to hot-holding", ws: "qc", duration: 25, machine: false, phase: "QUALITY_CHECK" },
    ],
  },
  drum: {
    pieces: 12,
    stages: [
      { name: "Bread drumsticks batch", ws: "chicken-prep", duration: 75, machine: false, phase: "PREPARATION" },
      { name: "Fry drumsticks batch", ws: "fryer", duration: 540, machine: true, phase: "COOKING" },
      { name: "Core-temp check & move to hot-holding", ws: "qc", duration: 25, machine: false, phase: "QUALITY_CHECK" },
    ],
  },
};

export const SIMULATION_ASSUMPTIONS = [
  "Dough, sauces and marinated proteins are assumed to arrive prepared from central kitchens; branches assemble, cook and pack. Not confirmed by the company.",
  "Pizza: make-line prep ≈70–85 s, conveyor bake 5.5 min, cut/box 25 s.",
  "Chicken is batch-fried (16 wings / 12 drumsticks per basket: bread 70 s, fry 7–9 min, core-temperature check) into hot-holding; orders are picked, tossed and boxed in ≈12 s + 1.5 s per piece.",
  "Jollof / fried rice is cooked in batches (≈40 portions, 15 min) and held hot; orders are portioned from the warmer in ≈35 s.",
  "Packaging takes 20 s plus 5 s per production unit; collection hand-over 8 s.",
  "Customer arrival follows a Poisson process scaled by a lunch/dinner demand curve; channel mix is a demo setting.",
];
