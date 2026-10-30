// Disposable local UI fixture. No access to Codex, desktop control or user files.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ordinaryPrompts, contextEnvelopes } from './fixtures/user-prompts.mjs';

const dist = fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url));
const hotBundle = process.env.UI_FIXTURE_HOT_BUNDLE;
const streams = new Set();
const streamRoutes = new Map();
const notifications = new Map();
const counters = {};
const clipboardFixture = { text: '', writes: 0, fail: false };
const diagnosticFixture = { gateway: 'ok', nativeVersionCode: null, activeVersion: '', pendingVersion: '', fileMode: 'saved', saves: 0, text: '' };
const voiceFixture = { region: 'cn', workspace: '', qwenConfigured: true, deepseekConfigured: true, deepseekBaseUrl: 'https://api.deepseek.com', qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', asrModel: 'qwen-audio-3.1-asr-flash', promptModel: 'deepseek-v4-flash', denied: false, failRefine: false, delay: 0, transcriptions: 0, refinements: 0, cancellations: 0 };
let offline = false;
const fixtureAppConfig = await fs.readFile(new URL('../apps/mobile/src/app/config.ts', import.meta.url), 'utf8');
const nativeVersionCode = Number(fixtureAppConfig.match(/export const appVersionCode = (\d+);/u)?.[1]);
if (!Number.isSafeInteger(nativeVersionCode) || nativeVersionCode < 1) throw new Error('Fixture app version is missing');
let apkState = { supported: true, revision: 0, phase: 'idle', receivedBytes: 0, totalBytes: 8388608, versionCode: nativeVersionCode + 1, versionName: `${nativeVersionCode + 1}-ui-fixture`, nativeVersionCode, canInstall: false, error: '' };
const apkCounters = { downloads: 0, installs: 0 };
const states = new Map(['A', 'B'].map(name => [name, {
  userInputs: [], approvals: [], cursor: 100, generation: `fixture-${name}`, turnStatus: 'completed', activity: undefined, messages: [
    { id: `${name}-user`, role: 'user', text: `检查 ${name} 连接的实时消息和历史记录`, kind: 'user_message', timestamp: '2026-10-20T09:00:00Z' },
    { id: `${name}-assistant`, role: 'assistant', text: `${name} 连接的内容。\n\n已检查连接、消息顺序和恢复行为。\n\n\`\`\`ts\nconst connected = true;\n\`\`\``, kind: 'agent_message', timestamp: '2026-10-20T09:01:00Z' },
  ],
}]));
const thread = name => ({ id: 'same-thread', threadName: `${name} · 优化连接与消息同步`, cwd: '/workspace/codex-to-phone', source: 'vscode', originator: 'Codex Desktop', updatedAt: '2026-10-20T09:01:00Z' });
const json = (res, value, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
function agentSnapshot(name, agentId = 'opencode') {
  const state = states.get(name);
  const claude = agentId === 'claude';
  const deepseek = agentId === 'deepseek', label = deepseek ? 'DeepSeek Harness' : claude ? 'Claude Code' : 'OpenCode';
  return state[`${agentId}Agent`] ??= {
    agentId, session: { id: claude || deepseek ? '11111111-1111-4111-8111-111111111111' : 'ses_fixture', title: `${label} · 远程工作与实时消息`, directory: '/synthetic/project', updatedAt: '2026-10-21T09:00:00Z' },
    connected: true, status: 'running', activity: 'outputting', updatedAt: '2026-10-21T09:01:00Z', partialText: deepseek,
    messages: [{ id: 'msg_fixture-user', role: 'user', text: '检查当前项目的实时输出和手机问答', kind: 'user_message', timestamp: '2026-10-21T09:00:00Z' },
      { id: 'msg_fixture-assistant', role: 'assistant', text: `已连接原有 ${label} 会话，正在处理项目检查。`, kind: 'agent_message', timestamp: '2026-10-21T09:01:00Z' }],
    questions: [], permissions: [], historyCursor: claude || deepseek ? null : 'fixture-history', control: { token: randomUUID(), canSend: true, canSteer: !claude, canInterrupt: true }, submission: null,
  };
}
function confirmNative(state) {
  const pending = state.nativePending;
  if (!pending) return;
  const interrupted = pending.action === 'interrupt-turn';
  state.turnStatus = interrupted ? 'interrupted' : 'inProgress';
  state.control = { ...state.control, activeTurnId: interrupted ? null : 'fixture-native-turn', canSend: true, canInterrupt: !interrupted, submission: { clientMessageId: pending.clientMessageId, action: pending.action, delivery: 'confirmed', turnStatus: state.turnStatus } };
  if (pending.message) state.messages.push({ id: `fixture-native-${pending.clientMessageId}`, clientMessageId: pending.clientMessageId, role: 'user', text: pending.message, kind: 'userMessage', timestamp: new Date().toISOString() });
  state.nativePending = null;
  state.cursor++;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture/cache-storage.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await fs.readFile(new URL('./fixtures/cache-storage.js', import.meta.url))); return;
    }
    if (url.pathname === '/fixture/clipboard') {
      if (url.searchParams.has('fail')) clipboardFixture.fail = url.searchParams.get('fail') === '1';
      if (req.method === 'POST') {
        if (clipboardFixture.fail) return json(res, { error: 'synthetic_clipboard_failure' }, 500);
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        if (typeof payload.string !== 'string' || payload.string.length > 65536) return json(res, { error: 'invalid_synthetic_clipboard' }, 400);
        clipboardFixture.text = payload.string; clipboardFixture.writes++;
      }
      return json(res, clipboardFixture);
    }
    if (url.pathname === '/fixture/diagnostics') {
      for (const key of ['gateway', 'activeVersion', 'pendingVersion', 'fileMode']) if (url.searchParams.has(key)) diagnosticFixture[key] = url.searchParams.get(key);
      if (url.searchParams.has('nativeVersionCode')) diagnosticFixture.nativeVersionCode = Number(url.searchParams.get('nativeVersionCode'));
      return json(res, diagnosticFixture);
    }
    if (url.pathname === '/fixture/diagnostic-file') {
      if (req.method === 'POST') {
        if (diagnosticFixture.fileMode === 'error') return json(res, { error: 'synthetic_save_failed' }, 500);
        if (diagnosticFixture.fileMode === 'cancelled') return json(res, { status: 'cancelled' });
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 65536) return json(res, { error: 'invalid_diagnostic_file' }, 400);
        diagnosticFixture.text = input.text; diagnosticFixture.saves++;
        return json(res, { status: 'saved' });
      }
      return json(res, { text: diagnosticFixture.text, saves: diagnosticFixture.saves });
    }
    if (url.pathname === '/fixture/voice') {
      for (const key of ['denied', 'failRefine']) if (url.searchParams.has(key)) voiceFixture[key] = url.searchParams.get(key) === '1';
      if (url.searchParams.has('delay')) voiceFixture.delay = Math.min(10000, Number(url.searchParams.get('delay')) || 0);
      return json(res, voiceFixture);
    }
    if (/^\/[AB]\/api\/voice\//.test(url.pathname)) {
      const action = url.pathname.split('/').at(-1);
      if (action === 'config' && req.method === 'GET') return json(res, voiceFixture);
      let body = ''; for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      if (action === 'config') {
        if (payload.deepseekBaseUrl && payload.deepseekBaseUrl !== voiceFixture.deepseekBaseUrl && voiceFixture.deepseekConfigured && !('deepseekKey' in payload)) return json(res, { error: 'voice_deepseek_key_required_for_url' }, 409);
        if (payload.qwenBaseUrl && payload.qwenBaseUrl !== voiceFixture.qwenBaseUrl && voiceFixture.qwenConfigured && !('qwenKey' in payload)) return json(res, { error: 'voice_qwen_key_required_for_url' }, 409);
        if ('qwenBaseUrl' in payload) voiceFixture.qwenBaseUrl = payload.qwenBaseUrl;
        if ('qwenModel' in payload) voiceFixture.asrModel = payload.qwenModel;
        for (const key of ['qwenKey', 'deepseekKey']) if (key in payload) voiceFixture[key === 'qwenKey' ? 'qwenConfigured' : 'deepseekConfigured'] = Boolean(payload[key]);
        if ('region' in payload) voiceFixture.region = payload.region;
        if ('workspace' in payload) voiceFixture.workspace = payload.workspace;
        if ('deepseekBaseUrl' in payload) voiceFixture.deepseekBaseUrl = payload.deepseekBaseUrl;
        if ('deepseekModel' in payload) voiceFixture.promptModel = payload.deepseekModel;
        return json(res, voiceFixture);
      }
      if (action === 'cancel') { voiceFixture.cancellations++; return json(res, { ok: true }); }
      if (voiceFixture.delay) await new Promise(resolve => setTimeout(resolve, voiceFixture.delay));
      if (action === 'transcribe') { voiceFixture.transcriptions++; return json(res, { text: '先分析手机会话按项目分组，Codex和DeepSeek都要，暂时不要执行或发布，版本是APK26。' }); }
      if (action === 'refine') {
        voiceFixture.refinements++;
        return voiceFixture.failRefine ? json(res, { error: 'voice_refine_unavailable' }, 502) : json(res, { text: '目标：分析手机会话按项目分组的方案。\n范围：Codex 和 DeepSeek，版本 APK26。\n约束：暂时不要执行或发布。' });
      }
    }
    if (url.pathname === '/fixture/apk-native.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await fs.readFile(new URL('./fixtures/apk-native.js', import.meta.url))); return;
    }
    if (url.pathname === '/fixture/apk') {
      const action = url.searchParams.get('action');
      const phase = url.searchParams.get('phase');
      if (action === 'download') { apkCounters.downloads++; apkState = { ...apkState, revision: apkState.revision + 1, phase: 'downloading', receivedBytes: 0, error: '' }; }
      if (action === 'install') { apkCounters.installs++; apkState = { ...apkState, revision: apkState.revision + 1, phase: apkState.canInstall ? 'awaiting_install' : 'permission_required', error: '' }; }
      if (phase) apkState = { ...apkState, revision: apkState.revision + 1, phase, receivedBytes: Number(url.searchParams.get('bytes')) || apkState.receivedBytes,
        canInstall: url.searchParams.get('allowed') === '1', error: url.searchParams.get('error') || '' };
      return json(res, { ...apkState, counters: apkCounters });
    }
    if (url.pathname === '/fixture/counters') return json(res, { ...counters, activeStreams: [...streamRoutes.values()] });
    if (url.pathname === '/fixture/prompt-visibility') {
      const state = states.get('A');
      if (url.searchParams.get('phase') === 'completed') {
        state.turnStatus = 'completed';
        if (state.control) state.control = { ...state.control, activeTurnId: null, canSend: true, canInterrupt: false };
        state.messages.push({ id: 'prompt-fixture-final', role: 'assistant', text: '合成任务完成，提示词应继续可见。', kind: 'agentMessage', phase: 'final_answer', timestamp: new Date().toISOString() });
      } else {
        state.messages = [...contextEnvelopes, ordinaryPrompts[2], ordinaryPrompts[3]].map((text, index) => ({ id: `prompt-fixture-${index}`, role: 'user', text, kind: 'message', timestamp: `2026-10-29T00:00:${String(index).padStart(2, '0')}Z` }));
      }
      state.cursor++;
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/projects') {
      const state = states.get(url.searchParams.get('name') ?? 'A');
      state.projects = true; state.deepseekHistory = true;
      state.listDelay = Math.min(3000, Math.max(0, Number(url.searchParams.get('delay')) || 0));
      if (url.searchParams.get('reactivate') === '1') state.reactivated = true;
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/agent') {
      const name = url.searchParams.get('name') ?? 'A';
      const agentId = ['claude', 'deepseek'].includes(url.searchParams.get('agent')) ? url.searchParams.get('agent') : 'opencode';
      const snapshot = agentSnapshot(name, agentId), phase = url.searchParams.get('phase');
      states.get(name).agentResponseDelay = Math.min(3000, Math.max(0, Number(url.searchParams.get('responseDelay')) || 0));
      snapshot.questions = []; snapshot.permissions = []; snapshot.submission = null; snapshot.operationError = null;
      snapshot.control = { token: randomUUID(), canSend: true, canSteer: agentId !== 'claude', canInterrupt: phase !== 'completed' };
      snapshot.status = phase === 'completed' ? 'idle' : 'running'; snapshot.activity = phase === 'working' ? 'working' : 'outputting';
      snapshot.partialText = phase === 'partial';
      if (agentId === 'deepseek' && phase === 'history') {
        states.get(name).deepseekHistory = true; snapshot.status = 'idle'; snapshot.control.canSteer = false; snapshot.control.canInterrupt = false;
        snapshot.messages = Array.from({ length: 40 }, (_, i) => ({ id: `history-${960 + i}`, role: i % 2 ? 'assistant' : 'user', text: `合成历史消息 ${960 + i}`, kind: i % 2 ? 'agent_message' : 'user_message', timestamp: new Date(1760000000000 + (960 + i) * 1000).toISOString() }));
        snapshot.historyCursor = '960'; snapshot.partialText = true;
      }
      if (phase === 'questions') snapshot.questions = [{ id: randomUUID(), status: 'pending', questions: [
        { question: '先优化哪些部分？', header: '开发方向', multiple: true, custom: true, options: [{ label: '实时连接', description: '减少断线后的等待时间，并保持运行状态同步' }, { label: '手机界面', description: '整理会话布局与常用操作入口' }] },
        { question: '还有哪些使用要求？', header: '补充要求', multiple: false, custom: true, options: [] },
      ] }];
      if (agentId === 'claude' && phase === 'questions') snapshot.questions[0].questions[1] = { question: '使用什么主题？', header: '主题', multiple: false, custom: true, options: [{ label: '深色', description: '深色界面' }, { label: '浅色', description: '浅色界面' }] };
      if (phase === 'unsupported-form') snapshot.questions = [{ id: randomUUID(), status: 'pending', unavailableReason: '此表单含暂不支持的字段、条件或约束，请在电脑处理。', questions: [{ header: 'OpenCode 表单', question: '复杂条件表单', multiple: false, custom: false, options: [] }] }];
      if (phase === 'permissions') snapshot.permissions = [{ id: randomUUID(), status: 'pending', action: 'edit', resources: ['/synthetic/project/src/example.ts'], save: ['/synthetic/project/src/**'], detail: '--- a/src/example.ts\n+++ b/src/example.ts\n-before\n+after', unavailableReason: null, decisions: ['once', 'always', 'reject'] }];
      if (agentId === 'claude' && phase === 'permissions') snapshot.permissions = [{ id: randomUUID(), status: 'pending', action: 'Edit', resources: ['/synthetic/project'], save: [], detail: JSON.stringify({ file_path: '/synthetic/project/src/example.ts', old_string: 'before', new_string: 'after', replace_all: false }, null, 2), unavailableReason: null, decisions: ['once', 'reject'] }];
      if (agentId === 'deepseek' && phase === 'questions') snapshot.questions[0].questions[1] = { question: '是否执行此计划？\n\n完整计划：\n1. 保留当前会话和任务。\n2. 修改手机问答及单次审批接线。\n3. 验证完整参数、两端先答和断线恢复。\n最后一步：由用户在手机实际确认。', header: '计划确认', multiple: false, custom: true, options: [{ label: '执行计划', description: '允许继续当前计划' }, { label: '修改计划', description: '补充修改要求' }] };
      if (agentId === 'deepseek' && ['permissions', 'permission-uncertain', 'permission-unavailable'].includes(phase)) snapshot.permissions = [{ id: randomUUID(), status: phase === 'permission-uncertain' ? 'uncertain' : 'pending', action: 'bash', resources: ['/synthetic/project'], save: [], detail: phase === 'permission-unavailable' ? '无法完整核验本次工具参数，请在电脑查看后处理。' : '工具：bash\n本次操作需要权限\n\n工具输入（原始 JSON）：\n{"command":"printf synthetic-only","timeout":1000}', unavailableReason: phase === 'permission-unavailable' ? '手机未取得完整操作参数，允许按钮已禁用。' : null, decisions: phase === 'permission-unavailable' ? ['reject'] : ['once', 'reject'] }];
      if (phase === 'uncertain') { snapshot.submission = { clientMessageId: randomUUID(), action: 'message', delivery: 'uncertain' }; snapshot.control.canSend = false; snapshot.control.canInterrupt = false; }
      if (phase === 'append') snapshot.messages[1].text += '\n\n新的实时文本已经抵达手机。';
      if (phase === 'rejected') snapshot.operationError = { clientMessageId: randomUUID(), code: 'rejected' };
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/gateway') {
      states.get(url.searchParams.get('name') ?? 'A').legacyGateway = url.searchParams.get('legacy') === '1';
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/native') {
      const state = states.get(url.searchParams.get('name') ?? 'A');
      const active = url.searchParams.get('active') === '1';
      state.nativeBehavior = url.searchParams.get('behavior') ?? 'confirm';
      state.nativeAdmissionDelay = Math.min(10000, Number(url.searchParams.get('admissionDelay')) || 0);
      state.nativeReplyDelay = Math.min(10000, Number(url.searchParams.get('replyDelay')) || 0);
      state.background = url.searchParams.get('background') === '1';
      state.nativePending = null;
      state.turnStatus = active ? 'inProgress' : 'completed';
      state.control = { transport: 'native', token: randomUUID(), activeTurnId: active ? 'fixture-native-turn' : null, canSend: true, canInterrupt: active, submission: null, queue: { available: url.searchParams.get('queue') !== '0', items: [] } };
      const queueStatus = url.searchParams.get('queueStatus');
      if (['waiting', 'paused', 'sending', 'uncertain'].includes(queueStatus)) state.control.queue.items = Array.from({ length: 3 }, (_, index) => ({ clientMessageId: `fixture-queued-${index}`, text: `合成待发 ${index + 1}\n仅用于核对折叠、全文和取消入口，不发送到真实会话。`, status: queueStatus, createdAt: new Date().toISOString() }));
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/native-confirm') {
      confirmNative(states.get(url.searchParams.get('name') ?? 'A'));
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/questions') {
      const state = states.get(url.searchParams.get('name') ?? 'A');
      state.turnStatus = 'inProgress';
      state.userInputs = [{
        id: randomUUID(), threadId: 'same-thread', turnId: 'fixture-turn', kind: url.searchParams.get('kind') === 'async' ? 'desktop-async' : 'desktop-sync', status: 'pending',
        questions: [
          { id: 'direction', header: '优化方向', question: '接下来优先优化哪一项？', options: [{ label: '实时连接（推荐）', description: '改善公网连接恢复速度，保持会话状态与电脑同步' }, { label: '手机界面', description: '整理消息布局与操作入口' }], allowOther: true, secret: false },
          { id: 'details', header: '补充要求', question: '还有哪些使用要求？', options: [], allowOther: true, secret: false },
        ],
      }];
      if (url.searchParams.get('single') === '1') state.userInputs[0].questions = state.userInputs[0].questions.slice(0, 1);
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/resolve-questions') {
      for (const state of states.values()) state.userInputs = [];
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/approvals') {
      const state = states.get(url.searchParams.get('name') ?? 'A');
      state.turnStatus = 'inProgress';
      state.approvalBehavior = url.searchParams.get('behavior') ?? 'ack';
      const kind = url.searchParams.get('kind') ?? 'command', unsupported = url.searchParams.get('unsupported') === '1';
      state.approvals = [{ id: randomUUID(), source: 'desktop', threadId: 'same-thread', turnId: 'fixture-turn', kind, status: 'pending',
        title: kind === 'command' ? '命令执行请求' : kind === 'fileChange' ? '文件修改请求' : '权限请求',
        detail: '请核对操作内容和授权范围。允许一次仅限当前任务。',
        reason: '合成测试：确认手机能够核对完整请求并提交决定', cwd: '/synthetic/project/long-directory-for-mobile-layout',
        command: kind === 'command' ? 'echo synthetic-only-approval-for-mobile' : null,
        preview: kind === 'permissions' ? '网络访问：允许\n读取路径：/synthetic/read\n写入路径：/synthetic/write' : kind === 'fileChange' ? 'update /synthetic/project/a.txt\n-before\n+after' : '',
        unavailableReason: unsupported ? '此请求包含手机暂不支持的策略选项，其余选项请在电脑处理。' : null,
        availableDecisions: unsupported ? [] : ['accept', 'acceptForSession', 'decline', 'cancel'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }];
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
    if (url.pathname === '/fixture/resolve-approvals') {
      for (const state of states.values()) state.approvals = [];
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true });
    }
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
    if (url.pathname === '/fixture/process') {
      const state = states.get('A'), phase = url.searchParams.get('phase') ?? 'working', deepseek = url.searchParams.get('agent') === 'deepseek';
      if (!['working', 'final', 'completed', 'next', 'interrupted', 'legacy', 'steering'].includes(phase)) return json(res, {}, 400);
      const message = (id, role, text, messagePhase, index) => ({ id: `process-fixture-${id}`, role, text, kind: role === 'user' ? 'user_message' : 'agent_message', timestamp: new Date(Date.UTC(2026, 9, 23, 6, 0, index)).toISOString(), turnId: index >= 4 ? 'process-next-turn' : 'process-turn', ...(messagePhase ? { phase: messagePhase } : {}) });
      state.messages = [
        message('user', 'user', '检查手机过程折叠，只展示合成数据', null, 0),
        message('read', 'assistant', '正在读取项目文件，确认当前展示逻辑。', 'commentary', 1),
        message('check', 'assistant', '已找到过程与最终回复的阶段标记，正在核验窄屏点击。', 'commentary', 2),
      ];
      if (!deepseek) state.messages.splice(2, 0, { ...message('tool', 'tool', 'Tool: exec_command\n{\"cmd\":\"pwd\"}', null, 1), kind: 'function_call' });
      if (phase === 'steering') state.messages.splice(2, 0, message('steer', 'user', '补充：只保留最终结果', null, 2));
      if (['final', 'completed', 'next', 'interrupted', 'legacy', 'steering'].includes(phase)) state.messages.push(message('final', 'assistant', `过程折叠已完成。\n\n最终结果独立显示，点击“执行过程”可重新查看。${url.searchParams.get('update') === '1' ? '\n\n最终回复继续更新，手动展开保持。' : ''}`, deepseek && phase === 'final' ? 'commentary' : 'final_answer', 3));
      if (['next', 'interrupted', 'legacy'].includes(phase)) state.messages.push(message('next-user', 'user', '继续检查下一轮过程', null, 4), message('next-work', 'assistant', '新一轮任务正在分析，过程默认展开。', 'commentary', 5));
      if (phase === 'legacy') state.messages.push(message('legacy', 'assistant', '旧版无阶段标记的完整回复保持可见。', null, 6));
      state.turnStatus = ['completed', 'legacy'].includes(phase) ? 'completed' : phase === 'interrupted' ? 'interrupted' : 'inProgress';
      state.activity = state.turnStatus === 'inProgress' ? 'outputting' : undefined;
      if (deepseek) { const agent = agentSnapshot('A', 'deepseek'); agent.messages = state.messages; agent.status = state.turnStatus === 'inProgress' ? 'running' : 'idle'; agent.activity = state.activity ?? 'working'; agent.partialText = true; }
      state.cursor++;
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true, phase });
    }
    if (url.pathname === '/fixture/input-replacement') {
      const state = states.get('A'), phase = url.searchParams.get('phase') ?? 'provisional';
      if (!['provisional', 'history', 'formal', 'long', 'final', 'repeat', 'cached'].includes(phase)) return json(res, {}, 400);
      const turnId = '00000000-0000-4000-8000-000000000035';
      const provisional = { id: `${turnId}-input`, turnId, role: 'user', text: '合成显示测试：只回复开始', kind: 'userMessage', timestamp: '2026-10-24T01:00:00Z' };
      const native = { ...provisional, id: `desktop-${turnId}-initial`, clientMessageId: 'fixture-initial', replacesMessageId: provisional.id };
      const history = { ...provisional, id: 'log-fixture-initial', kind: 'message', sourceItemId: 'fixture-history-initial', timestamp: '2026-10-24T01:00:00.070Z' };
      const started = { id: 'fixture-input-started', turnId, role: 'tool', kind: 'task_started', text: 'Codex turn started', timestamp: '2026-10-24T01:00:00.056Z' };
      const indexed = url.searchParams.get('indexed') === '1';
      const pending = indexed ? { ...provisional, id: 'turn-48-input', turnId: 'turn-48', clientMessageId: native.clientMessageId } : provisional;
      const gap = indexed ? Array.from({ length: 12 }, (_, index) => ({ ...started, id: `indexed-gap-${index}`, text: `Synthetic step ${index}`, timestamp: provisional.timestamp })) : [];
      state.messages = phase === 'provisional' ? [] : [started, history];
      state.desktopMessages = ['provisional', 'history'].includes(phase) ? [pending, ...gap] : phase === 'long' ? [started] : [native, ...gap];
      if (phase === 'cached') state.desktopMessages = [{ ...pending, nativeMessageId: native.id, replacesMessageId: provisional.id }, ...gap];
      state.inputReplacements = ['provisional', 'history'].includes(phase) ? [] : [{ turnId, replacesMessageId: provisional.id, nativeMessageId: native.id, clientMessageId: native.clientMessageId }];
      if (['final', 'repeat'].includes(phase)) state.messages.push({ id: 'fixture-input-final', turnId, role: 'assistant', kind: 'agentMessage', phase: 'final_answer', text: '开始', timestamp: '2026-10-24T01:00:02Z' });
      if (phase === 'repeat') {
        state.desktopMessages.push({ ...native, id: `desktop-${turnId}-steering`, replacesMessageId: undefined, clientMessageId: 'fixture-steer-two', timestamp: '2026-10-24T01:00:01Z' });
        state.messages.push({ ...history, id: 'log-fixture-steer-two', sourceItemId: 'fixture-history-two', timestamp: '2026-10-24T01:00:01.070Z' });
      }
      state.turnStatus = ['final', 'repeat'].includes(phase) ? 'completed' : 'inProgress';
      state.activity = state.turnStatus === 'inProgress' ? 'working' : undefined;
      state.cursor++;
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true, phase });
    }
    if (url.pathname === '/fixture/mirrored-steering') {
      const state = states.get('A'), phase = url.searchParams.get('phase') ?? 'history', deepseek = url.searchParams.get('agent') === 'deepseek';
      const turnId = '00000000-0000-4000-8000-000000000010';
      const native = { id: `desktop-${turnId}-accepted-steer`, turnId, clientMessageId: 'fixture-steer-first', role: 'user', text: '合成引导测试：只回复成功', kind: 'userMessage', timestamp: '2026-10-23T05:51:35.517Z' };
      const history = { id: 'log-fixture-steer-first', sourceItemId: 'msg_fixture_steer_first', turnId, role: 'user', text: native.text, kind: 'message', timestamp: '2026-10-23T05:52:09.088Z' };
      const missingClient = url.searchParams.get('client') === '0';
      if (missingClient) { delete native.clientMessageId; history.timestamp = '2026-10-23T05:51:35.592Z'; }
      const withReceipt = url.searchParams.get('receipt') === '1';
      if (withReceipt) history.clientMessageId = 'fixture-steer-first';
      state.messages = phase === 'native' ? [native] : [native, history];
      if (url.searchParams.get('started') === '1') state.messages.push({ id: 'fixture-mirror-started', role: 'tool', kind: 'task_started', text: 'Codex turn started', timestamp: '2026-10-23T05:51:35.550Z' });
      if (missingClient) state.messages.push(...Array.from({ length: 7 }, (_, i) => ({ id: `fixture-mirror-progress-${i}`, turnId, role: 'tool', text: `合成执行过程 ${i + 1}`, kind: 'commandExecution', timestamp: native.timestamp })));
      if (phase === 'repeat') state.messages.push(
        { ...native, id: `desktop-${turnId}-second-steer`, ...(missingClient ? {} : { clientMessageId: 'fixture-steer-second' }) },
        { ...history, id: 'log-fixture-steer-second', sourceItemId: 'msg_fixture_steer_second', ...(withReceipt ? { clientMessageId: 'fixture-steer-second' } : {}), timestamp: '2026-10-23T05:52:10.088Z' });
      state.messages.push({ id: 'fixture-steer-result', role: 'assistant', text: '成功', kind: 'agent_message', timestamp: '2026-10-23T05:52:11Z' });
      if (deepseek) { const agent = agentSnapshot('A', 'deepseek'); agent.messages = state.messages; agent.status = state.turnStatus === 'inProgress' ? 'running' : 'idle'; agent.activity = state.activity ?? 'working'; agent.partialText = true; }
      state.cursor++;
      for (const notify of notifications.values()) notify();
      return json(res, { ok: true, phase });
    }
    if (url.pathname === '/fixture/mirrored-reply') {
      const state = states.get('A');
      const text = '同一条助手回复：历史记录与实时通道应只显示一次。';
      state.messages.push(
        { id: 'desktop-00000000-0000-4000-8000-000000000001-msg_fixture_final', sourceItemId: 'msg_fixture_final', role: 'assistant', text, kind: 'agentMessage', timestamp: '2026-10-20T09:02:00Z' },
        { id: 'log-fixture-final', sourceItemId: 'msg_fixture_final', phase: 'final_answer', role: 'assistant', text, kind: 'message', timestamp: '2026-10-20T09:02:17Z' });
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
        const all = Array.from({ length: state.projects ? 160 : 145 }, (_, index) => {
          const row = index ? { ...thread(name), id: `fixture-${index}`, threadName: `${name} 会话 ${String(index).padStart(3, '0')}` } : thread(name);
          return state.projects ? { ...row, cwd: ['/workspace/codex-to-phone', '/workspace/client/demo', '/workspace/server/demo', '/workspace/附件1', null][index % 5], updatedAt: new Date(Date.now() - (!index || (state.reactivated && index === 150) ? 0 : index < 130 ? 5 : 45) * 86400_000).toISOString() } : row;
        });
        if (state.projects && state.reactivated) all.unshift({ ...thread(name), id: 'fixture-new', threadName: '桌面新建合成会话', updatedAt: new Date().toISOString() });
        const matching = all.filter(item => (!state.projects || url.searchParams.get('range') === 'all' || Date.parse(item.updatedAt) >= Date.now() - 30 * 86400_000) && item.threadName.toLowerCase().includes((url.searchParams.get('query') ?? '').toLowerCase()));
        if (state.projects) matching.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 120);
        if (state.listDelay) await new Promise(resolve => setTimeout(resolve, state.listDelay));
        counters[`${name}:range:${url.searchParams.get('range') ?? 'recent'}:${offset}`] = (counters[`${name}:range:${url.searchParams.get('range') ?? 'recent'}:${offset}`] ?? 0) + 1;
        return json(res, { threads: matching.slice(offset, offset + limit), nextOffset: offset + Math.min(limit, matching.length - offset), hasMore: offset + limit < matching.length });
      }
      if (route === '/api/live/turns') return json(res, { turns: [] });
      if (route === '/api/desktop/active') return json(res, { thread: state.background ? { ...thread(name), id: 'different-foreground-thread' } : thread(name), source: 'ipc-stream' });
      if (route === '/api/connection') return json(res, { ok: true });
      if (route === '/api/uploads' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        counters.uploads = (counters.uploads ?? 0) + 1;
        return json(res, { upload: { ok: true, originalName: input.fileName, fileName: input.fileName, path: `/synthetic/uploads/${input.fileName}`, relativePath: `uploads/${input.fileName}`, size: Buffer.from(input.dataBase64, 'base64').length, createdAt: new Date().toISOString() } });
      }
      if (route === '/api/gateway') return state.legacyGateway ? json(res, { error: 'not_found' }, 404) : json(res, { gateway: { kind: 'mobile-codex-gateway', desktopTransport: 'native', tunnel: { enabled: true, state: 'connected' } } });
      if (route === '/api/agents') return state.legacyGateway ? json(res, { error: 'not_found' }, 404) : json(res, { agents: [{ id: 'codex', label: 'Codex', state: 'unprobed' }, { id: 'opencode', label: 'OpenCode', state: 'connected', transport: 'opencode-v2-http-sse' }, { id: 'claude', label: 'Claude Code', state: 'connected', transport: 'claude-mods-http' }, { id: 'deepseek', label: 'DeepSeek Harness', state: 'connected', transport: 'deepseek-cordis-http-sse' }] });
      if (route === '/api/agents/opencode/sessions') return json(res, { sessions: [agentSnapshot(name).session], cursor: null });
      if (route === '/api/agents/claude/sessions') return json(res, { sessions: [agentSnapshot(name, 'claude').session], cursor: null });
      if (route === '/api/agents/deepseek/sessions') {
        const original = agentSnapshot(name, 'deepseek').session;
        if (!state.deepseekHistory) return json(res, { sessions: [original], cursor: null });
        const rows = [ { ...original, updatedAt: new Date().toISOString() }, ...Array.from({ length: 74 }, (_, i) => ({ ...original, id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, title: `合成${i < 54 ? '近期' : '更早'}会话 ${i}`, directory: state.projects ? ['/synthetic/client/demo', '/synthetic/server/demo', '/synthetic/附件1'][i % 3] : `/synthetic/workspace-${i % 3}`, updatedAt: new Date(Date.now() - (i < 54 ? 10 : 45) * 86400_000).toISOString() })) ];
        const filtered = rows.filter(row => (url.searchParams.get('range') === 'all' || Date.parse(row.updatedAt) >= Date.now() - 30 * 86400_000) && row.title.includes(url.searchParams.get('search') ?? ''));
        const offset = Number(url.searchParams.get('cursor') ?? 0);
        return json(res, { sessions: filtered.slice(offset, offset + 50), cursor: offset + 50 < filtered.length ? String(offset + 50) : null });
      }
      if (route === '/api/agents/deepseek/sessions/11111111-1111-4111-8111-111111111111/history' && state.deepseekHistory) {
        const end = Number(url.searchParams.get('cursor')), start = Math.max(0, end - 40);
        return json(res, { messages: Array.from({ length: end - start }, (_, i) => ({ id: `history-${start + i}`, role: i % 2 ? 'assistant' : 'user', text: `合成历史消息 ${start + i}`, kind: i % 2 ? 'agent_message' : 'user_message', timestamp: new Date(1760000000000 + (start + i) * 1000).toISOString() })), cursor: start ? String(start) : null });
      }
      if (route === '/api/agents/opencode/sessions/ses_fixture/history') return json(res, { messages: [{ id: 'msg_fixture-old', role: 'assistant', text: '更早的合成 OpenCode 消息。', kind: 'agent_message', timestamp: '2026-10-20T09:00:00Z' }], cursor: null });
      if (/^\/api\/agents\/(opencode|claude|deepseek)\/sessions\/[^/]+\//.test(route) && req.method === 'POST' && !route.endsWith('/stream-token')) {
        const snapshot = agentSnapshot(name, route.split('/')[3]);
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        if (input.controlToken !== snapshot.control.token || !input.clientMessageId) return json(res, { error: 'control_expired' }, 409);
        if (snapshot.agentId === 'claude' && ((route.endsWith('/messages') && input.delivery !== 'queue') || (route.includes('/permissions/') && input.decision === 'always'))) return json(res, { error: 'unsupported' }, 409);
        counters['agentWrites'] = (counters['agentWrites'] ?? 0) + 1;
        if (route.endsWith('/messages')) { counters['agentDelivery'] = input.delivery; snapshot.messages.push({ id: `msg_${input.clientMessageId}`, role: 'user', text: input.text, kind: 'user_message', timestamp: new Date(Math.max(Date.now(), ...snapshot.messages.map(message => Date.parse(message.timestamp))) + 1).toISOString() }); snapshot.submission = { clientMessageId: input.clientMessageId, action: 'message', delivery: 'confirmed' }; snapshot.status = 'running'; snapshot.control.canInterrupt = true; }
        if (route.endsWith('/interrupt')) { snapshot.status = 'idle'; snapshot.control.canInterrupt = false; snapshot.submission = { clientMessageId: input.clientMessageId, action: 'interrupt', delivery: 'confirmed' }; }
        if (route.includes('/questions/')) { counters['agentAnswerCounts'] = input.answers.map(answer => answer.length); snapshot.questions = []; }
        if (route.includes('/permissions/')) { counters['agentPermissionDecision'] = input.decision; snapshot.permissions = []; }
        for (const notify of notifications.values()) notify();
        if (state.agentResponseDelay) { setTimeout(() => json(res, { ok: true, delivery: 'confirmed' }), state.agentResponseDelay); return; }
        return json(res, { ok: true, delivery: 'confirmed' });
      }
      if (route === '/api/status') return json(res, { ok: true, desktopControl: { ok: true, mode: state.control ? 'desktop-ipc-follower-control' : 'macos-ui-injector-control' }, live: { ok: true, mode: 'fixture' }, activeDesktopThread: thread(name) });
      if (route === '/api/diagnostics') {
        if (diagnosticFixture.gateway === 'legacy') return json(res, { error: 'not_found' }, 404);
        if (diagnosticFixture.gateway === 'error') return json(res, { error: 'synthetic_diagnostic_failure' }, 503);
        return json(res, { schema: 'mobile-codex-gateway-diagnostics-v1', buildId: 'gateway-33333333-3333-4333-8333-333333333333', tunnel: { enabled: true, omitted: 0, events: [
          { at: new Date().toISOString(), seq: 1, generation: 1, state: 'connected', reason: 'open' },
        ] } });
      }
      if (route.endsWith('/health')) return json(res, { ok: true, mode: 'fixture' });
      if (route.endsWith('/stream-token')) return json(res, { streamToken: `fixture-${name}-${Date.now()}` });
      if (route.endsWith('/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const delta = () => {
          if (route.startsWith('/api/agents/')) { res.write(`event: agent-session\ndata: ${JSON.stringify(agentSnapshot(name, route.split('/')[3]))}\n\n`); return; }
          res.write(`event: delta\ndata: ${JSON.stringify(state)}\n\n`);
          res.write(`event: desktop\ndata: ${JSON.stringify({ threadId: 'same-thread', status: state.turnStatus, messages: state.desktopMessages ?? state.messages, inputReplacements: state.inputReplacements, userInputs: state.userInputs, approvals: state.approvals, interactionsAvailable: true, control: state.control, source: 'desktop-ipc', eventCount: state.cursor, updatedAt: new Date().toISOString() })}\n\n`);
        };
        delta();
        streams.add(res);
        streamRoutes.set(res, `${name}:${route}`);
        notifications.set(res, delta);
        const timer = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 1000);
        res.on('close', () => { streams.delete(res); streamRoutes.delete(res); notifications.delete(res); clearInterval(timer); });
        return;
      }
      if (route.endsWith('/delta')) return json(res, { ...state, messages: [], truncated: false });
      if (state.control && /\/api\/desktop\/control\/threads\/same-thread\/queue\/[^/]+\/cancel$/.test(route)) {
        const id = route.split('/').at(-2);
        state.control.queue.items = state.control.queue.items.filter(item => item.clientMessageId !== id);
        counters.queueCancellations = (counters.queueCancellations ?? 0) + 1;
        for (const notify of notifications.values()) notify();
        return json(res, { ok: true });
      }
      if (state.control && /\/api\/desktop\/control\/threads\/same-thread\/(messages|interrupt)$/.test(route)) {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body), interrupt = route.endsWith('/interrupt');
        counters.nativeRequests = (counters.nativeRequests ?? 0) + 1;
        counters.lastNativeRequest = input;
        if (state.nativeAdmissionDelay) await new Promise(resolve => setTimeout(resolve, state.nativeAdmissionDelay));
        if (state.nativeBehavior === 'http-error') return json(res, { error: 'synthetic_gateway_unavailable' }, 502);
        if (state.nativeBehavior === 'reject-refresh') return json(res, { error: 'desktop_control_refresh_required' }, 409);
        if (!state.control.canSend || input.controlToken !== state.control.token || input.expectedTurnId !== state.control.activeTurnId || !input.clientMessageId) return json(res, { error: 'desktop_control_refresh_required' }, 409);
        if ((input.mode === 'steer' && !state.control.activeTurnId) || (input.mode === 'start' && state.control.activeTurnId)) return json(res, { error: 'desktop_turn_changed' }, 409);
        counters.nativeMode = input.mode;
        if (input.mode === 'queue') {
          state.control.queue.items.push({ clientMessageId: input.clientMessageId, text: input.message, status: 'waiting', createdAt: new Date().toISOString() });
          counters.queueSubmissions = (counters.queueSubmissions ?? 0) + 1;
          for (const notify of notifications.values()) notify();
          if (state.nativeReplyDelay) await new Promise(resolve => setTimeout(resolve, state.nativeReplyDelay));
          return json(res, { ok: true, mode: 'desktop-ipc-follower-control', action: 'queue-message', delivery: 'confirmed', thread: thread(name) });
        }
        const action = interrupt ? 'interrupt-turn' : state.control.activeTurnId ? 'steer-turn' : 'start-turn';
        const delivery = state.nativeBehavior.startsWith('confirm') ? 'confirmed' : state.nativeBehavior === 'ack' ? 'submitted' : 'uncertain';
        counters['nativeSubmissions'] = (counters['nativeSubmissions'] ?? 0) + 1;
        state.nativePending = { clientMessageId: input.clientMessageId, action, message: input.message };
        state.control = { ...state.control, canSend: false, canInterrupt: false, submission: { clientMessageId: input.clientMessageId, action, delivery } };
        if (delivery === 'confirmed') confirmNative(state);
        for (const notify of notifications.values()) notify();
        if (state.nativeReplyDelay) await new Promise(resolve => setTimeout(resolve, state.nativeReplyDelay));
        if (state.nativeBehavior === 'confirm-http-error') return json(res, { error: 'synthetic_lost_receipt' }, 502);
        return json(res, { ok: delivery !== 'uncertain', mode: 'desktop-ipc-follower-control', action, delivery, turnStatus: delivery === 'confirmed' ? state.turnStatus : undefined, thread: thread(name) });
      }
      if (route.includes('/user-inputs/') && route.endsWith('/respond')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        if (!state.userInputs.length || !route.includes(state.userInputs[0].id)) return json(res, { error: 'question_expired' }, 409);
        counters['questionSubmissions'] = (counters['questionSubmissions'] ?? 0) + 1;
        counters['lastFixtureAnswerCount'] = Object.keys(input.answers).length;
        state.userInputs = [];
        for (const notify of notifications.values()) notify();
        return json(res, { status: 'resolved' });
      }
      if (route.includes('/approvals/') && route.endsWith('/respond')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body), a = state.approvals[0];
        if (!a || !route.includes(a.id) || a.status !== 'pending' || !a.availableDecisions.includes(input.decision)) return json(res, { error: 'approval_expired' }, 409);
        counters['approvalSubmissions'] = (counters['approvalSubmissions'] ?? 0) + 1;
        const status = state.approvalBehavior === 'confirm' ? 'resolved' : state.approvalBehavior === 'ack' ? 'submitted' : 'uncertain';
        if (status === 'resolved') state.approvals = []; else a.status = status;
        for (const notify of notifications.values()) notify();
        return json(res, { status });
      }
      if (route.endsWith('/messages')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        state.messages.push({ id: `fixture-${Date.now()}`, role: 'user', text: input.message, kind: 'user_message', timestamp: new Date().toISOString() });
        return json(res, { ok: true, mode: 'desktop-ipc-follower-control', action: 'start-turn', thread: thread(name) });
      }
      if (/\/api\/desktop\/threads\/(same-thread|fixture-[\w-]+)$/.test(route)) {
        if (url.searchParams.has('before')) return json(res, {
          messages: Array.from({ length: 30 }, (_, index) => ({ id: `${name}-old-${index}`, role: index % 2 ? 'assistant' : 'user', text: `${name} 更早的历史 ${index + 1}。${'用于验证阅读旧消息时新推送不会改变滚动位置。'.repeat(4)}`, kind: index % 2 ? 'agent_message' : 'user_message', timestamp: '2026-10-19' })),
          windowStart: 0, cursor: 50, generation: state.generation,
        });
        return json(res, { thread: thread(name), ...state, windowStart: 50 });
      }
      return json(res, {});
    }
    counters[`static:${url.pathname}`] = (counters[`static:${url.pathname}`] ?? 0) + 1;
    if (hotBundle && url.pathname !== '/') { res.writeHead(404); res.end(); return; }
    const file = hotBundle || (url.pathname === '/' ? path.join(dist, 'index.html') : path.join(dist, url.pathname));
    if (!hotBundle && !file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
    const extension = path.extname(file);
    let content = await fs.readFile(file);
    if (extension === '.html') {
      const profiles = ['A', 'B'].map(name => ({ id: name, name: `测试连接 ${name}`, endpoint: `http://127.0.0.1:${server.address().port}/${name}`, token: 'fixture-only', cacheNamespace: `fixture-${name}`, updatedAt: '2026-10-20' }));
      const bootstrap = `<script>if(!localStorage.connectionProfiles){localStorage.connectionProfiles=${JSON.stringify(JSON.stringify(profiles))};localStorage.activeConnectionProfileId='A';}</script>`;
      content = content.toString().replace('<head>', `<head>${bootstrap}`);
      if (url.searchParams.get('cacheFixture') === '1') content = content.replace('</head>', '<script src="/fixture/cache-storage.js"></script></head>');
      if (url.searchParams.get('diagnosticsFixture') === '1') content = content.replace('</head>', '<meta name="mobile-codex-hot-bundle" content="fixture-loaded-old"></head>');
      if (url.searchParams.get('apkFixture') === '1' || url.searchParams.get('voiceFixture') === '1') content = content.replace('</head>', '<script src="/fixture/apk-native.js"></script></head>');
      if (url.searchParams.get('textScale') === '150') content = content.replace('</head>', '<style>html { font-size: 150%; }</style></head>');
    }
    res.writeHead(200, { 'content-type': extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'text/html' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.UI_FIXTURE_PORT ?? 0), '127.0.0.1', () => console.log(`UI_FIXTURE=http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const stream of streams) stream.destroy(); server.close(); });
