/**
 * Shape of src/data/devices.virtual.json — the simulated hardware fleet.
 *
 * The integration hub only reads the binding fields (DeviceBinding) and the `virtual` flag.
 * The `hardware` block is the simulator's physical model of that device; the server ignores it.
 */
import type { Metric } from "../../src/lib/integration/contracts";

export type HardwareKind = "cold-air" | "frozen-air" | "hot-air" | "oil" | "door" | "controller" | "food-probe";

export interface HardwareProfile {
  kind: HardwareKind;
  /** Floor-plan equipment type the device is installed on (for the physical model). */
  equipmentType: string;
  /** Equipment setpoint (°C) from the floor-plan catalogue, where relevant. */
  setpointC?: number;
  radio: "lorawan" | "wifi" | "ble" | "ethernet";
  firmware: string;
  /** Battery-powered devices report battery_pct; mains devices omit it. */
  battery?: { startPct: number; /** Nominal life at the configured interval. */ lifeDays: number };
  /** Median signal strength at the installation point. */
  rssiDbm: number;
  /** Thermal model (air-temperature probes). Rates are °C per minute. */
  thermal?: {
    /** Room temperature around the cabinet. */
    ambientC: number;
    /** Warm-up rate towards ambient with the compressor/heater off, per °C of difference. */
    leakPerMin: number;
    /** Cooling (or heating) rate with the compressor/heater running. */
    drivePerMin: number;
    /** Thermostat switching band around the setpoint. */
    hysteresisC: number;
    /** Defrost cycle (freezers / walk-ins). */
    defrost?: { everyHours: number; minutes: number; heatPerMin: number };
    /** Door openings per hour at peak demand (0 for sealed cabinets). */
    doorOpensPerPeakHour: number;
    /** Temperature gain per second with the door open (warm air ingress). */
    doorGainPerSec: number;
  };
  /** Fryer oil model: quality loss per cooking load and when the oil is changed. */
  oil?: { lossPerLoadPct: number; loadsPerPeakHour: number; changeBelowPct: number };
  /** Packet loss probability per uplink. */
  lossRate: number;
}

export interface VirtualDeviceEntry {
  deviceId: string;
  branchId: string;
  equipmentId?: string;
  sensorCode?: string;
  metric: Metric;
  calibrationOffset: number;
  expectedIntervalSec: number;
  model: string;
  installedAt: string;
  lastCalibratedAt: string;
  virtual: true;
  hardware: HardwareProfile;
}

export interface VirtualTerminalEntry {
  sourceId: string;
  branchId: string;
  name: string;
  model: string;
  equipmentId?: string;
  virtual: true;
  /** Order channels this terminal takes and its share of the branch's demand. */
  channels: Array<"walk-in" | "pos" | "online" | "chris-b-app" | "phone" | "delivery-partner">;
  demandShare: number;
}

export interface VirtualCameraEntry {
  cameraId: string;
  branchId: string;
  name: string;
  virtualCameraId: string;
  protocol: "mjpeg";
  streamPath: string;
  enabled: boolean;
  virtual: true;
}

export interface VirtualFleetFile {
  _comment: string;
  generatedBy: string;
  branches: Array<{ branchId: string; name: string; slug: string; floorPlan: string }>;
  devices: VirtualDeviceEntry[];
  posTerminals: VirtualTerminalEntry[];
  cameras: VirtualCameraEntry[];
  /** Staff badges (see WearableBinding in src/lib/integration/contracts.ts). */
  wearables?: import("../../src/lib/integration/contracts").WearableBinding[];
}
