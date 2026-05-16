import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

type BrokerRequest = {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
};

type BrokerResponse = {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

type RelayConnection = {
  relayId: string;
  secret: string;
  socket: WebSocket;
  connectedAt: string;
  lastSeenAt: string;
};

type PendingRequest = {
  resolve: (response: BrokerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const config = {
  host: process.env.MOBILE_CODEX_BROKER_HOST ?? "0.0.0.0",
  port: Number(process.env.MOBILE_CODEX_BROKER_PORT ?? 18888),
  requestTimeoutMs: Number(process.env.MOBILE_CODEX_BROKER_REQUEST_TIMEOUT_MS ?? 180_000),
};

const app = Fastify({ logger: true, bodyLimit: 40 * 1024 * 1024 });
const relays = new Map<string, RelayConnection>();
const pending = new Map<string, PendingRequest>();

app.get("/health", async () => ({
  ok: true,
  mode: "mobile-codex-broker",
  connectedRelays: [...relays.keys()],
}));

app.all("/r/:relayId/*", async (request, reply) => {
  const params = z.object({ relayId: z.string().min(1), "*": z.string().optional() }).parse(request.params);
  const relay = relays.get(params.relayId);
  if (!relay || relay.socket.readyState !== relay.socket.OPEN) {
    return reply.code(503).send({
      error: "relay_offline",
      message: `Relay ${params.relayId} is not connected to broker`,
    });
  }

  const response = await forwardToRelay(relay, {
    method: request.method,
    path: stripRelayPrefix(request.url, params.relayId),
    headers: normalizeHeaders(request.headers),
    body: encodeRequestBody(request.body),
  });

  for (const [name, value] of Object.entries(response.headers)) {
    if (canForwardResponseHeader(name)) reply.header(name, value);
  }
  return reply.code(response.status).send(response.body);
});

await app.listen({ host: config.host, port: config.port });

const wss = new WebSocketServer({ server: app.server, path: "/relay/connect" });
wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "", "http://broker.local");
  const relayId = url.searchParams.get("relayId")?.trim();
  const secret = url.searchParams.get("secret")?.trim();
  if (!relayId || !secret) {
    socket.close(1008, "missing relayId or secret");
    return;
  }

  const existing = relays.get(relayId);
  if (existing && existing.secret !== secret) {
    socket.close(1008, "relay secret mismatch");
    return;
  }
  existing?.socket.close(1012, "replaced by a newer relay connection");

  const connection: RelayConnection = {
    relayId,
    secret,
    socket,
    connectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  relays.set(relayId, connection);
  app.log.info({ relayId }, "relay connected");

  socket.on("message", (data) => handleRelayMessage(connection, data.toString()));
  socket.on("close", () => {
    if (relays.get(relayId)?.socket === socket) relays.delete(relayId);
    app.log.info({ relayId }, "relay disconnected");
  });
  socket.on("error", (error) => {
    app.log.warn({ relayId, error }, "relay websocket error");
  });
});

function forwardToRelay(relay: RelayConnection, request: Omit<BrokerRequest, "type" | "id">): Promise<BrokerResponse> {
  const id = randomUUID();
  const message: BrokerRequest = { type: "request", id, ...request };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("broker-request-timeout"));
    }, config.requestTimeoutMs);
    pending.set(id, { resolve, reject, timeout });
    relay.socket.send(JSON.stringify(message), (error) => {
      if (!error) return;
      clearTimeout(timeout);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function handleRelayMessage(relay: RelayConnection, raw: string): void {
  relay.lastSeenAt = new Date().toISOString();
  let message: BrokerResponse;
  try {
    message = JSON.parse(raw) as BrokerResponse;
  } catch {
    return;
  }
  if (message.type !== "response" || typeof message.id !== "string") return;
  const item = pending.get(message.id);
  if (!item) return;
  clearTimeout(item.timeout);
  pending.delete(message.id);
  item.resolve(message);
}

function stripRelayPrefix(rawUrl: string, relayId: string): string {
  const prefix = `/r/${encodeURIComponent(relayId)}`;
  const url = new URL(rawUrl, "http://broker.local");
  const pathname = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || "/" : "/";
  return `${pathname}${url.search}`;
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length") continue;
    if (Array.isArray(value)) {
      result[name] = value.join(", ");
    } else if (typeof value === "string") {
      result[name] = value;
    }
  }
  return result;
}

function encodeRequestBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  return JSON.stringify(body);
}

function canForwardResponseHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower !== "content-length" && lower !== "connection" && lower !== "transfer-encoding";
}
