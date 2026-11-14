import type { WorkItemResponse } from '../../../../../shared/workItem';
import { apiGet, apiPost, buildUrl, normalizeEndpoint } from '../connection/http';
import { cleanHandoffDraft, type HandoffDraft, type HandoffHost, type ProductHandoff } from './handoff';

const draftKey = 'mobileCodexProductHandoffV1';
export const migrationKey = 'mobileCodexHandoffMigrationV1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type MigrationHost = HandoffHost & { getState(): Promise<{ handoff?: ProductHandoff | null; handoffMigration?: { version: 1; id: string; digest: string } }> };
type ImportResult = { storeId: string; storeRevision: number; imports: { legacyId: string; uid: string; fingerprint: string }[] };
type Packet = { storeId: string; scope: string; handoff: ProductHandoff | null; draft: Omit<HandoffDraft, 'attachments'> & { attachments: Omit<HandoffDraft['attachments'][number], 'previewUrl'>[] } | null };
type Journal = { version: 1; endpoint: string; scope: string; native: { id: string; digest: string } | null; rawDraft: string | null; packet: Packet };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const size = (value: string) => new TextEncoder().encode(value).length;
const fail = (text: string): never => { throw new Error(text); };
const active = new Set<string>();
function handoffValue(value: ProductHandoff): ProductHandoff {
  if (!value || value.revision !== 1 || !uuid(value.id) || !['draft', 'uncertain', 'confirmed'].includes(value.status)
    || typeof value.text !== 'string' || size(value.text) > 64 * 1024 || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || value.createdAt > 8640000000000000) fail('旧交接记录无法核验，已保留原数据。');
  if (value.target && (!uuid(value.target.threadId) || typeof value.target.scope !== 'string' || !value.target.scope || size(value.target.scope) > 4096
    || typeof value.target.title !== 'string' || size(value.target.title) > 4096 || (value.target.cwd != null && (typeof value.target.cwd !== 'string' || size(value.target.cwd) > 4096)))) fail('旧交接目标无法核验，已保留原数据。');
  if ((value.message !== undefined && (typeof value.message !== 'string' || size(value.message) > 96 * 1024))
    || (value.clientMessageId !== undefined && value.clientMessageId !== value.id)
    || (value.acceptance !== undefined && !['desktop', 'queue'].includes(value.acceptance))
    || (value.status !== 'draft' && (!value.target || !value.message || value.clientMessageId !== value.id || (value.status === 'confirmed' && !value.acceptance)))) fail('旧交接送达记录无法核验，已保留原数据。');
  return { revision: 1, id: value.id, status: value.status, text: value.text, createdAt: value.createdAt,
    ...(value.clientMessageId ? { clientMessageId: value.clientMessageId } : {}), ...(value.message ? { message: value.message } : {}),
    ...(value.acceptance ? { acceptance: value.acceptance } : {}), ...(value.target ? { target: { scope: value.target.scope, threadId: value.target.threadId, title: value.target.title, ...(value.target.cwd !== undefined ? { cwd: value.target.cwd } : {}) } } : {}) };
}
function draftValue(value: HandoffDraft): NonNullable<Packet['draft']> {
  const draft = cleanHandoffDraft(value);
  if (!uuid(draft.id) || !draft.scope || size(draft.scope) > 4096 || size(draft.targetId) > 512) fail('旧草稿身份无法核验，已保留原数据。');
  return { ...draft, attachments: draft.attachments.map(({ previewUrl: _preview, ...asset }) => asset) };
}
export function hasLegacyHandoff(storage: Storage = localStorage) { return Boolean(storage.getItem(draftKey) || storage.getItem(migrationKey)); }
/** Explicit migration only: this function never submits a message or confirms delivery. */
export async function migrateHandoff(options: { endpoint: string; token: string; scope: string; host?: MigrationHost; storage?: Storage; signal?: AbortSignal;
  get?: typeof apiGet; post?: typeof apiPost }) {
  const storage = options.storage ?? localStorage, get = options.get ?? apiGet, post = options.post ?? apiPost;
  const endpoint = normalizeEndpoint(options.endpoint), check = () => options.signal?.throwIfAborted();
  if (active.has(endpoint)) fail('交接正在迁移，请等待当前操作完成。');
  active.add(endpoint);
  try {
    check();
    const saved = storage.getItem(migrationKey);
    let journal: Journal;
    if (saved) {
      if (size(saved) > 600 * 1024) fail('迁移记录过大，已保留原数据。');
      try { journal = JSON.parse(saved) as Journal; } catch { return fail('迁移记录无法读取，已保留原数据。'); }
      if (!journal || journal.version !== 1 || journal.endpoint !== endpoint || journal.scope !== options.scope || !uuid(journal.packet?.storeId)
        || journal.packet.scope !== options.scope || (journal.rawDraft !== null && (typeof journal.rawDraft !== 'string' || size(journal.rawDraft) > 128 * 1024))
        || (journal.native !== null && (!journal.native || !uuid(journal.native.id) || !hash(journal.native.digest)))) fail('请切回原连接完成迁移；旧记录已保留。');
      // Revalidate and whitelist persisted data before sending it across the bridge/network.
      const handoff = journal.packet.handoff ? handoffValue(journal.packet.handoff) : null;
      const draft = journal.packet.draft ? draftValue(journal.packet.draft as HandoffDraft) : null;
      if ((!handoff && !draft) || (handoff?.target && handoff.target.scope !== options.scope) || (draft && draft.scope !== options.scope)
        || (handoff ? journal.native?.id !== handoff.id : journal.native !== null)) fail('迁移记录身份不匹配，已保留原数据。');
      journal.packet = { storeId: journal.packet.storeId, scope: options.scope, handoff, draft };
    } else {
      const state = options.host ? await options.host.getState() : { handoff: null };
      check();
      const handoff = state.handoff ? handoffValue(state.handoff) : null, rawDraft = storage.getItem(draftKey);
      if (rawDraft && size(rawDraft) > 128 * 1024) fail('旧交接草稿过大，已保留原数据。');
      let draft: Packet['draft'] = null;
      if (rawDraft) {
        try { draft = draftValue(JSON.parse(rawDraft) as HandoffDraft); }
        catch { return fail('旧交接草稿无法核验，已保留原数据。'); }
      }
      if (!handoff && !draft) fail('没有需要迁移的旧交接。');
      if ((handoff?.target && handoff.target.scope !== options.scope) || (draft && draft.scope !== options.scope)) fail('请切回旧交接所属连接后再迁移。');
      const native = handoff ? state.handoffMigration : null;
      if (handoff && (!native || native.version !== 1 || native.id !== handoff.id || !hash(native.digest))) fail('请更新原生 App 后再迁移；旧交接仍可使用。');
      const info = await get<{ storeId: string }>(buildUrl(endpoint, '/api/work-items?limit=1'), options.token, options.signal);
      check(); if (!uuid(info.storeId)) fail('电脑尚未提供事项存储，请更新网关；旧交接已保留。');
      journal = { version: 1, endpoint, scope: options.scope, native: native ? { id: native.id, digest: native.digest } : null, rawDraft,
        packet: { storeId: info.storeId, scope: options.scope, handoff, draft } };
      const json = JSON.stringify(journal); if (size(json) > 600 * 1024) fail('迁移记录过大，已保留原数据。');
      storage.setItem(migrationKey, json); // Resume the exact immutable import after response/ACK loss.
    }
    if (journal.native && !options.host) fail('需要原生 App 完成迁移确认，旧记录已保留。');
    const result = await post<ImportResult>(buildUrl(endpoint, '/api/work-items/import-handoff'), options.token, journal.packet, options.signal);
    check();
    const expected = new Set([journal.packet.handoff?.id, journal.packet.draft?.id].filter(Boolean));
    if (result.storeId !== journal.packet.storeId || !Array.isArray(result.imports) || result.imports.length !== expected.size
      || new Set(result.imports.map(r => r.legacyId)).size !== expected.size
      || result.imports.some(r => !expected.has(r.legacyId) || !uuid(r.uid) || !hash(r.fingerprint))) fail('事项导入回执无法核验，旧记录已保留。');
    for (const record of result.imports) {
      const restored = await get<WorkItemResponse>(buildUrl(endpoint, `/api/work-items/${record.uid}`), options.token, options.signal);
      check();
      if (restored.storeId !== result.storeId || restored.item?.uid !== record.uid || restored.item.source?.kind !== 'legacy-handoff'
        || restored.item.source.legacyId !== record.legacyId || restored.item.source.importFingerprint !== record.fingerprint) fail('事项回读核验失败，旧记录已保留。');
    }
    let handoff: ProductHandoff | null = null;
    if (journal.native) {
      if (!options.host) fail('需要原生 App 完成迁移确认，旧记录已保留。');
      const imported = result.imports.find(r => r.legacyId === journal.native!.id)!;
      const response = await options.host!.handoff({ id: journal.native.id, action: 'ackMigration', expectedDigest: journal.native.digest, storeId: result.storeId, workItemUid: imported.uid });
      check();
      if (!response || !Object.hasOwn(response, 'handoff') || response.handoff?.id === journal.native.id) fail('原生迁移确认失败，旧记录已保留。');
      handoff = response.handoff ? handoffValue(response.handoff) : null;
    } else if (options.host) {
      const current = await options.host.getState(); check();
      handoff = current.handoff ? handoffValue(current.handoff) : null;
    }
    const draftChanged = storage.getItem(draftKey) !== journal.rawDraft;
    if (!draftChanged && journal.rawDraft !== null) storage.removeItem(draftKey);
    storage.removeItem(migrationKey);
    return { count: result.imports.length, handoff, draftChanged };
  } finally { active.delete(endpoint); }
}
