import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PassThrough } from "node:stream";
import { z } from "zod";
import type { AgentGateway } from "../agents/agentGateway.js";
import { agentError } from "../agents/sessions.js";
import type { DeviceRegistry } from "./devices.js";
import type { SubmissionRegistry } from "./submissions.js";
import { createEventStream } from "./eventStream.js";
import { snapshotSender } from "./snapshotPatch.js";

const agentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const paramsSchema = z.object({ agentId, sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/u) });
const operationSchema = z.object({ controlToken: z.string().uuid(), clientMessageId: z.string().uuid() });
type StreamToken = { owner: string; agentId: string; sessionId: string; expires: number };

export function createAgentSessionRoutes(context: {
  gateway: AgentGateway; owners: WeakMap<FastifyRequest, string>; devices: DeviceRegistry;
  streams: Set<PassThrough>; deviceStreams: Map<string, Set<PassThrough>>; submissions: SubmissionRegistry;
}) {
  const tokens = new Map<string, StreamToken>();
  const { gateway, owners, devices, streams, deviceStreams, submissions } = context;
  function sessionAdapter(params: z.infer<typeof paramsSchema>) {
    const adapter = gateway.sessions(params.agentId);
    if (!adapter.validSessionId(params.sessionId)) throw agentError("AGENT_SESSION_ID_INVALID", 400);
    return adapter;
  }
  function valid(rawUrl: string) {
    const url = new URL(rawUrl, "http://relay.local");
    const match = url.pathname.match(/^\/api\/agents\/([a-z][a-z0-9-]{0,63})\/sessions\/([^/]+)\/events$/u);
    if (!match) return null;
    prune();
    const token = tokens.get(url.searchParams.get("streamToken") ?? "");
    return token && token.agentId === match[1] && token.sessionId === decodeURIComponent(match[2]!) && devices.has(token.owner) ? token : null;
  }
  function prune() { for (const [id, token] of tokens) if (token.expires <= Date.now() || !devices.has(token.owner)) tokens.delete(id); }
  return {
    owner(rawUrl: string) { return valid(rawUrl)?.owner ?? null; },
    revoke(owner: string) { for (const [id, token] of tokens) if (token.owner === owner) tokens.delete(id); },
    register(app: FastifyInstance) {
      app.get("/api/agents/:agentId/sessions", async request => {
        const { agentId: id } = z.object({ agentId }).parse(request.params);
        const query = z.object({ search: z.string().max(200).optional(), cursor: z.string().max(8192).optional(), range: z.enum(["recent", "all"]).optional() }).parse(request.query);
        if (query.range && id !== "deepseek") throw agentError("AGENT_RANGE_UNSUPPORTED", 400);
        return gateway.sessions(id).listSessions(query.search, query.cursor, query.range);
      });
      app.get("/api/agents/:agentId/sessions/:sessionId/history", async request => {
        const { agentId: id, sessionId } = paramsSchema.parse(request.params);
        const { cursor } = z.object({ cursor: z.string().min(1).max(8192) }).parse(request.query);
        return sessionAdapter({ agentId: id, sessionId }).readHistory(sessionId, cursor);
      });
      app.post("/api/agents/:agentId/sessions/:sessionId/stream-token", { bodyLimit: 4096 }, async request => {
        const params = paramsSchema.parse(request.params); sessionAdapter(params);
        prune();
        if (tokens.size >= 1024) throw Object.assign(new Error("stream_limit"), { statusCode: 429 });
        const streamToken = randomUUID(), expires = Date.now() + 15 * 60_000;
        tokens.set(streamToken, { ...params, expires, owner: owners.get(request)! });
        return { streamToken, expiresAt: new Date(expires).toISOString() };
      });
      app.get("/api/agents/:agentId/sessions/:sessionId/events", async (request, reply) => {
        const params = paramsSchema.parse(request.params), streamToken = valid(request.url);
        if (!streamToken) return reply.code(401).send({ error: "unauthorized" });
        const adapter = sessionAdapter(params), owner = streamToken.owner;
        const { v } = z.object({ v: z.coerce.number().optional() }).parse(request.query);
        if (streams.size >= 32 || (deviceStreams.get(owner)?.size ?? 0) >= 4 || !devices.has(owner)) return reply.code(429).send({ error: "stream_limit" });
        const events = createEventStream(reply, streams), owned = deviceStreams.get(owner) ?? new Set<PassThrough>();
        deviceStreams.set(owner, owned); owned.add(events.stream);
        let closed = false, unsubscribe: (() => void) | undefined;
        events.onClose(() => { closed = true; unsubscribe?.(); owned.delete(events.stream); if (!owned.size) deviceStreams.delete(owner); });
        const publish = snapshotSender(events.send, "agent-session", v === 1);
        try {
          unsubscribe = await adapter.watchSession(params.sessionId, snapshot => publish(snapshot), () => events.stream.destroy());
          if (closed) unsubscribe();
          return events.ready();
        } catch (error) { events.stream.destroy(); throw error; }
      });
      app.post("/api/agents/:agentId/sessions/:sessionId/messages", { bodyLimit: 90_000 }, async request => {
        const params = paramsSchema.parse(request.params);
        const body = operationSchema.extend({ text: z.string().trim().min(1).max(20_000), delivery: z.enum(["steer", "queue"]) }).strict().parse(request.body);
        return execute(request, params, "message", body, () => sessionAdapter(params).sendMessage(params.sessionId, body));
      });
      app.post("/api/agents/:agentId/sessions/:sessionId/interrupt", { bodyLimit: 4096 }, async request => {
        const params = paramsSchema.parse(request.params), body = operationSchema.strict().parse(request.body);
        return execute(request, params, "interrupt", body, () => sessionAdapter(params).interruptSession(params.sessionId, body));
      });
      app.post("/api/agents/:agentId/sessions/:sessionId/questions/:id/respond", { bodyLimit: 65_536 }, async request => {
        const params = paramsSchema.extend({ id: z.string().uuid() }).parse(request.params);
        const body = operationSchema.extend({ answers: z.array(z.array(z.string().min(1).max(10_000)).min(1).max(100)).min(1).max(20) }).strict().parse(request.body);
        return execute(request, params, `question:${params.id}`, body, () => sessionAdapter(params).respondQuestion(params.sessionId, params.id, body));
      });
      app.post("/api/agents/:agentId/sessions/:sessionId/permissions/:id/respond", { bodyLimit: 4096 }, async request => {
        const params = paramsSchema.extend({ id: z.string().uuid() }).parse(request.params);
        const body = operationSchema.extend({ decision: z.enum(["once", "always", "reject"]) }).strict().parse(request.body);
        return execute(request, params, `permission:${params.id}`, body, () => sessionAdapter(params).respondPermission(params.sessionId, params.id, body));
      });
    },
  };
  function execute<T extends object>(request: FastifyRequest, params: z.infer<typeof paramsSchema>, action: string, body: { clientMessageId: string }, run: () => Promise<T>) {
    return submissions.execute(body.clientMessageId, { owner: owners.get(request), ...params, action, ...body }, run);
  }
}
