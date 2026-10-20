// Disposable local UI fixture. No access to Codex, desktop control or user files.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url));
const streams = new Set();
const notifications = new Map();
const counters = {};
let offline = false;
const states = new Map(['A', 'B'].map(name => [name, {
  cursor: 100, generation: `fixture-${name}`, turnStatus: 'completed', activity: undefined, messages: [
    { id: `${name}-user`, role: 'user', text: `检查 ${name} 连接的实时消息和历史记录`, kind: 'user_message', timestamp: '2026-10-20T09:00:00Z' },
    { id: `${name}-assistant`, role: 'assistant', text: `${name} 连接的内容。\n\n已检查连接、消息顺序和恢复行为。\n\n\`\`\`ts\nconst connected = true;\n\`\`\``, kind: 'agent_message', timestamp: '2026-10-20T09:01:00Z' },
  ],
}]));
const thread = name => ({ id: 'same-thread', threadName: `${name} · 优化连接与消息同步`, cwd: '/workspace/codex-to-phone', source: 'vscode', originator: 'Codex Desktop', updatedAt: '2026-10-20T09:01:00Z' });
const json = (res, value, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture/counters') return json(res, counters);
    if (url.pathname === '/fixture/activity') {
      const state = states.get(url.searchParams.get('name') ?? 'A');
      const phase = url.searchParams.get('phase');
      if (!state || !['thinking', 'working', 'outputting', 'completed', 'interrupted', 'failed'].includes(phase)) return json(res, {}, 400);
      state.turnStatus = ['thinking', 'working', 'outputting'].includes(phase) ? 'inProgress' : phase;
      state.activity = state.turnStatus === 'inProgress' ? phase : undefined;
      if (url.searchParams.get('empty') === '1') state.messages = [];
      state.cursor++;
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/offline') {
      offline = url.searchParams.get('enabled') === '1';
      if (offline) for (const stream of streams) stream.destroy();
      return json(res, { offline });
    }
    if (url.pathname === '/fixture/append') {
      const name = url.searchParams.get('name') ?? 'A';
      const state = states.get(name);
      if (!state) return json(res, {}, 404);
      state.messages.push({ id: `${name}-update-${Date.now()}`, role: 'assistant', text: '浏览历史期间抵达的新消息', kind: 'agent_message', timestamp: new Date().toISOString() });
      state.cursor++;
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/disconnect') { for (const stream of streams) stream.destroy(); return json(res, { ok: true }); }
    if (url.pathname.startsWith('/api/') || /^\/[AB]\//.test(url.pathname)) {
      const name = /^\/B\//.test(url.pathname) ? 'B' : 'A';
      const route = url.pathname.replace(/^\/[AB]/, '');
      const state = states.get(name);
      counters[`${name}:${route}`] = (counters[`${name}:${route}`] ?? 0) + 1;
      if (offline) return json(res, { error: 'fixture_offline' }, 503);
      if (!route.endsWith('/events') && req.headers.authorization !== 'Bearer fixture-only') return json(res, { error: 'unauthorized' }, 401);
      if (route === '/api/threads' || route === '/api/live/threads') {
        const all = Array.from({ length: 145 }, (_, index) => index ? { ...thread(name), id: `fixture-${index}`, threadName: `${name} 会话 ${String(index).padStart(3, '0')}` } : thread(name));
        const matching = all.filter(item => item.threadName.toLowerCase().includes((url.searchParams.get('query') ?? '').toLowerCase()));
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 120);
        return json(res, { threads: matching.slice(offset, offset + limit), nextOffset: offset + limit, hasMore: offset + limit < matching.length });
      }
      if (route === '/api/live/turns') return json(res, { turns: [] });
      if (route === '/api/desktop/active') return json(res, { thread: thread(name), source: 'ipc-stream' });
      if (route === '/api/connection') return json(res, { ok: true });
      if (route === '/api/status') return json(res, { ok: true, desktopControl: { ok: true, mode: 'fixture' }, live: { ok: true, mode: 'fixture' }, activeDesktopThread: thread(name) });
      if (route.endsWith('/health')) return json(res, { ok: true, mode: 'fixture' });
      if (route.endsWith('/stream-token')) return json(res, { streamToken: `fixture-${name}-${Date.now()}` });
      if (route.endsWith('/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const delta = () => res.write(`event: delta\ndata: ${JSON.stringify(state)}\n\n`);
        delta();
        streams.add(res);
        notifications.set(res, delta);
        const timer = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 1000);
        res.on('close', () => { streams.delete(res); notifications.delete(res); clearInterval(timer); });
        return;
      }
      if (route.endsWith('/delta')) return json(res, { ...state, messages: [], truncated: false });
      if (route.endsWith('/messages')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        state.messages.push({ id: `fixture-${Date.now()}`, role: 'user', text: input.message, kind: 'user_message', timestamp: new Date().toISOString() });
        return json(res, { ok: true, mode: 'desktop-ipc-follower-control', action: 'start-turn', thread: thread(name) });
      }
      if (/\/api\/desktop\/threads\/same-thread$/.test(route)) {
        if (url.searchParams.has('before')) return json(res, {
          messages: Array.from({ length: 30 }, (_, index) => ({ id: `${name}-old-${index}`, role: index % 2 ? 'assistant' : 'user', text: `${name} 更早的历史 ${index + 1}。${'用于验证阅读旧消息时新推送不会改变滚动位置。'.repeat(4)}`, kind: index % 2 ? 'agent_message' : 'user_message', timestamp: '2026-10-19' })),
          windowStart: 0, cursor: 50, generation: state.generation,
        });
        return json(res, { thread: thread(name), ...state, windowStart: 50 });
      }
      return json(res, {});
    }
    const file = url.pathname === '/' ? path.join(dist, 'index.html') : path.join(dist, url.pathname);
    if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
    const extension = path.extname(file);
    let content = await fs.readFile(file);
    if (extension === '.html') {
      const profiles = ['A', 'B'].map(name => ({ id: name, name: `测试连接 ${name}`, endpoint: `http://127.0.0.1:${server.address().port}/${name}`, token: 'fixture-only', cacheNamespace: `fixture-${name}`, updatedAt: '2026-10-20' }));
      const bootstrap = `<script>if(!localStorage.connectionProfiles){localStorage.connectionProfiles=${JSON.stringify(JSON.stringify(profiles))};localStorage.activeConnectionProfileId='A';}</script>`;
      content = content.toString().replace('<head>', `<head>${bootstrap}`);
      if (url.searchParams.get('textScale') === '150') content = content.replace('</head>', '<style>html { font-size: 150%; }</style></head>');
    }
    res.writeHead(200, { 'content-type': extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'text/html' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.UI_FIXTURE_PORT ?? 0), '127.0.0.1', () => console.log(`UI_FIXTURE=http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const stream of streams) stream.destroy(); server.close(); });
