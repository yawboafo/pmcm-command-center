import { consoleAccessAllowed } from "@/lib/integration/access";
import { CAMERAS } from "@/lib/integration/hub";

/**
 * MJPEG stream proxy (multipart/x-mixed-replace) for registered, enabled cameras that use
 * `protocol: "mjpeg"` — in the prototype the simulated cameras served by scripts/camera-sim.ts.
 * The server checks the camera, then relays the gateway stream; the gateway address never
 * reaches the browser. Simulated cameras may use VIRTUAL_CAMERA_GATEWAY_URL so they can run
 * alongside a real MediaMTX gateway on CAMERA_GATEWAY_URL.
 */
export async function GET(req: Request, ctx: { params: Promise<{ cameraId: string }> }) {
  if (!consoleAccessAllowed(req)) return new Response("unauthorised", { status: 401 });
  const { cameraId } = await ctx.params;
  const cam = CAMERAS.find((c) => c.cameraId === cameraId);
  if (!cam || !cam.enabled) return new Response("camera not available", { status: 404 });
  if (cam.protocol !== "mjpeg") return new Response("camera does not use MJPEG", { status: 400 });
  const gateway = (cam.virtual && process.env.VIRTUAL_CAMERA_GATEWAY_URL) || process.env.CAMERA_GATEWAY_URL;
  if (!gateway) return new Response("camera gateway not configured", { status: 503 });
  const upstream = await fetch(`${gateway.replace(/\/$/, "")}/${cam.streamPath.replace(/^\//, "")}`, { signal: req.signal, cache: "no-store" }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream || !upstream.ok || !upstream.body || !/^multipart\/x-mixed-replace;\s*boundary=[\w.-]{1,70}$/i.test(type)) {
    await upstream?.body?.cancel().catch(() => {});
    return new Response("gateway unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      ...(cam.virtual ? { "X-PMCM-Simulated": "1" } : {}),
    },
  });
}
