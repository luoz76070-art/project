import http from 'node:http';
import { createDeepSeekInteractions } from './interactions.mjs';
import { createDeepSeekCatalog } from './catalog.mjs';
import { messageOf, finalMessageId } from './messages.mjs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

export const harnessVersion = '0.2.1-rc.2';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const fail = (code, status = 409) => Object.assign(new Error(`DEEPSEEK_${code}`), { status });
const iso = value => new Date(Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15 ? value : Date.now()).toISOString();

/** Original dsh process; only an explicit cold-session message may restore its Agent. */
export function createDeepSeekBridge(ctx, config, createUserMessage) {
  if (!config || Object.keys(config).some(key => !['port', 'token', 'directory', 'scope'].includes(key))
    || !Number.isInteger(config.port) || config.port < 0 || config.port > 65535
    || typeof config.token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/u.test(config.token)
    || typeof config.directory !== 'string' || !path.isAbsolute(config.directory)
    || (config.scope !== undefined && !['directory', 'all'].includes(config.scope))) throw fail('CONFIG_INVALID', 400);
  const directory = path.resolve(config.directory), aliases = new Map(), ids = new WeakMap(), entries = new Map(), disposers = [];
  const catalog = config.scope === 'all' ? createDeepSeekCatalog(ctx, config.token, id => Boolean(entries.get(id)?.clients.size || entries.get(id)?.submission)) : null;
  const requests = new Set();
  let stopped = false;
  const interactions = createDeepSeekInteractions(ctx);
  function allowed(agent) {
    return agent && ctx.agents.get(agent.id) === agent && !agent.session.header.origin
      && typeof agent.session.header.cwd === 'string' && path.isAbsolute(agent.session.header.cwd) && (catalog || path.resolve(agent.session.header.cwd) === directory);
  }
  function live(id) {
    const agent = catalog ? ctx.agents.get(catalog.row(id).hostId) : aliases.get(id);
    if (!allowed(agent)) throw fail('SESSION_GONE', 410);
    return agent;
  }
  function alias(agent) {
    if (catalog) return catalog.rememberAgent(agent);
    if (!ids.has(agent)) {
      if (aliases.size >= 128) throw fail('BUSY', 429);
      const id = randomUUID(); ids.set(agent, id); aliases.set(id, agent);
    }
    return ids.get(agent);
  }
  function session(agent) {
    if (catalog) return catalog.row(alias(agent)).session;
    return { id: alias(agent), title: `DeepSeek · ${String(agent.id).slice(0, 64)}`, directory, updatedAt: iso(agent.session.header.createdAt) };
  }
  function currentAgent(entry) {
    if (!catalog) return live(entry.id);
    const row = catalog.row(entry.id), agent = ctx.agents.get(row.hostId);
    if (agent && (!allowed(agent) || path.resolve(agent.session.header.cwd) !== row.session.directory)) throw fail('SESSION_CHANGED');
    if (entry.agent && agent !== entry.agent) throw fail('SESSION_CHANGED');
    if (agent && !entry.agent) { entry.agent = agent; entry.token = randomUUID(); }
    return agent;
  }
  function bound(entry) {
    let budget = 256 * 1024;
    const kept = [];
    for (const message of entry.messages.slice(-120).reverse()) {
      const bytes = Buffer.byteLength(JSON.stringify(message));
      if (bytes > budget) break;
      budget -= bytes; kept.push(message);
    }
    entry.messages = kept.reverse();
  }
  function add(entry, message) {
    entry.messages = entry.messages.filter(item => item.id !== message.id); entry.messages.push(message); bound(entry);
  }
  function snapshot(entry) {
    const agent = currentAgent(entry), ready = !entry.submission || entry.submission.delivery === 'confirmed';
    return {
      agentId: 'deepseek', session: catalog ? catalog.row(entry.id).session : session(agent), connected: true, updatedAt: iso(Date.now()),
      status: agent?.status ?? 'idle', activity: entry.stream?.text ? 'outputting' : entry.activity,
      messages: entry.messages, ...(agent ? interactions.snapshot(entry) : { questions: [], permissions: [] }), historyCursor: entry.historyCursor ?? null, partialText: true,
      control: { token: entry.token, canSend: ready, canSteer: ready && Boolean(agent) && entry.turn !== null, canInterrupt: ready && agent?.status === 'running' && entry.turn !== null },
      submission: entry.submission ? { clientMessageId: entry.submission.clientMessageId, action: entry.submission.action, delivery: entry.submission.delivery } : null,
      operationError: entry.operationError,
    };
  }
  function write(res, data) {
    if (res.writableLength + Buffer.byteLength(data) > 1024 * 1024) { res.destroy(); return; }
    res.write(data);
  }
  function publish(entry, immediate = false) {
    if (!entry.clients.size || stopped || entry.loading) return;
    if (!immediate) { entry.timer ??= setTimeout(() => { entry.timer = null; publish(entry, true); }, 200); return; }
    clearTimeout(entry.timer); entry.timer = null;
    let payload;
    try { payload = `data: ${JSON.stringify(snapshot(entry))}\n\n`; } catch { for (const res of entry.clients) res.destroy(); return; }
    for (const res of entry.clients) if (res.headersSent) write(res, payload);
  }
  function project(entry, event, baseline = false) {
    if (!Number.isSafeInteger(event.seq) || (!baseline && event.seq <= entry.cursor)) return;
    entry.cursor = Math.max(entry.cursor, event.seq);
    const data = event.data;
    const finalId = finalMessageId(entry, event);
    if (finalId) entry.messages = entry.messages.map(message => message.id === finalId ? { ...message, phase: 'final_answer' } : message);
    if (event.type === 'turn/start') { entry.toolCalls.clear(); entry.step = null; entry.turn = data.turn; entry.token = randomUUID(); entry.activity = 'thinking'; }
    if (event.type === 'turn/end') {
      entry.turn = null; entry.token = randomUUID(); entry.activity = 'working';
      if (entry.submission?.action === 'interrupt' && entry.submission.turn === data.turn) entry.submission.delivery = 'confirmed';
    }
    if (event.type === 'step/start') { entry.step = data.step; entry.toolCalls.clear(); }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const id = event.type === 'tool/call' ? data.callId : data.subCallId;
      if (entry.toolCalls.has(id)) entry.toolCalls.set(id, null);
      else if (entry.toolCalls.size < 128 && typeof id === 'string') {
        let args;
        try { args = event.type === 'tool/call' ? data.arguments : JSON.stringify(data.arguments); } catch {}
        const bytes = [...entry.toolCalls.values()].reduce((sum, call) => sum + (call ? Buffer.byteLength(call.arguments) : 0), 0);
        entry.toolCalls.set(id, typeof args === 'string' && args.length <= 131072 && bytes + Buffer.byteLength(args) <= 256 * 1024 ? { name: data.name, arguments: args, turn: data.turn ?? entry.turn, step: data.step ?? entry.step } : null);
      }
    }
    const message = event.type === 'user/message' && data?.source?.kind === 'user' ? data : event.type === 'assistant/message' ? data.message : null;
    if (message) {
      if (event.type === 'user/message' && entry.submission && (entry.submission.messageId === message.id || (entry.submission.rpcId && entry.submission.rpcId === message.source?.rpcId))) entry.submission.delivery = 'confirmed';
      if (entry.clients.size) {
        if (event.type === 'assistant/message' && entry.stream?.turn === data.turn && entry.stream?.step === data.step) {
          entry.messages = entry.messages.filter(item => item.id !== entry.stream.id); entry.stream = null;
        }
        const visible = messageOf(event); if (visible) add(entry, visible);
      }
    }
  }
  async function baseline(entry, agent, signal) {
    if (catalog) {
      const page = await catalog.page(entry.id, null, signal);
      for (const event of page.events) project(entry, event, true);
      entry.messages = page.messages; entry.historyCursor = page.cursor; entry.cursor = page.throughSeq;
      return;
    }
    const observation = await ctx.sessionQuery.observeSession(agent.id, { projectionMode: 'none' });
    try {
      if (stopped || live(entry.id) !== agent || observation.source !== 'live') throw fail('SESSION_GONE', 410);
      // The official API copies the entire log on events access. Avoid that for large sessions.
      if (observation.cursor < 4096) for (const event of observation.events) project(entry, event, true);
      entry.cursor = Math.max(entry.cursor, observation.cursor);
    } finally { observation[Symbol.dispose](); }
  }
  async function watch(id, res, signal) {
    if (catalog) await catalog.resolve(id, signal);
    const agent = catalog ? ctx.agents.get(catalog.row(id).hostId) : live(id);
    if (agent && !allowed(agent)) throw fail('SESSION_GONE', 410);
    let entry = entries.get(id);
    if (!entry) {
      if (entries.size >= 32) throw fail('BUSY', 429);
      entry = { id, agent, token: randomUUID(), turn: null, cursor: -1, clients: new Set(), messages: [], stream: null, streamRevision: 0, activity: 'working', submission: null, operationError: null, timer: null, poll: null, loading: null, buffered: [], toolCalls: new Map(), step: null };
      entries.set(id, entry);
    }
    if (entry.clients.size >= 4) throw fail('BUSY', 429);
    const first = entry.clients.size === 0;
    entry.clients.add(res);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      entry.clients.delete(res);
      if (!entry.clients.size) {
        clearTimeout(entry.timer); clearInterval(entry.poll); entry.poll = null; entry.timer = null; entry.token = randomUUID(); entry.messages = []; entry.stream = null;
        if (entry.submission && entry.submission.delivery !== 'confirmed') entry.submission.delivery = 'uncertain';
        else if (entries.get(id) === entry) entries.delete(id);
      }
    };
    res.on('close', close);
    try {
      if (first) {
        entry.cursor = -1; entry.turn = null; entry.step = null; entry.finalCandidate = null; entry.toolCalls.clear();
        entry.loading = baseline(entry, agent, signal).then(() => {
          for (const event of entry.buffered) project(entry, event);
        }).finally(() => { entry.buffered = []; entry.loading = null; });
      }
      if (entry.loading) await entry.loading;
      if (res.destroyed || stopped) return;
      if (!catalog && currentAgent(entry) !== agent) return;
      if (catalog) currentAgent(entry);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      publish(entry, true);
      const timer = setInterval(() => write(res, ': heartbeat\n\n'), 10000); timer.unref();
      if (!entry.poll) {
      const pollState = () => { const current = currentAgent(entry); return JSON.stringify({ interactions: current ? interactions.snapshot(entry) : null, status: current?.status ?? 'idle', token: entry.token }); };
      let previous = pollState();
      entry.poll = setInterval(() => {
        try {
          const next = pollState();
          if (next !== previous) { previous = next; publish(entry, true); }
        } catch { res.destroy(); }
      }, 250); entry.poll.unref();
      }
      res.on('close', () => clearInterval(timer));
    } catch (error) { close(); throw error; }
  }
  function operate(id, action, input, requestId, signal) {
    const entry = entries.get(id), agent = entry ? currentAgent(entry) : null;
    if (!entry?.clients.size || input.controlToken !== entry.token || !uuid.test(input.clientMessageId ?? '')) throw fail('STALE_CONTROL');
    if (action === 'question' || action === 'permission') {
      if (!agent) throw fail('REQUEST_EXPIRED', 410);
      const result = interactions.respond(entry, action, requestId, input); publish(entry, true); return result;
    }
    if (entry.submission?.clientMessageId === input.clientMessageId) throw fail('ALREADY_SUBMITTED');
    if (entry.submission && entry.submission.delivery !== 'confirmed') throw fail('RESULT_PENDING');
    if (action === 'message' && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000 || !['queue', 'steer'].includes(input.delivery))) throw fail('INPUT_INVALID', 400);
    if ((action === 'interrupt' || input.delivery === 'steer') && (entry.turn === null || agent?.status !== 'running')) throw fail('STALE_TURN');
    if (catalog && !agent && action === 'message') {
      entry.submission = { clientMessageId: input.clientMessageId, action, delivery: 'submitted', rpcId: input.clientMessageId };
      entry.operationError = null; entry.token = randomUUID(); publish(entry, true);
      return catalog.prompt(id, input, signal).then(() => ({ ok: true, delivery: entry.submission.delivery }), () => {
        if (entry.submission.delivery !== 'confirmed') entry.submission.delivery = 'uncertain';
        publish(entry, true); return { ok: true, delivery: entry.submission.delivery };
      });
    }
    if (!agent) throw fail('SESSION_GONE', 410);
    const message = action === 'message' ? createUserMessage({ content: [{ type: 'text', text: input.text }], source: { kind: 'user' } }) : null;
    // No await between guard, reservation and original live-handle operation.
    entry.submission = { clientMessageId: input.clientMessageId, action, delivery: 'submitted', messageId: message?.id, turn: entry.turn };
    entry.operationError = null; entry.token = randomUUID();
    try {
      if (action === 'interrupt') agent.cancel({ kind: 'user' }, { keepInbox: true });
      else if (input.delivery === 'steer') agent.steer(message);
      else agent.followup(message);
    } catch { entry.submission.delivery = 'uncertain'; }
    publish(entry, true);
    return { ok: true, delivery: entry.submission.delivery };
  }
  const on = (event, callback) => disposers.push(ctx.on(event, callback));
  if (catalog) on('session/created', () => catalog.invalidate());
  const entryFor = agent => {
    if (!allowed(agent)) return null;
    const entry = entries.get(catalog ? catalog.rememberAgent(agent) : ids.get(agent));
    if (entry && !entry.agent && catalog) { entry.agent = agent; entry.token = randomUUID(); }
    return entry?.agent === agent ? entry : null;
  };
  on('session/event', (session, event) => {
    if (catalog && ['user/message', 'assistant/message', 'session/title'].includes(event.type)) catalog.invalidate();
    const agent = ctx.agents.get(session.id), entry = agent && entryFor(agent);
    if (!entry) return;
    if (entry.loading) {
      if (entry.buffered.length >= 4096) { for (const res of entry.clients) res.destroy(); return; }
      entry.buffered.push(event); return;
    }
    project(entry, event); publish(entry);
  });
  on('agent/status', ({ agent }) => {
    catalog?.invalidate();
    const entry = entryFor(agent); if (!entry) return;
    if (agent.status === 'idle') { entry.token = randomUUID(); entry.turn = null; entry.activity = 'working'; }
    publish(entry);
  });
  on('agent/inbox/discarded', ({ agent, message }) => {
    const entry = entryFor(agent);
    if (entry?.submission?.messageId !== message.id) return;
    entry.operationError = { clientMessageId: entry.submission.clientMessageId, code: 'rejected' }; entry.submission = null; entry.token = randomUUID(); publish(entry);
  });
  on('agent/assistant-stream', ({ agent, frame }) => {
    const entry = entryFor(agent); if (!entry?.clients.size || entry.loading) return;
    // Official revisions increase for every frame, across attempts of this Agent.
    if (!Number.isSafeInteger(frame.revision) || frame.revision <= entry.streamRevision) return;
    if (frame.type === 'start') {
      if (entry.stream) entry.messages = entry.messages.filter(message => message.id !== entry.stream.id);
      entry.stream = { id: `stream-${frame.attemptId}-${frame.revision}`, attempt: frame.attemptId, index: 0, turn: frame.turn, step: frame.step, blocks: new Map(), text: '' };
      entry.activity = 'thinking';
    } else {
      const stream = entry.stream;
      if (!stream || stream.attempt !== frame.attemptId || stream.index !== frame.index) return;
      if (frame.type === 'end') {
        entry.messages = entry.messages.filter(message => message.id !== stream.id); entry.stream = null; entry.activity = 'working';
      } else {
        ++stream.index;
        const chunk = frame.chunk;
        if (stream.blocks.size < 64 || stream.blocks.has(chunk.index)) {
          if (chunk.type === 'text-delta' && stream.text.length < 32768) stream.blocks.set(chunk.index, ((stream.blocks.get(chunk.index) ?? '') + chunk.text).slice(0, 32768));
          if (chunk.type === 'block-end' && chunk.block?.type === 'text') stream.blocks.set(chunk.index, chunk.block.text.slice(0, 32768));
        }
        stream.text = [...stream.blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join('\n').slice(0, 32768);
        if (stream.text) add(entry, { id: stream.id, timestamp: iso(frame.time), role: 'assistant', kind: 'agent_message', text: stream.text,
          ...(Number.isSafeInteger(stream.turn) && stream.turn >= 0 ? { turnId: String(stream.turn), phase: 'commentary' } : {}),
        });
        else if (chunk.type === 'tool-call-delta') entry.activity = 'working';
      }
    }
    entry.streamRevision = frame.revision;
    publish(entry);
  });
  on('agent/disposed', ({ agent }) => {
    catalog?.invalidate();
    const id = catalog ? catalog.identity(agent.id) : ids.get(agent), entry = entries.get(id);
    if (entry) { clearTimeout(entry.timer); clearInterval(entry.poll); for (const res of entry.clients) res.destroy(); entries.delete(id); }
    aliases.delete(id);
  });
  function authorized(req) {
    const got = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${config.token}`);
    return req.headers.origin === undefined && ['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && got.length === expected.length && timingSafeEqual(got, expected);
  }
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController(); requests.add(controller); res.once('close', () => { controller.abort(); requests.delete(controller); });
    const json = (value, status = 200) => { if (!res.destroyed && !res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); } };
    try {
      if (!authorized(req)) throw fail('AUTH_FAILED', 403);
      const url = new URL(req.url, 'http://127.0.0.1');
      const queryRoute = catalog && (url.pathname === '/sessions' || /\/history$/u.test(url.pathname));
      if (url.hash || (url.search && !queryRoute) || [...url.searchParams.keys()].some(key => !['search', 'cursor', 'range'].includes(key))) throw fail('INPUT_INVALID', 400);
      if (req.method === 'GET' && url.pathname === '/info') return json({ protocol: 1, harnessVersion, messagePhases: true, interactions: interactions.available(), ...(catalog ? { scope: 'all', history: true } : {}) });
      if (req.method === 'GET' && url.pathname === '/sessions') {
        if (catalog) return json(await catalog.list(url.searchParams.get('search'), url.searchParams.get('cursor'), controller.signal, url.searchParams.get('range') ?? 'recent'));
        const sessions = ctx.agents.list().filter(allowed).slice(0, 128).map(session); return json({ sessions, cursor: null });
      }
      const match = /^\/sessions\/([0-9a-f-]{36})\/(events|history|messages|interrupt|questions\/([0-9a-f-]{36})\/respond|permissions\/([0-9a-f-]{36})\/respond)$/u.exec(url.pathname);
      if (!match || !uuid.test(match[1])) throw fail('NOT_FOUND', 404);
      if (catalog && req.method === 'GET' && match[2] === 'history') {
        const cursor = url.searchParams.get('cursor'); if (!cursor || !uuid.test(cursor)) throw fail('CURSOR_INVALID', 400);
        const page = await catalog.page(match[1], cursor, controller.signal); return json({ messages: page.messages, cursor: page.cursor });
      }
      if (req.method === 'GET' && match[2] === 'events') return await watch(match[1], res, controller.signal);
      if (req.method !== 'POST' || ['events', 'history'].includes(match[2])) throw fail('NOT_FOUND', 404);
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 128 * 1024) throw fail('INPUT_INVALID', 413); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('INPUT_INVALID', 400); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INPUT_INVALID', 400);
      return json(await operate(match[1], match[3] ? 'question' : match[4] ? 'permission' : match[2] === 'messages' ? 'message' : 'interrupt', input, match[3] ?? match[4], controller.signal));
    } catch (error) { json({ error: error.message?.startsWith('DEEPSEEK_') ? error.message : 'DEEPSEEK_BRIDGE_FAILED' }, error.status ?? 500); if (res.headersSent && !res.writableEnded) res.destroy(); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 32;
  const ready = new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', () => resolve(server.address())); });
  // Startup errors are observable to apply/tests without an unhandled rejection.
  ready.catch(() => {});
  return { ready, async stop() {
    stopped = true; for (const dispose of disposers) dispose?.();
    for (const entry of entries.values()) { clearTimeout(entry.timer); clearInterval(entry.poll); for (const res of entry.clients) res.destroy(); }
    for (const controller of requests) controller.abort(); requests.clear();
    entries.clear(); aliases.clear(); catalog?.stop();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
