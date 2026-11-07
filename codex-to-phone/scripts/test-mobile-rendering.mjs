import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-rendering-'));
const output = path.join(temp, 'render.cjs');
await build({ stdin: { contents: `export { createElement as h } from 'react'; export { renderToStaticMarkup as render } from 'react-dom/server'; export { MessageContent } from './apps/mobile/src/features/chat/MessageContent'; export { MessageTimeline, ToolMessageBubble } from './apps/mobile/src/features/chat/components'; export { ComputerComposer } from './apps/mobile/src/features/chat/ComputerComposer'; export { imageSource } from './apps/mobile/src/features/chat/imageSources';`, resolveDir: root }, outfile: output, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, nodePaths: [path.join(root, 'apps/mobile/node_modules')] });
const originalStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: () => null };
const { default: { h, render, MessageContent, MessageTimeline, ToolMessageBubble, ComputerComposer, imageSource } } = await import(pathToFileURL(output).href);
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
