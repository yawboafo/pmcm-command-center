import type { Branch } from "../network/branches";

export type Role =
  | "system-admin"
  | "national-ops"
  | "regional-manager"
  | "branch-manager"
  | "kitchen-supervisor"
  | "food-safety-officer"
  | "inventory-manager"
  | "viewer";

export type Permission =
  | "view:branch"
  | "view:safety"
  | "act:safety"
  | "view:inventory"
  | "act:inventory"
  | "act:orders"
  | "edit:floorplan"
  | "control:simulation"
  | "view:cctv"
  /** See named staff positions (badge tracking). Personal data: managers and floor supervisors only. */
  | "view:staff-location"
  | "admin";

const ROLE_PERMS: Record<Role, Permission[]> = {
  "system-admin": ["view:branch", "view:safety", "act:safety", "view:inventory", "act:inventory", "act:orders", "edit:floorplan", "control:simulation", "view:cctv", "view:staff-location", "admin"],
  "national-ops": ["view:branch", "view:safety", "act:safety", "view:inventory", "act:inventory", "act:orders", "control:simulation", "edit:floorplan", "view:staff-location"],
  "regional-manager": ["view:branch", "view:safety", "act:safety", "view:inventory", "act:inventory", "act:orders", "control:simulation", "view:staff-location"],
  "branch-manager": ["view:branch", "view:safety", "act:safety", "view:inventory", "act:inventory", "act:orders", "control:simulation", "view:staff-location"],
  "kitchen-supervisor": ["view:branch", "view:safety", "act:safety", "view:inventory", "act:orders", "view:staff-location"],
  "food-safety-officer": ["view:branch", "view:safety", "act:safety"],
  "inventory-manager": ["view:branch", "view:inventory", "act:inventory"],
  viewer: ["view:branch", "view:safety", "view:inventory"],
};

export interface DemoUser {
  id: string;
  name: string;
  role: Role;
  roleLabel: string;
  scope: { all: true } | { regions: string[] } | { branchIds: string[] };
}

/**
 * Demo identities for exploring branch-scoped access in the prototype.
 * In production these checks must be enforced server-side (see docs/ARCHITECTURE.md);
 * client-side checks only shape the UI.
 */
export const DEMO_USERS: DemoUser[] = [
  { id: "u-admin", name: "Demo Administrator", role: "system-admin", roleLabel: "System Administrator", scope: { all: true } },
  { id: "u-national", name: "National Ops (demo)", role: "national-ops", roleLabel: "National Operations Manager", scope: { all: true } },
  { id: "u-ashanti", name: "Ashanti Regional (demo)", role: "regional-manager", roleLabel: "Regional Manager — Ashanti", scope: { regions: ["Ashanti"] } },
  { id: "u-eastlegon", name: "East Legon Manager (demo)", role: "branch-manager", roleLabel: "Branch Manager — East Legon", scope: { branchIds: ["branch-015"] } },
  { id: "u-fso", name: "Food Safety Officer (demo)", role: "food-safety-officer", roleLabel: "Food Safety Officer", scope: { all: true } },
  { id: "u-inv", name: "Inventory Manager (demo)", role: "inventory-manager", roleLabel: "Inventory Manager", scope: { all: true } },
  { id: "u-viewer", name: "Read-only Viewer (demo)", role: "viewer", roleLabel: "Read-Only Viewer", scope: { all: true } },
];

export function can(user: DemoUser, p: Permission) {
  return ROLE_PERMS[user.role].includes(p);
}

export function canSeeBranch(user: DemoUser, b: Branch) {
  if ("all" in user.scope) return true;
  if ("regions" in user.scope) return user.scope.regions.includes(b.region);
  return user.scope.branchIds.includes(b.id);
}
