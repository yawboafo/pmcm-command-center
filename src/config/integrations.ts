/**
 * What has to be connected to turn the prototype into a working operations platform for a
 * tenant. Shown in the start-up notice and in Settings. `status` describes this codebase:
 * "ready" = the receiving side is built and tested (contract, signed endpoint, UI); "designed" =
 * documented in docs/INTEGRATION.md / ARCHITECTURE.md but not built; "todo" = not started.
 */
export type IntegrationStatus = "ready" | "designed" | "todo";

export interface IntegrationItem {
  area: string;
  what: string;
  hardware: string;
  status: IntegrationStatus;
}

export const INTEGRATIONS: IntegrationItem[] = [
  { area: "Orders & POS", what: "Every order as it happens: ordering app, in-store POS, delivery partners", hardware: "Order webhooks from the ordering platform and POS (no new hardware)", status: "ready" },
  { area: "Kitchen display (KDS)", what: "Real station progress and prep times instead of modelled kitchen work", hardware: "Station bump screens / KDS with an events API", status: "todo" },
  { area: "Food-safety sensors", what: "Fridges, freezers, walk-ins, hot-holding, cooked-food core temperatures, door openings", hardware: "Wireless temperature probes (LoRaWAN or Wi-Fi), Bluetooth food probes, door sensors, a branch gateway", status: "ready" },
  { area: "Equipment & energy", what: "Fryer oil quality, oven / fryer status and faults, power draw", hardware: "Fryer oil-quality sensors, equipment controller feeds, CT-clamp energy monitors", status: "ready" },
  { area: "Cameras", what: "Live video next to the twin, for authorised roles", hardware: "ONVIF / RTSP IP cameras and a media gateway (MediaMTX, WebRTC)", status: "ready" },
  { area: "Staff location", what: "Where staff are on shift, for alert response and zoning", hardware: "UWB anchors and staff badges (or BLE beacons), plus the HR rota for badge assignment", status: "ready" },
  { area: "Inventory & supply", what: "Real stock levels, central-kitchen dispatches, supplier receipts", hardware: "Stock / ERP system and dispatch records (API integration)", status: "todo" },
  { area: "Delivery tracking", what: "Rider position and hand-over times", hardware: "Rider app GPS or delivery-partner tracking feeds", status: "todo" },
  { area: "Branch connectivity & power", what: "Keep data flowing through outages", hardware: "4G backup router and UPS per branch; NTP time sync on devices", status: "designed" },
  { area: "Platform back end", what: "Always-on ingestion, history and alerts even with no console open", hardware: "MQTT broker with mTLS, event stream, time-series database, SSO with role-based access and audit log", status: "designed" },
  { area: "Branch layouts", what: "Each twin matching its real restaurant", hardware: "Site survey or 3D scan of each branch; branded storefront and interior models", status: "todo" },
];

export const STATUS_LABEL: Record<IntegrationStatus, string> = { ready: "Ready to connect", designed: "Designed", todo: "Not started" };
