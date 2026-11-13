import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WorkItem, WorkItemAsset, WorkItemAttempt, WorkItemChange, WorkItemResponse, WorkItemState, WorkItemSummary } from '../../../../shared/workItem.js';
import type { LastTurn } from '../../../../shared/lastTurn.js';
import { fieldsSchema, itemSchema, limits, mutationSchema, stateSchema, uuid, workItemError } from './schema.js';
import { applyTurnResult, newAttempt, recordDelivery, userAction, verifyItem, type InternalBinding, type UserAction } from './stateMachine.js';
import { importSchema, legacyEntries } from './legacy.js';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ mutationId: uuid, fingerprint: hashSchema, revision: z.number().int().positive() }).strict();
const entrySchema = z.object({ item: itemSchema, createFingerprint: hashSchema, receipts: z.array(receiptSchema).max(limits.receipts) }).strict();
const snapshotSchema = z.object({ schemaVersion: z.literal(1), storeId: uuid, storeRevision: z.number().int().safe().nonnegative(),
  entries: z.array(entrySchema).max(limits.items), imports: z.array(z.object({ legacyId: uuid, uid: uuid, fingerprint: hashSchema }).strict()).max(limits.items),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.entries.map(e => e.item.uid)).size !== data.entries.length || new Set(data.imports.map(e => e.legacyId)).size !== data.imports.length
    || new Set(data.imports.map(e => e.uid)).size !== data.imports.length
    || data.imports.some(e => !data.entries.some(x => x.item.uid === e.uid && x.item.source.legacyId === e.legacyId && x.item.source.importFingerprint === e.fingerprint))
    || data.entries.some(e => (e.item.source.kind === 'legacy-handoff' && !data.imports.some(i => i.uid === e.item.uid))
      || new Set(e.receipts.map(r => r.mutationId)).size !== e.receipts.length || e.receipts.some(r => r.revision > e.item.revision))) {
    ctx.addIssue({ code: 'custom', message: 'store_identity_invalid' });
  }
});
type Snapshot = z.infer<typeof snapshotSchema>;
type Guard = () => void;
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
export type ItemFields = z.infer<typeof fieldsSchema>;
export type Mutation = z.infer<typeof mutationSchema>;

/** A single Relay owns writes. No watcher, dispatch, background replay or asset deletion. */
export class WorkItemStore {
  private data: Snapshot | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: WorkItemChange) => void>();
  readonly file: string;
  private constructor(private root: string) { this.file = path.join(root, '.mobile-codex', 'work-items.json'); }
  static async open(root: string): Promise<WorkItemStore> {
    const store = new WorkItemStore(root);
    try {
      const stat = await fs.stat(store.file);
      if (stat.size > limits.storeBytes) throw new Error('oversized');
      const raw = await fs.readFile(store.file, 'utf8');
      if (Buffer.byteLength(raw) > limits.storeBytes) throw new Error('oversized');
      store.data = snapshotSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          // A missing primary with a backup requires explicit recovery, not an empty reset.
          const backup = await fs.stat(`${store.file}.bak`).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
          if (backup) return store;
          const initial: Snapshot = { schemaVersion: 1, storeId: randomUUID(), storeRevision: 0, entries: [], imports: [] };
          await store.persist(initial); store.data = initial;
        } catch { /* Keep only this feature unavailable; never overwrite unreadable data. */ }
      }
    }
    return store;
  }
  private snapshot(): Snapshot { if (!this.data) throw workItemError('work_item_store_unavailable', 503); return this.data; }
  info() { const data = this.snapshot(); return { storeId: data.storeId, storeRevision: data.storeRevision }; }
  get(uid: string): WorkItemResponse {
    const item = this.snapshot().entries.find(e => e.item.uid === uid)?.item;
    if (!item) throw workItemError('work_item_not_found', 404);
    return { item: clone(item), ...this.info() };
  }
  list(state?: WorkItemState, cursor?: string, limit = 50) {
    const data = this.snapshot();
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw workItemError('work_item_limit_invalid', 400);
    if (state) stateSchema.parse(state);
    let offset = 0;
    if (cursor) {
      const parsed = z.object({ revision: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), state: stateSchema.nullable() }).strict()
        .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
      if (parsed.revision !== data.storeRevision || parsed.state !== (state ?? null)) throw workItemError('work_item_cursor_stale');
      offset = parsed.offset;
    }
    const items = data.entries.map(e => e.item).filter(item => !state || item.state === state).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.uid.localeCompare(b.uid));
    const page: WorkItemSummary[] = items.slice(offset, offset + limit).map(({ uid, revision, kind, title, state, createdAt, updatedAt }) => ({ uid, revision, kind, title, state, createdAt, updatedAt }));
    return { ...this.info(), items: page, nextCursor: offset + limit < items.length ? Buffer.from(JSON.stringify({ revision: data.storeRevision, offset: offset + limit, state: state ?? null })).toString('base64url') : null };
  }
  subscribe(listener: (event: WorkItemChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async drain() { await this.writes; }
  create(uid: string, input: ItemFields, owner: string, mutation: Mutation, guard: Guard) {
    uuid.parse(uid); const fields = fieldsSchema.parse(input); mutationSchema.parse(mutation);
    const signature = fingerprint({ uid, fields, owner, mutation });
    return this.serialize(async () => {
      guard(); const data = this.snapshot(), existing = data.entries.find(e => e.item.uid === uid);
      if (existing) { if (existing.createFingerprint !== signature) throw workItemError('work_item_id_conflict'); return this.get(uid); }
      if (mutation.expectedRevision !== 0) throw workItemError('work_item_revision_conflict');
      await this.validateAssets(fields.assets);
      const now = new Date().toISOString();
      const item: WorkItem = { ...fields, schemaVersion: 1, uid, revision: 1, state: 'todo', createdAt: now, updatedAt: now,
        createdByDeviceId: owner, source: { kind: 'manual' }, currentAttempt: newAttempt(), lastTransition: null };
      const next = clone(data); next.entries.push({ item, createFingerprint: signature, receipts: [{ mutationId: mutation.mutationId, fingerprint: signature, revision: 1 }] });
      await this.commit(next, [uid], guard); return this.get(uid);
    });
  }
  patch(uid: string, patch: Partial<ItemFields>, mutation: Mutation, owner: string, guard: Guard) {
    const fields = fieldsSchema.partial().parse(patch);
    return this.mutate(uid, mutation, { action: 'edit', fields, owner }, guard, async item => {
      if (fields.assets) await this.validateAssets(fields.assets);
      return { ...item, ...fields };
    });
  }
  action(uid: string, action: UserAction, reason: string | null, mutation: Mutation, owner: string, guard: Guard) {
    return this.mutate(uid, mutation, { action, reason, owner }, guard, item => userAction(item, action, new Date().toISOString(), reason));
  }
  verify(uid: string, decision: 'accept' | 'return', reason: string | null, mutation: Mutation, owner: string, guard: Guard) {
    return this.mutate(uid, mutation, { verify: decision, reason, owner }, guard, item => verifyItem(item, decision, new Date().toISOString(), reason));
  }
  // These two methods are internal extension points only; no REST adapter exposes them.
  recordDelivery(uid: string, binding: WorkItemAttempt, actor: 'system' | 'agent', mutation: Mutation) {
    return this.mutate(uid, mutation, { binding, actor }, () => {}, item => recordDelivery(item, binding, new Date().toISOString(), actor));
  }
  applyTurnResult(uid: string, binding: InternalBinding, result: LastTurn | null | undefined, actor: 'system' | 'agent', mutation: Mutation) {
    return this.mutate(uid, mutation, { binding, result, actor }, () => {}, item => applyTurnResult(item, binding, result, new Date().toISOString(), actor));
  }
  importHandoff(raw: unknown, owner: string, guard: Guard) {
    const input = importSchema.parse(raw), sources = legacyEntries(input);
    return this.serialize(async () => {
      guard(); const data = this.snapshot();
      if (data.storeId !== input.storeId) throw workItemError('work_item_store_changed');
      const next = clone(data), changed: string[] = [], imports: Snapshot['imports'] = [];
      for (const source of sources) {
        const signature = fingerprint({ scope: input.scope, ...source });
        const previous = next.imports.find(e => e.legacyId === source.legacyId);
        if (previous) { if (previous.fingerprint !== signature) throw workItemError('work_item_import_conflict'); imports.push(previous); continue; }
        const { handoff, draft } = source, now = new Date().toISOString(), attempt = newAttempt();
        const locked = handoff && handoff.status !== 'draft';
        const detail = locked ? handoff.text : draft?.text ?? handoff!.text;
        const assets: WorkItemAsset[] = [];
        for (const attachment of draft?.attachments ?? []) {
          // A frozen submission is authoritative; don't attach later edited Web references.
          if (locked && !handoff.message?.split('\n').includes(`- ${attachment.fileName} | ${attachment.path}`)) continue;
          assets.push({ id: randomUUID(), relativePath: path.relative(this.root, attachment.path), fileName: attachment.fileName,
            size: attachment.size, ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}), managed: false });
        }
        await this.validateAssets(assets);
        if (handoff?.target) Object.assign(attempt, { channel: 'codex-desktop', agentId: 'codex', sessionId: handoff.target.threadId, cwd: handoff.target.cwd ?? null });
        else if (draft?.targetId) Object.assign(attempt, { channel: 'codex-desktop', agentId: 'codex', sessionId: draft.targetId });
        if (locked) Object.assign(attempt, { clientMessageId: handoff.clientMessageId, message: handoff.message,
          delivery: handoff.status === 'uncertain' ? 'unknown' : handoff.acceptance === 'queue' ? 'queued' : 'delivered' });
        const uid = randomUUID();
        const item: WorkItem = { schemaVersion: 1, uid, revision: 1, kind: 'task', title: [...(detail.trim().split('\n')[0] || '交接事项')].slice(0, limits.title).join(''), detail,
          state: attempt.delivery === 'delivered' ? 'in_progress' : 'todo', createdAt: handoff ? new Date(handoff.createdAt).toISOString() : now, updatedAt: now,
          createdByDeviceId: owner, source: { kind: 'legacy-handoff', legacyId: source.legacyId, importFingerprint: signature }, assets, codeRefs: [], currentAttempt: attempt, lastTransition: null };
        const record = { legacyId: source.legacyId, uid, fingerprint: signature };
        next.entries.push({ item, createFingerprint: signature, receipts: [] }); next.imports.push(record); imports.push(record); changed.push(uid);
      }
      if (changed.length) await this.commit(next, changed, guard);
      return { ...this.info(), imports: clone(imports) };
    });
  }
  private mutate(uid: string, mutation: Mutation, command: unknown, guard: Guard, run: (item: WorkItem) => WorkItem | Promise<WorkItem>) {
    uuid.parse(uid); mutationSchema.parse(mutation); const signature = fingerprint({ command, mutation });
    return this.serialize(async () => {
      guard(); const next = clone(this.snapshot()), entry = next.entries.find(e => e.item.uid === uid);
      if (!entry) throw workItemError('work_item_not_found', 404);
      const receipt = entry.receipts.find(r => r.mutationId === mutation.mutationId);
      if (receipt) { if (receipt.fingerprint !== signature) throw workItemError('work_item_mutation_conflict'); return this.get(uid); }
      if (entry.item.revision !== mutation.expectedRevision) throw workItemError('work_item_revision_conflict');
      const updated = await run(entry.item);
      if (updated === entry.item) return this.get(uid);
      entry.item = { ...updated, revision: entry.item.revision + 1, updatedAt: new Date().toISOString() };
      entry.receipts.push({ mutationId: mutation.mutationId, fingerprint: signature, revision: entry.item.revision });
      entry.receipts = entry.receipts.slice(-limits.receipts);
      await this.commit(next, [uid], guard); return this.get(uid);
    });
  }
  private async validateAssets(assets: WorkItemAsset[]) {
    if (!assets.length) return;
    const uploadRoot = path.join(this.root, 'mobile-uploads');
    const actualRoot = await fs.realpath(uploadRoot).catch(() => { throw workItemError('work_item_asset_unavailable', 422); });
    if (actualRoot !== path.join(await fs.realpath(this.root), 'mobile-uploads')) throw workItemError('work_item_asset_outside_root', 422);
    for (const asset of assets) {
      if (path.isAbsolute(asset.relativePath) || !asset.relativePath.startsWith('mobile-uploads/') || asset.relativePath.split(/[\\/]/u).includes('..')) throw workItemError('work_item_asset_outside_root', 422);
      const actual = await fs.realpath(path.join(this.root, asset.relativePath)).catch(() => { throw workItemError('work_item_asset_unavailable', 422); });
      if (!actual.startsWith(`${actualRoot}${path.sep}`)) throw workItemError('work_item_asset_outside_root', 422);
      const stat = await fs.stat(actual);
      if (!stat.isFile() || stat.size !== asset.size || stat.size > limits.assetBytes) throw workItemError('work_item_asset_invalid', 422);
    }
  }
  private async commit(next: Snapshot, changed: string[], guard: Guard) {
    next.storeRevision++;
    if (next.entries.length > limits.items || Buffer.byteLength(JSON.stringify(next)) > limits.storeBytes) throw workItemError('work_item_capacity', 507);
    snapshotSchema.parse(next);
    await this.persist(next, guard);
    this.data = next;
    for (const uid of changed) { const item = next.entries.find(e => e.item.uid === uid)!.item;
      for (const listener of this.listeners) { try { listener({ uid, revision: item.revision, storeRevision: next.storeRevision }); } catch { /* A disconnected consumer cannot roll back a committed write. */ } }
    }
  }
  private async persist(next: Snapshot, guard: Guard = () => {}) {
    const dir = path.dirname(this.file); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (this.data) await this.atomic(`${this.file}.bak`, JSON.stringify(this.data));
    await this.atomic(this.file, JSON.stringify(next), guard);
  }
  private async atomic(file: string, content: string, guard: Guard = () => {}) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      guard(); await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(action, action); this.writes = pending.catch(() => undefined); return pending;
  }
}
