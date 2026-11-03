import type { EquipmentCategory, EquipmentType, FurnitureType, Interaction, Vec3 } from "./types";

interface EquipmentSpec {
  label: string;
  category: EquipmentCategory;
  size: Vec3;
  /** Base elevation for wall/ceiling-mounted items. */
  elevation?: number;
  setpointC?: number;
  capacity?: number;
  maintenanceIntervalDays?: number;
  inspect: Interaction["inspect"];
  /** Elevated items do not block floor circulation. */
  elevated?: boolean;
}

/**
 * Equipment catalogue with typical commercial footprints (metres).
 * Dimensions are generic industry sizes, not measured from any branch.
 */
export const EQUIPMENT_CATALOG: Record<EquipmentType, EquipmentSpec> = {
  "conveyor-oven": { label: "Conveyor Pizza Oven", category: "cooking", size: [2.0, 1.6, 1.0], setpointC: 260, capacity: 4, maintenanceIntervalDays: 30, inspect: ["status", "temperature", "orders", "maintenance", "cleaning"] },
  "deck-oven": { label: "Deck Oven", category: "cooking", size: [1.4, 1.6, 1.0], setpointC: 280, capacity: 2, maintenanceIntervalDays: 30, inspect: ["status", "temperature", "orders", "maintenance"] },
  fryer: { label: "Twin-Basket Fryer", category: "cooking", size: [0.9, 1.1, 0.8], setpointC: 175, capacity: 2, maintenanceIntervalDays: 14, inspect: ["status", "temperature", "orders", "maintenance", "cleaning"] },
  "pizza-makeline": { label: "Refrigerated Pizza Make-Line", category: "preparation", size: [2.0, 1.0, 0.8], setpointC: 4, capacity: 2, inspect: ["status", "temperature", "orders", "inventory", "cleaning"] },
  "dough-table": { label: "Dough Table", category: "preparation", size: [1.8, 0.9, 0.8], capacity: 1, inspect: ["status", "cleaning"] },
  "prep-table": { label: "Stainless Prep Table", category: "preparation", size: [1.8, 0.9, 0.75], capacity: 1, inspect: ["status", "orders", "cleaning"] },
  "breading-station": { label: "Breading & Marination Station", category: "preparation", size: [1.5, 0.95, 0.75], capacity: 1, inspect: ["status", "orders", "cleaning"] },
  "rice-stove": { label: "Rice Pot Stove", category: "cooking", size: [1.6, 0.9, 0.8], setpointC: 100, capacity: 2, maintenanceIntervalDays: 30, inspect: ["status", "temperature", "orders", "maintenance"] },
  "rice-warmer": { label: "Rice Hot-Holding Warmer", category: "cooking", size: [1.2, 1.0, 0.7], setpointC: 70, capacity: 3, inspect: ["status", "temperature", "orders", "inventory"] },
  "hot-holding": { label: "Hot-Holding Cabinet", category: "cooking", size: [1.2, 1.4, 0.7], setpointC: 70, capacity: 6, inspect: ["status", "temperature", "orders"] },
  "packaging-table": { label: "Packaging Table", category: "service", size: [1.8, 0.95, 0.8], capacity: 2, inspect: ["status", "orders", "inventory"] },
  "qc-pass": { label: "Heated QC Pass", category: "service", size: [1.5, 1.4, 0.6], setpointC: 65, capacity: 3, inspect: ["status", "temperature", "orders"] },
  "dispatch-rack": { label: "Delivery Dispatch Rack", category: "service", size: [1.6, 1.8, 0.5], capacity: 8, inspect: ["status", "orders"] },
  fridge: { label: "Upright Refrigerator", category: "refrigeration", size: [0.75, 2.0, 0.8], setpointC: 3, maintenanceIntervalDays: 90, inspect: ["status", "temperature", "inventory", "maintenance"] },
  freezer: { label: "Upright Freezer", category: "refrigeration", size: [0.75, 2.0, 0.8], setpointC: -18, maintenanceIntervalDays: 90, inspect: ["status", "temperature", "inventory", "maintenance"] },
  "walk-in-cold": { label: "Cold Room Evaporator", category: "refrigeration", size: [1.2, 0.45, 0.55], elevation: 2.35, setpointC: 3, maintenanceIntervalDays: 90, inspect: ["status", "temperature", "inventory", "maintenance"], elevated: true },
  "walk-in-freezer": { label: "Freezer Room Evaporator", category: "refrigeration", size: [1.2, 0.45, 0.55], elevation: 2.35, setpointC: -18, maintenanceIntervalDays: 90, inspect: ["status", "temperature", "inventory", "maintenance"], elevated: true },
  shelving: { label: "Storage Shelving", category: "storage", size: [1.2, 1.9, 0.5], inspect: ["inventory"] },
  sink: { label: "Three-Compartment Sink", category: "sanitation", size: [1.2, 0.95, 0.65], inspect: ["status", "cleaning"] },
  handwash: { label: "Handwash Basin", category: "sanitation", size: [0.5, 0.9, 0.45], inspect: ["status", "cleaning"] },
  dishwasher: { label: "Hood Dishwasher", category: "sanitation", size: [0.7, 1.5, 0.75], maintenanceIntervalDays: 60, inspect: ["status", "maintenance", "cleaning"] },
  hood: { label: "Extraction Hood", category: "ventilation", size: [2.0, 0.55, 1.1], elevation: 2.15, maintenanceIntervalDays: 90, inspect: ["status", "maintenance", "cleaning"], elevated: true },
  "pos-counter": { label: "Ordering Counter (POS)", category: "service", size: [3.0, 1.05, 0.7], capacity: 2, inspect: ["status", "orders"] },
  "pickup-counter": { label: "Collection Counter", category: "service", size: [1.8, 1.05, 0.6], capacity: 4, inspect: ["status", "orders"] },
  "menu-board": { label: "Digital Menu Board", category: "service", size: [3.0, 0.9, 0.08], elevation: 2.05, inspect: ["status"], elevated: true },
  "drinks-fridge": { label: "Drinks Display Fridge", category: "refrigeration", size: [0.7, 2.0, 0.7], setpointC: 4, maintenanceIntervalDays: 90, inspect: ["status", "temperature", "inventory"] },
  desk: { label: "Manager Workstation", category: "office", size: [1.2, 0.75, 0.6], inspect: ["status"] },
  lockers: { label: "Staff Lockers", category: "office", size: [1.2, 1.9, 0.5], inspect: ["status"] },
  toilet: { label: "WC", category: "sanitation", size: [0.45, 0.8, 0.7], inspect: ["cleaning"] },
  "waste-bins": { label: "Segregated Waste Bins", category: "waste", size: [1.4, 1.0, 0.6], inspect: ["status", "cleaning"] },
  "mop-sink": { label: "Mop Sink & Cleaning Store", category: "sanitation", size: [0.6, 0.6, 0.6], inspect: ["cleaning"] },
};

export const FURNITURE_CATALOG: Record<FurnitureType, { label: string; size: Vec3; seats: number }> = {
  "table-2": { label: "Table for 2", size: [0.8, 0.75, 1.5], seats: 2 },
  "table-4": { label: "Table for 4", size: [1.3, 0.75, 1.7], seats: 4 },
  "booth-4": { label: "Booth for 4", size: [1.4, 1.1, 1.9], seats: 4 },
  bench: { label: "Bench", size: [1.6, 0.45, 0.45], seats: 3 },
  "stool-bar": { label: "Window Bar + Stools", size: [2.4, 1.05, 0.9], seats: 4 },
  "waiting-bench": { label: "Waiting Bench", size: [1.8, 0.45, 0.5], seats: 3 },
  plant: { label: "Planter", size: [0.5, 1.2, 0.5], seats: 0 },
};

export function isElevated(type: EquipmentType): boolean {
  return !!EQUIPMENT_CATALOG[type].elevated;
}
