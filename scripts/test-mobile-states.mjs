import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'states-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
await build({
  stdin: { contents: "export { EmptyState } from './apps/mobile/src/shared/EmptyState.tsx'; export * from './apps/mobile/src/shared/Skeleton.tsx'; export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: process.cwd(), loader: 'ts' },
  outfile: path.join(dir, 'states.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', nodePaths: [path.resolve('apps/mobile/node_modules')],
});
const m = createRequire(import.meta.url)(path.join(dir, 'states.cjs'));
const render = (type, props, ...children) => m.renderToStaticMarkup(m.createElement(type, props, ...children));
const read = file => fs.readFile(file, 'utf8');
const [app, agents, items, css] = await Promise.all(['apps/mobile/src/app/App.tsx', 'apps/mobile/src/features/agents/AgentWorkspace.tsx', 'apps/mobile/src/features/workItems/WorkItemsPage.tsx', 'apps/mobile/src/styles.css'].map(read));

test('empty state shows the theme-following brand mark, a title and optional text', () => {
  const html = render(m.EmptyState, { title: '选择一个 Codex 线程' }, '打开线程列表');
  assert.match(html, /^<div class="empty-brand"><span class="empty-illustration"><svg class="brand-mark" width="44" height="44"[^>]*aria-hidden="true"/);
  assert.match(html, /stroke="currentColor"/); assert.match(html, /fill="var\(--signal\)"/);
  assert.match(html, /<strong>选择一个 Codex 线程<\/strong><p>打开线程列表<\/p><\/div>$/);
  const compact = render(m.EmptyState, { title: 't', compact: true, className: 'work-items-empty' });
  assert.match(compact, /^<div class="empty-brand compact work-items-empty">/); assert.match(compact, /width="28"/); assert.doesNotMatch(compact, /<p>/);
});
test('skeletons announce what is loading and are shaped like the content', () => {
  const list = render(m.ListSkeleton, { label: '正在读取事项' });
  assert.match(list, /^<div class="skeleton-list" role="status" aria-label="正在读取事项">/);
  assert.equal((list.match(/class="skeleton-row"/g) ?? []).length, 3);
  assert.match(render(m.MessageSkeleton, { label: '正在读取线程' }), /role="status" aria-label="正在读取线程"><i class="skeleton-bubble"><\/i>/);
});
test('loading uses skeletons instead of spinners; the thread list no longer claims "no match" while loading', () => {
  assert.match(app, /filtered\.length === 0 && \(loading && !threads\.length \? <ListSkeleton label="正在读取线程列表" \/>/);
  assert.match(app, /{loadingMessages && <MessageSkeleton label="正在读取线程" \/>}/);
  assert.doesNotMatch(app, /<span>读取线程<\/span>|从左侧选择线程/);
  assert.match(agents, /loading && \(agent \? !sessions\.length : !agents\.length\) \? <ListSkeleton/);
  assert.match(agents, /{!snapshot && <MessageSkeleton label="正在读取原会话" \/>}/);
  assert.match(items, /items === null \? \(error \? null : <ListSkeleton label="正在读取事项" \/>\)/);
});
test('empty states use the brand illustration everywhere', () => {
  assert.match(app, /<EmptyState title={isNewThread \? "开始一个新线程" : "选择一个 Codex 线程"}>/);
  assert.match(app, /<EmptyState compact title={query\.trim\(\) \? "没有匹配的线程" : "还没有线程"}>/);
  assert.match(agents, /<EmptyState compact title="还没有接入其他 Agent">/); assert.match(agents, /<EmptyState compact title="没有会话">/);
  assert.match(items, /<EmptyState compact className="work-items-empty" title={emptyText\[current\]} \/>/);
});
test('skeleton shimmer is a CSS animation, so the reduced-motion rule stops it', () => {
  assert.match(css, /\.skeleton-row i, \.skeleton-messages i \{[^}]*animation: skeletonShimmer 1\.4s ease-in-out infinite;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation-iteration-count: 1 !important;/);
});
