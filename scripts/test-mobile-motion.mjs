import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
await build({ entryPoints: ['apps/mobile/src/shared/haptics.ts'], outfile: path.join(dir, 'haptics.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const haptics = createRequire(import.meta.url)(path.join(dir, 'haptics.cjs'));
const read = file => fs.readFile(file, 'utf8');
const [composer, components, agents, app, css] = await Promise.all(['apps/mobile/src/features/chat/ComputerComposer.tsx', 'apps/mobile/src/features/chat/components.tsx', 'apps/mobile/src/features/agents/AgentWorkspace.tsx', 'apps/mobile/src/app/App.tsx', 'apps/mobile/src/styles.css'].map(read));

test('haptics vibrate with the pattern for each kind, respect the setting, and never throw', t => {
  const store = new Map(), calls = [];
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), savedStorage = globalThis.localStorage;
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator; globalThis.localStorage = savedStorage; });
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: pattern => { calls.push(pattern); return true; } } });
  assert.equal(haptics.hapticsEnabled(), true, 'on by default');
  haptics.haptic(); haptics.haptic('confirm'); haptics.haptic('warn');
  assert.deepEqual(calls, [8, 14, [12, 48, 12]]);
  haptics.setHapticsEnabled(false); haptics.haptic(); assert.equal(calls.length, 3); assert.equal(haptics.hapticsEnabled(), false);
  haptics.setHapticsEnabled(true); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  assert.doesNotThrow(() => haptics.haptic());
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate() { throw new Error('blocked'); } } });
  assert.doesNotThrow(() => haptics.haptic());
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(haptics.hapticsEnabled(), true); assert.doesNotThrow(() => haptics.setHapticsEnabled(false));
});
test('send, steer and queue tap before sending; Ctrl+Enter stays silent', () => {
  for (const call of ['onSend()', 'onSend("steer")', 'onSend("queue")']) assert.ok(composer.includes(`onClick={() => { haptic(); ${call}; }}`), call);
  assert.match(composer, /event\.preventDefault\(\); if \(canSend\) onSend\(\);/);
});
test('approval decisions: confirm for allow, warn for decline/cancel, in Codex cards and Agent permissions', () => {
  const card = components.slice(components.indexOf('export function ApprovalCard('));
  assert.match(card, /const respond = \(decision: LiveApprovalDecision\) => { haptic\(decision === "decline" \|\| decision === "cancel" \? "warn" : "confirm"\); onRespond\(decision\); };/);
  assert.doesNotMatch(card.slice(0, card.indexOf('\n}\n')), /onClick={\(\) => onRespond\(/);
  assert.match(agents, /if \(locked \|\| submitted\.current\) return; submitted\.current = true; setSent\(true\); haptic\(decision === "reject" \? "warn" : "confirm"\);/);
});
test('settings has a switch to turn haptics off', () => {
  assert.match(app, /role="switch" aria-label="发送和审批时轻微震动" aria-checked={haptics}/);
  assert.match(app, /useState\(hapticsEnabled\)/);
});
test('motion: messages and cards rise in, sheets slide both ways, reduced motion shortens everything', () => {
  const tail = css.slice(css.indexOf('/* U7: motion'));
  assert.match(tail, /\.message-bubble, \.tool-message, \.approval-card, \.agent-permission \{ animation: messageIn/);
  assert.match(tail, /\.voice-sheet \{ animation: sheetUp/);
  assert.match(tail, /\.settings-sheet \{ transition: transform 220ms [^;]*, visibility 0s linear 220ms; \}/, 'stays visible while sliding out');
  assert.match(tail, /\.settings-sheet\.open \{ transition: transform 220ms [^;]*, visibility 0s linear 0s; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation-duration: 1ms !important;[^}]*transition-duration: 1ms !important;/);
});
