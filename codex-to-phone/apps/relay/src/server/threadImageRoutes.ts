import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CodexStore } from "../store/codexStore.js";
import { readThreadImage } from "../store/threadImages.js";

export function registerThreadImageRoutes(app: FastifyInstance, store: CodexStore, owners: WeakMap<FastifyRequest, string>) {
  let active = 0;
  const perOwner = new Map<string, number>();
  app.post("/api/threads/:threadId/images", { bodyLimit: 8192 }, async (request, reply) => {
    const { threadId } = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const { path } = z.object({ path: z.string().min(1).max(4096) }).parse(request.body);
    const owner = owners.get(request)!;
    if (active >= 4 || (perOwner.get(owner) ?? 0) >= 2) return reply.code(429).send({ error: "image_busy" });
    active++;
    perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
    try {
      const thread = await store.getThreadSummary(threadId);
      if (!thread?.cwd) return reply.code(404).send({ error: "image_thread_not_found" });
      const image = await readThreadImage(thread.cwd, path);
      return reply.header("Cache-Control", "no-store").send(image);
    } finally {
      active--;
      const count = (perOwner.get(owner) ?? 1) - 1;
      if (count) perOwner.set(owner, count); else perOwner.delete(owner);
    }
  });
}
