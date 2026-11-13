import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-voice-tests-'));
test.after(() => fs.rm(root, { recursive: true, force: true }));
const source = await fs.readFile(new URL('../apps/mobile/src/features/voice/model.ts', import.meta.url), 'utf8');
await fs.writeFile(path.join(root, 'model.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { mergeVoiceDraft, parseVoiceConfig, parseVoiceText, voiceError } = await import(path.join(root, 'model.mjs'));

// Exercise the actual HTTP error translator with a native transport stub; no real requests.
const httpSource = await fs.readFile(new URL('../apps/mobile/src/features/connection/http.ts', import.meta.url), 'utf8');
const httpJs = ts.transpileModule(httpSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/import[^;]+from "@capacitor\/core";/, 'const Capacitor = { isNativePlatform: () => false }; const CapacitorHttp = {};');
await fs.writeFile(path.join(root, 'http.mjs'), httpJs);
const { ensureHttpOk } = await import(path.join(root, 'http.mjs'));

test('voice adoption appends to the captured draft and rejects changed or excessive drafts', () => {
  assert.equal(mergeVoiceDraft('已有约束：不要发布', '已有约束：不要发布', '只分析 APK26'), '已有约束：不要发布\n\n只分析 APK26');
  assert.equal(mergeVoiceDraft('', '', ' 只分析 '), '只分析');
  assert.throws(() => mergeVoiceDraft('旧草稿', '新输入', '不要覆盖'), /输入框内容已变化/);
  assert.throws(() => mergeVoiceDraft('x'.repeat(19999), 'x'.repeat(19999), '任务'), /20000/);
});

test('voice response decoder refuses empty, truncated and unknown payloads', () => {
  assert.equal(parseVoiceText({ text: ' 只分析，不执行。 ' }), '只分析，不执行。');
  for (const raw of [null, {}, { text: 1 }, { text: '' }, { text: 'x'.repeat(20001) }]) assert.throws(() => parseVoiceText(raw));
  const config = { region: 'cn', workspace: '', qwenConfigured: true, deepseekConfigured: false, deepseekBaseUrl: 'https://provider.example/v1', qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', asrModel: 'qwen', promptModel: 'deepseek' };
  assert.equal(parseVoiceConfig(config), config);
  for (const raw of [null, {}, { ...config, region: 'unknown' }, { ...config, qwenConfigured: 'yes' }, { ...config, deepseekBaseUrl: undefined }, { ...config, qwenBaseUrl: undefined }]) assert.throws(() => parseVoiceConfig(raw));
});

test('voice errors expose actionable native messages and hide arbitrary exception text', () => {
  assert.match(voiceError(new Error('voice_microphone_denied')), /麦克风权限/);
  assert.match(voiceError(new Error('HTTP 404')), /更新网关/);
  assert.doesNotMatch(voiceError(new Error('upstream-secret-api-key')), /secret/);
});

test('voice HTTP errors identify stage, cause and required endpoint credential without exposing provider data', () => {
  for (const [stage, label] of [['asr', '百炼语音识别'], ['refine', 'DeepSeek 提示词整理']]) {
    for (const reason of ['auth', 'busy', 'endpoint', 'request', 'unavailable', 'response_invalid', 'timeout']) {
      assert.throws(() => ensureHttpOk(502, { error: `voice_${stage}_${reason}`, detail: 'provider-secret' }), error => {
        assert.match(error.message, new RegExp(label)); assert.doesNotMatch(error.message, /provider-secret/); return true;
      });
    }
  }
  assert.throws(() => ensureHttpOk(409, { error: 'voice_qwen_key_required_for_url' }), /百炼地址/);
  assert.throws(() => ensureHttpOk(409, { error: 'voice_audio_upgrade_required' }), /APK29/);
});
