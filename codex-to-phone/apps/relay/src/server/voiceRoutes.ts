import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { DeviceRegistry } from "./devices.js";
import { VoiceCredentialStore, voiceConfigPatch } from "../voice/credentials.js";
import { VoiceService, VoiceError, transcribeSchema, refineSchema, MAX_AUDIO_BYTES } from "../voice/service.js";

export function registerVoiceRoutes(app: FastifyInstance, options: { owners: WeakMap<FastifyRequest, string>; devices: DeviceRegistry; credentials: VoiceCredentialStore; service: VoiceService }) {
  const { owners, devices, credentials, service } = options;
  const parsing = new Map<string, string>();
  const release = (request: FastifyRequest) => { parsing.delete(request.id); };
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" || !["/api/voice/transcribe", "/api/voice/refine"].includes(request.url.split("?")[0]!)) return;
    const owner = owners.get(request);
    if (!owner) return reply.code(401).send({ error: "unauthorized" });
    // Reserve before parsing a Base64 body, as well as before the paid operation.
    if (parsing.size >= 4 || [...parsing.values()].includes(owner)) return reply.code(429).send({ error: "voice_busy" });
    parsing.set(request.id, owner);
    reply.raw.once("close", () => release(request));
  });
  app.addHook("onResponse", async request => release(request));
  app.addHook("onError", async request => release(request));
  app.addHook("onRequestAbort", async request => release(request));
  const safe = (action: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    try { return await action(request, reply); }
    catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "voice_invalid_request" });
      if (error instanceof VoiceError) return reply.code(error.statusCode).send({ error: error.code });
      if (error instanceof Error && ["voice_deepseek_key_required_for_url", "voice_qwen_key_required_for_url"].includes(error.message)) return reply.code(409).send({ error: error.message });
      return reply.code(500).send({ error: "voice_unavailable" });
    }
  };
  app.get("/api/voice/config", safe(async request => credentials.status(owners.get(request)!)));
  app.post("/api/voice/config", { bodyLimit: 4096 }, safe(async request => {
    const owner = owners.get(request)!;
    return credentials.update(owner, voiceConfigPatch.parse(request.body), () => devices.has(owner));
  }));
  app.post("/api/voice/cancel", { bodyLimit: 256 }, safe(async request => {
    const { requestId } = z.object({ requestId: z.string().uuid() }).strict().parse(request.body);
    service.cancel(owners.get(request)!, requestId); return { ok: true };
  }));
  const operation = (kind: "transcribe" | "refine") => safe(async (request, reply) => {
    const owner = owners.get(request)!;
    if (!devices.has(owner)) throw new VoiceError("voice_cancelled", 409);
    const controller = new AbortController();
    const cancel = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on("close", cancel);
    try {
      const result = kind === "transcribe"
        ? await service.transcribe(owner, transcribeSchema.parse(request.body), credentials.get(owner), controller.signal)
        : await service.refine(owner, refineSchema.parse(request.body), credentials.get(owner), controller.signal);
      if (!devices.has(owner)) throw new VoiceError("voice_cancelled", 409);
      return result;
    } finally { reply.raw.off("close", cancel); }
  });
  app.post("/api/voice/transcribe", { bodyLimit: 4 * Math.ceil(MAX_AUDIO_BYTES / 3) + 1024 }, operation("transcribe"));
  app.post("/api/voice/refine", { bodyLimit: 128 * 1024 }, operation("refine"));
}
