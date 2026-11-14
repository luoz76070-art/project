import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-history-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
await build({ entryPoints: ['apps/mobile/src/features/voice/history.ts'], outfile: path.join(dir, 'history.mjs'), bundle: true, platform: 'node', format: 'esm' });
const h = await import(pathToFileURL(path.join(dir, 'history.mjs')).href);
const memory = () => { const map = new Map(); return { getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map }; };
const day = 86_400_000, t0 = Date.parse('2026-11-14T00:00:00Z');

test('defaults: on, 30 days, newest first, text only, capped', () => {
  const s = memory();
  assert.deepEqual(h.voiceHistorySettings(s), { enabled: true, days: 30 });
  h.recordVoiceTranscript('  第一条  ', t0, s); h.recordVoiceTranscript('第二条', t0 + 1000, s);
  assert.deepEqual(h.readVoiceHistory(t0 + 2000, s).map(e => e.text), ['第二条', '第一条']);
  assert.equal(h.recordVoiceTranscript('   ', t0, s), null);
  for (let i = 0; i < 250; i++) h.recordVoiceTranscript(`条目 ${i}`, t0 + 5000 + i, s);
  assert.equal(h.readVoiceHistory(t0 + 10_000, s).length, h.voiceHistoryLimit);
  assert.ok(!JSON.stringify([...s.map.values()]).includes('dataBase64'));
});
test('expired entries are pruned on read and the pruned list is saved', () => {
  const s = memory();
  h.recordVoiceTranscript('旧的', t0, s); h.recordVoiceTranscript('新的', t0 + 25 * day, s);
  assert.deepEqual(h.readVoiceHistory(t0 + 31 * day, s).map(e => e.text), ['新的']);
  assert.equal(JSON.parse(s.getItem('mobileCodexVoiceHistoryV1')).length, 1);
  h.setVoiceHistorySettings({ enabled: true, days: 7 }, s);
  assert.deepEqual(h.readVoiceHistory(t0 + 33 * day, s), [], '7-day window drops the 8-day-old entry');
  assert.equal(s.getItem('mobileCodexVoiceHistoryV1'), null);
});
test('turning history off deletes it and stops recording', () => {
  const s = memory();
  h.recordVoiceTranscript('私密内容', t0, s);
  h.setVoiceHistorySettings({ enabled: false, days: 30 }, s);
  assert.equal(s.getItem('mobileCodexVoiceHistoryV1'), null);
  assert.equal(h.recordVoiceTranscript('不应保存', t0, s), null);
  assert.deepEqual(h.readVoiceHistory(t0, s), []);
});
test('single delete, clear all, and corrupt storage are safe', () => {
  const s = memory();
  const a = h.recordVoiceTranscript('甲', t0, s); h.recordVoiceTranscript('乙', t0 + 1, s);
  h.removeVoiceHistory(a.id, s); assert.deepEqual(h.readVoiceHistory(t0 + 2, s).map(e => e.text), ['乙']);
  h.clearVoiceHistory(s); assert.deepEqual(h.readVoiceHistory(t0, s), []);
  s.setItem('mobileCodexVoiceHistoryV1', '{not json'); assert.deepEqual(h.readVoiceHistory(t0, s), []);
  s.setItem('mobileCodexVoiceHistorySettingsV1', '"weird"'); assert.deepEqual(h.voiceHistorySettings(s), { enabled: true, days: 30 });
});
