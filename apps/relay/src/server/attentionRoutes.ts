import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PassThrough } from "node:stream";
import { z } from "zod";
import type { AttentionHub } from "../attention/attentionHub.js";
import type { DeviceRegistry } from "./devices.js";
import { createEventStream } from "./eventStream.js";

/** F1: one stream per device with everything it sent work to; the phone's notification service is its only reader. */
export function createAttentionRoutes(context: {
  hub: AttentionHub; owners: WeakMap<FastifyRequest, string>; devices: DeviceRegistry;
  streams: Set<PassThrough>; deviceStreams: Map<string, Set<PassThrough>>;
}) {
  const { hub, owners, devices, streams, deviceStreams } = context;
  return {
    register(app: FastifyInstance) {
      app.get("/api/attention", async request => ({ items: hub.items(owners.get(request)!) }));
      app.get("/api/attention/events", async (request, reply) => {
        const owner = owners.get(request)!;
        if (!devices.has(owner)) return reply.code(401).send({ error: "unauthorized" });
        const events = createEventStream(reply, streams), owned = deviceStreams.get(owner) ?? new Set<PassThrough>();
        deviceStreams.set(owner, owned); owned.add(events.stream);
        events.send("snapshot", { items: hub.items(owner) });
        const unsubscribe = hub.subscribe(owner, change => change.item ? events.send("item", change.item) : events.send("removed", { key: change.key }));
        events.onClose(() => { unsubscribe(); owned.delete(events.stream); if (!owned.size) deviceStreams.delete(owner); });
        return events.ready();
      });
      app.post("/api/attention/respond", { bodyLimit: 4096 }, async request => {
        const body = z.object({ key: z.string().min(1).max(400), requestId: z.string().min(1).max(200), decision: z.enum(["allow", "deny"]) }).strict().parse(request.body);
        return hub.respond(owners.get(request)!, body.key, body.requestId, body.decision);
      });
    },
  };
}
