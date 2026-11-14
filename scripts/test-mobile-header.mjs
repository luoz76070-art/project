import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'header-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
await build({
  stdin: { contents: "export * from './apps/mobile/src/shared/pullRefresh.ts'; export { AgentIcon } from './apps/mobile/src/features/agents/AgentIcon.tsx'; export { PullToRefresh } from './apps/mobile/src/shared/PullToRefresh.tsx'; export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: process.cwd(), loader: 'ts' },
  outfile: path.join(dir, 'header.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', nodePaths: [path.resolve('apps/mobile/node_modules')],
});
const m = createRequire(import.meta.url)(path.join(dir, 'header.cjs'));
const app = await fs.readFile('apps/mobile/src/app/App.tsx', 'utf8'), agents = await fs.readFile('apps/mobile/src/features/agents/AgentWorkspace.tsx', 'utf8');
const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test('pull-to-refresh fires only past the threshold, from the top, with one finger', () => {
  const pull = m.createPullTracker();
  pull.start(0, 100); assert.equal(pull.move(0, 100 + m.pullRefreshThreshold * 2), m.pullRefreshThreshold); assert.equal(pull.end(), true);
  pull.start(0, 100); assert.equal(pull.move(0, 1000), 96, 'capped'); assert.equal(pull.end(), true);
  pull.start(0, 100); pull.move(0, 150); assert.equal(pull.end(), false, 'short pull');
  pull.start(20, 100); assert.equal(pull.move(20, 400), 0); assert.equal(pull.end(), false, 'not at top');
  pull.start(0, 100); pull.move(0, 300); assert.equal(pull.move(5, 320), 0); assert.equal(pull.end(), false, 'list scrolled away');
  pull.start(0, 100, 2); pull.move(0, 400); assert.equal(pull.end(), false, 'pinch');
  pull.start(0, 100); pull.move(0, 400); pull.cancel(); assert.equal(pull.end(), false, 'cancelled');
  pull.start(0, 100); assert.equal(pull.move(0, 50), 0, 'pushing up is not a pull');
});
test('PullToRefresh renders the list container untouched until pulled', () => {
  const html = m.renderToStaticMarkup(m.createElement(m.PullToRefresh, { className: 'thread-list', label: 'Codex 线程列表', onRefresh() {} }, m.createElement('p', null, 'row')));
  assert.equal(html, '<div class="thread-list" aria-label="Codex 线程列表"><p>row</p></div>');
});
test('each Agent has its own neutral icon; unknown falls back to a robot', () => {
  const svg = id => m.renderToStaticMarkup(m.createElement(m.AgentIcon, { id, size: 18 }));
  const classes = ['codex', 'claude', 'deepseek', 'opencode', 'other'].map(id => svg(id).match(/lucide-([a-z-]+)/g).at(-1));
  assert.equal(new Set(classes).size, 5, classes.join());
  assert.match(svg('other'), /lucide-bot/); assert.match(svg('codex'), /aria-hidden="true"/);
});
test('Codex top bar: title switches Agent, dot after the name, project chip, one action', () => {
  const header = between(app, '<header className="topbar', '</header>');
  assert.match(header, /className="workspace-switch" onClick={onOpenAgents}/);
  assert.match(header, /<strong>{workspaceTitle}<\/strong><span className={`status-dot/);
  assert.match(header, /className="project-chip">{workspaceProject}/);
  assert.match(app, /workspaceProject = selected\?\.cwd \? projectGroupLabel\(selected\.cwd\)/);
  assert.doesNotMatch(header, /刷新线程|aria-label="切换 Agent"|shortPath/);
  const actions = between(header, '<div className="top-actions">', '</div>');
  assert.match(actions, /^<div className="top-actions">\s*{workspaceReady\s*\? <button[^]*aria-label="事项"[^]*: <button[^]*aria-label="设置"[^]*}\s*$/);
  assert.equal((actions.match(/<button/g) ?? []).length, 2, 'one of the two is rendered');
});
test('refresh moved to pull-to-refresh (with a fallback in the thread drawer); settings reachable from the drawer', () => {
  assert.match(app, /<PullToRefresh className="thread-list" label="Codex 线程列表" onRefresh={\(\) => loadThreads\(\)}>/);
  const drawer = between(app, '<div className="sidebar-actions">', 'sidebar-close');
  assert.match(drawer, /aria-label="刷新线程"/); assert.match(drawer, /setSettingsOpen\(true\)[^]*aria-label="设置"/);
});
test('Agent top bar: title returns to the Agent list, no refresh icon, list pulls to refresh', () => {
  const header = between(agents, '<header className="topbar', '</header>');
  assert.match(header, /className="workspace-switch" onClick={switchAgent}/);
  assert.match(header, /<AgentIcon id={agent\.id}/);
  assert.doesNotMatch(header, /RefreshCcw|刷新 Agent 列表/);
  assert.equal((header.match(/className="icon-button"/g) ?? []).length, 2, 'back + 事项');
  assert.match(agents, /<PullToRefresh className="agent-session-list" onRefresh={\(\) => agent \? loadSessions\(agent\) : loadAgents\(\)}>/);
  assert.match(agents, /function switchAgent\(\) {\s*if \(!agent \|\| !window\.dispatchEvent\(new Event\(productBeforeNavigate/);
});
