import { createHmac } from "node:crypto";

/**
 * Simulated hardware fleet ("virtual" devices, POS terminals and the simulator heartbeat).
 *
 * Instead of hundreds of per-device keys, every virtual device signs with a key derived
 * from one server secret: key = hex HMAC-SHA256(VIRTUAL_FLEET_SECRET, id). The server and
 * scripts/hardware-sim.ts derive the same key; the fleet secret itself never leaves the
 * server environment / .env.local. Physical devices keep their own keys (DEVICE_KEYS).
 */
export const FLEET_SECRET_MIN_LENGTH = 32;

/** Id the hardware simulator signs its status heartbeat with. */
export const SIMULATOR_ID = "hardware-sim";

export function deriveVirtualKey(fleetSecret: string, id: string): string {
  return createHmac("sha256", fleetSecret).update(id).digest("hex");
}

/** The derived key for a virtual device / terminal, or null when the fleet secret is not configured. */
export function virtualKey(id: string, fleetSecret = process.env.VIRTUAL_FLEET_SECRET): string | null {
  if (!fleetSecret || fleetSecret.length < FLEET_SECRET_MIN_LENGTH) return null;
  return deriveVirtualKey(fleetSecret, id);
}
