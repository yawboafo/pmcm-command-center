/**
 * Generates the simulated hardware fleet registry, src/data/devices.virtual.json.
 *
 * Binds a virtual device to every monitorable piece of equipment in the three demo
 * branches (East Legon / Model C, Spintex / Model B, KNUST / Model A), with realistic
 * models, reporting intervals, calibration offsets and a physical model for
 * scripts/hardware-sim.ts. Also registers virtual POS terminals and the East Legon
 * simulated cameras. Deterministic: re-running produces the same file.
 *
 *   npx tsx scripts/generate-fleet.ts            (or: npm run generate:fleet)
 *
 * Keys are not stored here: each device signs with HMAC(VIRTUAL_FLEET_SECRET, deviceId).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Equipment, FloorPlan } from "../src/lib/floorplan/types";
import { EQUIPMENT_CATALOG } from "../src/lib/floorplan/catalog";
import { BRANCH_BY_ID, demoBranchIds } from "../src/lib/network/branches";
import { hashString, Rng } from "../src/lib/sim/rng";
import type { HardwareProfile, VirtualCameraEntry, VirtualDeviceEntry, VirtualFleetFile, VirtualTerminalEntry } from "./lib/fleet-spec";

const root = join(__dirname, "..");
const plan = (format: string): FloorPlan => JSON.parse(readFileSync(join(root, "src", "data", "floorplans", `model-${format.toLowerCase()}.json`), "utf8"));
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Installation and calibration dates (pilot installation, recalibrated on a 90-day cycle). */
function dates(rng: Rng) {
  const installed = new Date(Date.UTC(2026, 6, 1 + rng.int(0, 20)));
  const calibrated = new Date(Date.UTC(2026, 9, 1 + rng.int(0, 28)));
  return { installedAt: installed.toISOString().slice(0, 10), lastCalibratedAt: calibrated.toISOString().slice(0, 10) };
}

const AIR_COLD = new Set(["fridge", "drinks-fridge", "pizza-makeline", "walk-in-cold"]);
const AIR_FROZEN = new Set(["freezer", "walk-in-freezer"]);
const AIR_HOT = new Set(["hot-holding", "rice-warmer", "qc-pass"]);

function airProfile(e: Equipment, rng: Rng): { hw: HardwareProfile; model: string; interval: number } {
  const sp = e.operational.setpointC ?? EQUIPMENT_CATALOG[e.type].setpointC ?? 3;
  const walkIn = e.type.startsWith("walk-in");
  const lora = walkIn || e.type === "freezer" || e.type === "fridge";
  const radio = lora ? "lorawan" : "wifi";
  const kitchenAmbient = 29 + rng.range(-1.5, 2.5); // Accra kitchen, hot line nearby
  if (AIR_HOT.has(e.type)) {
    return {
      model: "SIM · Wi-Fi high-temperature probe, PT1000, 0…150 °C",
      interval: 60,
      hw: {
        kind: "hot-air",
        equipmentType: e.type,
        setpointC: sp,
        radio: "wifi",
        firmware: `hth-${rng.pick(["2.1.4", "2.1.6", "2.2.0"])}`,
        rssiDbm: Math.round(rng.range(-68, -52)),
        thermal: { ambientC: kitchenAmbient, leakPerMin: 0.008, drivePerMin: e.type === "qc-pass" ? 1.2 : 1.0, hysteresisC: e.type === "qc-pass" ? 1.0 : 1.5, doorOpensPerPeakHour: e.type === "qc-pass" ? 60 : 30, doorGainPerSec: -0.04 },
        lossRate: 0.01,
      },
    };
  }
  const frozen = AIR_FROZEN.has(e.type);
  return {
    model: lora ? `SIM · LoRaWAN cold-chain probe, NTC, −40…+85 °C, IP67` : "SIM · Wi-Fi refrigeration probe, NTC, −30…+70 °C",
    interval: walkIn ? 60 : 120,
    hw: {
      kind: frozen ? "frozen-air" : "cold-air",
      equipmentType: e.type,
      setpointC: sp,
      radio,
      firmware: lora ? `lw-ct-${rng.pick(["3.4.1", "3.4.2", "3.5.0"])}` : `wf-ct-${rng.pick(["1.9.3", "2.0.1"])}`,
      battery: { startPct: Math.round(rng.range(55, 100)), lifeDays: lora ? 3 * 365 : 365 },
      rssiDbm: Math.round(walkIn ? rng.range(-108, -92) : lora ? rng.range(-96, -80) : rng.range(-72, -55)),
      thermal: {
        ambientC: e.type === "drinks-fridge" ? 27 + rng.range(-1, 1.5) : kitchenAmbient,
        // Large insulated rooms leak slowly; display fridges with glass doors leak fastest.
        leakPerMin: walkIn ? 0.0035 : e.type === "drinks-fridge" ? 0.009 : e.type === "pizza-makeline" ? 0.012 : frozen ? 0.0045 : 0.006,
        drivePerMin: walkIn ? 0.35 : frozen ? 0.45 : 0.55,
        hysteresisC: frozen ? 2.0 : 1.2,
        // Defrost heat is kept modest: the air probe sits away from the evaporator, so it sees a small rise only.
        defrost: frozen ? { everyHours: 6, minutes: walkIn ? 12 : 10, heatPerMin: 0.05 } : walkIn ? { everyHours: 8, minutes: 15, heatPerMin: 0.03 } : undefined,
        doorOpensPerPeakHour: e.type === "pizza-makeline" ? 90 : e.type === "drinks-fridge" ? 40 : walkIn ? 14 : 20,
        doorGainPerSec: walkIn ? 0.012 : e.type === "pizza-makeline" ? 0.006 : 0.02,
      },
      lossRate: walkIn ? 0.06 : lora ? 0.03 : 0.015,
    },
  };
}

function build(): VirtualFleetFile {
  const devices: VirtualDeviceEntry[] = [];
  const posTerminals: VirtualTerminalEntry[] = [];
  const cameras: VirtualCameraEntry[] = [];
  const branches: VirtualFleetFile["branches"] = [];

  for (const branchId of demoBranchIds()) {
    const b = BRANCH_BY_ID.get(branchId)!;
    const slug = slugOf(b.name);
    const p = plan(b.floorPlanType);
    branches.push({ branchId, name: b.name, slug, floorPlan: `model-${b.floorPlanType.toLowerCase()}` });
    const dev = (suffix: string, e: { id: string } | null, d: Omit<VirtualDeviceEntry, "deviceId" | "branchId" | "virtual" | "installedAt" | "lastCalibratedAt">, rng: Rng) => {
      const deviceId = `v-${slug}-${e ? e.id : "qc"}-${suffix}`;
      devices.push({ deviceId, branchId, ...(e ? { equipmentId: e.id } : {}), ...d, ...dates(rng), virtual: true });
    };

    for (const e of p.equipment) {
      const rng = new Rng(hashString(`${branchId}:${e.id}`));
      if (AIR_COLD.has(e.type) || AIR_FROZEN.has(e.type) || AIR_HOT.has(e.type)) {
        const a = airProfile(e, rng);
        // Calibration certificate offset: small, probe-specific.
        dev("temp", e, { metric: "temperature_c", calibrationOffset: r2(rng.range(-0.35, 0.35)), expectedIntervalSec: a.interval, model: a.model, hardware: a.hw }, rng);
      }
      if (e.type === "walk-in-cold" || e.type === "walk-in-freezer") {
        dev("door", e, {
          metric: "door_open",
          calibrationOffset: 0,
          expectedIntervalSec: 300,
          model: "SIM · LoRaWAN magnetic door contact (event + 5 min heartbeat)",
          hardware: { kind: "door", equipmentType: e.type, radio: "lorawan", firmware: `lw-dc-${rng.pick(["1.2.0", "1.2.2"])}`, battery: { startPct: Math.round(rng.range(60, 100)), lifeDays: 5 * 365 }, rssiDbm: Math.round(rng.range(-104, -88)), lossRate: 0.04 },
        }, rng);
      }
      if (e.type === "fryer") {
        dev("oil", e, {
          metric: "oil_quality_pct",
          calibrationOffset: r2(rng.range(-1.5, 1.5)),
          expectedIntervalSec: 300,
          model: "SIM · inline total-polar-material oil sensor (TPM → quality %)",
          hardware: { kind: "oil", equipmentType: e.type, setpointC: 175, radio: "ethernet", firmware: `tpm-${rng.pick(["4.0.2", "4.1.0"])}`, rssiDbm: -40, oil: { lossPerLoadPct: rng.range(0.55, 0.8), loadsPerPeakHour: 9, changeBelowPct: 32 }, lossRate: 0.005 },
        }, rng);
      }
      if (e.type === "fryer" || e.type === "conveyor-oven" || e.type === "deck-oven") {
        dev("ctl", e, {
          metric: "status",
          calibrationOffset: 0,
          expectedIntervalSec: 120,
          model: e.type === "fryer" ? "SIM · fryer controller gateway (Modbus → Wi-Fi), fault relay" : "SIM · oven controller gateway (Modbus → Ethernet), burner/belt fault relay",
          hardware: { kind: "controller", equipmentType: e.type, setpointC: e.operational.setpointC, radio: e.type === "fryer" ? "wifi" : "ethernet", firmware: `ctl-${rng.pick(["5.3.0", "5.3.1"])}`, rssiDbm: e.type === "fryer" ? Math.round(rng.range(-70, -58)) : -40, lossRate: 0.01 },
        }, rng);
      }
    }

    // QC food probes: Bluetooth probe paired with the QC tablet; bound by sensor code.
    p.sensors
      .filter((s) => s.kind === "cook-temp-check")
      .forEach((s, i) => {
        const rng = new Rng(hashString(`${branchId}:${s.code}`));
        devices.push({
          deviceId: `v-${slug}-qc-probe-${i + 1}`,
          branchId,
          sensorCode: s.code,
          metric: "probe_temperature_c",
          calibrationOffset: r2(rng.range(-0.3, 0.3)),
          expectedIntervalSec: 1800,
          model: "SIM · Bluetooth food core probe via QC tablet app",
          ...dates(rng),
          virtual: true,
          hardware: { kind: "food-probe", equipmentType: "qc-probe", setpointC: 75, radio: "ble", firmware: `qc-app-${rng.pick(["1.8.0", "1.8.2"])}`, battery: { startPct: Math.round(rng.range(40, 100)), lifeDays: 30 }, rssiDbm: Math.round(rng.range(-75, -60)), lossRate: 0.01 },
        });
      });

    // POS terminals on each ordering counter, plus the branch's online-ordering feed.
    const counters = p.equipment.filter((e) => e.type === "pos-counter");
    counters.forEach((e, i) =>
      posTerminals.push({ sourceId: `vpos-${slug}-${String(i + 1).padStart(2, "0")}`, branchId, name: `${b.name} counter POS ${i + 1} (simulated)`, model: "SIM · counter POS terminal", equipmentId: e.id, virtual: true, channels: ["walk-in", "pos"], demandShare: 0.5 / counters.length }),
    );
    posTerminals.push({ sourceId: `vapp-${slug}`, branchId, name: `${b.name} online ordering feed (simulated Chris B / partners)`, model: "SIM · ordering-platform webhook", virtual: true, channels: ["chris-b-app", "online", "phone", "delivery-partner"], demandShare: 0.5 });

    // Simulated cameras at the pose of selected virtual (3D) cameras — East Legon only.
    if (branchId === "branch-015") {
      const wanted = ["Restaurant Entrance", "Customer Counter 1", "Pizza Oven 1", "Frying Station 1", "Delivery Dispatch", "Cold Storage"];
      for (const name of wanted) {
        const c = p.cameras.find((x) => x.name === name);
        if (!c) continue;
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
        cameras.push({ cameraId: `vcam-${slug}-${key}`, branchId, name: `${name} (simulated)`, virtualCameraId: c.id, protocol: "mjpeg", streamPath: `${slug}/${key}`, enabled: true, virtual: true });
      }
    }
  }

  return {
    _comment:
      "GENERATED by scripts/generate-fleet.ts — do not edit by hand. Simulated hardware fleet: every entry is virtual (data shows as SIM DEVICE / SIM CAMERA, never LIVE). Devices sign with HMAC(VIRTUAL_FLEET_SECRET, deviceId); run with `npm run hardware:sim` and `npm run camera:sim`. The `hardware` blocks are the simulator's physical model and are ignored by the server.",
    generatedBy: "scripts/generate-fleet.ts",
    branches,
    devices,
    posTerminals,
    cameras,
  };
}

const fleet = build();
const out = join(root, "src", "data", "devices.virtual.json");
writeFileSync(out, JSON.stringify(fleet, null, 1) + "\n");
const per = fleet.branches.map((b) => `${b.name}: ${fleet.devices.filter((d) => d.branchId === b.branchId).length} devices, ${fleet.posTerminals.filter((t) => t.branchId === b.branchId).length} POS sources, ${fleet.cameras.filter((c) => c.branchId === b.branchId).length} cameras`);
console.log(`Wrote ${out}\n  ${per.join("\n  ")}\n  total ${fleet.devices.length} devices`);
