/**
 * Floor plan schema — the single source of truth for a restaurant layout.
 *
 * One FloorPlan JSON drives the 2D architectural view, the 3D digital twin,
 * the virtual camera network, the kitchen workflow engine and the food-safety
 * sensor layer. Coordinates are metres. The building origin (0,0) is its
 * south-west corner; +x runs east along `width`, +z runs north along `length`.
 * 3D positions are [x, y, z] with y up.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type FloorPlanFormat = "A" | "B" | "C" | "custom";

export type RoomType =
  | "dining"
  | "customer"
  | "counter"
  | "kitchen"
  | "pizza"
  | "chicken"
  | "rice"
  | "packaging"
  | "dispatch"
  | "cold"
  | "freezer"
  | "dry"
  | "wash"
  | "staff"
  | "toilet"
  | "office"
  | "waste"
  | "corridor";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** Axis-aligned rectangle: min corner (x, z) and size (w along x, d along z). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Food-safety zoning used to keep raw handling away from cooked packaging. */
  hygieneZone: "public" | "raw" | "cooked" | "storage" | "support";
}

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  /** Bottom elevation; non-zero for wall above a window head. */
  base?: number;
  exterior: boolean;
}

export type OpeningAxis = "x" | "z";

export interface Door {
  id: string;
  name: string;
  /** Centre of the opening. */
  x: number;
  z: number;
  width: number;
  /** Axis the wall runs along ("x" = wall parallel to the x axis). */
  axis: OpeningAxis;
  kind: "entrance" | "internal" | "staff" | "emergency" | "delivery";
}

export interface WindowOpening {
  id: string;
  x: number;
  z: number;
  width: number;
  axis: OpeningAxis;
  sill: number;
  height: number;
}

export type EquipmentType =
  | "conveyor-oven"
  | "deck-oven"
  | "fryer"
  | "pizza-makeline"
  | "dough-table"
  | "prep-table"
  | "breading-station"
  | "rice-stove"
  | "rice-warmer"
  | "hot-holding"
  | "packaging-table"
  | "qc-pass"
  | "dispatch-rack"
  | "fridge"
  | "freezer"
  | "walk-in-cold"
  | "walk-in-freezer"
  | "shelving"
  | "sink"
  | "handwash"
  | "dishwasher"
  | "hood"
  | "pos-counter"
  | "pickup-counter"
  | "menu-board"
  | "drinks-fridge"
  | "desk"
  | "lockers"
  | "toilet"
  | "waste-bins"
  | "mop-sink";

export type EquipmentCategory =
  | "cooking"
  | "preparation"
  | "refrigeration"
  | "storage"
  | "sanitation"
  | "service"
  | "office"
  | "ventilation"
  | "waste";

export interface Interaction {
  /** What clicking the object opens in the inspector. */
  inspect: Array<"status" | "temperature" | "inventory" | "orders" | "maintenance" | "cleaning">;
  focusDistance: number;
}

export interface Equipment {
  id: string;
  type: EquipmentType;
  name: string;
  category: EquipmentCategory;
  roomId: string;
  position: Vec3;
  /** Rotation about Y in radians. 0 = front faces +z. */
  rotation: number;
  /** [width (x), height (y), depth (z)] before rotation. */
  size: Vec3;
  workstationId?: string;
  operational: {
    powered: boolean;
    /** Target temperature in °C for cooking or cold equipment, if relevant. */
    setpointC?: number;
    capacity?: number;
    maintenanceIntervalDays?: number;
  };
  interaction: Interaction;
}

export type FurnitureType = "table-2" | "table-4" | "booth-4" | "bench" | "stool-bar" | "waiting-bench" | "plant";

export interface Furniture {
  id: string;
  type: FurnitureType;
  roomId: string;
  position: Vec3;
  rotation: number;
  size: Vec3;
  seats: number;
}

export type WorkstationType =
  | "order-counter"
  | "pizza-prep"
  | "oven"
  | "chicken-prep"
  | "fryer"
  | "rice"
  | "qc"
  | "packaging"
  | "pickup"
  | "dispatch"
  | "dish"
  | "storage";

export interface Workstation {
  id: string;
  name: string;
  type: WorkstationType;
  roomId: string;
  equipmentIds: string[];
  /** Where a staff member stands to operate the station. */
  standPoint: Vec2;
  /** Parallel jobs the station can run (e.g. fryer baskets, oven slots). */
  capacity: number;
}

export interface VirtualCamera {
  id: string;
  code: string;
  name: string;
  roomId: string;
  position: Vec3;
  target: Vec3;
  fov: number;
  workstationIds: string[];
}

export type SensorKind =
  | "fridge-temp"
  | "freezer-temp"
  | "hot-holding-temp"
  | "cook-temp-check"
  | "oil-quality"
  | "equipment-health"
  | "cleaning-checklist"
  | "storage-inspection"
  | "handwash-compliance";

export interface Sensor {
  id: string;
  code: string;
  name: string;
  kind: SensorKind;
  roomId: string;
  equipmentId?: string;
  position: Vec3;
  unit?: "°C" | "%" | "status";
  /** Thresholds come from the branch safety profile; this names which profile entry applies. */
  thresholdProfile?: string;
}

export interface NavigationPath {
  id: string;
  name: string;
  kind: "customer" | "staff" | "delivery" | "emergency";
  points: Vec2[];
}

/** Ordered links that describe how product moves between stations for each menu workflow. */
export interface WorkflowLink {
  from: WorkstationType;
  to: WorkstationType;
  flow: "pizza" | "chicken" | "rice" | "all";
}

export interface FloorPlan {
  schemaVersion: 1;
  restaurantId: string;
  name: string;
  format: FloorPlanFormat;
  /** Always true for generated templates — they are not surveyed branch plans. */
  conceptual: boolean;
  provenance: string;
  dimensions: { width: number; length: number; height: number };
  /** Street frontage side used to place the facade, signage and car park. */
  frontage: "south";
  rooms: Room[];
  /** Pairs of room ids with no wall between them (open counters, open kitchens). */
  openings: Array<[string, string]>;
  walls: Wall[];
  doors: Door[];
  windows: WindowOpening[];
  equipment: Equipment[];
  furniture: Furniture[];
  workstations: Workstation[];
  cameras: VirtualCamera[];
  sensors: Sensor[];
  navigationPaths: NavigationPath[];
  workflow: WorkflowLink[];
  /** Customer-side anchor points used by the simulation. */
  anchors: {
    outside: Vec2;
    entrance: Vec2;
    queueHead: Vec2;
    queueDir: Vec2;
    waiting: Vec2;
    pickup: Vec2;
    riderDoor: Vec2;
    riderWait: Vec2;
    staffRest: Vec2;
  };
}
