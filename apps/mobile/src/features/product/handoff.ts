import type { PendingAttachment, ThreadSummary, ThreadRuntime } from '../../app/types';
import { composeMessageWithAttachments } from '../chat/attachments';
import { isDesktopSource } from '../threads/model';

export type ProductHandoff = {
  revision: 1; id: string; status: 'draft' | 'uncertain' | 'confirmed'; text: string; createdAt: number;
  clientMessageId?: string; message?: string;
  acceptance?: 'desktop' | 'queue';
  target?: { scope: string; threadId: string; title: string; cwd?: string | null };
};
export type HandoffDraft = { id: string; text: string; scope: string; targetId: string; attachments: PendingAttachment[] };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type HandoffMutation = { id: string; action: 'submit' | 'confirm' | 'close'; message?: string; target?: ProductHandoff['target']; clientMessageId?: string; acceptance?: 'desktop' | 'queue' };
export type HandoffHost = { handoff(value: HandoffMutation): Promise<{ handoff?: ProductHandoff | null }> };
const key = 'mobileCodexProductHandoffV1';
const inFlight = new Set<string>();
const byteLength = (value: string) => new TextEncoder().encode(value).length;

function cleanDraft(value: HandoffDraft): HandoffDraft {
  if (typeof value.text !== 'string' || byteLength(value.text) > 64 * 1024 || typeof value.id !== 'string' ||
    typeof value.scope !== 'string' || typeof value.targetId !== 'string' || !Array.isArray(value.attachments) || value.attachments.length > 16) {
    throw new Error('交接内容过大或格式无效，请缩短说明并检查附件。');
  }
  return { id: value.id, text: value.text, scope: value.scope, targetId: value.targetId,
    attachments: value.attachments.map(item => {
      if (typeof item.id !== 'string' || typeof item.path !== 'string' || !item.path || typeof item.fileName !== 'string' ||
        !Number.isFinite(item.size) || item.size < 0 || item.size > 25 * 1024 * 1024) throw new Error('交接附件不可用，请重新添加。');
      return { id: item.id, path: item.path, fileName: item.fileName, size: item.size, createdAt: item.createdAt,
        relativePath: item.relativePath, mimeType: item.mimeType, previewUrl: null };
    }) };
}
export function saveHandoffDraft(value: HandoffDraft, storage: Storage = localStorage) {
  const json = JSON.stringify(cleanDraft(value));
  if (byteLength(json) > 128 * 1024) throw new Error('交接内容过大，请减少附件或缩短说明。');
  try { storage.setItem(key, json); }
  catch { throw new Error('交接草稿保存失败，请释放空间后重试。'); }
}
export function loadHandoffDraft(handoff: ProductHandoff, scope: string, storage: Storage = localStorage): HandoffDraft {
  let raw: string | null;
  try { raw = storage.getItem(key); }
  catch { throw new Error('无法读取交接草稿，请恢复存储后重试。'); }
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (value.id === handoff.id) return cleanDraft(value);
    } catch { throw new Error('已保存的交接草稿无法读取，请先检查存储。'); }
  }
  return { id: handoff.id, text: handoff.text, scope, targetId: '', attachments: [] };
}
export function removeHandoffDraft(storage: Storage = localStorage) { storage.removeItem(key); }

/** Save the exact binding before invoking the existing Desktop path. Never retries a send. */
export async function submitProductHandoff(options: {
  handoff: ProductHandoff; draft: HandoffDraft; scope: string; target: ThreadSummary; ready: boolean;
  host: HandoffHost; persist: (draft: HandoffDraft) => void;
  changed: (state: ProductHandoff) => void;
  send: (message: string, id: string, threadId: string) => Promise<'confirmed' | 'queued' | 'uncertain' | 'rejected'>;
}) {
  const { handoff, draft, target, scope } = options;
  if (inFlight.has(handoff.id) || handoff.status !== 'draft') throw new Error('交接已提交或结果待确认，请勿重复发送。');
  if (draft.id !== handoff.id || draft.scope !== scope || draft.targetId !== target.id || !isDesktopSource(target) || !options.ready) {
    throw new Error('目标会话或控制状态已改变，请重新核对后确认。');
  }
  const message = composeMessageWithAttachments(draft.text, draft.attachments);
  if (!message || byteLength(message) > 96 * 1024) throw new Error('请填写任务说明并检查附件大小。');
  inFlight.add(handoff.id);
  try {
    options.persist(draft);
    const { handoff: reserved } = await options.host.handoff({ id: handoff.id, action: 'submit', message,
      target: { scope, threadId: target.id, title: target.threadName || target.id, cwd: target.cwd } });
    if (!reserved || reserved.status !== 'uncertain' || reserved.id !== handoff.id || reserved.clientMessageId !== handoff.id ||
      reserved.target?.scope !== scope || reserved.target.threadId !== target.id || reserved.message !== message) {
      throw new Error('交接身份未能确认，尚未发送。请重新打开任务卡核查状态。');
    }
    options.changed(reserved);
    const delivery = await options.send(message, handoff.id, target.id);
    if (delivery === 'confirmed' || delivery === 'queued') {
      const result = await options.host.handoff({ id: handoff.id, action: 'confirm', clientMessageId: handoff.id, acceptance: delivery === 'queued' ? 'queue' : 'desktop' });
      if (result.handoff) options.changed(result.handoff);
    }
    // Any other result stays reserved. A rejected/unknown write is never silently replayed.
  } finally { inFlight.delete(handoff.id); }
}

export function handoffMatchesReceipt(handoff: ProductHandoff, scope: string, threadId: string | undefined, clientMessageId: string | undefined) {
  return handoff.status === 'uncertain' && handoff.target?.scope === scope && handoff.target.threadId === threadId &&
    handoff.clientMessageId === handoff.id && clientMessageId === handoff.id;
}

export function handoffReceiptAcceptance(handoff: ProductHandoff, scope: string, threadId: string | undefined, control: ThreadRuntime['desktopControl']): 'desktop' | 'queue' | null {
  if (control?.transport !== 'native') return null;
  if (control.submission?.delivery === 'confirmed' && handoffMatchesReceipt(handoff, scope, threadId, control.submission.clientMessageId)) return 'desktop';
  if (control.queue?.items.some(item => handoffMatchesReceipt(handoff, scope, threadId, item.clientMessageId))) return 'queue';
  return null;
}
