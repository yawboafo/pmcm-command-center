import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integration/hub", () => ({
  CAMERAS: [
    { cameraId: "vcam-entrance", branchId: "branch-015", name: "Entrance (simulated)", protocol: "mjpeg", streamPath: "/eastlegon/entrance", enabled: true, virtual: true },
    { cameraId: "vcam-off", branchId: "branch-015", name: "Off", protocol: "mjpeg", streamPath: "off", enabled: false, virtual: true },
    { cameraId: "cam-whep", branchId: "branch-015", name: "WHEP", protocol: "webrtc-whep", streamPath: "whep", enabled: true, virtual: false },
  ],
}));

const { GET } = await import("@/app/api/cameras/[cameraId]/mjpeg/route");

const call = (cameraId: string) => GET(new Request(`http://localhost/api/cameras/${cameraId}/mjpeg`), { params: Promise.resolve({ cameraId }) });
const MJPEG = "multipart/x-mixed-replace; boundary=opsframe";

describe("MJPEG camera proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses unknown, disabled and non-MJPEG cameras without contacting the gateway", async () => {
    vi.stubEnv("VIRTUAL_CAMERA_GATEWAY_URL", "http://camera-sim:8090");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("nope")).status).toBe(404);
    expect((await call("vcam-off")).status).toBe(404);
    expect((await call("cam-whep")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing gateway", async () => {
    vi.stubEnv("VIRTUAL_CAMERA_GATEWAY_URL", "");
    vi.stubEnv("CAMERA_GATEWAY_URL", "");
    expect((await call("vcam-entrance")).status).toBe(503);
  });

  it("refuses console requests without the access token when one is configured", async () => {
    vi.stubEnv("CONSOLE_ACCESS_TOKEN", "console-token-123");
    vi.stubEnv("VIRTUAL_CAMERA_GATEWAY_URL", "http://camera-sim:8090");
    expect((await call("vcam-entrance")).status).toBe(401);
  });

  it("relays the gateway stream for a registered camera without exposing the gateway address", async () => {
    vi.stubEnv("VIRTUAL_CAMERA_GATEWAY_URL", "http://camera-sim:8090/");
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response("--opsframe\r\nContent-Type: image/jpeg\r\n\r\nJPEG\r\n", { headers: { "content-type": MJPEG } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("vcam-entrance");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(MJPEG);
    expect(res.headers.get("x-ops-simulated")).toBe("1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://camera-sim:8090/eastlegon/entrance");
    const body = await res.text();
    expect(body).toContain("JPEG");
    expect(body).not.toContain("camera-sim");
    expect([...res.headers.values()].join(" ")).not.toContain("camera-sim");
  });

  it("answers 502 when the gateway is down or does not serve MJPEG", async () => {
    vi.stubEnv("VIRTUAL_CAMERA_GATEWAY_URL", "http://camera-sim:8090");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
    expect((await call("vcam-entrance")).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect((await call("vcam-entrance")).status).toBe(502);
  });
});
