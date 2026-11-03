/**
 * Simulated camera gateway: serves one MJPEG stream (multipart/x-mixed-replace) per
 * simulated camera in src/data/devices.virtual.json, generated with ffmpeg — the
 * `testsrc2` pattern with an overlay naming the camera and branch, a running GMT
 * timestamp, and a "SIMULATED CAMERA" banner. Nobody is filmed.
 *
 *   npm run camera:sim -- [--port 8090] [--host 127.0.0.1] [--fps 5] [--ffmpeg /opt/homebrew/bin/ffmpeg]
 *
 * Point the server at it with VIRTUAL_CAMERA_GATEWAY_URL=http://127.0.0.1:8090 (or
 * CAMERA_GATEWAY_URL). Browsers never talk to this gateway: the console plays
 * /api/cameras/{cameraId}/mjpeg, which checks the registry and relays the stream.
 *
 * The overlay text is drawn here with a built-in bitmap font and piped to ffmpeg as a
 * second (RGBA) input, so it works with ffmpeg builds that lack the drawtext filter.
 * ffmpeg runs only while someone is watching a camera.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import fleetJson from "../src/data/devices.virtual.json";
import { arg } from "./lib/env";
import type { VirtualFleetFile } from "./lib/fleet-spec";

const fleet = fleetJson as unknown as VirtualFleetFile;
const PORT = Number(arg("port", "8090"));
const HOST = arg("host", "127.0.0.1")!;
const FPS = Math.min(15, Math.max(1, Number(arg("fps", "5")) || 5));
const FFMPEG = arg("ffmpeg") ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const W = 640;
const H = 360;
const BOUNDARY = "opsframe";

// ───────────────────────────── bitmap font (5×7) ─────────────────────────────

const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  ",": "00000 00000 00000 00000 01100 00100 01000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  "(": "00010 00100 01000 01000 01000 00100 00010",
  ")": "01000 00100 00010 00010 00010 00100 01000",
  "·": "00000 00000 00000 01100 01100 00000 00000",
  "!": "00100 00100 00100 00100 00100 00000 00100",
};
const FONT = new Map(Object.entries(GLYPHS).map(([c, rows]) => [c, rows.split(" ").map((r) => [...r].map((b) => b === "1"))]));

type RGBA = [number, number, number, number];

function fillRect(buf: Buffer, x0: number, y0: number, w: number, h: number, [r, g, b, a]: RGBA) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
}

function drawText(buf: Buffer, text: string, x: number, y: number, scale: number, color: RGBA) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT.get(ch);
    if (g) g.forEach((row, ry) => row.forEach((on, rx) => on && fillRect(buf, cx + rx * scale, y + ry * scale, scale, scale, color)));
    cx += 6 * scale;
  }
}

const textWidth = (text: string, scale: number) => text.length * 6 * scale - scale;

// ───────────────────────────── cameras ─────────────────────────────

interface Cam {
  cameraId: string;
  path: string;
  title: string;
  branch: string;
  hue: number;
  proc: ChildProcessWithoutNullStreams | null;
  clients: Set<ServerResponse>;
  lastFrame: Buffer | null;
  overlayTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  base: Buffer;
}

const cams: Cam[] = fleet.cameras.map((c, i) => {
  const branch = fleet.branches.find((b) => b.branchId === c.branchId)?.name ?? c.branchId;
  const title = c.name.replace(/\s*\(simulated\)\s*$/i, "");
  // Static part of the overlay: header band and the SIMULATED CAMERA banner.
  const base = Buffer.alloc(W * H * 4);
  // Header band; its first ~26 px stay clear for the console player's own SIM CAMERA label.
  fillRect(base, 0, 0, W, 80, [0, 0, 0, 170]);
  drawText(base, `${title}`, 10, 32, 2, [255, 255, 255, 255]);
  const banner = "SIMULATED CAMERA - NOT A REAL FEED";
  fillRect(base, 0, H - 46, W, 46, [245, 158, 11, 235]);
  drawText(base, banner, Math.round((W - textWidth(banner, 3)) / 2), H - 34, 3, [0, 0, 0, 255]);
  drawText(base, "SIM", W - textWidth("SIM", 3) - 10, 10, 3, [245, 158, 11, 255]);
  return { cameraId: c.cameraId, path: `/${c.streamPath.replace(/^\//, "")}`, title, branch, hue: (i * 57) % 360, proc: null, clients: new Set(), lastFrame: null, overlayTimer: null, idleTimer: null, base };
});

function overlayFrame(cam: Cam) {
  const buf = Buffer.from(cam.base);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  drawText(buf, `${cam.branch} · ${cam.cameraId.replace(/^vcam-/, "")}`.slice(0, 50), 10, 56, 1, [200, 200, 200, 255]);
  drawText(buf, `${now} GMT`, W - textWidth(`${now} GMT`, 2) - 10, 56, 2, [255, 255, 255, 255]);
  return buf;
}

function start(cam: Cam) {
  if (cam.proc) return;
  const p = spawn(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-re",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${W}x${H}:rate=${FPS}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-video_size",
    `${W}x${H}`,
    "-framerate",
    "2",
    "-i",
    "pipe:0",
    "-filter_complex",
    `[0:v]hue=h=${cam.hue}[b];[b][1:v]overlay=0:0:format=auto,format=yuvj420p[v]`,
    "-map",
    "[v]",
    "-c:v",
    "mjpeg",
    "-q:v",
    "7",
    "-f",
    "image2pipe",
    "pipe:1",
  ]);
  cam.proc = p;
  let acc: Buffer = Buffer.alloc(0);
  p.stdout.on("data", (chunk: Buffer) => {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    // Split the JPEG stream on SOI (FFD8) / EOI (FFD9) markers.
    for (;;) {
      const soi = acc.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi < 0) {
        acc = Buffer.alloc(0);
        break;
      }
      const eoi = acc.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
      if (eoi < 0) {
        if (soi > 0) acc = acc.subarray(soi);
        break;
      }
      const frame = acc.subarray(soi, eoi + 2);
      acc = acc.subarray(eoi + 2);
      broadcast(cam, Buffer.from(frame));
    }
  });
  p.stderr.on("data", (d: Buffer) => console.error(`[${cam.cameraId}] ffmpeg: ${d.toString().trim()}`));
  p.stdin.on("error", () => {});
  p.on("exit", (code) => {
    if (cam.proc === p) {
      cam.proc = null;
      if (cam.overlayTimer) clearInterval(cam.overlayTimer);
      cam.overlayTimer = null;
      if (code && cam.clients.size) {
        console.error(`[${cam.cameraId}] ffmpeg exited (${code}); restarting`);
        setTimeout(() => cam.clients.size && start(cam), 1000);
      }
    }
  });
  // Overlay frames at 2 fps (the clock ticks each second; ffmpeg repeats the last overlay between them).
  const push = () => p.stdin.writable && p.stdin.write(overlayFrame(cam));
  push();
  cam.overlayTimer = setInterval(push, 500);
  console.log(`[${cam.cameraId}] started (${cam.clients.size} viewer${cam.clients.size === 1 ? "" : "s"})`);
}

function stop(cam: Cam) {
  if (cam.overlayTimer) clearInterval(cam.overlayTimer);
  cam.overlayTimer = null;
  const p = cam.proc;
  cam.proc = null;
  cam.lastFrame = null;
  if (p) {
    p.stdin.end();
    p.kill("SIGTERM");
    console.log(`[${cam.cameraId}] stopped (no viewers)`);
  }
}

function writeFrame(res: ServerResponse, frame: Buffer) {
  return res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`) && res.write(frame) && res.write("\r\n");
}

const congested = new WeakSet<ServerResponse>();
function broadcast(cam: Cam, frame: Buffer) {
  cam.lastFrame = frame;
  for (const res of cam.clients) {
    // Slow viewers skip frames instead of buffering without limit.
    if (congested.has(res)) continue;
    if (!writeFrame(res, frame)) {
      congested.add(res);
      res.once("drain", () => congested.delete(res));
    }
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  if (url.pathname === "/" || url.pathname === "/cameras") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ simulated: true, cameras: cams.map((c) => ({ cameraId: c.cameraId, path: c.path, viewers: c.clients.size, running: !!c.proc })) }, null, 1));
    return;
  }
  const cam = cams.find((c) => c.path === url.pathname.replace(/\/$/, ""));
  if (!cam || req.method !== "GET") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("unknown camera");
    return;
  }
  res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "cache-control": "no-store", connection: "close", "x-ops-simulated": "1" });
  cam.clients.add(res);
  if (cam.idleTimer) clearTimeout(cam.idleTimer);
  cam.idleTimer = null;
  if (cam.lastFrame) writeFrame(res, cam.lastFrame);
  start(cam);
  req.on("close", () => {
    cam.clients.delete(res);
    if (!cam.clients.size) cam.idleTimer = setTimeout(() => !cam.clients.size && stop(cam), 15_000);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Simulated camera gateway on http://${HOST}:${PORT}  (${FPS} fps, ffmpeg: ${FFMPEG})`);
  for (const c of cams) console.log(`  ${c.cameraId.padEnd(40)} ${c.path}`);
  console.log(`\nSet VIRTUAL_CAMERA_GATEWAY_URL=http://${HOST}:${PORT} on the Next server; the console plays /api/cameras/<cameraId>/mjpeg.`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    for (const c of cams) stop(c);
    process.exit(0);
  });
