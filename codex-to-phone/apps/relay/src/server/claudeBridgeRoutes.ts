import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ClaudeAdapter } from "../agents/claudeAdapter.js";
import { claudeBatchSchema, claudeRegisterSchema, claudeSessionId, claudeInteractionWaitSchema } from "../agents/claudeProtocol.js";

export function authorizeClaudeBridge(request: FastifyRequest, token?: string) {
  const header = request.headers.authorization;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(token && !request.headers.origin && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")
    && Buffer.byteLength(supplied) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)));
}

export function registerClaudeBridgeRoutes(app: FastifyInstance, adapter: ClaudeAdapter) {
  const params = z.object({ sessionId: claudeSessionId });
  app.post("/api/claude-bridge/register", { bodyLimit: 8192 }, async request => adapter.register(claudeRegisterSchema.parse(request.body)));
  app.post("/api/claude-bridge/:sessionId/events", { bodyLimit: 262_144 }, async request => {
    const { sessionId } = params.parse(request.params), body = claudeBatchSchema.parse(request.body);
    return adapter.ingest(sessionId, body.generation, body.sequence, body.events);
  });
  app.post("/api/claude-bridge/:sessionId/poll", { bodyLimit: 4096 }, async (request, reply) => {
    const { sessionId } = params.parse(request.params), { generation } = z.object({ generation: z.string().uuid() }).strict().parse(request.body);
    const controller = new AbortController(), abort = () => controller.abort();
    reply.raw.on("close", abort);
    try { return await adapter.poll(sessionId, generation, controller.signal); }
    finally { reply.raw.off("close", abort); }
  });
  app.post("/api/claude-bridge/:sessionId/end", { bodyLimit: 4096 }, async request => {
    const { sessionId } = params.parse(request.params), { generation } = z.object({ generation: z.string().uuid() }).strict().parse(request.body);
    return adapter.end(sessionId, generation);
  });
  app.post("/api/claude-bridge/:sessionId/interaction", { bodyLimit: 131_072 }, async (request, reply) => {
    const { sessionId } = params.parse(request.params), body = claudeInteractionWaitSchema.parse(request.body);
    const controller = new AbortController(), abort = () => controller.abort();
    reply.raw.on("close", abort);
    try { return await adapter.waitInteraction(sessionId, body, controller.signal); }
    finally { reply.raw.off("close", abort); }
  });
  app.post("/api/claude-bridge/:sessionId/interaction/close", { bodyLimit: 4096 }, async request => {
    const { sessionId } = params.parse(request.params), body = z.object({ generation: z.string().uuid(), id: z.string().uuid(), serial: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().parse(request.body);
    return adapter.closeInteraction(sessionId, body.generation, body.id, body.serial);
  });
}
