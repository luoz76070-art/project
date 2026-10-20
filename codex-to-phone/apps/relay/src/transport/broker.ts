import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { attachHeartbeat } from "./heartbeat.js";
import { canForwardHeader, chunkBytes, decodeRelayMessage, maxFrameBytes, maxPendingRequests, maxRequestsPerRelay, type BrokerRequest } from "./protocol.js";

type RelayConnection = { relayId: string; socket: WebSocket };
type ForwardedResponse = { status: number; headers: Record<string, string>; stream: PassThrough };
type PendingRequest = {
  relay: RelayConnection;
  stream: PassThrough;
  started: boolean;
  sequence: number;
  credit: boolean;
  timeout: NodeJS.Timeout;
  start: (status: number, headers: Record<string, string>) => void;
  finish: (error?: ForwardError, cancel?: boolean) => void;
};
class ForwardError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); }
}

export function loadBrokerConfig() {
  return {
    host: process.env.MOBILE_CODEX_BROKER_HOST ?? "0.0.0.0",
    port: Number(process.env.MOBILE_CODEX_BROKER_PORT ?? 18888),
    requestTimeoutMs: Number(process.env.MOBILE_CODEX_BROKER_REQUEST_TIMEOUT_MS ?? 180_000),
    heartbeatMs: Number(process.env.MOBILE_CODEX_HEARTBEAT_MS ?? 15_000),
    relayCredentials: loadRelayCredentials(process.env.MOBILE_CODEX_BROKER_RELAYS),
    allowDynamicRelays: process.env.MOBILE_CODEX_BROKER_ALLOW_DYNAMIC_RELAYS === "true",
  };
}

export function createBroker(config = loadBrokerConfig()) {
  if (config.relayCredentials.size === 0 && !config.allowDynamicRelays) {
    throw new Error("Set MOBILE_CODEX_BROKER_RELAYS to a JSON object of relay credentials. For local development only, set MOBILE_CODEX_BROKER_ALLOW_DYNAMIC_RELAYS=true.");
  }
  const app = Fastify({ logger: { serializers: { req: req => ({ method: req.method, url: req.url?.split("?")[0] }) }, redact: ["req.headers.authorization"] }, bodyLimit: 40 * 1024 * 1024 });
  const relays = new Map<string, RelayConnection>();
  const pending = new Map<string, PendingRequest>();
  const wss = new WebSocketServer({ server: app.server, path: "/relay/connect", maxPayload: maxFrameBytes });

  app.get("/health", async () => ({ ok: true, mode: "mobile-codex-broker", connectedRelayCount: relays.size }));
  app.all("/r/:relayId/*", async (request, reply) => {
    const params = z.object({ relayId: z.string().min(1) }).parse(request.params);
    const relay = relays.get(params.relayId);
    if (!relay || relay.socket.readyState !== WebSocket.OPEN) {
      return reply.code(503).send({ error: "relay_offline", message: `Relay ${params.relayId} is not connected to broker` });
    }
    if (pending.size >= maxPendingRequests || [...pending.values()].filter((item) => item.relay === relay).length >= maxRequestsPerRelay || relay.socket.bufferedAmount > maxFrameBytes) {
      return reply.code(503).send({ error: "relay_busy" });
    }
    try {
      const response = await forwardToRelay(relay, {
        method: request.method as BrokerRequest["method"], path: stripRelayPrefix(request.url, params.relayId),
        headers: normalizeHeaders(request.headers), body: encodeRequestBody(request.body),
      }, reply.raw);
      for (const [name, value] of Object.entries(response.headers)) {
        if (canForwardHeader(name)) reply.header(name, value);
      }
      return reply.code(response.status).send(response.stream);
    } catch (error) {
      if (error instanceof ForwardError) return reply.code(error.statusCode).send({ error: error.code });
      throw error;
    }
  });

  function failRelay(relay: RelayConnection) {
    for (const item of pending.values()) {
      if (item.relay === relay) item.finish(new ForwardError(503, "relay_disconnected"));
    }
  }
  wss.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "", "http://broker.local");
    const relayId = url.searchParams.get("relayId")?.trim();
    const secret = bearerToken(request.headers.authorization) ?? url.searchParams.get("secret")?.trim();
    const configuredSecret = relayId ? config.relayCredentials.get(relayId) : undefined;
    if (!relayId || !secret || (!configuredSecret && !config.allowDynamicRelays) || (configuredSecret && !secretsMatch(secret, configuredSecret))) {
      socket.close(1008, "invalid relay credentials"); return;
    }
    const old = relays.get(relayId);
    if (old) { failRelay(old); old.socket.close(1012, "replaced by a newer relay connection"); }
    const connection = { relayId, socket };
    relays.set(relayId, connection);
    attachHeartbeat(socket, config.heartbeatMs);
    app.log.info({ relayId }, "relay connected");
    socket.on("message", (raw) => handleRelayMessage(connection, raw.toString()));
    socket.on("close", () => {
      if (relays.get(relayId) === connection) relays.delete(relayId);
      failRelay(connection);
    });
    socket.on("error", (error) => { app.log.warn({ relayId, error }, "relay websocket error"); socket.terminate(); });
  });
  app.addHook("preClose", async () => {
    for (const relay of relays.values()) { failRelay(relay); relay.socket.terminate(); }
    wss.close();
  });

  function send(relay: RelayConnection, frame: object) {
    if (relay.socket.readyState === WebSocket.OPEN) relay.socket.send(JSON.stringify(frame), (error) => { if (error) relay.socket.terminate(); });
  }
  function forwardToRelay(relay: RelayConnection, request: Omit<BrokerRequest, "type" | "id" | "stream">, downstream: ServerResponse): Promise<ForwardedResponse> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const stream = new PassThrough({ highWaterMark: 64 * 1024 });
      stream.on("error", () => {}); // Failure can precede Fastify attaching its stream listener.
      const closed = () => item.finish(new ForwardError(499, "client_closed"), true);
      const item: PendingRequest = {
        relay, stream, started: false, sequence: 0, credit: true,
        timeout: setTimeout(() => item.finish(new ForwardError(504, "relay_timeout"), true), config.requestTimeoutMs),
        start(status, headers) {
          if (item.started) { item.finish(new ForwardError(502, "invalid_relay_response"), true); return; }
          item.started = true; item.timeout.refresh(); resolve({ status, headers, stream });
        },
        finish(error, cancel = false) {
          if (pending.get(id) !== item) return;
          pending.delete(id); clearTimeout(item.timeout); downstream.off("close", closed);
          if (cancel) send(relay, { type: "cancel", id });
          if (error) { stream.destroy(error); reject(error); }
          else stream.end();
        },
      };
      pending.set(id, item);
      downstream.once("close", closed);
      if (downstream.destroyed) { closed(); return; }
      relay.socket.send(JSON.stringify({ type: "request", id, stream: true, ...request }), (error) => {
        if (error) item.finish(new ForwardError(503, "relay_disconnected"));
      });
    });
  }
  function handleRelayMessage(relay: RelayConnection, raw: string) {
    const message = decodeRelayMessage(raw);
    if (!message) return;
    const item = pending.get(message.id);
    if (!item || item.relay !== relay) return;
    item.timeout.refresh();
    if (message.type === "response") {
      if (item.started) { item.finish(new ForwardError(502, "invalid_relay_response"), true); return; }
      item.start(message.status, message.headers); item.stream.write(message.body); item.finish(); return;
    }
    if (message.type === "response-start") { item.start(message.status, message.headers); return; }
    if (message.type === "response-error") { item.finish(new ForwardError(502, "local_relay_failed"), true); return; }
    if (!item.started) { item.finish(new ForwardError(502, "invalid_relay_response"), true); return; }
    if (message.type === "response-end") { item.finish(); return; }
    const bytes = Buffer.from(message.body, "base64");
    if (message.seq !== item.sequence || !item.credit || bytes.length > chunkBytes || bytes.toString("base64") !== message.body) {
      item.finish(new ForwardError(502, "invalid_relay_chunk"), true); return;
    }
    item.sequence += 1; item.credit = false;
    const acknowledge = () => {
      if (pending.get(message.id) !== item) return;
      item.credit = true; send(relay, { type: "ack", id: message.id, seq: message.seq });
    };
    if (item.stream.write(bytes)) acknowledge();
    else item.stream.once("drain", acknowledge);
  }
  return app;
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
    if (!canForwardHeader(lower)) continue;
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

function loadRelayCredentials(raw: string | undefined): Map<string, string> {
  if (!raw?.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MOBILE_CODEX_BROKER_RELAYS must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MOBILE_CODEX_BROKER_RELAYS must be a JSON object.");
  }
  const credentials = new Map<string, string>();
  for (const [relayId, value] of Object.entries(parsed)) {
    if (!relayId.trim() || typeof value !== "string" || value.length < 24) {
      throw new Error("Each broker relay credential must have a non-empty relayId and a secret of at least 24 characters.");
    }
    credentials.set(relayId, value);
  }
  return credentials;
}

function bearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
