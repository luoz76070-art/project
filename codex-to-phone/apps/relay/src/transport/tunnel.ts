import WebSocket from "ws";
import { attachHeartbeat } from "./heartbeat.js";
import { canForwardHeader, chunkBytes, decodeBrokerMessage, maxFrameBytes, maxRequestsPerRelay, type BrokerRequest, type RelayMessage } from "./protocol.js";

type TunnelConfig = ReturnType<typeof loadTunnelConfig>;
type ActiveRequest = { controller: AbortController; acknowledge?: { seq: number; resolve: () => void } };

export function loadTunnelConfig() {
  return {
    brokerUrl: process.env.MOBILE_CODEX_BROKER_URL ?? "",
    relayId: process.env.MOBILE_CODEX_RELAY_ID ?? "",
    relaySecret: process.env.MOBILE_CODEX_RELAY_SECRET ?? "",
    localRelay: process.env.MOBILE_CODEX_LOCAL_RELAY ?? "http://127.0.0.1:8787",
    reconnectMs: Number(process.env.MOBILE_CODEX_TUNNEL_RECONNECT_MS ?? 3_000),
    requestTimeoutMs: Number(process.env.MOBILE_CODEX_TUNNEL_REQUEST_TIMEOUT_MS ?? 180_000),
    heartbeatMs: Number(process.env.MOBILE_CODEX_HEARTBEAT_MS ?? 15_000),
  };
}

export function startTunnel(config: TunnelConfig) {
  if (!config.brokerUrl || !config.relayId || !config.relaySecret) {
    throw new Error("Set MOBILE_CODEX_BROKER_URL, MOBILE_CODEX_RELAY_ID and MOBILE_CODEX_RELAY_SECRET.");
  }
  const lifetime = new AbortController();
  let current: WebSocket | null = null;
  const done = (async () => {
    let failures = 0;
    while (!lifetime.signal.aborted) {
      const started = Date.now();
      try { await connectOnce(); } catch (error) { console.error(`[remote-tunnel] ${toErrorMessage(error)}`); }
      if (lifetime.signal.aborted) break;
      if (Date.now() - started >= 30_000) failures = 0;
      const budget = Math.min(30_000, config.reconnectMs * 2 ** Math.min(failures++, 6));
      await delay(Math.max(10, Math.random() * budget), lifetime.signal);
    }
  })();
  return { done, stop() { lifetime.abort(); current?.terminate(); } };

  function connectOnce(): Promise<void> {
    const url = buildBrokerWebSocketUrl(config.brokerUrl, config.relayId);
    console.log(`[remote-tunnel] connecting ${redactBrokerWebSocketUrl(url)}`);
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${config.relaySecret}` }, handshakeTimeout: 10_000, maxPayload: maxFrameBytes,
    });
    current = socket;
    const active = new Map<string, ActiveRequest>();
    return new Promise((resolve) => {
      socket.once("open", () => {
        console.log(`[remote-tunnel] connected relayId=${config.relayId}`);
        attachHeartbeat(socket, config.heartbeatMs);
      });
      socket.on("error", (error) => { console.error(`[remote-tunnel] ${toErrorMessage(error)}`); socket.terminate(); });
      socket.once("close", () => {
        for (const request of active.values()) request.controller.abort();
        active.clear(); if (current === socket) current = null; resolve();
      });
      socket.on("message", (data) => {
        const frame = decodeBrokerMessage(data.toString());
        if (!frame) return;
        const item = active.get(frame.id);
        if (frame.type === "cancel") { item?.controller.abort(); return; }
        if (frame.type === "ack") { if (item?.acknowledge?.seq === frame.seq) item.acknowledge.resolve(); return; }
        if (item) return; // Never replay an in-flight request.
        if (active.size >= maxRequestsPerRelay) {
          void send(socket, { type: "response", id: frame.id, status: 503, headers: { "content-type": "application/json" }, body: '{"error":"relay_busy"}' }).catch(() => socket.terminate());
          return;
        }
        const request = { controller: new AbortController() };
        active.set(frame.id, request);
        void forwardLocal(socket, frame, request).catch(async (error) => {
          if (request.controller.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
          if (frame.stream) await send(socket, { type: "response-error", id: frame.id, message: toErrorMessage(error).slice(0, 1000) }).catch(() => socket.terminate());
          else await send(socket, { type: "response", id: frame.id, status: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "local_relay_failed", message: toErrorMessage(error) }) }).catch(() => socket.terminate());
        }).finally(() => { if (active.get(frame.id) === request) active.delete(frame.id); });
      });
    });
  }

  async function forwardLocal(socket: WebSocket, request: BrokerRequest, active: ActiveRequest) {
    // Idle timeout is refreshed by each chunk. SSE heartbeats keep a healthy stream alive.
    const timeout = setTimeout(() => active.controller.abort(new Error("local-relay-timeout")), config.requestTimeoutMs);
    const signal = active.controller.signal;
    try {
      const base = new URL(config.localRelay);
      const target = new URL(request.path, base);
      if (target.origin !== base.origin) throw new Error("invalid-local-relay-path");
      const response = await fetch(target, { method: request.method, headers: request.headers, body: request.body, signal, redirect: "manual" });
      timeout.refresh();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => { if (canForwardHeader(name)) headers[name] = value; });
      if (!request.stream) {
        const body = await response.text();
        await send(socket, { type: "response", id: request.id, status: response.status, headers, body }); return;
      }
      await send(socket, { type: "response-start", id: request.id, status: response.status, headers });
      if (response.body) {
        const reader = response.body.getReader();
        let seq = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (let offset = 0; offset < value.length; offset += chunkBytes) {
              signal.throwIfAborted(); timeout.refresh();
              const bytes = value.subarray(offset, offset + chunkBytes);
              await sendChunk(socket, active, { type: "response-chunk", id: request.id, seq: seq++, body: Buffer.from(bytes).toString("base64") });
              timeout.refresh();
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      await send(socket, { type: "response-end", id: request.id });
    } catch (error) {
      // A local deadline is an upstream failure; explicit cancellation/connection loss stays silent.
      if (signal.aborted && signal.reason instanceof Error && signal.reason.message === "local-relay-timeout" && socket.readyState === WebSocket.OPEN) {
        if (request.stream) await send(socket, { type: "response-error", id: request.id, message: "local-relay-timeout" });
        else await send(socket, { type: "response", id: request.id, status: 502, headers: { "content-type": "application/json" }, body: '{"error":"local_relay_timeout"}' });
      } else throw error;
    } finally { clearTimeout(timeout); active.acknowledge = undefined; }
  }
}

async function sendChunk(socket: WebSocket, request: ActiveRequest, frame: Extract<RelayMessage, { type: "response-chunk" }>) {
  const signal = request.controller.signal;
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => { signal.removeEventListener("abort", aborted); request.acknowledge = undefined; };
    request.acknowledge = { seq: frame.seq, resolve() { cleanup(); resolve(); } };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    void send(socket, frame).catch((error) => { cleanup(); reject(error); });
  });
}
function send(socket: WebSocket, frame: RelayMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error("tunnel-closed")); return; }
    socket.send(JSON.stringify(frame), (error) => error ? reject(error) : resolve());
  });
}
function buildBrokerWebSocketUrl(raw: string, relayId: string): string {
  const url = new URL(raw);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (!pathname) url.pathname = "/relay/connect";
  else if (!pathname.endsWith("/relay/connect")) url.pathname = `${pathname}/relay/connect`;
  url.searchParams.set("relayId", relayId);
  // Keep credentials only in the Authorization header.
  url.searchParams.delete("secret");
  return url.toString();
}
function redactBrokerWebSocketUrl(raw: string): string {
  const url = new URL(raw); if (url.searchParams.has("secret")) url.searchParams.set("secret", "[REDACTED]"); return url.toString();
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener("abort", finish, { once: true });
  });
}
function toErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
