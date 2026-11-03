# Integration guide — connecting real devices, cameras and order systems

The command center is built so that every simulated source can be replaced by a real one
without touching UI or business logic. External systems are translated at the edge into the
canonical contracts in `src/lib/integration/contracts.ts`; everything downstream (food-safety
limits, alert delays, the 3D twin, panels, analytics) consumes only those shapes.

**Provenance rule:** every value carries `source: "live" | "simulated"` and the UI shows a
LIVE or SIMULATED badge. A live sensor replaces the simulated value for that sensor only, and
its simulated history is discarded so charts never mix the two. Safety and alert logic is
source-agnostic: the same limits and delays apply to both.

## What exists in the prototype

| Piece | Where | Status |
|---|---|---|
| Device telemetry ingestion (signed HTTPS) | `POST /api/ingest/telemetry` | Working, tested |
| POS / ordering webhook (signed HTTPS) | `POST /api/ingest/pos` | Working, tested |
| In-process hub: de-duplication, bindings, calibration, replay buffer | `src/lib/integration/hub.ts` | Prototype stand-in for the production pipeline |
| Live stream to the console (SSE, `Last-Event-ID` resume) | `GET /api/stream/telemetry` (`reading` and `order` events) | Working |
| Browser client applying live data to the twin | `src/lib/integration/liveClient.ts` | Working |
| Device registry and camera registry | `src/data/devices.json` | Bench examples only |
| Integration health | `GET /api/integration/status`, Settings → Integrations | Working |
| WebRTC (WHEP) camera proxy + live player | `POST /api/cameras/{id}/whep`, `LiveCameraPlayer` | Unit-tested; not yet run against a real gateway |
| Bench tools | `scripts/device-sim.ts`, `scripts/pos-sim.ts` | Working |

The first live event (reading or order) switches the console from the demo clock to the real
wall clock at 1× and restarts open branch simulations on that timeline, so live and simulated
timelines never mix. A newly opened console only replays the last 5 minutes of buffered
events, so stale data never makes the console look live; a reconnecting console resumes from
its `Last-Event-ID` and gets everything still buffered.

## Device telemetry contract (`TelemetryMessage`, v1)

```json
{
  "v": 1,
  "messageId": "6f1c0e0a-5c1d-4d0f-9a43-2f7d1b9c8e11",
  "deviceId": "acc-eastlegon-coldroom-01",
  "ts": "2026-11-03T12:15:30Z",
  "readings": [{ "metric": "temperature_c", "value": 3.4 }],
  "battery_pct": 87,
  "rssi_dbm": -71,
  "firmware": "2.4.1"
}
```

- `messageId` must be unique per message; retries with the same id are acknowledged as
  duplicates (HTTP 200) and not applied twice.
- `ts` is the device clock. Devices and gateways **must be NTP-synchronised**; messages
  timestamped more than 2 minutes in the future are rejected (`clock_skew`).
- Metrics and units are fixed: `temperature_c`, `probe_temperature_c`, `oil_quality_pct`
  (100 = fresh oil), `door_open` (1/0), `power_w`, `humidity_pct`, `status` (1 OK / 0 fault).
  Multi-probe devices add `channel` per reading.

### Signing (HTTPS)

| Header | Value |
|---|---|
| `x-pmcm-device` | device id |
| `x-pmcm-timestamp` | Unix epoch milliseconds at signing |
| `x-pmcm-signature` | hex `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` |

Requests outside a ±5 minute window are rejected, which blocks replay of captured requests.
Responses: `202` accepted, `200` duplicate, `400` schema / clock skew, `401` unknown device,
bad signature or stale timestamp, `413` too large, `422` metric not bound for this device.

Per-device secrets live in the server environment as `DEVICE_KEYS='{"<deviceId>":"<secret ≥16 chars>"}'`
in the prototype. In production use a secrets manager and per-device X.509 certificates (mTLS).

### MQTT

Gateways that prefer MQTT publish the same JSON to `pmcm/v1/{branchCode}/{deviceId}/telemetry`
(QoS 1). In production an MQTT → ingestion bridge verifies the device certificate, then hands
the message to the same validation and binding code as the HTTPS route.

### Binding devices to the floor plan (`src/data/devices.json`)

```json
{ "deviceId": "acc-eastlegon-coldroom-01", "branchId": "branch-015", "equipmentId": "walk-in-cold-1",
  "metric": "temperature_c", "calibrationOffset": -0.2, "expectedIntervalSec": 60,
  "model": "…", "installedAt": "2026-12-01", "lastCalibratedAt": "2026-12-01" }
```

- Bind to `equipmentId` (stable across floor-plan edits) wherever possible. Use `sensorCode`
  (for example `SNS-034`) only for sensors not attached to equipment, such as a QC food probe;
  sensor codes can change when the editor re-places sensors.
- `calibrationOffset` is added to every raw value; take it from the latest calibration
  certificate and update it at each recalibration.
- A device is shown offline after 3 × `expectedIntervalSec` without data, and the twin raises a
  "sensor connectivity lost" alert for that sensor.
- Readings for equipment that does not exist in the branch floor plan are counted as
  "unmatched" on Settings → Integrations; fix the binding or the floor plan.

### Bench test

```bash
npx tsx scripts/device-sim.ts --device bench-coldroom-01 --value 3.2 --drift 0.5 --interval 2
```

`--drift` raises the value each reading to imitate a failing compressor; the twin shows the
LIVE reading, then opens a LIVE alert after the configured delay.

## POS / ordering webhook (`PosOrderEvent`, v1)

```json
{
  "v": 1,
  "idempotencyKey": "b1e0c9f4-…",
  "branchId": "branch-015",
  "externalRef": "CB-778812",
  "channel": "chris-b-app",
  "fulfilment": "delivery",
  "status": "RECEIVED",
  "lines": [{ "menuId": "pz-chicken-l", "qty": 1, "unitPriceGhs": 150 }],
  "ts": "2026-11-03T12:15:30Z"
}
```

- Signed like devices, with `x-pmcm-source` (sender id, e.g. `chris-b`, `pos-eastlegon`) in place
  of `x-pmcm-device`, and the shared secret `POS_WEBHOOK_SECRET` (≥16 characters).
- Send one event per status change: `RECEIVED`, `ACCEPTED`, `READY`, `COMPLETED`, `CANCELLED`,
  `REFUNDED`. Events are idempotent on (`x-pmcm-source`, `idempotencyKey`), so retries are safe.
- `branchId` and `menuId` must already be mapped to command-center ids; unknown ids are refused
  with `422` rather than guessed. Keep the mapping table in the integration service.
- Prices from the source system are authoritative and replace catalogue prices on that order.
- Live orders appear with a LIVE badge. **Kitchen progress is still simulated** until a kitchen
  display (KDS) or station-level system is connected; the order inspector says so.

Bench test: `npx tsx scripts/pos-sim.ts --branch branch-015 [--final CANCELLED]`.

## Cameras

Virtual cameras are viewpoints in the 3D model and are always labelled SIMULATED VIEW. Physical
cameras are a separate path:

1. IP cameras with ONVIF Profile S and RTSP (H.264 recommended for browser compatibility).
2. A media gateway in the branch or a regional site — MediaMTX is the reference: RTSP in,
   WebRTC (WHEP) and HLS out. Set `CAMERA_GATEWAY_URL` on the server.
3. Register each camera in `devices.json → cameras` with its authorisation (`approvedBy`,
   `approvedAt`, `purpose`, `privacyNoticeUrl`, `retentionDays`), `streamPath` on the gateway,
   and optionally `virtualCameraId` when it is mounted at the pose of a virtual camera.
4. The browser posts its SDP offer to `/api/cameras/{cameraId}/whep`; the server checks that
   the camera is registered and enabled and forwards it to the gateway. Camera addresses and
   credentials never reach the browser.
5. Live video plays only in the labelled LIVE CAMERA player (Settings → Integrations, or the
   "LIVE FEED" button on a matching tile in the twin's camera grid). It is never composited
   into the 3D simulation.

Not yet done: the proxy does not forward the WHEP session `Location` header, so sessions are
closed by the gateway's timeout rather than an explicit `DELETE`; HLS playback is not
implemented. Set `NEXT_PUBLIC_STUN_URL` only if consoles reach the gateway across NAT.

## Recommended hardware (to validate with the operations team)

| Need | Option | Notes |
|---|---|---|
| Fridge / freezer / walk-in air temperature | Wireless probes, LoRaWAN (with a branch gateway) or Wi-Fi | LoRaWAN gets through cold-room walls better; choose probes rated for −40 °C in freezers |
| Hot-holding cabinets | Wired or wireless probe rated to ≥ 120 °C | |
| Cooked-chicken core temperature | Bluetooth food probe with a tablet app at QC | Report as `probe_temperature_c` bound by `sensorCode` |
| Fryer oil quality | Inline total-polar-material sensor or handheld TPM meter | Report as `oil_quality_pct` |
| Door open / power | Reed switch; CT clamp energy monitor | Optional; `door_open`, `power_w` |
| Cameras | ONVIF/RTSP IP cameras + MediaMTX gateway | See Cameras |

Devices should buffer readings locally while offline and send them with their original `ts`
when the link returns (new `messageId` per reading). Calibrate probes against a reference
thermometer at installation and at a fixed interval; record each certificate's offset.

## Production path

```
devices ──MQTT/mTLS──► broker ─┐
gateways ──HTTPS+HMAC─────────┤► ingestion service (validate, bind, calibrate, de-duplicate)
POS / Chris B ──webhook───────┘          │
                                         ▼
                           Redis Streams or Kafka  ──► alert/rules service (same limits as today)
                                         │
                                         ▼
                           TimescaleDB (readings, orders, audit) ──► NestJS WebSocket gateway ──► consoles
```

- Replace the in-process hub with the stream; keep `contracts.ts` as the shared schema.
- Move the bindings and camera registry from `devices.json` into Postgres (schema sketch in
  `prisma/schema.prisma`), editable by administrators with audit logging.
- Replace `CONSOLE_ACCESS_TOKEN` with authenticated sessions and branch-scoped RBAC enforced on
  the server, including on the live stream and camera routes.
- Run alerting server-side so alerts fire and notify staff even when no console is open.

## Privacy and legal

- Ghana's Data Protection Act, 2012 (Act 843) applies to CCTV footage of staff and customers and
  to customer order data. Confirm registration duties with the Data Protection Commission and
  the lawful basis for each purpose with counsel before connecting cameras or order data.
- Display CCTV signage at each branch, publish the privacy notice referenced in each camera's
  authorisation, set and enforce retention periods, and restrict live viewing to authorised
  roles with an audit log.
- Do not use cameras for purposes beyond the recorded authorisation (for example, staff
  performance monitoring) without separate review.
