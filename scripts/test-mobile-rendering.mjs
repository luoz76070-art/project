import { channels, evidence, input as statusInput, statusInputs } from './fixtures/session-status.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { turnResults } from './fixtures/last-turn.mjs';
import { turnResult } from '../plugins/mobile-deepseek/turnResult.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-rendering-'));
const output = path.join(temp, 'render.cjs');
await build({ stdin: { contents: `export { createElement as h } from 'react'; export { renderToStaticMarkup as render } from 'react-dom/server'; export { DisclosureSummary } from './apps/mobile/src/shared/DisclosureSummary'; export { SidebarScrim } from './apps/mobile/src/features/threads/SidebarScrim'; export { MessageContent } from './apps/mobile/src/features/chat/MessageContent'; export { MessageTimeline, ToolMessageBubble } from './apps/mobile/src/features/chat/components'; export { ComputerComposer } from './apps/mobile/src/features/chat/ComputerComposer'; export { TurnResultNotice } from './apps/mobile/src/features/chat/TurnResultNotice'; export { SessionStatus } from './apps/mobile/src/features/chat/SessionStatus'; export { deriveSessionStatus, agentSessionStatus, codexSessionStatus, readActivityEvidence } from './apps/mobile/src/features/chat/sessionStatusModel'; export { imageSource } from './apps/mobile/src/features/chat/imageSources'; export { HandoffCard } from './apps/mobile/src/features/product/HandoffCard'; export { HandoffMigrationNotice } from './apps/mobile/src/features/product/HandoffMigrationNotice';`, resolveDir: root }, outfile: output, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, nodePaths: [path.join(root, 'apps/mobile/node_modules')] });
const originalStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: () => null };
const { default: { h, render, DisclosureSummary, SidebarScrim, MessageContent, MessageTimeline, ToolMessageBubble, ComputerComposer, imageSource, TurnResultNotice, SessionStatus, deriveSessionStatus, agentSessionStatus, codexSessionStatus, readActivityEvidence, HandoffCard, HandoffMigrationNotice } } = await import(pathToFileURL(output).href);
globalThis.localStorage = originalStorage;
test.after(() => fs.rm(temp, { recursive: true, force: true }));
const tool = index => ({ id: `t${index}`, role: 'tool', kind: 'commandExecution', text: `Command: rg query-${index}`, turnId: 'turn-a', timestamp: '2026-11-07T00:00:00Z' });
const note = index => ({ id: `n${index}`, role: 'assistant', kind: 'agentMessage', phase: 'commentary', text: `执行说明 ${index}`, turnId: 'turn-a' });
test('execution notes remain readable in order while only command and output details are folded', () => {
  const visible = [];
  const html = render(h(MessageTimeline, { messages: [note(1), tool(1), tool(2), note(2), tool(3), note(3)], running: true,
    renderMessage: message => { visible.push(message.id); return h('p', { 'data-note': message.id }, message.text); } }));
  assert.deepEqual(visible, ['n1', 'n2', 'n3']);
  assert.match(html, /^<p data-note="n1">执行说明 1<\/p><section/);
  assert.match(html, /<\/section><p data-note="n2">执行说明 2<\/p><section/);
  assert.match(html, /<\/section><p data-note="n3">执行说明 3<\/p>$/);
  assert.equal((html.match(/class="process-toggle"/g) ?? []).length, 2);
  assert.match(html, /2 项/); assert.match(html, /1 项/);
  assert.doesNotMatch(html, /Command:|query-|正在执行/);
});
test('completion and interruption never fold execution notes or final prose', () => {
  const final = { ...note(3), id: 'final', phase: 'final_answer', text: '最终正文' };
  for (const complete of [false, true]) {
    const html = render(h(MessageTimeline, { messages: [note(1), tool(1), note(2), ...(complete ? [final] : [])], running: false,
      renderMessage: message => h('p', {}, message.text) }));
    assert.match(html, /执行说明 1/); assert.match(html, /执行说明 2/);
    assert.doesNotMatch(html, /Command:|正在执行/);
    if (complete) assert.match(html, /执行完成.*<\/section><p>执行说明 2<\/p><p>最终正文<\/p>/);
    else assert.match(html, /执行记录/);
  }
});
test('notes without tools never get a tool-card wrapper that display preferences could hide', () => {
  const html = render(h(MessageTimeline, { messages: [note(1), note(2)], running: true, renderMessage: message => h('p', {}, message.text) }));
  assert.equal(html, '<p>执行说明 1</p><p>执行说明 2</p>');
});
test('expanded tool details show original command and output with one timeline expansion', () => {
  const message = { ...tool(1), text: 'Command: rg query-1\nOutput:\noriginal output' };
  const closed = render(h(ToolMessageBubble, { message, onCopy: () => {} }));
  const opened = render(h(ToolMessageBubble, { message, onCopy: () => {}, expanded: true }));
  assert.doesNotMatch(closed, /<details[^>]*\sopen/);
  assert.match(opened, /<details[^>]*\sopen/);
  assert.match(opened, /<pre>Command: rg query-1\nOutput:\noriginal output<\/pre>/);
});
test('Agent plain output is visible after expansion while Codex empty envelopes stay empty', () => {
  for (const text of ['DeepSeek output', 'Claude output', 'OpenCode output', 'Status: failed\nvisible failure']) {
    const message = { ...tool(1), kind: 'function_call_output', text };
    const html = render(h(ToolMessageBubble, { message, onCopy: () => {}, expanded: true }));
    assert.ok(html.includes(`<pre>${text}</pre>`));
    assert.doesNotMatch(html, /工具执行完成，无文本输出/);
  }
  for (const text of ['Tool: exec_command\nStatus: completed', 'Output:\n']) {
    const html = render(h(ToolMessageBubble, { message: { ...tool(1), kind: 'function_call_output', text }, onCopy: () => {}, expanded: true }));
    assert.doesNotMatch(html, /<pre>/);
    assert.match(html, /工具执行完成，无文本输出/);
  }
});
test('many running tools mount one collapsed live summary and no raw tool rows', () => {
  let calls = 0;
  const html = render(h(MessageTimeline, { messages: Array.from({ length: 40 }, (_, i) => tool(i)), running: true, renderMessage: () => { calls++; return h('pre', {}, 'RAW TOOL'); } }));
  assert.equal(calls, 0); assert.equal((html.match(/class="process-toggle"/g) ?? []).length, 1);
  assert.match(html, /aria-expanded="false"/); assert.match(html, /正在执行/); assert.match(html, /40 项/); assert.doesNotMatch(html, /RAW TOOL/);
});
test('completed process keeps the final answer outside; idle history never spins as running', () => {
  const final = { id: 'final', role: 'assistant', kind: 'agentMessage', phase: 'final_answer', turnId: 'turn-a', text: '最终正文' };
  const html = render(h(MessageTimeline, { messages: [tool(1), final], running: false, renderMessage: message => h('p', {}, message.text) }));
  assert.match(html, /执行完成/); assert.match(html, /最终正文/); assert.doesNotMatch(html, /正在执行/);
  const stopped = render(h(MessageTimeline, { messages: [tool(1)], running: false, renderMessage: () => null }));
  assert.match(stopped, /执行记录/); assert.doesNotMatch(stopped, /class="spin"/);
});
test('collapsed failures stay visible and different turns remain separate', () => {
  const html = render(h(MessageTimeline, { messages: [{ ...tool(1), text: 'Process exited with code 1' }, { ...tool(2), turnId: 'turn-b' }], renderMessage: () => null }));
  assert.equal((html.match(/class="process-toggle"/g) ?? []).length, 2); assert.match(html, /1 项异常/);
});
test('Markdown images with spaces and parentheses render as images, while code and HTML remain literal', () => {
  const html = render(h(MessageContent, { text: '验收截图\n\n![截图](</project/a (1).png>)\n\n![远程](https://example.com/a.png)\n\n`![代码](/not-loaded.png)`\n\n<script>alert(1)</script>' }));
  assert.equal((html.match(/class="message-image"/g) ?? []).length, 2);
  assert.match(html, /<code>!\[代码\]/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test('source policy rejects executable, cleartext and credentialed image URLs', () => {
  for (const source of ['javascript:alert(1)', 'data:text/html;base64,YQ==', 'https://user:secret@example.com/a.png', 'http://example.com/a.png', '\0.png']) assert.equal(imageSource(source).kind, 'invalid', source);
  for (const source of ['/project/a.png', 'output/a.png', 'file:///project/a.png']) assert.equal(imageSource(source).kind, 'local');
  assert.equal(imageSource('https://example.com/a.png').kind, 'remote');
});

test('all computer channels share composer controls without granting unsupported steer or stop', () => {
  const props = { draft: 'draft', onDraft() {}, onSend() {}, onStop() {}, onUpload() {}, voice: null, status: 'connected', placeholder: 'message', hasContent: true, canSend: true };
  const idle = render(h(ComputerComposer, props));
  assert.match(idle, /aria-label="上传文件"/); assert.match(idle, /aria-label="发送"/); assert.doesNotMatch(idle, /停止生成|引导发送/);
  const running = render(h(ComputerComposer, { ...props, running: true, canStop: true, deliveries: { steer: false, queue: true } }));
  assert.match(running, /disabled="" aria-label="引导发送"/); assert.match(running, /aria-label="排队发送"/); assert.match(running, /aria-label="停止生成"/);
  const empty = render(h(ComputerComposer, { ...props, draft: '', hasContent: false, running: true, canStop: false }));
  assert.match(empty, /disabled="" aria-label="停止生成"/); assert.doesNotMatch(empty, /aria-label="发送"/);
});

for (const result of turnResults) test(`S1 mobile renders ${result.status} in the existing notice area`, () => {
  const html = render(h(TurnResultNotice, { result }));
  assert.match(html, new RegExp(`data-turn-result="${result.status}"`));
  assert.ok(html.includes(result.reason.message)); assert.ok(html.includes(result.endedAt));
  assert.match(render(h(TurnResultNotice, { result, running: true })), /上轮/);
});
test('S1 actual DeepSeek model failure is visible on mobile, and unknown results stay absent', () => {
  const result = turnResult({ type: 'turn/end', seq: 3, time: 1000, data: { turn: 1, reason: { kind: 'error', error: { code: 'INVALID_REQUEST', message: 'model is unavailable on every account (per-model cooldown) PRIVATE' } } } });
  const html = render(h(TurnResultNotice, { result }));
  assert.match(html, /失败/); assert.match(html, /模型暂不可用/); assert.doesNotMatch(html, /PRIVATE/);
  for (const result of [undefined, null, { status: 'idle' }]) assert.equal(render(h(TurnResultNotice, { result })), '');
});

// Matrix checks the shared presentation contract, not upstream reachability.
for (const channel of channels) for (const [kind, patch] of Object.entries(statusInputs)) test(`S2 ${channel}: ${kind} has one shared label and skin`, () => {
  const status = deriveSessionStatus(statusInput(patch));
  assert.equal(status.kind, kind);
  const labels = { preparing: '准备中', thinking: '思考中', executing: '执行中', waiting: '等待', completed: '完成', failed: '失败', interrupted: '中断' };
  for (const variant of ['inline', 'notice', 'composer']) {
    const html = render(h(SessionStatus, { status, variant }));
    assert.ok(html.includes(`data-session-status="${kind}"`));
    assert.ok(html.includes(labels[kind]));
    assert.ok(!html.includes(channel));
  }
});
test('S2 evidence is whitelisted, bounded and attributed; unknown activity and receipts do not invent states', () => {
  const base = statusInput({ phase: 'running', lastTurn: turnResults[0] });
  assert.equal(deriveSessionStatus(base), null);
  assert.equal(deriveSessionStatus({ ...base, activityEvidence: evidence('thinking', 'old') }), null);
  assert.equal(deriveSessionStatus({ ...base, activityEvidence: evidence('new-kind') }), null);
  assert.equal(readActivityEvidence(evidence('thinking', 'x'.repeat(513))), null);
  assert.equal(readActivityEvidence({ ...evidence('thinking'), observedAt: 'invalid' }), null);
  assert.deepEqual(readActivityEvidence({ ...evidence('thinking'), command: 'PRIVATE' }), evidence('thinking'));
  assert.equal(deriveSessionStatus({ ...base, activityEvidence: evidence('outputting') }).kind, 'executing');
  for (const status of ['submitting', 'submitted', 'uncertain']) {
    assert.equal(deriveSessionStatus({ ...base, activityEvidence: evidence('working'), questions: [{ status }] }), null);
  }
  const waiting = deriveSessionStatus({ ...base, approvals: [{ status: 'pending' }], questions: [{ status: 'pending' }] });
  assert.equal(waiting.kind, 'waiting'); assert.match(waiting.detail, /审批和回答/);
  assert.equal(deriveSessionStatus({ ...base, online: false, approvals: [{ status: 'pending' }], activityEvidence: evidence('thinking') }), null);
  assert.equal(deriveSessionStatus(statusInput({ phase: 'unknown', lastTurn: turnResults[0] })), null);
  assert.equal(deriveSessionStatus(statusInput({ online: false, lastTurn: turnResults[0] })).kind, 'completed');
  assert.equal(deriveSessionStatus({ ...base, turnId: turnResults[0].turnId, approvals: [{ status: 'pending' }] }).kind, 'completed');
  assert.equal(render(h(SessionStatus, { status: null })), '');
});
test('S2 real channel normalizers require evidence, retain result reasons and leave unsupported preparation absent', () => {
  const runtime = { turnStatus: 'inProgress', statusTurnId: 'current', activity: 'thinking', approvals: [], userInputs: [], messages: [] };
  for (const watchMode of ['none', 'desktop-tail']) {
    assert.equal(codexSessionStatus({ ...runtime, watchMode }, true), null);
    assert.equal(codexSessionStatus({ ...runtime, watchMode, activityEvidence: evidence('working') }, true).kind, 'executing');
    assert.equal(codexSessionStatus({ ...runtime, watchMode, sourceConnected: false, activityEvidence: evidence('thinking') }, true), null);
  }
  for (const agentId of ['claude', 'deepseek', 'opencode']) {
    const snapshot = { agentId, status: 'running', connected: true, activeTurnId: 'current', activity: 'thinking', permissions: [], questions: [] };
    assert.equal(agentSessionStatus(snapshot, true), null);
    assert.equal(agentSessionStatus({ ...snapshot, activityEvidence: evidence('thinking') }, true).kind, 'thinking');
    assert.equal(agentSessionStatus({ ...snapshot, questions: [{ status: 'pending' }] }, true).kind, 'waiting');
    assert.equal(agentSessionStatus({ ...snapshot, status: 'idle', lastTurn: null }, true), null);
  }
  const failed = turnResult({ type: 'turn/end', seq: 20, data: { turn: 4, reason: { kind: 'error', error: { code: 'INVALID_REQUEST', message: 'model is unavailable on every account (per-model cooldown) PRIVATE' } } } });
  const status = agentSessionStatus({ status: 'idle', connected: true, permissions: [], questions: [], lastTurn: failed }, true);
  const html = render(h(SessionStatus, { status, variant: 'notice' }));
  assert.match(html, /失败/); assert.match(html, /模型暂不可用/); assert.doesNotMatch(html, /PRIVATE/);
});


test('W1 handoff migration entry preserves the existing card and calls completion only close', t => {
  const previous = globalThis.localStorage;
  t.after(() => { globalThis.localStorage = previous; });
  globalThis.localStorage = { getItem: () => null };
  const base = { revision: 1, id: '12345678-1234-4234-8234-123456789abc', text: '旧交接', createdAt: 1,
    target: { scope: 'fixture', threadId: '22345678-1234-4234-8234-123456789abc', title: '已有会话' }, message: '冻结正文' };
  for (const status of ['confirmed', 'uncertain']) {
    const html = render(h(HandoffCard, { handoff: { ...base, status, acceptance: 'desktop' }, scope: 'fixture', threads: [], ready: false,
      queue: false, migrate() {}, changed() {}, select() {}, refresh() {}, upload() {}, send() {} }));
    assert.match(html, /role="dialog"/); assert.match(html, /迁移为事项/); assert.doesNotMatch(html, />完成<|事项列表/);
    if (status === 'confirmed') assert.match(html, />关闭<\/button>/);
    else assert.doesNotMatch(html, />关闭<\/button>/);
  }
  assert.equal(render(h(HandoffMigrationNotice, { migrate() {} })), '');
  globalThis.localStorage = { getItem: () => 'legacy-source' };
  assert.match(render(h(HandoffMigrationNotice, { migrate() {} })), /迁移为事项/);
});


test('U10 local Markdown links render filename labels with full path titles and no navigation', () => {
  const cases = [
    ['[scripts/x.py](/Users/test/project/scripts/x.py)', '/Users/test/project/scripts/x.py', 'x.py'],
    ['[source](/workspace/src/index.ts:42)', '/workspace/src/index.ts:42', 'index.ts'],
    ['[source](src/index.ts#L8-L12)', 'src/index.ts#L8-L12', 'index.ts'],
    ['[source](../src/main.ts)', '../src/main.ts', 'main.ts'],
    ['[config](package.json)', 'package.json', 'package.json'],
    ['[read](</Users/test/My Project/a (1).md>)', '/Users/test/My Project/a (1).md', 'a (1).md'],
    ['[read](file:///tmp/a%20b.md)', 'file:///tmp/a%20b.md', 'a b.md'],
    [String.raw`[win](C:\work\src\main.ts)`, String.raw`C:\work\src\main.ts`, 'main.ts'],
  ];
  for (const [text, title, name] of cases) {
    const html = render(h(MessageContent, { text }));
    assert.ok(html.includes(`<span class="local-file-tag" title="${title}">${name}</span>`), html);
    assert.doesNotMatch(html, /<a\b|href=|<button\b|<img\b/);
  }
});

test('U10 file labels preserve HTTP links, literal code and unsupported schemes', () => {
  const html = render(h(MessageContent, { text: '[web](https://example.com/a) [local](/tmp/a.ts)\n\n`[literal](/tmp/code.ts)`\n\n```md\n[block](/tmp/block.ts)\n```\n\n[bad](javascript:alert(1)) [anchor](#heading)' }));
  assert.match(html, /<a href="https:\/\/example.com\/a" target="_blank" rel="noreferrer">web<\/a>/);
  assert.equal((html.match(/local-file-tag/g) ?? []).length, 1);
  assert.match(html, /<code>\[literal\]\(\/tmp\/code.ts\)<\/code>/);
  assert.match(html, /\[block\]\(\/tmp\/block.ts\)/);
  assert.doesNotMatch(html, /href="(?:javascript|file):/);
  assert.match(html, /\[bad\]\(javascript:alert\(1\)\)/);
});

test('U10 sidebar scrim has an accessible close action and follows the same open state as the sidebar', async () => {
  let closed = 0;
  const opened = SidebarScrim({ open: true, onClose: () => closed++ });
  assert.match(render(opened), /class="mobile-scrim show"/);
  assert.match(render(opened), /aria-label="关闭线程列表遮罩"/);
  opened.props.onClick(); assert.equal(closed, 1);
  const hidden = SidebarScrim({ open: false, onClose() {} });
  assert.equal(hidden.props.tabIndex, -1); assert.equal(hidden.props['aria-hidden'], true);
  const app = await fs.readFile(path.join(root, 'apps/mobile/src/app/App.tsx'), 'utf8');
  assert.match(app, /thread-sidebar glass-surface \$\{sidebarOpen \? "open"/);
  assert.match(app, /<SidebarScrim open=\{sidebarOpen\} onClose=\{\(\) => setSidebarOpen\(false\)\}/);
  assert.match(app, /useState\(\(\) => !selected && !isNewThread\)/);
  assert.match(app, /if \(previousSplitMode.current !== splitMode\) setSidebarOpen\(false\)/);
  const css = await fs.readFile(path.join(root, 'apps/mobile/src/styles.css'), 'utf8');
  assert.match(css, /\.mobile-scrim\.show\s*\{[^}]*pointer-events: auto;[^}]*background: var\(--scrim\)/);
  assert.match(css, /:root \{[^}]*--scrim: #0006;/);
  assert.match(css, /:root\[data-theme="dark"\] \{[^}]*--scrim: #0009;/);
});

test('U10 latest-message pill occupies composer flow and settings use rotating Lucide disclosure arrows', async () => {
  const html = render(h('details', { className: 'settings-disclosure', open: true }, h(DisclosureSummary, {}, '连接能力')));
  assert.match(html, /<summary><svg[^>]*settings-chevron[^>]*aria-hidden="true"/);
  assert.match(html, /<span>连接能力<\/span>/);
  const css = await fs.readFile(path.join(root, 'apps/mobile/src/styles.css'), 'utf8');
  const pill = css.match(/\.latest-pill \{([^}]+)\}/)[1];
  assert.match(pill, /position: relative/); assert.match(pill, /justify-self: end/);
  assert.match(pill, /background: var\(--panel-strong\)/); assert.match(pill, /box-shadow: var\(--shadow\)/);
  assert.doesNotMatch(pill, /bottom:|position: (?:absolute|fixed)/);
  assert.doesNotMatch(css, /\.product-remote-shell \.latest-pill \{ box-shadow: none/);
  assert.match(css, /\.settings-disclosure > summary::-webkit-details-marker \{ display: none/);
  assert.match(css, /\.settings-disclosure > summary::marker \{ content: ""/);
  assert.match(css, /\.settings-disclosure\[open\] > summary \.settings-chevron \{ transform: rotate\(90deg\)/);
});
