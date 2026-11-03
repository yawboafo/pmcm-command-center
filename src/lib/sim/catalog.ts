/**
 * Demo inventory catalogue. Ingredient list follows the published pizza ingredient
 * master list (research §2); quantities, costs, suppliers and shelf lives are
 * illustrative demo values only.
 */
export type StorageClass = "chilled" | "frozen" | "dry" | "packaging" | "drinks";

export interface IngredientDef {
  sku: string;
  name: string;
  unit: "kg" | "L" | "pcs";
  storage: StorageClass;
  /** Opening stock for a Model B branch; scaled by format. */
  opening: number;
  reorderLevel: number;
  unitCost: number;
  shelfLifeDays: number;
  supplier: string;
}

const CK = "Central Kitchen (demo hub)";
const DRY = "Dry goods supplier (demo)";
const BEV = "Beverage distributor (demo)";
const PKG = "Packaging supplier (demo)";

export const INGREDIENTS: IngredientDef[] = [
  { sku: "CHK-WNG", name: "Chicken wings (marinated)", unit: "kg", storage: "frozen", opening: 38, reorderLevel: 14, unitCost: 62, shelfLifeDays: 60, supplier: CK },
  { sku: "CHK-DRM", name: "Chicken drumsticks (marinated)", unit: "kg", storage: "frozen", opening: 34, reorderLevel: 12, unitCost: 58, shelfLifeDays: 60, supplier: CK },
  { sku: "CHK-BRS", name: "Diced chicken breast (pizza)", unit: "kg", storage: "chilled", opening: 9, reorderLevel: 3, unitCost: 75, shelfLifeDays: 4, supplier: CK },
  { sku: "BEF-001", name: "Seasoned minced beef", unit: "kg", storage: "chilled", opening: 7, reorderLevel: 2.5, unitCost: 90, shelfLifeDays: 3, supplier: CK },
  { sku: "SSG-001", name: "Diced sausage", unit: "kg", storage: "chilled", opening: 4, reorderLevel: 1.5, unitCost: 70, shelfLifeDays: 10, supplier: CK },
  { sku: "HAM-001", name: "Ham", unit: "kg", storage: "chilled", opening: 3, reorderLevel: 1, unitCost: 95, shelfLifeDays: 10, supplier: CK },
  { sku: "TUN-001", name: "Tuna", unit: "kg", storage: "chilled", opening: 2.5, reorderLevel: 1, unitCost: 85, shelfLifeDays: 5, supplier: CK },
  { sku: "DGH-001", name: "Pizza dough (proofed)", unit: "kg", storage: "chilled", opening: 16, reorderLevel: 6, unitCost: 18, shelfLifeDays: 3, supplier: CK },
  { sku: "CHS-001", name: "Mozzarella cheese", unit: "kg", storage: "chilled", opening: 8, reorderLevel: 3, unitCost: 120, shelfLifeDays: 21, supplier: CK },
  { sku: "SAU-TOM", name: "Tomato pizza sauce", unit: "L", storage: "chilled", opening: 5, reorderLevel: 1.5, unitCost: 30, shelfLifeDays: 7, supplier: CK },
  { sku: "VEG-001", name: "Green pepper, onion & sweet corn mix", unit: "kg", storage: "chilled", opening: 5, reorderLevel: 1.5, unitCost: 25, shelfLifeDays: 4, supplier: CK },
  { sku: "COL-001", name: "Coleslaw", unit: "kg", storage: "chilled", opening: 5, reorderLevel: 1.5, unitCost: 28, shelfLifeDays: 3, supplier: CK },
  { sku: "JLB-001", name: "Jollof stew base", unit: "L", storage: "chilled", opening: 12, reorderLevel: 4, unitCost: 35, shelfLifeDays: 5, supplier: CK },
  { sku: "PLN-001", name: "Ripe plantain (sliced)", unit: "kg", storage: "chilled", opening: 8, reorderLevel: 3, unitCost: 15, shelfLifeDays: 3, supplier: CK },
  { sku: "SWP-001", name: "Sweet potato wedges", unit: "kg", storage: "frozen", opening: 10, reorderLevel: 3, unitCost: 22, shelfLifeDays: 90, supplier: CK },
  { sku: "RIC-001", name: "Long-grain parboiled rice", unit: "kg", storage: "dry", opening: 50, reorderLevel: 15, unitCost: 22, shelfLifeDays: 365, supplier: DRY },
  { sku: "FLR-001", name: "Flour (dusting)", unit: "kg", storage: "dry", opening: 10, reorderLevel: 3, unitCost: 12, shelfLifeDays: 180, supplier: DRY },
  { sku: "OIL-001", name: "Frying oil", unit: "L", storage: "dry", opening: 40, reorderLevel: 12, unitCost: 28, shelfLifeDays: 365, supplier: DRY },
  { sku: "SPC-001", name: "Spice blend (ginger, garlic, hwentia, rosemary)", unit: "kg", storage: "dry", opening: 3, reorderLevel: 1, unitCost: 80, shelfLifeDays: 180, supplier: CK },
  { sku: "PKG-PZ-S", name: "Pizza box — small", unit: "pcs", storage: "packaging", opening: 80, reorderLevel: 25, unitCost: 2.5, shelfLifeDays: 3650, supplier: PKG },
  { sku: "PKG-PZ-M", name: "Pizza box — medium", unit: "pcs", storage: "packaging", opening: 120, reorderLevel: 35, unitCost: 3, shelfLifeDays: 3650, supplier: PKG },
  { sku: "PKG-PZ-L", name: "Pizza box — large/jumbo", unit: "pcs", storage: "packaging", opening: 90, reorderLevel: 30, unitCost: 3.5, shelfLifeDays: 3650, supplier: PKG },
  { sku: "PKG-BKT", name: "Chicken bucket", unit: "pcs", storage: "packaging", opening: 120, reorderLevel: 30, unitCost: 2.2, shelfLifeDays: 3650, supplier: PKG },
  { sku: "PKG-RC", name: "Rice bowl & lid", unit: "pcs", storage: "packaging", opening: 220, reorderLevel: 60, unitCost: 1.2, shelfLifeDays: 3650, supplier: PKG },
  { sku: "PKG-BAG", name: "Carrier bag", unit: "pcs", storage: "packaging", opening: 300, reorderLevel: 80, unitCost: 0.6, shelfLifeDays: 3650, supplier: PKG },
  { sku: "DRK-COK", name: "Coke 0.45 L", unit: "pcs", storage: "drinks", opening: 72, reorderLevel: 24, unitCost: 9, shelfLifeDays: 270, supplier: BEV },
  { sku: "DRK-WTR", name: "Bottle water", unit: "pcs", storage: "drinks", opening: 60, reorderLevel: 20, unitCost: 2.5, shelfLifeDays: 365, supplier: BEV },
  { sku: "DRK-MLT", name: "Malt", unit: "pcs", storage: "drinks", opening: 48, reorderLevel: 16, unitCost: 12, shelfLifeDays: 270, supplier: BEV },
  { sku: "DRK-SOB", name: "Tealeys Sobolo", unit: "pcs", storage: "drinks", opening: 30, reorderLevel: 10, unitCost: 15, shelfLifeDays: 30, supplier: BEV },
];

export const INGREDIENT_BY_SKU = new Map(INGREDIENTS.map((i) => [i.sku, i]));

/**
 * Food-safety threshold profile. These defaults are DEMO placeholders that
 * mirror widely used HACCP reference points; each branch must replace them
 * with limits from its approved food-safety procedures and Ghana FDA guidance.
 */
export interface SafetyProfile {
  name: string;
  chilledMaxC: number;
  frozenMaxC: number;
  hotHoldingMinC: number;
  cookCoreMinC: number;
  oilQualityMinPct: number;
  /** Minutes a reading must stay out of range before an alert opens. */
  alertDelayMin: number;
  cleaningIntervalMin: number;
}

export const DEFAULT_SAFETY_PROFILE: SafetyProfile = {
  name: "Demo profile — replace with approved procedures",
  chilledMaxC: 5,
  frozenMaxC: -15,
  hotHoldingMinC: 63,
  cookCoreMinC: 75,
  oilQualityMinPct: 30,
  alertDelayMin: 5,
  cleaningIntervalMin: 120,
};
