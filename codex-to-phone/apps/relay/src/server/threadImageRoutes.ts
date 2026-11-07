import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CodexStore } from "../store/codexStore.js";
import { readThreadImage } from "../store/threadImages.js";

export function createProjectImageReader(read = readThreadImage) {
  let active = 0;
  const perOwner = new Map<string, number>();
  return async (owner: string, cwd: string, source: string) => {
    if (active >= 4 || (perOwner.get(owner) ?? 0) >= 2) throw Object.assign(new Error("image_busy"), { statusCode: 429 });
    active++;
    perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
    try {
      return await read(cwd, source);
    } finally {
      active--;
      const count = (perOwner.get(owner) ?? 1) - 1;
      if (count) perOwner.set(owner, count); else perOwner.delete(owner);
    }
  };
}
export type ProjectImageReader = ReturnType<typeof createProjectImageReader>;

export function registerThreadImageRoutes(app: FastifyInstance, store: CodexStore, owners: WeakMap<FastifyRequest, string>, readImage = createProjectImageReader()) {
  app.post("/api/threads/:threadId/images", { bodyLimit: 8192 }, async (request, reply) => {
    const { threadId } = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const { path } = z.object({ path: z.string().min(1).max(4096) }).strict().parse(request.body);
    const thread = await store.getThreadSummary(threadId);
    if (!thread?.cwd) return reply.code(404).send({ error: "image_thread_not_found" });
    return reply.header("Cache-Control", "no-store").send(await readImage(owners.get(request)!, thread.cwd, path));
  });
}
