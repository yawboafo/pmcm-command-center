import { consoleAccessAllowed } from "@/lib/integration/access";
import { CAMERAS } from "@/lib/integration/hub";

/**
 * WebRTC (WHEP) signalling proxy for authorised physical cameras.
 * The browser posts its SDP offer here; the server checks the camera is
 * registered, authorised and enabled, then forwards the offer to the media
 * gateway (e.g. MediaMTX at CAMERA_GATEWAY_URL/<streamPath>/whep). Camera
 * addresses and credentials never reach the browser.
 */
export async function POST(req: Request, ctx: { params: Promise<{ cameraId: string }> }) {
  if (!consoleAccessAllowed(req)) return new Response("unauthorised", { status: 401 });
  const { cameraId } = await ctx.params;
  const cam = CAMERAS.find((c) => c.cameraId === cameraId);
  if (!cam || !cam.enabled) return new Response("camera not available", { status: 404 });
  if (cam.protocol !== "webrtc-whep") return new Response("camera does not use WHEP", { status: 400 });
  const gateway = process.env.CAMERA_GATEWAY_URL;
  if (!gateway) return new Response("camera gateway not configured", { status: 503 });
  const offer = await req.text();
  if (!offer.startsWith("v=0") || offer.length > 20_000) return new Response("invalid SDP offer", { status: 400 });
  const upstream = await fetch(`${gateway.replace(/\/$/, "")}/${cam.streamPath.replace(/^\//, "")}/whep`, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer }).catch(() => null);
  if (!upstream || !upstream.ok) return new Response("gateway unavailable", { status: 502 });
  return new Response(await upstream.text(), { status: 201, headers: { "Content-Type": "application/sdp" } });
}
