import { randomUUID, createHash } from 'node:crypto';

const fail = (code, status = 409) => Object.assign(new Error(`DEEPSEEK_${code}`), { status });
const service = (ctx, name) => ctx.get ? ctx.get(name) : ctx[name];
// Vetted desktop build 332895e; the pending seam is internal even within this version.
const gatewayMethods = {
  settleRemoteEvent: '6b117ca6e967c8aa24f2b291e5506acf7b6230a1e061ce0201483d8f3ec94a0f',
  finishRemoteEvent: '87a6d8569f34a7fd0f6f68fb840b9af40099808c92fc118b11a9065961bdbd2d',
};
const method = (value, name) => {
  for (let current = value; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return descriptor.value;
  }
};
const string = (value, max = 131072) => typeof value === 'string' && value.length <= max;
// ApprovalRequestEvent.displayReason is a locale map with a required English fallback.
// Preserve every supplied locale instead of silently discarding presentation context.
function displayReason(value) {
  if (value === undefined) return '';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const entries = Object.entries(value);
  if (!Object.hasOwn(value, 'en') || entries.length > 32
    || entries.some(([locale, text]) => !locale || !string(locale, 64) || !string(text, 32768))) return null;
  const text = JSON.stringify(value, null, 2);
  return Buffer.byteLength(text) <= 32768 ? text : null;
}

/** Version-pinned in-process seam. Shares the desktop's pending waterfall; never installs an answerer. */
export function createDeepSeekInteractions(ctx) {
  const pendingRecords = new WeakMap(), continuedRecords = new WeakMap(), vetted = new WeakMap();
  function gateway() {
    const value = service(ctx, 'typertGateway');
    if (!(value?.pendingRemoteEvents instanceof Map)) return null;
    const functions = Object.keys(gatewayMethods).map(name => method(value, name));
    const previous = vetted.get(value.pendingRemoteEvents);
    if (previous?.functions.every((fn, i) => fn === functions[i])) return previous.accepted ? value : null;
    const accepted = Object.entries(gatewayMethods).every(([name, hash]) => typeof method(value, name) === 'function'
      && createHash('sha256').update(Function.prototype.toString.call(method(value, name)).replace(/\s+/gu, '')).digest('hex') === hash);
    vetted.set(value.pendingRemoteEvents, { functions, accepted });
    return accepted ? value : null;
  }
  function root(agent) {
    return ctx.agents.get(agent.id) === agent && (!ctx.agents.roots || ctx.agents.roots().includes(agent));
  }
  function questions(raw) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16 || new Set(raw.map(q => q?.id)).size !== raw.length) return null;
    const result = [];
    for (const q of raw) {
      if (!q || !string(q.id, 512) || !q.id || !string(q.question) || (q.detail !== undefined && !string(q.detail))
        || (q.header !== undefined && !string(q.header, 256)) || (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean')
        || Object.keys(q).some(key => !['id', 'question', 'detail', 'header', 'options', 'multiSelect', 'intent'].includes(key))) return null;
      const options = q.options ?? [];
      if (!Array.isArray(options) || options.length > 32 || new Set(options.map(o => o?.label)).size !== options.length
        || options.some(o => !o || !string(o.label, 10000) || !o.label || (o.description !== undefined && !string(o.description, 10000))
          || Object.keys(o).some(key => !['label', 'description'].includes(key)))) return null;
      if (q.intent !== undefined && (!q.intent || q.intent.kind !== 'plan-review' || !string(q.intent.approve, 10000)
        || !options.some(o => o.label === q.intent.approve) || q.detail === undefined
        || Object.keys(q.intent).some(key => !['kind', 'approve'].includes(key)))) return null;
      // Keep detail in the existing field so already installed APK21 also shows the entire plan.
      const question = q.detail === undefined ? q.question : `${q.question}\n\n${q.detail}`;
      if (!string(question)) return null;
      result.push({ question, header: q.header ?? '', options: options.map(o => ({ label: o.label, description: o.description ?? '' })), multiple: q.multiSelect ?? false, custom: true });
    }
    return Buffer.byteLength(JSON.stringify(result)) <= 192 * 1024 ? result : null;
  }
  function permission(req, entry) {
    const call = entry.toolCalls.get(req.callId);
    let complete = call && call.name === req.toolName && call.turn === entry.turn && call.step === entry.step && string(call.arguments, 131072);
    try { if (complete) JSON.parse(call.arguments); } catch { complete = false; }
    const presentation = displayReason(req.displayReason);
    const detail = complete ? `工具：${req.toolName}\n${req.reason ?? ''}\n${presentation ?? ''}\n\n工具输入（原始 JSON）：\n${call.arguments}` : '';
    const knownRequest = !Object.keys(req).some(key => !['agent', 'signal', 'toolName', 'callId', 'reason', 'displayReason'].includes(key));
    const available = complete && Buffer.byteLength(detail) <= 192 * 1024
      && (req.reason === undefined || string(req.reason, 32768)) && presentation !== null
      && knownRequest;
    return { action: string(req.toolName, 512) ? req.toolName : '未知工具', resources: [entry.agent.session.header.cwd], save: [],
      detail: available ? detail : '无法完整核验本次工具参数，请在电脑查看后处理。',
      unavailableReason: available ? null : !req.callId ? '原审批未关联工具输入，请在电脑核验后允许。' : !call ? '未取得当前工具的完整输入，请在电脑核验后允许。' : !knownRequest ? '此审批包含手机尚未支持的约束，请在电脑允许。' : call.turn !== entry.turn || call.step !== entry.step ? '工具输入属于其他步骤，请在电脑核验后允许。' : call.name !== req.toolName ? '工具名称与审批不一致，请在电脑核验后允许。' : '工具输入无法完整展示，请在电脑核验后允许。', decisions: available ? ['once', 'reject'] : ['reject'] };
  }
  function collect(entry) {
    const agent = entry.agent, host = gateway(), items = [];
    let budget = 384 * 1024;
    function fit(kind, data) {
      const bytes = Buffer.byteLength(JSON.stringify(data));
      if (bytes <= budget) { budget -= bytes; return data; }
      budget -= 1024;
      return kind === 'permission' ? { ...data, detail: '本次请求过长，请在电脑查看完整参数。', unavailableReason: '内容超过手机同步上限，允许已禁用。', decisions: ['reject'] }
        : { questions: [{ question: '本次提问过长，请在电脑查看完整内容。', header: 'DeepSeek 提问', options: [], multiple: false, custom: false }], unavailableReason: '内容超过手机同步上限，请在电脑处理。' };
    }
    if (!root(agent)) return items;
    for (const pending of host?.pendingRemoteEvents.values() ?? []) {
      const req = pending.source?.request, event = pending.source?.event;
      if (req?.agent !== agent || req.signal?.aborted || !['approval/request', 'user-questions/request'].includes(event)) continue;
      if (items.length >= 16) break;
      const kind = event === 'approval/request' ? 'permission' : 'question';
      if (kind === 'permission' && agent.status !== 'running') continue;
      const previous = pendingRecords.get(pending);
      if (previous && (previous.turn !== entry.turn || (kind === 'permission' && previous.step !== entry.step))) continue;
      let data = kind === 'permission' ? permission(req, entry) : { questions: questions(req.questions) };
      if (kind === 'question' && !data.questions) {
        data.questions = [{ question: '此提问包含手机暂不支持或超长的内容，请在电脑查看完整请求。', header: 'DeepSeek 提问', options: [], multiple: false, custom: false }];
        data.unavailableReason = '原请求无法完整展示，请在电脑处理。';
      }
      data = fit(kind, data);
      const signature = createHash('sha256').update(JSON.stringify({ kind, callId: req.callId, data, raw: kind === 'question' ? req.questions : { toolName: req.toolName, reason: req.reason, displayReason: req.displayReason, callId: req.callId } })).digest('hex');
      let record = pendingRecords.get(pending);
      if (!record || (record.signature !== signature && record.status === 'pending')) {
        record = { id: randomUUID(), kind, pending, req, host, signature, data, rawQuestions: req.questions, status: 'pending', turn: entry.turn, step: entry.step };
        pendingRecords.set(pending, record);
      } else if (record.signature !== signature) record.status = 'uncertain';
      if (record.turn !== entry.turn) continue;
      items.push(record);
    }
    const questionsService = service(ctx, 'userQuestions');
    const active = questionsService?.continued?.(agent) ?? [];
    let records = continuedRecords.get(agent);
    if (!records) { records = new Map(); continuedRecords.set(agent, records); }
    const remaining = new Set();
    for (const request of active.slice(0, 16 - items.length)) {
      const data = questions(request.questions);
      if (!data || !string(request.callId, 512)) continue;
      remaining.add(request.callId);
      const fitted = fit('question', { questions: data });
      const signature = JSON.stringify({ questions: request.questions, data: fitted });
      let record = records.get(request.callId);
      if (!record || (record.signature !== signature && record.status === 'pending')) {
        record = { id: randomUUID(), kind: 'question', callId: request.callId, signature, rawQuestions: request.questions, data: fitted, status: 'pending', continued: true };
        records.set(request.callId, record);
      } else if (record.signature !== signature) record.status = 'uncertain';
      const queued = [...(agent.inbox?.nextStep ?? []), ...(agent.inbox?.nextTurn ?? [])].some(message => message.source?.kind === 'user-question-reply' && message.source.callId === request.callId);
      if (queued && record.status === 'pending') record.status = 'submitted';
      items.push(record);
    }
    for (const key of records.keys()) if (!remaining.has(key)) records.delete(key);
    return items;
  }
  function snapshot(entry) {
    const items = collect(entry);
    return {
      questions: items.filter(item => item.kind === 'question').map(item => ({ id: item.id, status: item.status, ...item.data })),
      permissions: items.filter(item => item.kind === 'permission').map(item => ({ id: item.id, status: item.status, ...item.data })),
    };
  }
  function respond(entry, kind, id, input) {
    const record = collect(entry).find(item => item.kind === kind && item.id === id);
    if (!record || record.status !== 'pending') throw fail('REQUEST_EXPIRED');
    let value;
    if (kind === 'permission') {
      if (!record.data.decisions.includes(input.decision)) throw fail('DECISION_UNAVAILABLE');
      value = input.decision === 'once' ? 'allowed-once' : 'rejected';
    } else {
      if (record.data.unavailableReason || !Array.isArray(input.answers) || input.answers.length !== record.rawQuestions.length) throw fail('INPUT_INVALID', 400);
      value = { answers: record.rawQuestions.map((q, i) => {
        const answer = input.answers[i];
        if (!Array.isArray(answer) || !answer.length || answer.length > 33 || answer.some(v => !string(v, 10000) || !v.trim())
          || new Set(answer).size !== answer.length || (!q.multiSelect && answer.length !== 1)) throw fail('INPUT_INVALID', 400);
        const labels = new Set((q.options ?? []).map(o => o.label));
        const custom = answer.filter(v => !labels.has(v));
        if (custom.length > 1) throw fail('INPUT_INVALID', 400);
        return { id: q.id, selected: answer.filter(v => labels.has(v)), ...(custom.length ? { custom: custom[0] } : {}) };
      }) };
    }
    // Original live-handle guard + reservation + host settlement are synchronous.
    record.status = 'submitted';
    try {
      if (record.continued) {
        if (service(ctx, 'userQuestions').answer(entry.agent, record.callId, value) !== true) throw fail('REQUEST_EXPIRED');
        return { ok: true, delivery: 'submitted' };
      }
      if (gateway()?.pendingRemoteEvents !== record.host.pendingRemoteEvents || record.host.pendingRemoteEvents.get(record.pending.id) !== record.pending || record.req.signal?.aborted) throw fail('REQUEST_EXPIRED');
      record.host.settleRemoteEvent(record.pending, { kind: 'result', value });
      if (!record.host.pendingRemoteEvents.has(record.pending.id)) return { ok: true, delivery: 'confirmed' };
    } catch { /* A host call may have settled before throwing: never replay. */ }
    record.status = 'uncertain';
    return { ok: true, delivery: 'uncertain' };
  }
  return { snapshot, respond, available: () => gateway() !== null };
}
