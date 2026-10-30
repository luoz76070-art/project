import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDeepSeekBridge } from '../plugins/mobile-deepseek/bridge.mjs';

// Explicit, isolated official-service verification. No user profile, provider or model.
const runtime = process.argv[2];
if (!runtime || !path.isAbsolute(runtime) || process.argv.length !== 3) throw new Error('Usage: node scripts/check-deepseek-interactions.mjs <absolute-isolated-runtime-directory>');
const version = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/@deepseek-ai/dsh-llm/package.json'), 'utf8')).version;
assert.ok(['0.2.1-rc.2', '0.2.1-rc.3'].includes(version), 'Unsupported isolated runtime');
const load = name => import(pathToFileURL(path.join(runtime, 'node_modules/@deepseek-ai', name, 'lib/index.js')).href);
for (const name of ['dsh-api-gateway', 'dsh-user-approval', 'dsh-user-questions', 'dsh-session']) {
  assert.equal(JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/@deepseek-ai', name, 'package.json'), 'utf8')).version, version);
}
const [{ Context, symbols }, { TypertGatewayService }, { ApprovalService }, { UserQuestionService }, { SessionStore }, { AgentRegistry }, { default: SessionQuery }, { default: Projections }, { createUserMessage, createToolResultMessage }] = await Promise.all([
  load('cordis'), load('dsh-api-gateway'), load('dsh-user-approval'), load('dsh-user-questions'), load('dsh-session'), load('dsh-agent'), load('dsh-session-query'), load('dsh-session-projection'), load('dsh-llm'),
]);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-dsh-interaction-check-'));
const ctx = new Context(), checks = {};
let bridge, reader, controller;
try {
  const fibers = [ctx.plugin(SessionStore), ctx.plugin(AgentRegistry), ctx.plugin(SessionQuery), ctx.plugin(Projections), ctx.plugin(ApprovalService, { policy: 'ask' }), ctx.plugin(UserQuestionService)];
  await Promise.all(fibers.map(fiber => fiber.await()));
  // Original official gateway algorithms; omit physical WebSocket/Peer transport.
  const host = Object.create(TypertGatewayService.prototype);
  host.pendingRemoteEvents = new Map(); host.remoteEventClients = new Map(); host.ctx = ctx;
  Object.defineProperty(host, symbols.tracker, { value: { associate: 'typertGateway', property: 'ctx' } });
  ctx.reflect.provide('typertGateway', host);
  assert.notEqual(ctx.get('typertGateway'), ctx.get('typertGateway')); // Official scoped service proxies are recreated per read.
  const session = ctx.sessions.create('synthetic-interaction', { meta: { cwd: directory } });
  const agent = { id: session.id, session, ctx, status: 'running', inbox: { nextStep: [], nextTurn: [] },
    steer(message) { this.inbox.nextStep.push(message); }, followup() { assert.fail('no model task'); }, cancel() { assert.fail('no task interruption'); } };
  await ctx.agents.register(agent);
  session.append('turn/start', { turn: 1 }); session.append('step/start', { turn: 1, step: 1 });
  for (const event of ['approval/request', 'user-questions/request']) ctx.on(event, request => new Promise((resolve, reject) => {
    host.startRemoteEvent({ event, request, context: { agentId: agent.id, subject: agent, value: ctx }, resolve: outcome => resolve(outcome.value), reject });
  }));
  const facade = { agents: ctx.agents, sessionQuery: ctx.sessionQuery, on: (...args) => ctx.on(...args), get: name => ctx.get(name) };
  const token = randomBytes(32).toString('base64url');
  bridge = createDeepSeekBridge(facade, { port: 0, token, directory }, createUserMessage, version);
  const base = `http://127.0.0.1:${(await bridge.ready).port}`;
  const json = async (route, body) => {
    const res = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(4000) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await json('/info')).body.interactions, true); checks.officialGatewayFingerprint = true;
  const id = (await json('/sessions')).body.sessions[0].id;
  controller = new AbortController();
  const res = await fetch(`${base}/sessions/${id}/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  reader = res.body.getReader(); let buffer = ''; const decoder = new TextDecoder();
  async function next(predicate) {
    const deadline = setTimeout(() => controller.abort(), 5000);
    try {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) { const result = await reader.read(); assert.equal(result.done, false); buffer += decoder.decode(result.value, { stream: true }); continue; }
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (!frame.startsWith('data: ')) continue;
        const value = JSON.parse(frame.slice(6)); if (predicate(value)) return value;
      }
    } finally { clearTimeout(deadline); }
  }
  await next(() => true);
  const input = snapshot => ({ controlToken: snapshot.control.token, clientMessageId: randomUUID() });
  const asked = ctx.userQuestions.ask({ agent, questions: [{ id: 'plan', question: '确认计划？', detail: '完整计划\n最后一步', options: [{ label: '执行' }, { label: '修改' }], intent: { kind: 'plan-review', approve: '执行' } }] });
  const q = await next(value => value.questions.length);
  assert.ok(q.questions[0].questions[0].question.endsWith('最后一步'));
  assert.equal((await json(`/sessions/${id}/questions/${q.questions[0].id}/respond`, { ...input(q), answers: [['执行']] })).body.delivery, 'confirmed');
  assert.deepEqual(await asked, { answers: [{ id: 'plan', selected: ['执行'] }] }); checks.officialQuestionAndPlan = true;

  session.append('tool/call', { turn: 1, step: 1, callId: 'native-tool', name: 'bash', arguments: '{"command":"printf fixture"}' });
  const approval = ctx.approval.request({ agent, toolName: 'bash', callId: 'native-tool', reason: 'fixture', displayReason: { en: 'Synthetic read', zh: '合成读取权限' } });
  const p = await next(value => value.permissions.length);
  assert.deepEqual(p.permissions[0].decisions, ['once', 'reject']);
  assert.ok(p.permissions[0].detail.includes('Synthetic read')); assert.ok(p.permissions[0].detail.includes('合成读取权限'));
  await json(`/sessions/${id}/permissions/${p.permissions[0].id}/respond`, { ...input(p), decision: 'once' });
  assert.equal(await approval, 'allowed-once'); checks.officialApprovalAndAudit = true;

  const rejected = ctx.approval.request({ agent, toolName: 'bash', callId: 'native-tool' });
  const r = await next(value => value.permissions.length && value.permissions[0].id !== p.permissions[0].id);
  await json(`/sessions/${id}/permissions/${r.permissions[0].id}/respond`, { ...input(r), decision: 'reject' });
  assert.equal(await rejected, 'rejected'); checks.officialReject = true;

  const abort = new AbortController();
  const cancelled = ctx.approval.request({ agent, toolName: 'bash', callId: 'native-tool', signal: abort.signal });
  const c = await next(value => value.permissions.length && value.permissions[0].id !== r.permissions[0].id); abort.abort();
  assert.equal(await cancelled, 'cancelled');
  assert.equal((await json(`/sessions/${id}/permissions/${c.permissions[0].id}/respond`, { ...input(c), decision: 'once' })).status, 409); checks.officialCancellation = true;

  const desktop = ctx.userQuestions.ask({ agent, questions: [{ id: 'desktop', question: '桌面先答' }] });
  const d = await next(value => value.questions.length);
  const pending = [...host.pendingRemoteEvents.values()].find(item => item.source.event === 'user-questions/request');
  host.settleRemoteEvent(pending, { kind: 'result', value: { answers: [{ id: 'desktop', selected: [], custom: '桌面答案' }] } });
  await desktop;
  assert.equal((await json(`/sessions/${id}/questions/${d.questions[0].id}/respond`, { ...input(d), answers: [['手机迟到']] })).status, 409); checks.officialDesktopFirst = true;

  session.append('request/header', { turn: 1, step: 1, header: { tools: [{ name: 'ask_user_question', parameters: { type: 'object', properties: { timeout: { type: 'number' } } } }] } });
  session.append('tool/call', { turn: 1, step: 1, callId: 'timed-a', name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ id: 'later', question: '稍后回答？', options: [{ label: '继续' }] }] }) });
  const timed = await ctx.userQuestions.askTimed({ agent, questions: [{ id: 'later', question: '稍后回答？', options: [{ label: '继续' }] }] }, 'timed-a', 10);
  assert.equal(timed.pending, true);
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'timed-a', content: [{ type: 'text', text: JSON.stringify(timed) }], isError: false }) }, { surfaceOp: 'append' });
  session.append('step/end', { turn: 1, step: 1 }); session.append('turn/end', { turn: 1 }); agent.status = 'idle';
  const continued = await next(value => value.questions.some(item => item.questions[0].question === '稍后回答？'));
  assert.equal((await json(`/sessions/${id}/questions/${continued.questions[0].id}/respond`, { ...input(continued), answers: [['继续']] })).body.delivery, 'submitted');
  assert.equal(agent.inbox.nextStep[0].source.kind, 'user-question-reply'); assert.equal(agent.inbox.nextStep[0].source.callId, 'timed-a');
  assert.equal((await json(`/sessions/${id}/questions/${continued.questions[0].id}/respond`, { ...input(continued), answers: [['继续']] })).status, 409);
  session.append('user/message', agent.inbox.nextStep.shift(), { surfaceOp: 'append' });
  await next(value => value.questions.length === 0); checks.officialContinuedQuestion = true;

  const events = await ctx.sessionQuery.observeSession(agent.id, { projectionMode: 'none' });
  try { assert.deepEqual(events.events.filter(event => event.type === 'approval/decided').map(event => event.data.outcome), ['allowed-once', 'rejected', 'cancelled']); }
  finally { events[Symbol.dispose](); }
  assert.equal(host.pendingRemoteEvents.size, 0); checks.noPendingLeak = true;
  console.log(JSON.stringify({ version, checks, externalModelRequests: 0, userProfilesChanged: false, actualUserApprovalPerformed: false }, null, 2));
} finally {
  controller?.abort(); await reader?.cancel().catch(() => {}); await bridge?.stop(); await ctx.fiber.dispose(); await fs.rm(directory, { recursive: true, force: true });
}
