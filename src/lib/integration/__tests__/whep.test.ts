import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integration/hub", () => ({
  CAMERAS: [
    { cameraId: "cam-entrance", branchId: "branch-015", name: "Entrance", protocol: "webrtc-whep", streamPath: "/eastlegon/entrance", enabled: true },
    { cameraId: "cam-off", branchId: "branch-015", name: "Off", protocol: "webrtc-whep", streamPath: "off", enabled: false },
    { cameraId: "cam-hls", branchId: "branch-015", name: "HLS", protocol: "hls", streamPath: "hls", enabled: true },
  ],
}));

const { POST } = await import("@/app/api/cameras/[cameraId]/whep/route");

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
const call = (cameraId: string, body = OFFER) => POST(new Request(`http://localhost/api/cameras/${cameraId}/whep`, { method: "POST", body }), { params: Promise.resolve({ cameraId }) });

describe("WHEP camera proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses unknown, disabled and non-WHEP cameras, and bad offers", async () => {
    vi.stubEnv("CAMERA_GATEWAY_URL", "http://gateway:8889");
    expect((await call("nope")).status).toBe(404);
    expect((await call("cam-off")).status).toBe(404);
    expect((await call("cam-hls")).status).toBe(400);
    expect((await call("cam-entrance", "<script>")).status).toBe(400);
  });

  it("reports a missing gateway", async () => {
    vi.stubEnv("CAMERA_GATEWAY_URL", "");
    expect((await call("cam-entrance")).status).toBe(503);
  });

  it("forwards the offer to the gateway stream path and returns the answer", async () => {
    vi.stubEnv("CAMERA_GATEWAY_URL", "http://gateway:8889/");
    const fetchMock = vi.fn(async () => new Response("v=0\r\nanswer", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("cam-entrance");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("v=0\r\nanswer");
    expect(fetchMock).toHaveBeenCalledWith("http://gateway:8889/eastlegon/entrance/whep", expect.objectContaining({ method: "POST", body: OFFER }));
  });
});
