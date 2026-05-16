import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CodexStore } from "./codexStore.js";
import { resolveCodexExecutable } from "./codexExecutable.js";
import { loadConfig } from "./config.js";
import { DesktopControl, type DesktopStreamSnapshot } from "./desktopControl.js";
import { LiveCodex } from "./liveCodex.js";
import { LiveTurnController, type LiveTurnSnapshot } from "./liveTurnController.js";
import { UploadStore } from "./uploadStore.js";

async function main() {
  const config = loadConfig();
  const store = new CodexStore(config.codexHome);
  const live = new LiveCodex(config.defaultCwd);
  const liveTurns = new LiveTurnController(config.defaultCwd);
  const desktopControl = new DesktopControl(store);
  const uploads = new UploadStore(config.defaultCwd);
  const streamTokens = new Map<string, { turnId: string; expiresAt: number }>();
  const desktopStreamTokens = new Map<string, { threadId: string; expiresAt: number }>();
  const app = Fastify({ logger: true, bodyLimit: 36 * 1024 * 1024 });

  await app.register(cors, { origin: true });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health") return;
    const eventStream = parseLiveEventStreamUrl(request.url);
    if (eventStream && isValidStreamToken(eventStream.streamToken, eventStream.turnId)) return;
    const desktopEventStream = parseDesktopEventStreamUrl(request.url);
    if (desktopEventStream && isValidDesktopStreamToken(desktopEventStream.streamToken, desktopEventStream.threadId)) return;

    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (token !== config.token) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    mode: "desktop-history-readonly",
    codexHome: config.codexHome,
    defaultCwd: config.defaultCwd,
    codexExecutable: resolveCodexExecutable(),
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
      codexExecutable: resolveCodexExecutable(),
      live: liveStatus,
      desktopControl: desktopStatus,
      activeDesktopThread,
    };
  });

  app.get("/api/live/health", async () => live.status());
  app.get("/api/live/control/health", async () => liveTurns.status());
  app.get("/api/live/threads", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).parse(request.query);
    return { threads: await live.listThreads(query.limit ?? 50) };
  });
  app.get("/api/live/threads/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return live.readThread(params.id);
  });
  app.post("/api/live/messages", async (request) => {
    const body = z
      .object({ threadId: z.string().min(1).optional(), message: z.string().min(1).max(20_000), cwd: z.string().min(1).nullable().optional() })
      .parse(request.body);
    return live.sendMessage(body);
  });
  app.get("/api/live/turns", async () => ({ turns: liveTurns.listActiveTurns() }));
  app.post("/api/live/turns", async (request) => {
    const body = z
      .object({
        threadId: z.string().min(1).optional(),
        message: z.string().min(1).max(20_000),
        cwd: z.string().min(1).nullable().optional(),
        approvalPolicy: z.enum(["never", "on-request"]).optional(),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
      })
      .parse(request.body);
    return liveTurns.startTurn(body);
  });
  app.get("/api/live/turns/:turnId", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const current = liveTurns.getTurn(params.turnId);
    const turn =
      current && (current.status === "completed" || current.status === "interrupted" || current.status === "failed")
        ? await liveTurns.refreshTurn(params.turnId)
        : current;
    return turn ? { turn } : { error: "not_found", turn: null };
  });
  app.post("/api/live/turns/:turnId/stream-token", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", streamToken: null };
    const streamToken = randomUUID();
    const expiresAt = Date.now() + 15 * 60_000;
    streamTokens.set(streamToken, { turnId: params.turnId, expiresAt });
    pruneStreamTokens();
    return { streamToken, expiresAt: new Date(expiresAt).toISOString() };
  });
  app.get("/api/live/turns/:turnId/events", async (request, reply) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const query = z.object({ streamToken: z.string().optional() }).parse(request.query);
    if (!isValidStreamToken(query.streamToken, params.turnId)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    const current = liveTurns.getTurn(params.turnId);
    if (!current) {
      await reply.code(404).send({ error: "not_found" });
      return;
    }
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (snapshot: LiveTurnSnapshot) => {
      raw.write(`event: turn\n`);
      raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };
    const onSnapshot = (snapshot: LiveTurnSnapshot) => {
      if (snapshot.turnId === params.turnId) send(snapshot);
    };
    send(current);
    const keepAlive = setInterval(() => {
      raw.write(`event: ping\n`);
      raw.write(`data: ${Date.now()}\n\n`);
    }, 15_000);
    liveTurns.on("snapshot", onSnapshot);
    request.raw.on("close", () => {
      clearInterval(keepAlive);
      liveTurns.off("snapshot", onSnapshot);
    });
  });
  app.post("/api/live/turns/:turnId/steer", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const body = z.object({ threadId: z.string().min(1).optional(), message: z.string().min(1).max(20_000) }).parse(request.body);
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", turn: null };
    return { turn: await liveTurns.steerTurn({ threadId: body.threadId ?? current.threadId, turnId: params.turnId, message: body.message }) };
  });
  app.post("/api/live/turns/:turnId/interrupt", async (request) => {
    const params = z.object({ turnId: z.string().min(1) }).parse(request.params);
    const body = z.object({ threadId: z.string().min(1).optional() }).parse(request.body ?? {});
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", turn: null };
    return { turn: await liveTurns.interruptTurn({ threadId: body.threadId ?? current.threadId, turnId: params.turnId }) };
  });
  app.post("/api/live/turns/:turnId/approvals/:approvalId/respond", async (request) => {
    const params = z.object({ turnId: z.string().min(1), approvalId: z.string().min(1) }).parse(request.params);
    const body = z.object({ decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]) }).parse(request.body);
    const current = liveTurns.getTurn(params.turnId);
    if (!current) return { error: "not_found", turn: null };
    return { turn: await liveTurns.respondApproval({ turnId: params.turnId, approvalId: params.approvalId, decision: body.decision }) };
  });

  app.post("/api/uploads", async (request) => {
    const body = z.object({ fileName: z.string().min(1).max(200), dataBase64: z.string().min(1) }).parse(request.body);
    return { upload: await uploads.saveUpload(body) };
  });

  app.get("/api/threads", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).parse(request.query);
    return { threads: await store.listThreads(query.limit ?? 50) };
  });
  app.get("/api/threads/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return store.readThread(params.id);
  });
  app.get("/api/desktop/active", async () => ({ ...(await desktopControl.getActiveThread()), mode: "desktop-session-tail-readonly" }));
  app.get("/api/desktop/control/health", async () => desktopControl.status());
  app.post("/api/desktop/threads/:id/stream-token", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const streamToken = randomUUID();
    const expiresAt = Date.now() + 15 * 60_000;
    desktopStreamTokens.set(streamToken, { threadId: params.id, expiresAt });
    pruneDesktopStreamTokens();
    return { streamToken, expiresAt: new Date(expiresAt).toISOString() };
  });
  app.get("/api/desktop/threads/:id/events", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z.object({ streamToken: z.string().optional() }).parse(request.query);
    if (!isValidDesktopStreamToken(query.streamToken, params.id)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    await desktopControl.status().catch(() => undefined);
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (snapshot: DesktopStreamSnapshot) => {
      raw.write(`event: desktop\n`);
      raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };
    const onSnapshot = (snapshot: DesktopStreamSnapshot) => {
      if (snapshot.threadId === params.id) send(snapshot);
    };
    const current = desktopControl.getStreamSnapshot(params.id);
    if (current) send(current);
    const keepAlive = setInterval(() => {
      raw.write(`event: ping\n`);
      raw.write(`data: ${Date.now()}\n\n`);
    }, 15_000);
    const unsubscribe = desktopControl.onStreamSnapshot(onSnapshot);
    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
  app.get("/api/desktop/threads/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        latest: z.coerce.boolean().optional(),
        maxBytes: z.coerce.number().int().positive().max(2_000_000).optional(),
        maxMessages: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(request.query);
    const data = query.latest
      ? await store.readThreadLatest(params.id, query.maxBytes ?? 262_144, query.maxMessages ?? 80)
      : await store.readThreadWithCursor(params.id);
    return { ...data, mode: "desktop-session-tail-readonly" };
  });
  app.get("/api/desktop/threads/:id/delta", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z.object({ cursor: z.coerce.number().int().min(0).optional() }).parse(request.query);
    return { ...(await store.readThreadDelta(params.id, query.cursor ?? 0)), mode: "desktop-session-tail-readonly" };
  });
  app.post("/api/desktop/control/threads/:id/messages", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ message: z.string().min(1).max(20_000), cwd: z.string().min(1).nullable().optional(), mode: z.enum(["auto", "start", "steer"]).optional() })
      .parse(request.body);
    return desktopControl.sendMessage({ threadId: params.id, message: body.message, cwd: body.cwd, mode: body.mode });
  });
  app.post("/api/desktop/control/threads/:id/interrupt", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return desktopControl.interruptThread(params.id);
  });

  await app.listen({ host: config.host, port: config.port });

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
    return Boolean(token && token.turnId === turnId && token.expiresAt > Date.now());
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
    return Boolean(token && token.threadId === threadId && token.expiresAt > Date.now());
  }

  function pruneDesktopStreamTokens(): void {
    const now = Date.now();
    for (const [token, value] of desktopStreamTokens.entries()) {
      if (value.expiresAt <= now) desktopStreamTokens.delete(token);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
