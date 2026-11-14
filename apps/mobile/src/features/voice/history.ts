/** V6: transcripts kept on this phone only (text, never audio) for a chosen number of days. */
export type VoiceHistoryEntry = { id: string; at: string; text: string };
export type VoiceHistorySettings = { enabled: boolean; days: 7 | 30 | 90 };
export const defaultVoiceHistorySettings: VoiceHistorySettings = { enabled: true, days: 30 };
export const voiceHistoryLimit = 200;
const historyKey = 'mobileCodexVoiceHistoryV1', settingsKey = 'mobileCodexVoiceHistorySettingsV1', maxText = 8000, day = 86_400_000;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
function read<T>(storage: Store | null, key: string): T | null { try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; } }
function write(storage: Store | null, key: string, value: unknown) { try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Full or unavailable storage only loses history. */ } }

export function voiceHistorySettings(storage = local()): VoiceHistorySettings {
  const value = read<Partial<VoiceHistorySettings>>(storage, settingsKey);
  return { enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaultVoiceHistorySettings.enabled,
    days: value?.days === 7 || value?.days === 90 ? value.days : 30 };
}
/** Turning history off deletes what was kept. */
export function setVoiceHistorySettings(next: VoiceHistorySettings, storage = local()) {
  write(storage, settingsKey, next);
  if (!next.enabled) clearVoiceHistory(storage); else readVoiceHistory(Date.now(), storage);
}
function valid(entry: unknown): entry is VoiceHistoryEntry {
  const value = entry as VoiceHistoryEntry;
  return Boolean(value) && typeof value.id === 'string' && typeof value.text === 'string' && Number.isFinite(Date.parse(value.at));
}
/** Newest first; expired or malformed entries are dropped and the pruned list is saved. */
export function readVoiceHistory(now = Date.now(), storage = local()): VoiceHistoryEntry[] {
  const settings = voiceHistorySettings(storage), raw = read<unknown[]>(storage, historyKey);
  if (!Array.isArray(raw)) return [];
  const kept = settings.enabled ? raw.filter(valid).filter(e => now - Date.parse(e.at) < settings.days * day).slice(0, voiceHistoryLimit) : [];
  if (kept.length !== raw.length) kept.length ? write(storage, historyKey, kept) : clearVoiceHistory(storage);
  return kept;
}
export function recordVoiceTranscript(text: string, now = Date.now(), storage = local()) {
  const value = text.trim();
  if (!value || !voiceHistorySettings(storage).enabled) return null;
  const entry: VoiceHistoryEntry = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: new Date(now).toISOString(), text: value.slice(0, maxText) };
  write(storage, historyKey, [entry, ...readVoiceHistory(now, storage)].slice(0, voiceHistoryLimit));
  return entry;
}
export function removeVoiceHistory(id: string, storage = local()) {
  write(storage, historyKey, readVoiceHistory(Date.now(), storage).filter(e => e.id !== id));
}
export function clearVoiceHistory(storage = local()) { try { storage?.removeItem(historyKey); } catch { /* nothing kept */ } }
