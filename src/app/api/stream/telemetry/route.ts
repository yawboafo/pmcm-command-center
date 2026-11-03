import { consoleAccessAllowed } from "@/lib/integration/access";
import { backlog, subscribe } from "@/lib/integration/hub";

/**
 * Live telemetry stream for the command center (Server-Sent Events).
 * `?branchId=` limits the stream; `Last-Event-ID` (or `?after=`) resumes after
 * a dropped connection without losing readings still in the replay buffer.
 */
export async function GET(req: Request) {
  if (!consoleAccessAllowed(req)) return new Response("unauthorised", { status: 401 });
  const url = new URL(req.url);
  const branchId = url.searchParams.get("branchId");
  const after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (r: { seq: number; branchId: string }) => {
        if (branchId && r.branchId !== branchId) return;
        controller.enqueue(enc.encode(`id: ${r.seq}\nevent: reading\ndata: ${JSON.stringify(r)}\n\n`));
      };
      controller.enqueue(enc.encode(`retry: 3000\n: connected\n\n`));
      for (const r of backlog(branchId, after)) send(r);
      const unsubscribe = subscribe(send);
      const ping = setInterval(() => controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`)), 15_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
