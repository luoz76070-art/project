import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PassThrough } from "node:stream";
import { z } from "zod";
import type { AgentGateway } from "../agents/agentGateway.js";
import { agentError } from "../agents/sessions.js";
import type { DeviceRegistry } from "./devices.js";
import type { SubmissionRegistry } from "./submissions.js";
import { createEventStream } from "./eventStream.js";
import { snapshotSender } from "./snapshotPatch.js";
import { createProjectImageReader, type ProjectImageReader } from "./threadImageRoutes.js";
import { assistantImageReferences } from "../store/imageReferences.js";

const agentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const paramsSchema = z.object({ agentId, sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/u) });
const operationSchema = z.object({ controlToken: z.string().uuid(), clientMessageId: z.string().uuid() });
type StreamToken = { owner: string; agentId: string; sessionId: string; expires: number };
type MediaBinding = { directory: string | null; epoch: number; references: Set<string>; history: Set<string> };

export function createAgentSessionRoutes(context: {
  gateway: AgentGateway; owners: WeakMap<FastifyRequest, string>; devices: DeviceRegistry;
  streams: Set<PassThrough>; deviceStreams: Map<string, Set<PassThrough>>; submissions: SubmissionRegistry;
  readImage?: ProjectImageReader;
}) {
  const tokens = new Map<string, StreamToken>();
  const media = new Map<string, Set<MediaBinding>>();
  const { gateway, owners, devices, streams, deviceStreams, submissions, readImage = createProjectImageReader() } = context;
  const mediaKey = (owner: string, params: z.infer<typeof paramsSchema>) => `${owner}\0${params.agentId}\0${params.sessionId}`;
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
        const owner = owners.get(request)!, key = mediaKey(owner, { agentId: id, sessionId });
        const bindings = [...(media.get(key) ?? [])].map(binding => ({ binding, epoch: binding.epoch, directory: binding.directory }));
        const page = await sessionAdapter({ agentId: id, sessionId }).readHistory(sessionId, cursor);
        for (const { binding, epoch, directory } of bindings) {
          if (!directory || binding.epoch !== epoch || !media.get(key)?.has(binding) || !devices.has(owner)) continue;
          for (const reference of assistantImageReferences(directory, page.messages)) {
            binding.history.delete(reference); binding.history.add(reference);
            if (binding.history.size > 2048) binding.history.delete(binding.history.values().next().value!);
          }
        }
        return page;
      });
      app.post("/api/agents/:agentId/sessions/:sessionId/images", { bodyLimit: 8192 }, async (request, reply) => {
        const params = paramsSchema.parse(request.params); sessionAdapter(params);
        const body = z.object({ path: z.string().min(1).max(4096) }).strict().parse(request.body);
        const owner = owners.get(request)!;
        const bindings = [...(media.get(mediaKey(owner, params)) ?? [])];
        const directories = new Set(bindings.map(binding => binding.directory).filter((value): value is string => value !== null));
        if (directories.size !== 1) throw agentError("AGENT_IMAGE_SUBSCRIPTION_REQUIRED", 409);
        const directory = [...directories][0]!;
        return reply.header("Cache-Control", "no-store").send(await readImage(owner, directory, body.path,
          target => bindings.some(binding => binding.directory === directory && (binding.references.has(target) || binding.history.has(target)))));
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
        if (!devices.has(owner)) return reply.code(401).send({ error: "unauthorized" });
        if (streams.size >= 32 || (deviceStreams.get(owner)?.size ?? 0) >= 4) return reply.code(429).send({ error: "stream_limit" });
        const events = createEventStream(reply, streams), owned = deviceStreams.get(owner) ?? new Set<PassThrough>();
        deviceStreams.set(owner, owned); owned.add(events.stream);
        const key = mediaKey(owner, params), bindings = media.get(key) ?? new Set<MediaBinding>();
        const binding: MediaBinding = { directory: null, epoch: 0, references: new Set(), history: new Set() };
        media.set(key, bindings); bindings.add(binding);
        let closed = false, unsubscribe: (() => void) | undefined;
        events.onClose(() => {
          // watchSession can still be awaiting its first upstream frame.
          if (!reply.sent && !reply.raw.headersSent && !devices.has(owner)) void reply.code(401).send({ error: "unauthorized" });
          closed = true; binding.directory = null; bindings.delete(binding); if (!bindings.size) media.delete(key);
          unsubscribe?.(); owned.delete(events.stream); if (!owned.size) deviceStreams.delete(owner); });
        const publish = snapshotSender(events.send, "agent-session", v === 1);
        try {
          unsubscribe = await adapter.watchSession(params.sessionId, snapshot => {
            if (closed) return;
            const directory = snapshot.connected && snapshot.agentId === params.agentId && snapshot.session.id === params.sessionId
              && path.isAbsolute(snapshot.session.directory) && !snapshot.session.directory.includes("\0") ? snapshot.session.directory : null;
            if (directory !== binding.directory) { binding.epoch++; binding.history.clear(); }
            binding.directory = directory;
            binding.references = directory ? assistantImageReferences(directory, snapshot.messages) : new Set();
            publish(snapshot);
          }, () => { binding.directory = null; events.stream.destroy(); });
          if (closed) unsubscribe();
          return reply.sent ? reply : events.ready();
        } catch (error) { events.stream.destroy(); if (reply.sent) return reply; throw error; }
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
      app.post("/api/agents/:agentId/sessions/:sessionId/queue/:id/cancel", { bodyLimit: 4096 }, async request => {
        const params = paramsSchema.extend({ id: z.string().uuid() }).parse(request.params);
        const body = operationSchema.strict().parse(request.body), adapter = sessionAdapter(params);
        if (!adapter.cancelQueuedMessage) throw agentError("AGENT_QUEUE_UNSUPPORTED", 409);
        return execute(request, params, `queue-cancel:${params.id}`, body, () => adapter.cancelQueuedMessage!(params.sessionId, params.id, body));
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
