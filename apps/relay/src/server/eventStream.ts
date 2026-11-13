import type { FastifyReply } from "fastify";
import { PassThrough } from "node:stream";

// Fastify owns the response, including CORS/onSend and stream backpressure.
export function createEventStream(reply: FastifyReply, streams: Set<PassThrough>) {
  const stream = new PassThrough({ highWaterMark: 64 * 1024 });
  stream.on("error", () => {}); // Oversized initial snapshots may fail before reply.send attaches.
  const cleanups: Array<() => void> = [];
  streams.add(stream);
  reply.header("Content-Type", "text/event-stream; charset=utf-8")
    .header("Cache-Control", "no-cache, no-transform").header("X-Accel-Buffering", "no");
  const disconnected = () => stream.destroy();
  reply.raw.once("close", disconnected);
  stream.once("close", () => {
    streams.delete(stream); reply.raw.off("close", disconnected);
    for (const cleanup of cleanups) cleanup();
  });
  // A disconnected slow reader must not retain unbounded full snapshots.
  const write = (frame: string) => {
    if (stream.destroyed) return;
    if (stream.readableLength + stream.writableLength + Buffer.byteLength(frame) > 2 * 1024 * 1024) {
      stream.destroy(new Error("event-stream-consumer-too-slow")); return;
    }
    stream.write(frame);
  };
  const keepAlive = setInterval(() => write(`event: ping\ndata: ${Date.now()}\n\n`), 15_000);
  keepAlive.unref(); cleanups.push(() => clearInterval(keepAlive));
  return {
    stream,
    send(event: string, snapshot: unknown) { write(`event: ${event}\ndata: ${JSON.stringify(snapshot)}\n\n`); },
    onClose(cleanup: () => void) { if (stream.destroyed) cleanup(); else cleanups.push(cleanup); },
    ready() { write(": connected\n\n"); return reply.send(stream); },
  };
}
