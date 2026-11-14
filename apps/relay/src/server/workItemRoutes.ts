import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HandoffService } from '../workItems/handoffService.js';
import { WorkItemProgress } from '../workItems/progress.js';
import { handoffRequest, handoffResolve, handoffSubmit } from '../workItems/handoffSchema.js';
import type { OpenHandoffTarget } from './handoffChannels.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PassThrough } from 'node:stream';
import { z } from 'zod';
import type { DeviceRegistry } from './devices.js';
import { createEventStream } from './eventStream.js';
import { CaptureAssetStore } from '../capture/store.js';
import { WorkItemStore } from '../workItems/store.js';
import { bytes, captureSchema, fieldsSchema, limits, mutationSchema, stateSchema, uuid, workItemError } from '../workItems/schema.js';

export function createWorkItemRoutes(context: { retentionDays?: number; openHandoff?: OpenHandoffTarget; root: string; captures?: CaptureAssetStore; owners: WeakMap<FastifyRequest, string>; devices: DeviceRegistry;
  streams: Set<PassThrough>; deviceStreams: Map<string, Set<PassThrough>> }) {
  const { owners, devices, streams, deviceStreams } = context;
  let pending: Promise<WorkItemStore> | undefined;
  const captures = context.captures ?? new CaptureAssetStore(context.root);
  const openHandoff = context.openHandoff ?? (async () => { throw workItemError('work_item_handoff_unavailable', 503); });
  const progress = new WorkItemProgress(openHandoff);
  let retentionTimer: ReturnType<typeof setInterval> | undefined, stopped = false;
  const store = () => pending ??= WorkItemStore.open(context.root, captures).then(opened => {
    progress.attach(opened);
    if (!stopped && !retentionTimer) {
      // W6: purge expired card images and abandoned uploads now and every 6 hours.
      const sweep = () => void opened.retention(Date.now(), context.retentionDays ?? 30).catch(() => {});
      sweep(); retentionTimer = setInterval(sweep, 6 * 3_600_000); retentionTimer.unref?.();
    }
    return opened;
  });
  // Resume progress tracking after a relay restart, without creating a store for workspaces that never used work items.
  if (context.openHandoff) void fs.access(path.join(context.root, '.mobile-codex', 'work-items.json')).then(() => store()).catch(() => {});
  const handoffs = new HandoffService(context.root, captures, store, openHandoff);
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
    revoke(owner: string) { handoffs.revoke(owner); for (const [id, value] of tokens) if (value.owner === owner) tokens.delete(id); },
    cancelHandoffs() { handoffs.stop(); progress.stop(); },
    async stop() { stopped = true; clearInterval(retentionTimer); handoffs.stop(); progress.stop(); if (pending) await (await pending).drain().catch(() => {}); },
    register(app: FastifyInstance) {
      app.register(async routes => {
        routes.setErrorHandler((error, _request, reply) => {
          if (error instanceof z.ZodError || error instanceof SyntaxError) return reply.code(400).send({ error: 'invalid_request' });
          const value = error as { statusCode?: number; message?: string };
          if (value.message === 'work_item_handoff_text_too_long') {
            const { limit, length, excess } = error as unknown as { limit: number; length: number; excess: number };
            return reply.code(413).send({ error: value.message, limit, length, excess });
          }
          if (value.statusCode === 413) return reply.code(413).send({ error: 'work_item_payload_too_large' });
          const known = value.message && /^(work_item|capture)_[a-z_]+$/.test(value.message);
          return reply.code(known || value.statusCode === 401 ? value.statusCode ?? 500 : 503).send({ error: known ? value.message : value.statusCode === 401 ? 'unauthorized' : 'work_item_store_unavailable' });
        });
        routes.post('/api/work-items/:uid/handoffs/preview', { bodyLimit: 8192 }, async request => {
          const { uid } = z.object({ uid: uuid }).parse(request.params);
          return handoffs.preview(uid, handoffRequest.parse(request.body), owners.get(request)!, guard(request));
        });
        routes.post('/api/work-items/:uid/handoffs', { bodyLimit: 8192 }, async (request, reply) => {
          const { uid } = z.object({ uid: uuid }).parse(request.params);
          const receipt = await handoffs.submit(uid, handoffSubmit.parse(request.body), owners.get(request)!, guard(request));
          return reply.code(202).send(receipt);
        });
        routes.post('/api/work-items/:uid/handoffs/:id/resolve', { bodyLimit: 1024 }, async request => {
          const { uid, id } = z.object({ uid: uuid, id: uuid }).parse(request.params);
          return handoffs.resolve(uid, id, handoffResolve.parse(request.body).outcome, guard(request));
        });
        routes.get('/api/work-items/:uid/handoffs/:id', async request => {
          const { uid, id } = z.object({ uid: uuid, id: uuid }).parse(request.params);
          return handoffs.read(uid, id, owners.get(request)!, guard(request));
        });
        routes.get('/api/work-items', async request => {
          const query = z.object({ source: z.literal('capture').optional(), state: stateSchema.optional(), cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).strict().parse(request.query);
          return (await store()).list(query.state, query.cursor, query.limit, query.source === 'capture');
        });
        routes.get('/api/work-items/:uid', async request => (await store()).get(z.object({ uid: uuid }).parse(request.params).uid));
        routes.post('/api/work-items', { bodyLimit: limits.itemBytes }, async request => {
          const { uid: id, mutationId, expectedRevision, capture, storeId, ...fields } = fieldsSchema.extend({ capture: captureSchema.optional(), storeId: uuid.optional(), uid: uuid, ...mutationSchema.shape }).strict().parse(request.body);
          if (capture && storeId !== (await store()).info().storeId) throw workItemError('work_item_store_changed');
          if (capture) {
            // A replayed create of a deleted card answers 410 even though W6 already removed its images.
            if ((await store()).isDeleted(id)) throw workItemError('work_item_deleted', 410);
            if (fields.assets.length) throw workItemError('work_item_capture_assets_invalid', 400);
            fields.assets = (await captures.validate(capture.assetIds, capture.id, owners.get(request)!)).filter(a => a.role === 'original');
          }
          return (await store()).create(id, fields, owners.get(request)!, { mutationId, expectedRevision }, guard(request), capture);
        });
        routes.patch('/api/work-items/:uid', { bodyLimit: limits.itemBytes }, async request => {
          const { uid: id } = z.object({ uid: uuid }).parse(request.params);
          const { mutationId, expectedRevision, ...fields } = fieldsSchema.partial().extend(mutationSchema.shape).strict().parse(request.body);
          return (await store()).patch(id, fields, { mutationId, expectedRevision }, owners.get(request)!, guard(request));
        });
        routes.delete('/api/work-items/:uid', { bodyLimit: 4096 }, async request => {
          const { uid: id } = z.object({ uid: uuid }).parse(request.params);
          return (await store()).deleteCapture(id, mutationSchema.parse(request.body), owners.get(request)!, guard(request));
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
          events.onClose(current.subscribe(event => events.send(event.deleted ? 'work-item.deleted' : 'work-item.changed', event)));
          events.send('work-items.reset', current.info());
          return events.ready();
        });
      });
    },
  };
}
