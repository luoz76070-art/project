import { mergeVoiceDraft, type VoiceResult } from "./model";

export const voiceRecoveryTtl = 15 * 60_000;
export type VoicePending = { requestId: string; stage: "asr" | "refine"; scope: string; thread: string; createdAt: number; draftHash: string };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (scope: string) => `mobileCodexVoicePendingV1:${scope}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function voiceDraftHash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function loadVoicePending(storage: StoragePort, scope: string, now = Date.now()): VoicePending[] {
  const raw = storage.getItem(key(scope));
  if (!raw) return [];
  let values: unknown;
  try { values = raw.length <= 128_000 ? JSON.parse(raw) : null; } catch { values = null; }
  const valid = Array.isArray(values) ? values.slice(0, 64).flatMap((r: VoicePending) => {
    if (!r || !uuid.test(r.requestId) || !["asr", "refine"].includes(r.stage) || r.scope !== scope || typeof r.thread !== "string" || !r.thread || r.thread.length > 1024 || !/^[a-f0-9]{64}$/.test(r.draftHash) || !Number.isFinite(r.createdAt) || r.createdAt > now || now - r.createdAt >= voiceRecoveryTtl) return [];
    return [{ requestId: r.requestId, stage: r.stage, scope, thread: r.thread, createdAt: r.createdAt, draftHash: r.draftHash }];
  }) : [];
  save(storage, scope, valid);
  return valid;
}
function save(storage: StoragePort, scope: string, records: VoicePending[]) {
  if (records.length) storage.setItem(key(scope), JSON.stringify(records.map(({ requestId, stage, scope, thread, createdAt, draftHash }) => ({ requestId, stage, scope, thread, createdAt, draftHash }))));
  else storage.removeItem(key(scope));
}
export async function recoveredVoiceDraft(record: VoicePending, current: string, text: string) {
  if (await voiceDraftHash(current) !== record.draftHash) throw new Error("输入框内容已变化，请复制所需文字后自行粘贴");
  return mergeVoiceDraft(current, current, text);
}
const cancelled = () => new DOMException("Voice request detached", "AbortError");

/** One coordinator per connection: POST at most once, every recovery path is GET-only. */
export function createVoiceRecovery(options: {
  scope: string; storage: StoragePort; query: (id: string, signal: AbortSignal) => Promise<VoiceResult>;
  restore: (record: VoicePending, text: string) => Promise<void>;
  now?: () => number; schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
}) {
  const now = options.now ?? Date.now, schedule = options.schedule ?? setTimeout;
  const live = new Map<string, { resolve: (text: string) => void; reject: (error: unknown) => void }>();
  const posting = new Set<string>();
  const consuming = new Set<string>();
  let visible = false, stopped = false, epoch = 0, delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined, queryController: AbortController | undefined;
  const records = () => loadVoicePending(options.storage, options.scope, now());
  const remove = (id: string) => save(options.storage, options.scope, records().filter(r => r.requestId !== id));
  function finish(id: string, text?: string, error?: unknown) {
    const waiter = live.get(id); live.delete(id);
    if (waiter) { if (text !== undefined) waiter.resolve(text); else waiter.reject(error ?? cancelled()); }
  }
  async function accept(record: VoicePending, result: VoiceResult) {
    if (result.status === "processing" || consuming.has(record.requestId) || !records().some(r => r.requestId === record.requestId)) return;
    consuming.add(record.requestId);
    try {
      if (result.status === "completed" && result.outcome === "succeeded") {
        if (!live.has(record.requestId)) await options.restore(record, result.text);
        if (stopped) return;
        remove(record.requestId); finish(record.requestId, result.text);
      } else {
        remove(record.requestId);
        finish(record.requestId, undefined, result.status === "completed" && result.outcome === "cancelled"
          ? cancelled()
          : new Error(result.status === "not_found" ? "语音结果已失效，可重新转写保留的录音。" : "语音处理失败，可重试；已有原文仍可采用。"));
      }
    } finally { consuming.delete(record.requestId); }
  }
  async function poll() {
    if (!visible || stopped) return;
    clearTimeout(timer);
    const generation = ++epoch;
    queryController?.abort(); queryController = new AbortController();
    const signal = queryController.signal;
    let hasPending = false;
    try {
      const pending = records(); hasPending = pending.length > 0;
      for (const id of live.keys()) if (!pending.some(r => r.requestId === id)) finish(id, undefined, new Error("语音结果已过期，可重新转写保留的录音。"));
      for (const record of pending) {
        if (signal.aborted) break;
        try {
          const result = await options.query(record.requestId, signal);
          if (signal.aborted || generation !== epoch || stopped) break;
          if (result.status === "not_found" && posting.has(record.requestId)) continue;
          await accept(record, result);
        } catch (error) {
          if ((error as { status?: number }).status === 401 || (error as { status?: number }).status === 404) {
            if (!signal.aborted && generation === epoch) { remove(record.requestId); finish(record.requestId, undefined, error); }
          }
        }
      }
    } catch { /* A blocked local store cannot authorize a new upload. Retry reads on foreground. */ } finally {
      if (hasPending && visible && !stopped && generation === epoch) {
        timer = schedule(() => { void poll(); }, delay); delay = Math.min(delay * 2, 8000);
      }
    }
  }
  return {
    async submit(record: VoicePending, post: () => Promise<string | null>): Promise<string> {
      if (stopped) throw cancelled();
      const pending = records();
      if (pending.some(r => r.requestId === record.requestId)) throw new Error("语音请求已提交，请查询结果。");
      if (pending.length >= 64) throw new Error("语音恢复记录已满，请稍后重试。");
      save(options.storage, options.scope, [...pending, record]); // Persist before a paid request; failure prevents upload.
      const result = new Promise<string>((resolve, reject) => live.set(record.requestId, { resolve, reject }));
      posting.add(record.requestId);
      void (async () => {
        try {
          const text = await post();
          if (!stopped && text !== null) await accept(record, { status: "completed", requestId: record.requestId, outcome: "succeeded", text, expiresAt: now() + voiceRecoveryTtl });
        } catch (error) {
          // Transport/proxy errors may hide a successful provider call. Only GET can resolve it.
          const status = (error as { status?: number }).status;
          if (!stopped && records().some(r => r.requestId === record.requestId) && status && [400, 401, 403, 409, 422, 429].includes(status)) { remove(record.requestId); finish(record.requestId, undefined, error); }
        } finally {
          posting.delete(record.requestId);
          if (!stopped) { clearTimeout(timer); delay = 1000; void poll(); }
        }
      })();
      if (visible) { clearTimeout(timer); timer = schedule(() => { void poll(); }, 1000); }
      return result;
    },
    cancel(id: string) { remove(id); finish(id); },
    detach(id: string) { finish(id); },
    setVisible(value: boolean) {
      visible = value; ++epoch; queryController?.abort(); clearTimeout(timer);
      if (value && !stopped) { delay = 1000; void poll(); }
    },
    stop() {
      stopped = true; ++epoch; queryController?.abort(); clearTimeout(timer);
      for (const id of live.keys()) finish(id);
    },
    poll,
  };
}
export type VoiceRecovery = ReturnType<typeof createVoiceRecovery>;
