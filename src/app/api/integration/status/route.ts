import { consoleAccessAllowed } from "@/lib/integration/access";
import { FLEET_SECRET_MIN_LENGTH } from "@/lib/integration/fleet";
import { CAMERAS, deviceStatus, simulatorStatus, terminalStatus } from "@/lib/integration/hub";

/** Integration health for the Settings → Integrations view. Never returns secrets or raw stream URLs. */
export async function GET(req: Request) {
  if (!consoleAccessAllowed(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  return Response.json({
    serverTime: Date.now(),
    devices: deviceStatus(),
    posTerminals: terminalStatus(),
    cameras: CAMERAS.map((c) => ({ cameraId: c.cameraId, branchId: c.branchId, name: c.name, virtualCameraId: c.virtualCameraId ?? null, protocol: c.protocol, enabled: c.enabled, virtual: c.virtual, authorisedBy: c.authorisation?.approvedBy ?? (c.virtual ? "n/a — simulated camera (synthetic video)" : "—") })),
    simulator: simulatorStatus(),
    cameraGatewayConfigured: !!process.env.CAMERA_GATEWAY_URL,
    virtualCameraGatewayConfigured: !!(process.env.VIRTUAL_CAMERA_GATEWAY_URL || process.env.CAMERA_GATEWAY_URL),
    virtualFleetConfigured: (process.env.VIRTUAL_FLEET_SECRET?.length ?? 0) >= FLEET_SECRET_MIN_LENGTH,
    posWebhookConfigured: !!process.env.POS_WEBHOOK_SECRET,
    assistantConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}
