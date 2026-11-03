import { consoleAccessAllowed } from "@/lib/integration/access";
import { CAMERAS, deviceStatus } from "@/lib/integration/hub";

/** Integration health for the Settings → Integrations view. Never returns secrets or raw stream URLs. */
export async function GET(req: Request) {
  if (!consoleAccessAllowed(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  return Response.json({
    serverTime: Date.now(),
    devices: deviceStatus(),
    cameras: CAMERAS.map((c) => ({ cameraId: c.cameraId, branchId: c.branchId, name: c.name, virtualCameraId: c.virtualCameraId ?? null, protocol: c.protocol, enabled: c.enabled, authorisedBy: c.authorisation.approvedBy })),
    cameraGatewayConfigured: !!process.env.CAMERA_GATEWAY_URL,
    posWebhookConfigured: !!process.env.POS_WEBHOOK_SECRET,
    assistantConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}
