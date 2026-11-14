import { messageInteractionDriver } from './helpers/message-interaction-driver.mjs';
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
await build({ stdin: { contents: `export { createElement as h } from 'react'; export { renderToStaticMarkup as render } from 'react-dom/server'; export { ThreadRow } from './apps/mobile/src/features/threads/ThreadRow'; export { SessionRangeControl } from './apps/mobile/src/features/threads/SessionRangeControl'; export { DisclosureSummary } from './apps/mobile/src/shared/DisclosureSummary'; export { SidebarScrim } from './apps/mobile/src/features/threads/SidebarScrim'; export { MessageContent } from './apps/mobile/src/features/chat/MessageContent'; export { MessageTimeline, MessageBubble, ToolMessageBubble } from './apps/mobile/src/features/chat/components'; export { ComputerComposer } from './apps/mobile/src/features/chat/ComputerComposer'; export { TurnResultNotice } from './apps/mobile/src/features/chat/TurnResultNotice'; export { SessionStatus, ComposerSessionStatus } from './apps/mobile/src/features/chat/SessionStatus'; export { deriveSessionStatus, agentSessionStatus, codexSessionStatus, readActivityEvidence } from './apps/mobile/src/features/chat/sessionStatusModel'; export { imageSource } from './apps/mobile/src/features/chat/imageSources'; export { HandoffCard } from './apps/mobile/src/features/product/HandoffCard'; export { HandoffMigrationNotice } from './apps/mobile/src/features/product/HandoffMigrationNotice';`, resolveDir: root }, outfile: output, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, nodePaths: [path.join(root, 'apps/mobile/node_modules')] });
const originalStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: () => null };
const { default: { h, render, ThreadRow, SessionRangeControl, DisclosureSummary, SidebarScrim, MessageContent, MessageTimeline, MessageBubble, ToolMessageBubble, ComputerComposer, imageSource, TurnResultNotice, SessionStatus, ComposerSessionStatus, deriveSessionStatus, agentSessionStatus, codexSessionStatus, readActivityEvidence, HandoffCard, HandoffMigrationNotice } } = await import(pathToFileURL(output).href);
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


test('U11 thread rows omit repeated paths and only label sources outside the filter expectation', () => {
  const base = { thread: { id: 'thread', threadName: ' 当前   会话 ', cwd: '/workspace/project', source: 'vscode', originator: 'Codex Desktop', updatedAt: '2026-11-14T00:00:00Z' }, selected: true, activeDesktop: false, sourceFilter: 'all', onOpen() {} };
  for (const [source, filter, label] of [
    ['vscode', 'all', ''], ['vscode', 'desktop', ''], ['vscode', 'relay', '电脑发起'],
    ['appServer', 'all', '手机发起'], ['appServer', 'desktop', '手机发起'], ['appServer', 'relay', ''],
    ['cli', 'relay', 'CLI'], ['exec', 'all', 'Exec'], [null, 'all', '未知'],
  ]) {
    const html = render(h(ThreadRow, { ...base, sourceFilter: filter, thread: { ...base.thread, source, originator: '' } }));
    assert.match(html, /当前 会话/);
    assert.doesNotMatch(html, /thread-path|workspace|project/);
    if (label) { assert.match(html, /class="thread-source /); assert.ok(html.includes(`>${label}</span>`)); }
    else assert.doesNotMatch(html, /thread-source|>桌面</);
  }
  const desktopAlias = render(h(ThreadRow, { ...base, thread: { ...base.thread, source: null } }));
  assert.doesNotMatch(desktopAlias, /thread-source/);
  let opened = 0;
  const row = ThreadRow({ ...base, activeDesktop: true, onOpen: () => opened++ });
  assert.match(render(row), /class="thread-row active"/); assert.match(render(row), /当前桌面/);
  row.props.onClick(); assert.equal(opened, 1);
});

test('U11 earlier sessions keep range toggling and disabled behavior with a text-link appearance', async () => {
  const selected = [];
  for (const [range, label, next] of [['recent', '查看更早会话', 'all'], ['all', '只看近 30 天', 'recent']]) {
    const control = SessionRangeControl({ range, disabled: false, onChange: value => selected.push(value) });
    const html = render(control);
    assert.match(html, /<button type="button" class="session-range-link"/);
    assert.ok(html.includes(label)); assert.doesNotMatch(html, /history-button|href=/);
    control.props.children[1].props.onClick(); assert.equal(selected.at(-1), next);
    assert.match(render(h(SessionRangeControl, { range, disabled: true, onChange() {} })), /disabled=""/);
  }
  const css = await fs.readFile(path.join(root, 'apps/mobile/src/styles.css'), 'utf8');
  assert.match(css, /\.session-range-link \{[^}]*min-height: 44px;[^}]*border: 0;[^}]*background: transparent;[^}]*text-decoration: underline/);
});

test('U11 sidebar keeps two actions and source values, while testing connections lives in connection settings', async () => {
  const app = await fs.readFile(path.join(root, 'apps/mobile/src/app/App.tsx'), 'utf8');
  const tools = app.slice(app.indexOf('<div className="sidebar-tools">'), app.indexOf('<div className="host-filter"'));
  assert.equal((tools.match(/<button /g) ?? []).length, 2);
  assert.match(tools, /新线程/); assert.match(tools, /桌面/); assert.doesNotMatch(tools, /testConnection|检测/);
  assert.match(app, /setSourceFilter\("all"\)\}>全部/);
  assert.match(app, /setSourceFilter\("desktop"\)\}>电脑发起/);
  assert.match(app, /setSourceFilter\("relay"\)\}>手机发起/);
  const connection = app.slice(app.indexOf('<h3>手动连接</h3>'), app.indexOf('<VoiceSettings'));
  assert.match(connection, /onClick=\{\(\) => void testConnection\(\)\}/);
  assert.match(connection, /disabled=\{connectionState === "testing"\}/);
  assert.match(connection, /测试连接/);
  assert.equal((app.match(/onClick=\{\(\) => void testConnection\(\)\}/g) ?? []).length, 1);
  assert.doesNotMatch(app, /threadListDetail|className="thread-path"/);
});

const bubble = (message, expanded, assistantContinuation) => h(MessageBubble, { message, expandToolDetails: expanded, assistantContinuation,
  smooth: false, smoothPending: false, onSmoothDone() {}, onCopy() {} });
test('U1 consecutive assistant messages share identity while preserving every message and turn boundary', () => {
  const messages = [note(1), note(2), { ...note(3), phase: 'final_answer' }];
  const html = render(h(MessageTimeline, { messages, renderMessage: bubble }));
  assert.equal((html.match(/class="message-avatar"/g) ?? []).length, 1);
  assert.equal((html.match(/<strong>Codex<\/strong>/g) ?? []).length, 1);
  assert.equal((html.match(/data-message-role="assistant"/g) ?? []).length, 3);
  assert.equal((html.match(/assistant-continuation/g) ?? []).length, 2);
  assert.doesNotMatch(html, /message-actions|message-meta|aria-label="复制|<time/);
  assert.match(html, /tabindex="0"/);
  for (const separator of [{ id: 'user', role: 'user', text: 'new request' }, { ...note(3), turnId: 'other' }]) {
    const separated = render(h(MessageTimeline, { messages: [note(1), separator, note(2)], renderMessage: bubble }));
    assert.equal((separated.match(/<strong>Codex<\/strong>/g) ?? []).length, separator.role === 'assistant' ? 3 : 2);
  }
});
test('U1 a turn shares one assistant identity across tools until a user or different turn intervenes', () => {
  const sequence = [note(1), tool(1), note(2), tool(2), { ...note(3), phase: 'final_answer' }];
  const html = render(h(MessageTimeline, { messages: sequence, renderMessage: bubble }));
  assert.equal((html.match(/class="message-avatar"/g) ?? []).length, 1);
  assert.equal((html.match(/<strong>Codex<\/strong>/g) ?? []).length, 1);
  assert.equal((html.match(/data-message-role="assistant"/g) ?? []).length, 3);
  assert.equal((html.match(/class="process-toggle"/g) ?? []).length, 2);
  for (const separator of [
    { ...tool(3), turnId: 'turn-b' },
    { id: 'user', role: 'user', turnId: 'turn-a', text: 'new request' },
    { id: 'user', role: 'user', text: 'legacy request' },
  ]) {
    const separated = render(h(MessageTimeline, { messages: [...sequence, separator, tool(4), note(4)], renderMessage: bubble }));
    assert.equal((separated.match(/<strong>Codex<\/strong>/g) ?? []).length, 2);
  }
});
test('U1 messages without turn IDs only share identity with adjacent untagged assistant prose', () => {
  const legacy = index => ({ ...note(index), turnId: undefined });
  const cases = [
    [[legacy(1), legacy(2)], 1],
    [[legacy(1), { ...tool(1), turnId: undefined }, legacy(2)], 2],
    [[legacy(1), { id: 'system', role: 'system', text: 'notice' }, legacy(2)], 2],
    [[note(1), legacy(2)], 2],
    [[legacy(1), note(2)], 2],
  ];
  for (const [messages, heads] of cases) {
    const html = render(h(MessageTimeline, { messages, renderMessage: bubble }));
    assert.equal((html.match(/<strong>Codex<\/strong>/g) ?? []).length, heads);
  }
});
test('U1 system messages use a small icon banner, not a user bubble', () => {
  const html = render(bubble({ id: 'system', role: 'system', text: '连接恢复中' }));
  assert.match(html, /from-system/); assert.match(html, /lucide-info/); assert.match(html, /system-message-text/);
  assert.doesNotMatch(html, /user-message-text|message-actions/);
});
test('U1 tap/focus reveals metadata, focus inside keeps the copy button accessible', () => {
  const driver = messageInteractionDriver(() => {});
  assert.equal(driver.render().revealed, false);
  driver.event('onClick'); assert.equal(driver.render().revealed, true);
  driver.event('onBlur'); assert.equal(driver.render().revealed, false);
  driver.event('onFocus'); driver.event('onBlur', { relatedTarget: 'inside' });
  assert.equal(driver.render().revealed, true);
  driver.event('onBlur'); driver.event('onClick', { target: driver.interactive() });
  assert.equal(driver.render().revealed, false);
  driver.unmount();
});
test('U1 stationary long press copies once with feedback; failures are never reported as success', async () => {
  for (const fail of [false, true]) {
    let calls = 0, finish;
    const driver = messageInteractionDriver(() => { calls++; return new Promise((resolve, reject) => { finish = fail ? () => reject(new Error('denied')) : resolve; }); });
    driver.event('onPointerDown'); assert.equal(driver.pending(), 1); driver.hold();
    driver.event('onPointerUp'); driver.event('onClick');
    assert.equal(driver.render().revealed, true);
    void driver.render().copy(); assert.equal(calls, 1);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(driver.render().feedback, fail ? '复制失败，请重试' : '已复制');
    driver.unmount();
  }
});
test('U1 code and table presses preserve native selection and context menus, while prose still copies', async () => {
  for (const selector of ['pre', 'code', '.code-block', 'table']) for (const nested of [false, true]) for (const pointerType of ['touch', 'pen']) {
    let calls = 0;
    const driver = messageInteractionDriver(() => { calls++; });
    const region = driver.element(selector), target = nested ? driver.element('span', region) : region;
    driver.event('onPointerDown', { target, pointerType });
    assert.equal(driver.pending(), 0, `${selector}: no whole-message copy timer`);
    assert.equal(driver.event('onContextMenu', { target }).prevented, undefined);
    driver.hold();
    assert.equal(calls, 0);
    assert.equal(driver.event('onContextMenu', { target }).prevented, undefined);
    driver.event('onPointerUp');
    driver.event('onPointerDown', { pointerType });
    assert.equal(driver.pending(), 1);
    // Even with an active prose press, a menu originating inside code stays native.
    assert.equal(driver.event('onContextMenu', { target }).prevented, undefined);
    assert.equal(driver.event('onContextMenu').prevented, true);
    driver.hold(); await Promise.resolve();
    assert.equal(calls, 1); assert.equal(driver.render().feedback, '已复制');
    driver.unmount();
  }
});
test('U1 scroll, cancellation, release, mouse, interactive children, selection and unmount never copy', () => {
  for (const action of ['move', 'cancel', 'release', 'leave', 'mouse', 'child', 'selection', 'unmount']) {
    let calls = 0; const driver = messageInteractionDriver(() => { calls++; });
    driver.event('onPointerDown', action === 'mouse' ? { pointerType: 'mouse' } : action === 'child' ? { target: driver.interactive() } : {});
    if (action === 'move') driver.event('onPointerMove', { clientX: 11 });
    if (action === 'cancel') driver.event('onPointerCancel');
    if (action === 'release') driver.event('onPointerUp');
    if (action === 'leave') driver.event('onPointerLeave');
    if (action === 'selection') driver.select('selected text');
    if (action === 'unmount') driver.unmount();
    driver.hold(); assert.equal(calls, 0, action); driver.unmount();
  }
});
test('U1 late clipboard completion after unmount does not publish feedback', async () => {
  let finish; const driver = messageInteractionDriver(() => new Promise(resolve => { finish = resolve; }));
  driver.event('onPointerDown'); driver.hold(); driver.unmount(); finish();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(driver.render().feedback, '');
});

test('U2 one status bar above the input owns the only stop button for empty and nonempty drafts', () => {
  const status = deriveSessionStatus(statusInput(statusInputs.executing));
  for (const hasContent of [false, true]) for (const canStop of [false, true]) for (const busy of [false, true]) {
    const html = render(h(ComputerComposer, { draft: hasContent ? 'draft' : '', onDraft() {}, onSend() {}, onStop() {}, onUpload() {},
      voice: null, status: h(ComposerSessionStatus, { status, fallback: '当前会话' }), placeholder: 'message', running: true, hasContent, canStop, busy, canSend: true, deliveries: { steer: false, queue: true } }));
    const [bar, input] = html.split('<div class="composer">');
    assert.match(bar, /class="composer-status-bar"/);
    assert.equal((bar.match(/aria-label="停止生成"/g) ?? []).length, 1);
    assert.equal((bar.match(/data-session-status="executing"/g) ?? []).length, 1);
    assert.match(bar, /session-status-dot/);
    assert.doesNotMatch(input, /停止生成|composer-mode|session-status/);
    assert.equal(/disabled="" aria-label="停止生成"/.test(bar), !canStop || busy);
    assert.doesNotMatch(html, /generation-status/);
  }
});
test('U2 terminal results appear once; a new running turn keeps previous reason and timestamp', () => {
  for (const lastTurn of turnResults) {
    const terminal = deriveSessionStatus(statusInput({ phase: 'idle', lastTurn, turnId: lastTurn.turnId }));
    const idle = render(h(ComposerSessionStatus, { status: terminal, lastTurn, fallback: '当前会话' }));
    assert.equal((idle.match(/data-turn-result=/g) ?? []).length, 1);
    assert.ok(idle.includes(lastTurn.reason.message)); assert.ok(idle.includes(lastTurn.endedAt));
    assert.doesNotMatch(idle, /session-status-dot|上轮/);
    const active = deriveSessionStatus(statusInput(statusInputs.thinking));
    const running = render(h(ComposerSessionStatus, { status: active, lastTurn, running: true, fallback: '当前会话' }));
    assert.equal((running.match(/data-turn-result=/g) ?? []).length, 1);
    assert.match(running, /上轮/); assert.match(running, /data-session-status="thinking"/);
    assert.ok(running.includes(lastTurn.reason.message)); assert.ok(running.includes(lastTurn.endedAt));
    const staleRunning = render(h(ComposerSessionStatus, { status: terminal, lastTurn, running: true, fallback: '当前会话' }));
    assert.equal((staleRunning.match(/data-turn-result=/g) ?? []).length, 1);
    assert.doesNotMatch(staleRunning, /session-status-dot/);
  }
});
test('U2 unknown activity keeps neutral fallback and does not invent an active indicator', () => {
  const html = render(h(ComposerSessionStatus, { status: null, lastTurn: turnResults[0], running: true, fallback: '当前会话', feedback: '已排队' }));
  assert.match(html, /当前会话/); assert.match(html, /上轮/); assert.match(html, /已排队/);
  assert.doesNotMatch(html, /session-status-dot|thinking|executing/);
  const missing = render(h(ComposerSessionStatus, { status: null, lastTurn: null, fallback: '当前会话' }));
  assert.doesNotMatch(missing, /data-session-status/);
});
test('U2 Codex and Agent entry points mount status only through the composer and retain tool summaries', async () => {
  for (const file of ['apps/mobile/src/app/App.tsx', 'apps/mobile/src/features/agents/AgentWorkspace.tsx']) {
    const source = await fs.readFile(path.join(root, file), 'utf8');
    assert.equal((source.match(/<ComposerSessionStatus /g) ?? []).length, 1, file);
    assert.doesNotMatch(source, /<SessionStatus |<TurnResultNotice |showInlineTurnIndicator|className="composer-status"/, file);
    assert.match(source, /<ComputerComposer[\s\S]*?status={<ComposerSessionStatus/, file);
  }
  const html = render(h(MessageTimeline, { messages: [note(1), tool(1)], running: true, renderMessage: bubble }));
  assert.doesNotMatch(html, /generation-status|data-session-status/);
  assert.match(html, /process-toggle/); assert.match(html, /正在执行/); assert.match(html, /1 项/);
});
test('U2 uses signal for activity, danger for failure, and disables breathing with reduced motion', async () => {
  const css = await fs.readFile(path.join(root, 'apps/mobile/src/styles.css'), 'utf8');
  assert.match(css, /\.session-status-dot\s*{[^}]*background: var\(--signal\)/);
  assert.match(css, /\[data-session-status="failed"\]\s*{[^}]*color: var\(--danger\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.session-status-dot\s*{\s*animation: none/);
});
