// This module runs in the host's sandbox, not Node. Keep $ calls literal for the host's source validator.

/** @param {import('claude-code').On} on */
export function register(on) {
  const state = { enabled: false, closed: false, url: '', token: '', id: '', activationId: crypto.randomUUID(), generation: '',
    turnId: null, watching: false, sequence: 0, events: [], batch: null, flushing: false, polling: false,
    flushTimer: null, pollTimer: null, seen: new Set(), partial: false, connecting: false, flushPromise: null, requestSerial: 0 };

  on('session.start', async ($, e, next) => {
    const result = await next(e);
    // Optional bridge failure must not hold up the original session's startup.
    void connect($, state).catch(() => {});
    return result;
  });
  on('turn.start', ($, e, next) => {
    state.turnId = e.turnId;
    enqueue($, state, { type: 'state', turnId: e.turnId, activity: 'thinking' });
    return next(e);
  });
  on('turn.step', async function* ($, e, next) {
    const stream = next(e); // Calling next twice would run the model twice.
    for await (const chunk of stream) {
      if (!e.agentId && state.enabled) {
        if (chunk.kind === 'text' && state.watching) enqueue($, state, { type: 'text', turnId: e.turnId, id: `live:${e.turnId}:${e.index}:${chunk.index}`, text: chunk.text });
        else if (chunk.kind === 'tool' || chunk.kind === 'thinking') enqueue($, state, { type: 'state', turnId: e.turnId, activity: chunk.kind === 'tool' ? 'working' : 'thinking' });
      }
      yield chunk;
    }
    return await stream.result;
  });
  on('tool.call', ($, e, next) => {
    if (!e.agentId && state.turnId) enqueue($, state, { type: 'state', turnId: state.turnId, activity: 'working' });
    return next(e);
  });
  on('classic.PreToolUse', async ($, e, next) => {
    const result = await next(e);
    // Classic hooks do not execute the tool. Preserve other hooks' decisions and rewrites.
    if (String(e.tool) !== 'AskUserQuestion' || result.allow || result.ask || result.deny || result.updatedInput || !state.enabled || !state.watching || !state.turnId) return result;
    const request = questionRequest(e);
    if (!request) return result;
    const response = await interact($, state, next.signal, request);
    if (!response || !Array.isArray(response.answers) || next.signal.aborted) return result;
    const answers = questionAnswers(request.questions, response.answers);
    if (!answers) return result;
    const { tool, tool_use_id, ...original } = e;
    // Let the original tool validate and produce its own result; never synthesize a tool result.
    return { allow: true, updatedInput: { ...original, answers }, ...(result.additionalContext ? { additionalContext: result.additionalContext } : {}) };
  }).catch(($, e, next) => next(e));
  on('classic.PermissionRequest', async ($, e, next) => {
    const result = await next(e);
    if (result.decision || result.block || result.preventContinuation || e.tool_name === 'AskUserQuestion' || !state.enabled || !state.watching || !state.turnId) return result;
    const request = permissionRequest(e);
    if (!request) return result;
    const response = await interact($, state, next.signal, request);
    if (!response || next.signal.aborted || !['once', 'reject'].includes(response.decision)) return result;
    return { ...result, decision: response.decision === 'once' ? { behavior: 'allow' } : { behavior: 'deny', message: 'The user declined this request from Mobile Codex.' } };
  }).catch(($, e, next) => next(e));
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId && state.turnId === e.turnId) {
      state.turnId = null;
      enqueue($, state, { type: 'state', turnId: null, activity: 'thinking', aborted: e.isAborted });
      if (state.enabled && state.watching) void collectMessages($, state).catch(() => {});
    }
    return result;
  });
  on('session.end', ($, e, next) => {
    state.closed = true; state.enabled = false;
    state.flushTimer?.cancel(); state.pollTimer?.cancel();
    if (state.generation) void bridgeRequest($, state, `/${state.id}/end`, { generation: state.generation }).catch(() => {});
    return next(e);
  });
}

/** @param {import('claude-code').EngineInterface} $ */
async function connect($, state) {
  if (state.closed || state.connecting) return;
  state.connecting = true;
  try {
  const raw = await $.env.get('MOBILE_CODEX_CLAUDE_BRIDGE_URL');
  const token = await $.env.get('MOBILE_CODEX_CLAUDE_BRIDGE_TOKEN');
  if (!raw || !token) return;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || token.length < 32 || token.length > 512) return;
  state.url = url.origin; state.token = token;
  const version = await $.session.version();
  const base = version.base ?? version.version;
  if (!/^2\.1\.\d+$/.test(base) || Number(base.split('.')[2]) < 287) return;
  state.id = await $.session.id();
  const directory = await $.session.cwd();
  try {
    const response = await bridgeRequest($, state, '/register', { sessionId: state.id, activationId: state.activationId, version: base, directory, turnId: state.turnId, interactions: 1 });
    if (state.closed) return;
    if (typeof response.generation !== 'string' || !/^[0-9a-f-]{36}$/i.test(response.generation)) return;
    if (state.generation !== response.generation) { state.sequence = 0; state.batch = null; state.events = []; }
    state.generation = response.generation; state.enabled = true; state.watching = response.watching === true;
    enqueue($, state, { type: 'state', turnId: state.turnId, activity: 'thinking' });
    void poll($, state);
  } catch {
    if (!state.closed) state.pollTimer = $.clock.after(3000, () => { void connect($, state).catch(() => {}); });
  }
  } finally { state.connecting = false; }
}

/** @param {import('claude-code').EngineInterface} $ */
async function bridgeRequest($, state, route, body) {
  const response = await $.http.fetch(`${state.url}/api/claude-bridge${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw Object.assign(new Error('bridge_request_failed'), { status: response.status });
  if (response.text.length > 262144) throw new Error('bridge_response_limit');
  return JSON.parse(response.text);
}

/** @param {import('claude-code').EngineInterface} $ */
function enqueue($, state, event) {
  if (!state.enabled || state.closed) return;
  if (event.type === 'text' && event.text.length > 32000) {
    for (let offset = 0; offset < event.text.length; offset += 32000) enqueue($, state, { ...event, text: event.text.slice(offset, offset + 32000) });
    return;
  }
  const last = state.events.at(-1);
  if (event.type === 'state' && last?.type === 'state' && event.turnId === last.turnId && event.activity === last.activity && event.aborted === last.aborted) return;
  if (event.type === 'text' && last?.type === 'text' && last.id === event.id && last.text.length + event.text.length <= 32000) last.text += event.text;
  else state.events.push(event);
  if (state.events.length > 100 || new TextEncoder().encode(JSON.stringify(state.events)).length > 130000) {
    // Drop read-only overlays under backpressure, never receipts. A later transcript snapshot repairs the text.
    state.events = state.events.filter(e => e.type === 'receipt').slice(-32);
    state.events.push({ type: 'partial' }); state.partial = true;
    if (event.type === 'state') state.events.push(event);
  }
  if (!state.flushTimer && !state.flushing) state.flushTimer = $.clock.after(40, () => { state.flushTimer = null; void flush($, state); });
}

/** @param {import('claude-code').EngineInterface} $ */
function flush($, state) {
  if (state.flushPromise) return state.flushPromise;
  const pending = flushBatch($, state).finally(() => { if (state.flushPromise === pending) state.flushPromise = null; });
  return state.flushPromise = pending;
}

/** @param {import('claude-code').EngineInterface} $ */
async function flushBatch($, state) {
  if (state.flushing || state.closed || !state.enabled || (!state.batch && !state.events.length)) return;
  state.flushing = true;
  state.batch ??= { generation: state.generation, sequence: state.sequence + 1, events: state.events.splice(0) };
  const batch = state.batch;
  try {
    const response = await bridgeRequest($, state, `/${state.id}/events`, batch);
    if (state.batch !== batch || state.generation !== batch.generation) return;
    state.sequence = batch.sequence; state.batch = null; state.watching = response.watching === true;
  } catch (error) {
    if ([401, 403].includes(error.status)) { state.enabled = false; return; }
    if ([409, 410].includes(error.status)) { state.enabled = false; state.batch = null; state.events = []; state.pollTimer?.cancel(); void connect($, state).catch(() => {}); return; }
  } finally {
    state.flushing = false;
    if (!state.closed && state.enabled && (state.batch || state.events.length)) state.flushTimer = $.clock.after(state.batch ? 1000 : 40, () => { state.flushTimer = null; void flush($, state); });
  }
}

function questionRequest(input) {
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 4 || input.answers || input.response) return null;
  const questions = [];
  for (const q of input.questions) {
    if (!q || Object.keys(q).some(k => !['question', 'header', 'options', 'multiSelect'].includes(k))
      || typeof q.question !== 'string' || !q.question.trim() || q.question.length > 4000 || typeof q.header !== 'string' || q.header.length > 48
      || typeof q.multiSelect !== 'boolean' || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return null;
    const options = [];
    for (const option of q.options) {
      if (!option || Object.keys(option).some(k => !['label', 'description', 'preview'].includes(k))
        || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 1000
        || typeof option.description !== 'string' || option.description.length > 4000
        || (option.preview !== undefined && (typeof option.preview !== 'string' || option.preview.length > 18000))) return null;
      options.push({ label: option.label, description: option.description + (option.preview ? `\n\n预览（文本）：\n${option.preview}` : '') });
    }
    if (new Set(options.map(o => o.label)).size !== options.length) return null;
    questions.push({ question: q.question, header: q.header, options, multiple: q.multiSelect, custom: true });
  }
  if (new Set(questions.map(q => q.question)).size !== questions.length || new TextEncoder().encode(JSON.stringify(questions)).length > 90000) return null;
  return { kind: 'question', questions };
}

function questionAnswers(questions, values) {
  if (values.length !== questions.length) return null;
  const entries = [];
  for (let i = 0; i < questions.length; i++) {
    const row = values[i];
    if (!Array.isArray(row) || !row.length || row.length > 10 || (!questions[i].multiple && row.length !== 1)
      || new Set(row).size !== row.length || row.some(v => typeof v !== 'string' || !v.trim() || v.length > 10000)) return null;
    entries.push([questions[i].question, row.join(', ')]);
  }
  return Object.fromEntries(entries);
}

function permissionRequest(input) {
  // These tools' complete inputs are displayed. Interactive MCP tools keep their own host dialog.
  if (!['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'NotebookEdit'].includes(input.tool_name)
    || !input.tool_input || typeof input.tool_input !== 'object' || Array.isArray(input.tool_input)
    || typeof input.cwd !== 'string' || input.cwd.length > 4096 || !input.cwd.startsWith('/')) return null;
  const detail = JSON.stringify(input.tool_input, null, 2);
  if (!detail || detail.length > 32000 || new TextEncoder().encode(detail).length > 90000) return null;
  return { kind: 'permission', action: input.tool_name, directory: input.cwd, detail };
}

/** @param {import('claude-code').EngineInterface} $ */
async function interact($, state, signal, descriptor) {
  const generation = state.generation, turnId = state.turnId, id = crypto.randomUUID(), serial = ++state.requestSerial;
  // Drain the already queued turn start before publishing a request for that turn.
  for (let i = 0; i < 3 && (state.flushPromise || state.batch || state.events.length); i++) await flush($, state);
  if (signal.aborted || !state.enabled || state.closed || generation !== state.generation || turnId !== state.turnId || state.batch || state.events.length) return null;
  const close = () => { void bridgeRequest($, state, `/${state.id}/interaction/close`, { generation, id, serial }).catch(() => {}); };
  signal.addEventListener('abort', close, { once: true });
  try {
    while (!signal.aborted && !state.closed && state.enabled && generation === state.generation && turnId === state.turnId) {
      // Waiting in the host API pauses the hook budget. Do not wait on a homemade deferred Promise.
      const response = await bridgeRequest($, state, `/${state.id}/interaction`, { generation, id, serial, turnId, request: descriptor });
      if (signal.aborted || state.closed || generation !== state.generation || turnId !== state.turnId) return null;
      if (response.status === 'answered') return response.answer;
      if (response.status !== 'pending') return null;
    }
  } catch { /* no permission is granted on bridge failure; the original host flow stands */ }
  finally { signal.removeEventListener('abort', close); close(); }
  return null;
}

/** @param {import('claude-code').EngineInterface} $ */
async function collectMessages($, state) {
  if (state.closed || !state.watching) return;
  const messages = await $.session.messages();
  if (state.closed || !state.watching) return;
  let budget = 100000, partial = messages.length > 80;
  const recent = [];
  for (const message of messages.slice(-80).reverse()) {
    if (!message.text || !['user', 'assistant'].includes(message.role)) continue;
    const text = message.text.slice(-Math.min(64000, budget));
    if (text.length !== message.text.length) partial = true;
    if (text) recent.push({ role: message.role, text });
    budget -= text.length;
    if (!budget) { partial = true; break; }
  }
  recent.reverse();
  while (new TextEncoder().encode(JSON.stringify(recent)).length > 120000) {
    partial = true;
    if (recent.length > 1) recent.shift();
    else recent[0].text = recent[0].text.slice(Math.ceil(recent[0].text.length / 2));
  }
  state.partial = false;
  enqueue($, state, { type: 'messages', messages: recent, partial });
}

/** @param {import('claude-code').EngineInterface} $ */
async function poll($, state) {
  if (state.polling || state.closed || !state.enabled) return;
  state.polling = true;
  let retry = 0;
  const generation = state.generation;
  try {
    const response = await bridgeRequest($, state, `/${state.id}/poll`, { generation });
    if (state.closed || generation !== state.generation) return;
    state.watching = response.watching === true;
    if (!Array.isArray(response.commands) || response.commands.length > 16) throw new Error('bridge_commands_invalid');
    for (const command of response.commands) {
      if (state.closed || generation !== state.generation) return;
      if (typeof command.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(command.id)) continue;
      if (command.type === 'snapshot') { await collectMessages($, state); continue; }
      if (state.seen.has(command.id)) { enqueue($, state, { type: 'receipt', id: command.id, delivery: 'uncertain' }); continue; }
      state.seen.add(command.id);
      if (state.seen.size > 1024) state.seen.delete(state.seen.values().next().value);
      try {
        if (command.type === 'message' && typeof command.text === 'string' && command.text.trim() && command.text.length <= 20000) {
          const result = await $.prompt.submit({ text: command.text });
          enqueue($, state, { type: 'receipt', id: command.id, delivery: result.drop ? 'rejected' : typeof result.text === 'string' ? 'confirmed' : 'uncertain' });
        } else if (command.type === 'interrupt' && typeof command.turnId === 'string') {
          if (command.turnId !== state.turnId) { enqueue($, state, { type: 'receipt', id: command.id, delivery: 'rejected' }); continue; }
          await $.turn.abort({ turnId: command.turnId });
          enqueue($, state, { type: 'receipt', id: command.id, delivery: 'confirmed' });
        } else enqueue($, state, { type: 'receipt', id: command.id, delivery: 'rejected' });
      } catch { enqueue($, state, { type: 'receipt', id: command.id, delivery: 'uncertain' }); }
    }
  } catch (error) {
    retry = 3000;
    if ([401, 403].includes(error.status)) { state.enabled = false; return; }
    if ([409, 410].includes(error.status)) { state.enabled = false; state.events = []; state.batch = null; void connect($, state).catch(() => {}); return; }
  } finally {
    state.polling = false;
    if (!state.closed && state.enabled) state.pollTimer = $.clock.after(retry, () => { state.pollTimer = null; void poll($, state); });
  }
}
