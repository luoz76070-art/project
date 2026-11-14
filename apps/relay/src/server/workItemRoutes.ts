import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PassThrough } from 'node:stream';
import { z } from 'zod';
import type { DeviceRegistry } from './devices.js';
import { createEventStream } from './eventStream.js';
import { WorkItemStore } from '../workItems/store.js';
import { bytes, fieldsSchema, limits, mutationSchema, stateSchema, uuid, workItemError } from '../workItems/schema.js';

export function createWorkItemRoutes(context: { root: string; owners: WeakMap<FastifyRequest, string>; devices: DeviceRegistry;
  streams: Set<PassThrough>; deviceStreams: Map<string, Set<PassThrough>> }) {
  const { owners, devices, streams, deviceStreams } = context;
  let pending: Promise<WorkItemStore> | undefined;
  const store = () => pending ??= WorkItemStore.open(context.root);
  const tokens = new Map<string, { owner: string; expires: number }>();
  const guard = (request: FastifyRequest) => () => { if (!devices.has(owners.get(request) ?? '')) throw workItemError('unauthorized', 401); };
  const prune = () => { for (const [id, value] of tokens) if (value.expires <= Date.now() || !devices.has(value.owner)) tokens.delete(id); };
  function valid(raw: string) {
    const url = new URL(raw, 'http://relay.local');
    if (url.pathname !== '/api/work-items/events') return null;
    prune(); return tokens.get(url.searchParams.get('streamToken') ?? '') ?? null;
  }
  return {
    owner(raw: string) { return valid(raw)?.owner ?? null; },
    revoke(owner: string) { for (const [id, value] of tokens) if (value.owner === owner) tokens.delete(id); },
    async stop() { if (pending) await (await pending).drain(); },
    register(app: FastifyInstance) {
      app.register(async routes => {
        routes.setErrorHandler((error, _request, reply) => {
          if (error instanceof z.ZodError || error instanceof SyntaxError) return reply.code(400).send({ error: 'invalid_request' });
          const value = error as { statusCode?: number; message?: string };
          if (value.statusCode === 413) return reply.code(413).send({ error: 'work_item_payload_too_large' });
          const known = value.message && /^work_item_[a-z_]+$/.test(value.message);
          return reply.code(known || value.statusCode === 401 ? value.statusCode ?? 500 : 503).send({ error: known ? value.message : value.statusCode === 401 ? 'unauthorized' : 'work_item_store_unavailable' });
        });
        routes.get('/api/work-items', async request => {
          const query = z.object({ state: stateSchema.optional(), cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).strict().parse(request.query);
          return (await store()).list(query.state, query.cursor, query.limit);
        });
        routes.get('/api/work-items/:uid', async request => (await store()).get(z.object({ uid: uuid }).parse(request.params).uid));
        routes.post('/api/work-items', { bodyLimit: limits.itemBytes }, async request => {
          const { uid: id, mutationId, expectedRevision, ...fields } = fieldsSchema.extend({ uid: uuid, ...mutationSchema.shape }).strict().parse(request.body);
          return (await store()).create(id, fields, owners.get(request)!, { mutationId, expectedRevision }, guard(request));
        });
        routes.patch('/api/work-items/:uid', { bodyLimit: limits.itemBytes }, async request => {
          const { uid: id } = z.object({ uid: uuid }).parse(request.params);
          const { mutationId, expectedRevision, ...fields } = fieldsSchema.partial().extend(mutationSchema.shape).strict().parse(request.body);
          return (await store()).patch(id, fields, { mutationId, expectedRevision }, owners.get(request)!, guard(request));
        });
        routes.post('/api/work-items/:uid/actions', { bodyLimit: 4096 }, async request => {
          const { uid: id } = z.object({ uid: uuid }).parse(request.params);
          const { action, reason, ...mutation } = mutationSchema.extend({ action: z.enum(['start', 'review', 'return', 'reopen']), reason: bytes(1024).optional() }).strict().parse(request.body);
          if (action === 'return' && !reason?.trim()) throw workItemError('work_item_reason_required', 400);
          return (await store()).action(id, action, reason ?? null, mutation, owners.get(request)!, guard(request));
        });
        // Only this authenticated, explicit user decision can enter done.
        routes.post('/api/work-items/:uid/verify', { bodyLimit: 4096 }, async request => {
          const { uid: id } = z.object({ uid: uuid }).parse(request.params);
          const { decision, reason, ...mutation } = mutationSchema.extend({ decision: z.enum(['accept', 'return']), reason: bytes(1024).optional() }).strict().parse(request.body);
          if (decision === 'return' && !reason?.trim()) throw workItemError('work_item_reason_required', 400);
          return (await store()).verify(id, decision, reason ?? null, mutation, owners.get(request)!, guard(request));
        });
        routes.post('/api/work-items/import-handoff', { bodyLimit: 512 * 1024 }, async request => (await store()).importHandoff(request.body, owners.get(request)!, guard(request)));
        routes.post('/api/work-items/stream-token', { bodyLimit: 4096 }, async request => {
          (await store()).info(); guard(request)(); prune();
          if (tokens.size >= 1024) throw workItemError('work_item_stream_limit', 429);
          const streamToken = randomUUID(), expires = Date.now() + 15 * 60_000;
          tokens.set(streamToken, { owner: owners.get(request)!, expires });
          return { streamToken, expiresAt: new Date(expires).toISOString() };
        });
        routes.get('/api/work-items/events', async (request, reply) => {
          const token = valid(request.url);
          if (!token) return reply.code(401).send({ error: 'unauthorized' });
          const current = await store(); current.info(); guard(request)();
          if (streams.size >= 32 || (deviceStreams.get(token.owner)?.size ?? 0) >= 4) return reply.code(429).send({ error: 'stream_limit' });
          const events = createEventStream(reply, streams), owned = deviceStreams.get(token.owner) ?? new Set<PassThrough>();
          deviceStreams.set(token.owner, owned); owned.add(events.stream);
          events.onClose(() => { owned.delete(events.stream); if (!owned.size) deviceStreams.delete(token.owner); });
          events.onClose(current.subscribe(event => events.send('work-item.changed', event)));
          events.send('work-items.reset', current.info());
          return events.ready();
        });
      });
    },
  };
}
