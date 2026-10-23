import path from "node:path";
import { DeviceRegistry } from "./devices.js";
import type { FastifyRequest } from "fastify";
import { snapshotSender } from "./snapshotPatch.js";
import { SubmissionRegistry } from "./submissions.js";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PassThrough } from "node:stream";
import { createEventStream } from "./eventStream.js";
import { CodexStore } from "../store/codexStore.js";
import { resolveCodexExecutableDetails } from "../codex/codexExecutable.js";
import { loadConfig, type RelayConfig } from "../config.js";
import { DesktopControl, type DesktopStreamSnapshot } from "../desktop/desktopControl.js";
import { LiveCodex } from "../codex/liveCodex.js";
import { LiveTurnController, type LiveTurnSnapshot } from "../codex/liveTurnController.js";
import { UploadStore } from "../store/uploadStore.js";
import { createAgentGateway, type AgentGateway } from "../agents/agentGateway.js";
import type { GatewayRuntimeStatus } from "../gateway/managedGateway.js";
import { createAgentSessionRoutes } from "./agentSessionRoutes.js";
import { authorizeClaudeBridge, registerClaudeBridgeRoutes } from "./claudeBridgeRoutes.js";
import { claudeConfigSchema } from "../agents/claudeProtocol.js";
import { VoiceCredentialStore } from "../voice/credentials.js";
import { VoiceService } from "../voice/service.js";
import { registerVoiceRoutes } from "./voiceRoutes.js";

export type RelayServerOptions = {
  config?: RelayConfig;
  logger?: boolean;
  gateway?: { snapshot: () => GatewayRuntimeStatus; managerKey: string; requestStop: () => void };
  services?: Partial<{
    store: CodexStore;
    live: LiveCodex;
    liveTurns: LiveTurnController;
    desktopControl: DesktopControl;
    uploads: UploadStore;
    agentGateway: AgentGateway;
    voice: VoiceService;
  }>;
};

export async function createRelayServer(options: RelayServerOptions = {}) {
  const config = options.config ?? loadConfig();
  if (config.claude && (!claudeConfigSchema.safeParse(config.claude).success || config.claude.bridgeToken === config.token)) throw new Error("CLAUDE_CONFIG_INVALID");
  const store = options.services?.store ?? new CodexStore(config.codexHome);
  const live = options.services?.live ?? new LiveCodex(config.defaultCwd);
  const liveTurns = options.services?.liveTurns ?? new LiveTurnController(config.defaultCwd);
  const desktopControl = options.services?.desktopControl ?? new DesktopControl(store, { codexHome: config.codexHome, transport: config.desktopTransport });
  const uploads = options.services?.uploads ?? new UploadStore(config.defaultCwd);
  const agentGateway = options.services?.agentGateway ?? createAgentGateway({ codexHome: config.codexHome, opencode: config.opencode, claude: config.claude, deepseek: config.deepseek });
  const claudeBridge = config.claude ? agentGateway.claudeBridge() : null;
  const submissions = new SubmissionRegistry();
  const devices = await DeviceRegistry.open(path.join(config.defaultCwd, ".mobile-codex", "devices.json"));
  if (!options.services?.desktopControl && (config.desktopTransport === "native" || (!config.desktopTransport && process.platform !== "darwin"))) await desktopControl.messageQueue.open(path.join(config.defaultCwd, ".mobile-codex", "desktop-queue.json"), owner => devices.has(owner));
  const voiceCredentials = await VoiceCredentialStore.open(path.join(config.defaultCwd, ".mobile-codex", "voice-credentials.json"));
  const voice = options.services?.voice ?? new VoiceService();
  const owners = new WeakMap<FastifyRequest, string>();
  const deviceStreams = new Map<string, Set<PassThrough>>();
  const uploadRequests = new Set<string>();
  const deviceUploads = new Map<string, number>();
  const streamTokens = new Map<string, { turnId: string; expiresAt: number; owner: string }>();
  const desktopStreamTokens = new Map<string, { threadId: string; expiresAt: number; owner: string }>();
  const app = Fastify({ logger: options.logger === false ? false : { serializers: { req: req => ({ method: req.method, url: req.url?.split("?")[0] }) }, redact: ["req.headers.authorization"] }, bodyLimit: 36 * 1024 * 1024 });

  const streams = new Set<PassThrough>();
  const agentSessionRoutes = createAgentSessionRoutes({ gateway: agentGateway, owners, devices, streams, deviceStreams, submissions });
  // A route may still await its upstream's first frame before reply.send(stream).
  // Cancel adapters before HTTP drain, otherwise onClose cannot release that wait.
  app.addHook("preClose", async () => { voice.stop(); for (const stream of streams) stream.destroy(); await Promise.all([agentGateway.stop(), desktopControl.messageQueue?.stop()]); });
  app.addHook("onClose", async () => { store.close(); await Promise.all([desktopControl.stop(), liveTurns.stop(), live.stop?.()]); });

  await app.register(cors, {
    origin: true,
  });

  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0];
    if (pathname === "/health" || pathname === "/api/pairing/consume" || request.method === "OPTIONS") return;
    if (pathname?.startsWith("/api/claude-bridge/")) {
      if (!authorizeClaudeBridge(request, config.claude?.bridgeToken)) return reply.code(401).send({ error: "unauthorized" });
      return;
    }
    const eventStream = parseLiveEventStreamUrl(request.url);
    const desktopEventStream = parseDesktopEventStreamUrl(request.url);
    let owner: string | null = null;
    if (eventStream && isValidStreamToken(eventStream.streamToken, eventStream.turnId)) owner = streamTokens.get(eventStream.streamToken!)!.owner;
    if (desktopEventStream && isValidDesktopStreamToken(desktopEventStream.streamToken, desktopEventStream.threadId)) owner = desktopStreamTokens.get(desktopEventStream.streamToken!)!.owner;
    owner ??= agentSessionRoutes.owner(request.url);
    if (!owner) {
      const header = request.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      owner = token === config.token ? "admin" : token ? devices.authenticate(token) : null;
    }
    if (!owner) return reply.code(401).send({ error: "unauthorized" });
    owners.set(request, owner);
    if (pathname === "/api/pairing" && owner !== "admin") return reply.code(403).send({ error: "admin_required" });
    if (pathname === "/api/uploads") {
      if (uploadRequests.size >= 4 || (deviceUploads.get(owner) ?? 0) >= 2) return reply.code(429).send({ error: "upload_busy" });
      uploadRequests.add(request.id);
      deviceUploads.set(owner, (deviceUploads.get(owner) ?? 0) + 1);
    }
    if (pathname.endsWith("/events") && (streams.size >= 32 || (deviceStreams.get(owner)?.size ?? 0) >= 4)) return reply.code(429).send({ error: "stream_limit" });
  });
  const releaseUpload = (request: FastifyRequest) => {
    if (!uploadRequests.delete(request.id)) return;
    const owner = owners.get(request)!;
    const count = (deviceUploads.get(owner) ?? 1) - 1;
    if (count) deviceUploads.set(owner, count); else deviceUploads.delete(owner);
  };
  app.addHook("onResponse", async request => releaseUpload(request));
  app.addHook("onError", async request => releaseUpload(request));
  app.addHook("onRequestAbort", async request => releaseUpload(request));

  app.post("/api/pairing", async () => devices.createPairing());
  app.post("/api/pairing/consume", { bodyLimit: 4096 }, async request => {
    const body = z.object({ code: z.string().min(1).max(128), name: z.string().trim().min(1).max(80).default("手机") }).parse(request.body);
    return devices.pair(body.code, body.name);
  });
  app.get("/api/devices", async request => ({ devices: devices.list().filter(device => owners.get(request) === "admin" || device.id === owners.get(request)), admin: owners.get(request) === "admin" }));
  app.delete("/api/devices/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (owners.get(request) !== "admin" && owners.get(request) !== id) return reply.code(403).send({ error: "admin_required" });
    await devices.revoke(id);
    await desktopControl.messageQueue?.revoke(id);
    voice.revoke(id);
    await voiceCredentials.remove(id);
    agentSessionRoutes.revoke(id);
    for (const stream of deviceStreams.get(id) ?? []) stream.destroy();
    for (const [token, value] of streamTokens) if (value.owner === id) streamTokens.delete(token);
    for (const [token, value] of desktopStreamTokens) if (value.owner === id) desktopStreamTokens.delete(token);
    return { ok: true };
  });

  app.get("/api/submissions/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { submission: submissions.receipt(id) };
  });

  app.get("/api/connection", async () => ({ ok: true, authenticated: true }));
  registerVoiceRoutes(app, { owners, devices, credentials: voiceCredentials, service: voice });
  if (config.claude && claudeBridge) registerClaudeBridgeRoutes(app, claudeBridge);

  if (options.gateway) {
    const gateway = options.gateway;
    app.get("/api/gateway", async () => ({ gateway: gateway.snapshot() }));
    app.post("/api/gateway/stop", { bodyLimit: 4096 }, async (request, reply) => {
      const key = request.headers["x-mobile-codex-manager-key"];
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
      if (owners.get(request) !== "admin" || !local || typeof key !== "string" || Buffer.byteLength(key) !== Buffer.byteLength(gateway.managerKey) || !timingSafeEqual(Buffer.from(key), Buffer.from(gateway.managerKey))) return reply.code(403).send({ error: "gateway_manager_required" });
      const { instanceId } = z.object({ instanceId: z.string().uuid() }).strict().parse(request.body);
      if (gateway.snapshot().instanceId !== instanceId) return reply.code(409).send({ error: "gateway_instance_changed" });
      // Schedule after sending the acknowledgement; closing also releases SSE streams.
      setImmediate(gateway.requestStop);
      return reply.code(202).send({ stopping: true, instanceId });
    });
  }

  app.get("/api/agents", async () => ({ agents: agentGateway.snapshot() }));
  app.post("/api/agents/:id/probe", { bodyLimit: 4096 }, async (request, reply) => {
    if (owners.get(request) !== "admin") return reply.code(403).send({ error: "admin_required" });
    const { id } = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }).parse(request.params);
    return { agent: await agentGateway.probe(id) };
  });
  agentSessionRoutes.register(app);

  app.get("/health", async () => ({
    ok: true,
    mode: "mobile-codex-relay",
  }));

  app.get("/api/status", async () => {
    const [liveStatus, desktopStatus, activeDesktopThread] = await Promise.all([
      live.status(),
      desktopControl.status(),
      store.getActiveDesktopThread().catch(() => null),
    ]);
    return {
      ok: true,
      mode: "mobile-codex-relay",
      codexHome: config.codexHome,
      defaultCwd: config.defaultCwd,
      uploadDir: uploads.getUploadDir(),
      codexExecutable: resolveCodexExecutableDetails(),
      live: liveStatus,
      desktopControl: desktopStatus,
      activeDesktopThread,
    };
  });

  app.get("/api/live/health", async () => live.status());

  app.get("/api/live/control/health", async () => liveTurns.status());

  app.get("/api/live/threads", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(200).optional(),
      })
      .parse(request.query);
    const limit = query.limit ?? 50;
    const [threads, liveThreads] = await Promise.all([
      store.listThreads(limit).catch(() => []),
      live.listThreads(Math.min(limit, 20)).catch(() => []),
    ]);
    return { threads: uniqueThreads([...liveThreads, ...threads], limit) };
  });

  app.get("/api/live/threads/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return live.readThread(params.id);
  });

  app.post("/api/live/messages", async (request) => {
    const body = z
      .object({
        threadId: z.string().min(1).optional(),
        message: z.string().min(1).max(20_000),
        cwd: z.string().min(1).nullable().optional(),
      })
      .parse(request.body);
    return live.sendMessage(body);
  });

  app.get("/api/live/turns", async () => ({ turns: liveTurns.listActiveTurns() }));

  app.post("/api/live/turns", async (request) => {
    const body = z
      .object({
        threadId: z.string().min(1).optional(),
        message: z.string().min(1).max(20_000),
        clientMessageId: z.string().uuid().optional(),
        cwd: z.string().min(1).nullable().optional(),
        approvalPolicy: z.enum(["never", "on-request"]).optional(),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
      })
      .parse(request.body);
    return submissions.execute(body.clientMessageId, { route: "live-turn", ...body }, () => liveTurns.startTurn(body));
  });

  app.get("/api/live/turns/:turnId", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const current = liveTurns.getTurn(params.turnId);
    const turn =
      current && (current.status === "completed" || current.status === "interrupted" || current.status === "failed")
        ? await liveTurns.refreshTurn(params.turnId)
        : current;
    if (!turn) {
      return { error: "not_found", turn: null };
    }
    return { turn };
  });

  app.post("/api/live/turns/:turnId/stream-token", async (request) => {
    if (streamTokens.size >= 1024) pruneStreamTokens();
    if (streamTokens.size >= 1024) throw Object.assign(new Error("Stream token limit"), { statusCode: 429 });
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", streamToken: null };
    const streamToken = randomUUID();
    const expiresAt = Date.now() + 15 * 60_000;
    streamTokens.set(streamToken, { turnId: params.turnId, expiresAt, owner: owners.get(request)! });
    pruneStreamTokens();
    return { streamToken, expiresAt: new Date(expiresAt).toISOString() };
  });

  app.get("/api/live/turns/:turnId/events", async (request, reply) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        streamToken: z.string().optional(),
        v: z.coerce.number().optional(),
      })
      .parse(request.query);
    if (!isValidStreamToken(query.streamToken, params.turnId)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    const current = liveTurns.getTurn(params.turnId);
    if (!current) {
      await reply.code(404).send({ error: "not_found" });
      return;
    }

    const owner = owners.get(request)!;
    // Reserve synchronously before subscriptions perform any asynchronous work.
    if (streams.size >= 32 || (deviceStreams.get(owner)?.size ?? 0) >= 4 || !devices.has(owner)) return reply.code(429).send({ error: "stream_limit" });
    const events = createEventStream(reply, streams);
    const owned = deviceStreams.get(owner) ?? new Set<PassThrough>();
    deviceStreams.set(owner, owned);
    owned.add(events.stream);
    events.onClose(() => { owned.delete(events.stream); if (!owned.size) deviceStreams.delete(owner); });
    const sendSnapshot = snapshotSender(events.send, "turn", query.v === 1);
    const onSnapshot = (snapshot: LiveTurnSnapshot) => {
      if (snapshot.turnId === params.turnId) sendSnapshot(snapshot);
    };
    liveTurns.on("snapshot", onSnapshot);
    events.onClose(() => liveTurns.off("snapshot", onSnapshot));
    sendSnapshot(current);
    return events.ready();
  });

  app.post("/api/live/turns/:turnId/steer", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        threadId: z.string().min(1).optional(),
        message: z.string().min(1).max(20_000),
        clientMessageId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", turn: null };
    return submissions.execute(body.clientMessageId, { route: "steer", turnId: params.turnId, ...body }, async () => ({ turn: await liveTurns.steerTurn({ threadId: body.threadId ?? current.threadId, turnId: params.turnId, message: body.message }) }));
  });

  app.post("/api/live/turns/:turnId/interrupt", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        threadId: z.string().min(1).optional(),
      })
      .parse(request.body ?? {});
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", turn: null };
    return { turn: await liveTurns.interruptTurn({ threadId: body.threadId ?? current.threadId, turnId: params.turnId }) };
  });

  app.post("/api/live/turns/:turnId/approvals/:approvalId/respond", async (request) => {
    const params = z
      .object({
        turnId: z.string().min(1),
        approvalId: z.string().min(1),
      })
      .parse(request.params);
    const body = z
      .object({
        decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
      })
      .parse(request.body);
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", turn: null };
    return { turn: await liveTurns.respondApproval({ turnId: params.turnId, approvalId: params.approvalId, decision: body.decision }) };
  });

  app.post("/api/live/turns/:turnId/user-inputs/:inputId/respond", { bodyLimit: 65_536 }, async request => {
    const params = z.object({ turnId: z.string().min(1).max(200), inputId: z.string().uuid() }).parse(request.params);
    const body = z.object({ threadId: z.string().min(1).max(200), answers: z.record(z.string(), z.array(z.string().min(1).max(10_000)).min(1).max(20)) }).strict().parse(request.body);
    return { turn: liveTurns.respondUserInput({ ...params, ...body }) };
  });

  app.post("/api/uploads", async (request) => {
    const body = z
      .object({
        fileName: z.string().min(1).max(200),
        dataBase64: z.string().min(1),
      })
      .parse(request.body);
    return { upload: await uploads.saveUpload(body) };
  });

  app.get("/api/threads", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(200).default(120), offset: z.coerce.number().int().min(0).default(0), query: z.string().max(200).default(""), range: z.enum(["recent", "all"]).default("recent") }).parse(request.query);
    const rows = await store.listThreads(query.limit + 1, query.offset, query.query, query.range === "recent" ? Date.now() - 30 * 86400_000 : 0);
    const threads = rows.slice(0, query.limit);
    return { threads, hasMore: rows.length > query.limit, nextOffset: query.offset + threads.length };
  });

  app.get("/api/threads/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return store.readThread(params.id);
  });

  app.get("/api/desktop/active", async () => {
    const active = await desktopControl.getActiveThread();
    return { ...active, mode: "desktop-session-tail-readonly" };
  });

  app.get("/api/desktop/control/health", async () => desktopControl.status());

  app.post("/api/desktop/threads/:id/stream-token", async (request) => {
    if (desktopStreamTokens.size >= 1024) pruneDesktopStreamTokens();
    if (desktopStreamTokens.size >= 1024) throw Object.assign(new Error("Stream token limit"), { statusCode: 429 });
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const streamToken = randomUUID();
    const expiresAt = Date.now() + 15 * 60_000;
    desktopStreamTokens.set(streamToken, { threadId: params.id, expiresAt, owner: owners.get(request)! });
    pruneDesktopStreamTokens();
    return { streamToken, expiresAt: new Date(expiresAt).toISOString() };
  });

  app.get("/api/desktop/threads/:id/events", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        streamToken: z.string().optional(),
        v: z.coerce.number().optional(),
        cursor: z.coerce.number().int().min(0).optional(),
        generation: z.string().max(200).optional(),
      })
      .parse(request.query);
    if (!isValidDesktopStreamToken(query.streamToken, params.id)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    if (!desktopControl.followThread) void desktopControl.status().catch(() => undefined);
    const owner = owners.get(request)!;
    // Reserve synchronously before subscriptions perform any asynchronous work.
    if (streams.size >= 32 || (deviceStreams.get(owner)?.size ?? 0) >= 4 || !devices.has(owner)) return reply.code(429).send({ error: "stream_limit" });
    const events = createEventStream(reply, streams);
    const owned = deviceStreams.get(owner) ?? new Set<PassThrough>();
    deviceStreams.set(owner, owned);
    owned.add(events.stream);
    events.onClose(() => { owned.delete(events.stream); if (!owned.size) deviceStreams.delete(owner); });
    const sendSnapshot = snapshotSender(events.send, "desktop", query.v === 1);
    const onSnapshot = (snapshot: DesktopStreamSnapshot) => {
      if (snapshot.threadId === params.id) sendSnapshot(snapshot);
    };
    const unsubscribe = desktopControl.onStreamSnapshot(onSnapshot);
    events.onClose(unsubscribe);
    const unfollow = desktopControl.followThread?.(params.id);
    if (unfollow) events.onClose(unfollow);
    const current = desktopControl.getStreamSnapshot(params.id);
    if (current) sendSnapshot(current);
    if (query.cursor !== undefined) {
      let cursor = query.cursor;
      let generation = query.generation;
      let stopped = false;
      let timer: NodeJS.Timeout | undefined;
      const tick = async () => {
        try {
          const delta = await store.readThreadDelta(params.id, cursor, undefined, generation);
          if (stopped) return;
          if (delta.cursor !== cursor || delta.messages.length || delta.reset || delta.generation !== generation) {
            events.send("delta", delta);
            cursor = delta.cursor;
            generation = delta.generation;
          }
          timer = setTimeout(tick, delta.truncated && delta.messages.length > 0 ? 0 : 500);
          timer.unref();
        } catch {
          events.stream.destroy();
        }
      };
      events.onClose(() => { stopped = true; clearTimeout(timer); });
      void tick();
    }
    return events.ready();
  });

  app.get("/api/desktop/threads/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        latest: z.coerce.boolean().optional(),
        before: z.coerce.number().int().min(0).optional(),
        generation: z.string().max(200).optional(),
        maxBytes: z.coerce.number().int().positive().max(2_000_000).optional(),
        maxMessages: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(request.query);
    const maxBytes = Math.min(query.maxBytes ?? 65_536, 262_144);
    const maxMessages = Math.min(query.maxMessages ?? 24, 120);
    const data = query.latest || query.before !== undefined
      ? await store.readThreadLatest(params.id, maxBytes, maxMessages, query.before, query.generation)
      : await store.readThreadWithCursor(params.id);
    return { ...data, mode: "desktop-session-tail-readonly" };
  });

  app.post("/api/desktop/threads/:id/user-inputs/:inputId/respond", { bodyLimit: 65_536 }, async request => {
    const { id, inputId } = z.object({ id: z.string().min(1).max(200), inputId: z.string().uuid() }).parse(request.params);
    const { answers } = z.object({ answers: z.record(z.string().max(10_000), z.array(z.string().min(1).max(10_000)).min(1).max(20)) }).strict().parse(request.body);
    return desktopControl.respondUserInput(id, inputId, answers);
  });

  app.post("/api/desktop/threads/:id/approvals/:approvalId/respond", { bodyLimit: 4096 }, async request => {
    const { id, approvalId } = z.object({ id: z.string().min(1).max(200), approvalId: z.string().uuid() }).parse(request.params);
    const { decision } = z.object({ decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]) }).strict().parse(request.body);
    return desktopControl.respondApproval(id, approvalId, decision);
  });

  function uniqueThreads(threads: Array<Awaited<ReturnType<CodexStore["getActiveDesktopThread"]>>>, limit: number) {
    const seen = new Set<string>();
    const result = [];
    for (const thread of threads) {
      if (!thread || seen.has(thread.id)) continue;
      seen.add(thread.id);
      result.push(thread);
      if (result.length >= limit) break;
    }
    return result;
  }

  app.get("/api/desktop/threads/:id/delta", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        cursor: z.coerce.number().int().min(0).optional(),
        generation: z.string().max(200).optional(),
      })
      .parse(request.query);
    return {
      ...(await store.readThreadDelta(params.id, query.cursor ?? 0, undefined, query.generation)),
      mode: "desktop-session-tail-readonly",
    };
  });

  app.post("/api/desktop/control/threads/:id/messages", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        message: z.string().min(1).max(20_000),
        clientMessageId: z.string().uuid().optional(),
        cwd: z.string().min(1).nullable().optional(),
        mode: z.enum(["auto", "start", "steer", "queue"]).optional(),
        controlToken: z.string().uuid().optional(),
        expectedTurnId: z.string().min(1).max(300).nullable().optional(),
      })
      .parse(request.body);
    const owner = owners.get(request)!;
    const fingerprint = body.mode === "queue" ? { route: "desktop-queue", threadId: params.id, message: body.message, owner } : { route: "desktop-message", threadId: params.id, ...body, owner };
    return submissions.execute(body.clientMessageId, fingerprint, () => desktopControl.sendMessage({
      threadId: params.id,
      message: body.message,
      cwd: body.cwd,
      mode: body.mode,
      clientMessageId: body.clientMessageId,
      controlToken: body.controlToken,
      expectedTurnId: body.expectedTurnId,
      owner,
    }));
  });

  app.post("/api/desktop/control/threads/:id/queue/:messageId/cancel", async (request) => {
    const { id, messageId } = z.object({ id: z.string().min(1).max(300), messageId: z.string().uuid() }).parse(request.params);
    if (!desktopControl.messageQueue) throw Object.assign(new Error("desktop_queue_unavailable"), { statusCode: 409 });
    await desktopControl.messageQueue.cancel(id, messageId);
    return { ok: true };
  });

  app.post("/api/desktop/control/threads/:id/interrupt", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({
      clientMessageId: z.string().uuid().optional(),
      controlToken: z.string().uuid().optional(),
      expectedTurnId: z.string().min(1).max(300).optional(),
    }).parse(request.body ?? {});
    return submissions.execute(body.clientMessageId, { route: "desktop-interrupt", threadId: params.id, ...body }, () => desktopControl.interruptThread(params.id, body));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_request" });
    const details = error as { statusCode?: number; code?: string; message?: string };
    const status = typeof details.statusCode === "number" ? details.statusCode : 500;
    if (status >= 500) request.log.error({ code: details.code, status }, "Relay request failed");
    return reply.code(status).send({ error: status >= 500 ? "relay_request_failed" : details.message });
  });
  return app;

  function parseLiveEventStreamUrl(rawUrl: string): { turnId: string; streamToken?: string } | null {
    const url = new URL(rawUrl, "http://relay.local");
    const match = url.pathname.match(/^\/api\/live\/turns\/([^/]+)\/events$/);
    if (!match?.[1]) return null;
    return { turnId: decodeURIComponent(match[1]), streamToken: url.searchParams.get("streamToken") ?? undefined };
  }

  function parseDesktopEventStreamUrl(rawUrl: string): { threadId: string; streamToken?: string } | null {
    const url = new URL(rawUrl, "http://relay.local");
    const match = url.pathname.match(/^\/api\/desktop\/threads\/([^/]+)\/events$/);
    if (!match?.[1]) return null;
    return { threadId: decodeURIComponent(match[1]), streamToken: url.searchParams.get("streamToken") ?? undefined };
  }

  function isValidStreamToken(streamToken: string | undefined, turnId: string): boolean {
    if (!streamToken) return false;
    pruneStreamTokens();
    const token = streamTokens.get(streamToken);
    return Boolean(token && token.turnId === turnId && token.expiresAt > Date.now() && devices.has(token.owner));
  }

  function pruneStreamTokens(): void {
    const now = Date.now();
    for (const [token, value] of streamTokens.entries()) {
      if (value.expiresAt <= now) streamTokens.delete(token);
    }
  }

  function isValidDesktopStreamToken(streamToken: string | undefined, threadId: string): boolean {
    if (!streamToken) return false;
    pruneDesktopStreamTokens();
    const token = desktopStreamTokens.get(streamToken);
    return Boolean(token && token.threadId === threadId && token.expiresAt > Date.now() && devices.has(token.owner));
  }

  function pruneDesktopStreamTokens(): void {
    const now = Date.now();
    for (const [token, value] of desktopStreamTokens.entries()) {
      if (value.expiresAt <= now) desktopStreamTokens.delete(token);
    }
  }
}
