/**
 * Product vs customer branding. The platform is the software; the tenant is the restaurant
 * group using it as a service. Platform chrome (logo, title, loading screens, wire prefixes)
 * comes from PLATFORM; anything about the restaurant group (its name in the workspace switcher,
 * branch network, menu, storefront signage) comes from TENANT. Renaming the product is a
 * one-line change here; wire prefixes (`x-ops-*`, `ops/v1/…`) are deliberately brand-neutral.
 */
export const PLATFORM = {
  name: "Operations Ops",
  /** Short mark for the logo tile and compact labels. */
  mark: "OP",
  tagline: "Restaurant operations platform",
} as const;

export const TENANT = {
  id: "pizzaman-chickenman",
  name: "Pizzaman Chickenman",
  /** Compact label for tight spaces (filters, exports). */
  short: "PMCM",
  country: "Ghana",
  plan: "Prototype workspace",
} as const;

/**
 * UI labelling policy. The app always records where every value came from (LIVE, simulated,
 * simulated device); this only controls whether the "simulated" badges are drawn. The prototype
 * notice on start-up states once that operations, devices and cameras are simulated, so the
 * in-app badges are off. LIVE badges always show, so real data stands out once connected.
 */
export const UI_POLICY = {
  showSimulatedLabels: false,
} as const;
