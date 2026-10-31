import { useEffect, useRef, useState } from "react";
import { VoiceInput } from "../voice/VoiceInput";
import { ArrowUp, ChevronLeft, CircleStop, Loader2, RefreshCcw } from "lucide-react";
import type { CodexMessage } from "../../app/types";
import { maxMessagesPerThread } from "../../app/config";
import { MessageBubble, MessageTimeline, GenerationStatus } from "../chat/components";
import { apiGet, apiPost, buildUrl } from "../connection/http";
import { subscribeEvents, type SubscriptionState } from "../connection/subscription";
import { createSnapshotReducer } from "../connection/snapshotPatch";
import { writeClipboard } from "../../shared/clipboard";
import { AgentQuestions } from "./AgentQuestions";
import { AgentQueue } from "./AgentQueue";
import { agentDelivery, agentHistoryWindow, loadAgentDrafts, offlineAgent, reconcileAgentDraft, saveAgentDrafts, verifyAgentSnapshot, type PendingAgentDraft } from "./runtime";
import type { AgentDelivery, AgentPermission, AgentSession, AgentSessionSnapshot } from "./types";
import { groupByProject, sessionInRange, sessionListRefreshMs } from "../threads/model";
import { ProjectGroups } from "../threads/ProjectGroups";
import { SessionRangeControl } from "../threads/SessionRangeControl";

type Agent = { id: string; label: string; transport: string };
const friendlyError = (error: unknown) => {
  const status = (error as { status?: number })?.status;
  return status === 401 ? "设备凭证已失效，请返回设置重新配对。" : status === 410 ? "电脑会话暂时离线，请返回会话列表并等待重新连接。" : status === 404 ? "电脑端尚未提供此 Agent，请更新或检查插件配置。"
    : status === 409 ? "会话状态已变化，请等待重新同步后再操作。" : "无法连接 Agent，请确认电脑上的网关与 Agent 服务正在运行。";
};

export default function AgentWorkspace({ endpoint, token, scope, onBack }: { endpoint: string; token: string; scope: string; onBack: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]), [agent, setAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]), [selected, setSelected] = useState<AgentSession | null>(null);
  const [query, setQuery] = useState(""), [cursor, setCursor] = useState<string | null>(null);
  const [range, setRange] = useState<"recent" | "all">("recent");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => loadAgentDrafts(scope));
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const controller = useRef<AbortController | null>(null), requestId = useRef(0);
  useEffect(() => {
    const flush = () => saveAgentDrafts(scope, draftsRef.current);
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [scope]);
  useEffect(() => { const timer = setTimeout(() => saveAgentDrafts(scope, draftsRef.current), 700); return () => clearTimeout(timer); }, [drafts, scope]);
  useEffect(() => {
    void loadAgents();
    return () => { ++requestId.current; controller.current?.abort(); };
  }, [endpoint, token]);
  function begin(silent = false) { controller.current?.abort(); controller.current = new AbortController(); const id = ++requestId.current; if (!silent) { setError(""); setLoading(true); } return { signal: controller.current.signal, id }; }
  async function loadAgents() {
    const request = begin();
    try {
      const data = await apiGet<{ agents: Agent[] }>(buildUrl(endpoint, "/api/agents"), token, request.signal);
      if (request.id !== requestId.current) return;
      if (!Array.isArray(data.agents)) throw new Error("invalid agents");
      setAgents(data.agents.filter(item => (item.id === "opencode" && item.transport === "opencode-v2-http-sse") || (item.id === "claude" && item.transport === "claude-mods-http") || (item.id === "deepseek" && item.transport === "deepseek-cordis-http-sse")));
    } catch (caught) { if (!request.signal.aborted) setError(friendlyError(caught)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  async function loadSessions(target: Agent, append = false, selectedRange = range, silent = false) {
    const request = begin(silent); setAgent(target);
    try {
      const params = new URLSearchParams({ ...(query.trim() ? { search: query.trim() } : {}), ...(append && cursor ? { cursor } : {}), ...(target.id === "deepseek" ? { range: selectedRange } : {}) });
      const data = await apiGet<{ sessions: AgentSession[]; cursor: string | null }>(buildUrl(endpoint, `/api/agents/${target.id}/sessions?${params}`), token, request.signal);
      if (request.id !== requestId.current) return;
      if (!Array.isArray(data.sessions)) throw new Error("invalid sessions");
      setSessions(current => silent ? [...new Map([...current, ...data.sessions].map(item => [item.id, item])).values()].filter(item => sessionInRange(item.updatedAt, selectedRange) || data.sessions.some(next => next.id === item.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : append ? [...new Map([...current, ...data.sessions].map(item => [item.id, item])).values()] : data.sessions);
      if (!silent || sessions.length < 50) setCursor(data.cursor);
    } catch (caught) { if (!request.signal.aborted) setError(friendlyError(caught)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (agent?.id !== "deepseek" || selected || loading) return;
    const refresh = () => { if (!document.hidden) void loadSessions(agent, false, range, true); };
    const timer = setInterval(refresh, sessionListRefreshMs);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [agent?.id, selected?.id, loading, range, query, cursor, sessions.length, endpoint, token]);
  function back() {
    if (selected) { setSelected(null); if (agent) void loadSessions(agent); }
    else if (agent) { ++requestId.current; controller.current?.abort(); setAgent(null); setSessions([]); setCursor(null); setError(""); setLoading(false); }
    else onBack();
  }
  return <main className="agent-workspace">
    <header className="topbar glass-surface">
      <button className="icon-button" aria-label={selected ? "返回 Agent 会话列表" : agent ? "返回 Agent 列表" : "返回 Codex"} onClick={back}><ChevronLeft size={21} /></button>
      <div className="workspace-title"><div><h1>{selected?.title || agent?.label || "选择 Agent"}</h1><p>{selected ? `${agent?.label} · 原服务会话` : "同一连接，分别管理会话"}</p></div></div>
      {!selected && <button className="icon-button" aria-label="刷新 Agent 列表" disabled={loading} onClick={() => void (agent ? loadSessions(agent) : loadAgents())}><RefreshCcw size={18} className={loading ? "spin" : ""} /></button>}
    </header>
    {selected && agent ? <AgentChat key={`${agent.id}:${selected.id}`} endpoint={endpoint} token={token} agent={agent} session={selected}
      draft={drafts[`${agent.id}:${selected.id}`] ?? ""} onDraft={value => setDrafts(current => ({ ...current, [`${agent.id}:${selected.id}`]: value }))} />
      : <section className="agent-session-list">
        {error && <p className="connection-notice" role="status">{error}</p>}
        {!agent && <>
          <button className="agent-session-row" onClick={onBack}><strong>Codex</strong><small>电脑桌面会话与手机工作台</small></button>
          {agents.map(item => <button className="agent-session-row" key={item.id} onClick={() => void loadSessions(item)}><strong>{item.label}</strong><small>{item.id === "deepseek" ? "查看电脑会话与历史，继续原线程和处理提问" : item.id === "claude" ? "打开已加载插件的会话，查看输出、排队输入与中断" : "打开现有会话，查看输出与处理提问"}</small></button>)}
          {!loading && !agents.length && !error && <p className="setting-description">电脑端尚未接入其他 Agent。可配置 OpenCode 服务或 Claude Code 插件，然后刷新此页。</p>}
        </>}
        {agent && <>
          {agent.id === "deepseek" && <SessionRangeControl range={range} disabled={loading} onChange={next => { setRange(next); void loadSessions(agent, false, next); }} />}
          <form className="search-field" onSubmit={event => { event.preventDefault(); void loadSessions(agent); }}><input aria-label="搜索 Agent 会话" placeholder="搜索会话" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><button type="submit" disabled={loading}>搜索</button></form>
          {agent.id === "deepseek" ? <ProjectGroups key={agent.id} scope={scope} agentId={agent.id} groups={groupByProject(sessions, session => session.directory)} search={query}>
            {session => <button className="agent-session-row" key={session.id} onClick={() => setSelected(session)}><strong>{session.title || "未命名会话"}</strong><time>{new Date(session.updatedAt).toLocaleString()}</time></button>}
          </ProjectGroups> : sessions.map(session => <button className="agent-session-row" key={session.id} onClick={() => setSelected(session)}><strong>{session.title || "未命名会话"}</strong><small>{session.directory}</small><time>{new Date(session.updatedAt).toLocaleString()}</time></button>)}
          {!loading && !sessions.length && !error && <p>{agent.id === "deepseek" ? range === "recent" ? "近 30 天没有匹配会话，可查看更早会话。" : "没有匹配的 DeepSeek 会话，请检查电脑插件连接或搜索条件。" : agent.id === "claude" ? `尚无已连接的 ${agent.label} 会话，请先在电脑会话中加载并配置插件。` : "当前目录没有可用的现有会话。"}</p>}
          {cursor && <button className="action-button" disabled={loading} onClick={() => void loadSessions(agent, true)}>加载更多会话</button>}
        </>}
        {loading && <p className="inline-loading" role="status"><Loader2 className="spin" size={18} />正在读取…</p>}
      </section>}
  </main>;
}

function AgentChat({ endpoint, token, agent, session, draft, onDraft }: {
  endpoint: string; token: string; agent: Agent; session: AgentSession; draft: string; onDraft: (value: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<AgentSessionSnapshot | null>(null), snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const draftRef = useRef(draft); draftRef.current = draft;
  const pendingDraft = useRef<PendingAgentDraft | null>(null);
  const [stream, setStream] = useState<SubscriptionState>("connecting"), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [delivery, setDelivery] = useState<"steer" | "queue">(agent.id === "opencode" ? "steer" : "queue");
  const [history, setHistory] = useState<CodexMessage[]>([]), [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const historyRef = useRef(history); historyRef.current = history;
  const historyInitialized = useRef(false), [historyBusy, setHistoryBusy] = useState(false);
  const historyLock = useRef(false), viewport = useRef<HTMLDivElement>(null), scope = useRef<AbortController | null>(null);
  const nearBottom = useRef(true), initialized = useRef(false);
  const base = `/api/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}`;
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    const reduce = createSnapshotReducer<AgentSessionSnapshot>();
    const unsubscribe = subscribeEvents({
      getToken: signal => apiPost(buildUrl(endpoint, `${base}/stream-token`), token, {}, signal),
      url: streamToken => buildUrl(endpoint, `${base}/events?${new URLSearchParams({ streamToken, v: "1" })}`),
      events: { "agent-session": input => {
        const next = verifyAgentSnapshot(reduce(input), agent.id, session.id);
        acceptMessageReceipt(next.submission, next.connected ? next.queue : undefined);
        setSnapshot(next); setError("");
        if (!historyInitialized.current) { historyInitialized.current = true; setHistoryCursor(next.historyCursor); }
        if (!historyRef.current.length && nearBottom.current && !next.questions.length && !next.permissions.length) requestAnimationFrame(() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight }));
        if (!initialized.current || next.questions.length || next.permissions.length) requestAnimationFrame(() => {
          if (!historyRef.current.length && (!initialized.current || nearBottom.current)) {
            const card = viewport.current?.querySelector<HTMLElement>(".user-input-card, .agent-permission");
            if (card && viewport.current) viewport.current.scrollTop += card.getBoundingClientRect().top - viewport.current.getBoundingClientRect().top - 12;
          }
          initialized.current = true;
        });
      } },
      onState: state => { setStream(state); if (state !== "online") setSnapshot(offlineAgent); },
    });
    return () => { controller.abort(); unsubscribe(); };
  }, [endpoint, token, agent.id, session.id]);
  const online = stream === "online" && Boolean(snapshot?.connected && snapshot.control);
  const control = online ? snapshot?.control : null;
  function acceptMessageReceipt(receipt: AgentSessionSnapshot["submission"], queue?: AgentSessionSnapshot["queue"]) {
    const next = reconcileAgentDraft(draftRef.current, pendingDraft.current, receipt, queue);
    pendingDraft.current = next.pending;
    if (next.draft !== draftRef.current) { draftRef.current = next.draft; onDraft(next.draft); }
  }
  async function operate(action: "message" | "interrupt" | "question" | "permission" | "queue-cancel", suffix: string, extra: Record<string, unknown>, requestId?: string) {
    const current = snapshotRef.current, currentScope = scope.current;
    if (!currentScope || currentScope.signal.aborted || busyRef.current || !current?.connected || !current.control) return false;
    busyRef.current = true; setBusy(true); setError("");
    const clientMessageId = crypto.randomUUID(), controlToken = current.control.token;
    if (action === "message") pendingDraft.current = { clientMessageId, text: draftRef.current };
    if (action === "message" || action === "interrupt") setSnapshot(value => value ? { ...value, submission: { clientMessageId, action, delivery: "submitted" } } : value);
    try {
      const result = await apiPost<AgentDelivery>(buildUrl(endpoint, `${base}${suffix}`), token, { clientMessageId, controlToken, ...extra }, currentScope.signal);
      if (currentScope.signal.aborted) return true;
      if (action === "message" || action === "interrupt") {
        setSnapshot(value => agentDelivery(value, clientMessageId, action, result));
        if (action === "message") acceptMessageReceipt({ clientMessageId, action, delivery: result.delivery });
      } else if (action !== "queue-cancel") setSnapshot(value => value?.connected && value.control?.token === controlToken ? { ...value,
        ...(action === "question" ? { questions: value.questions.map(q => q.id === requestId ? { ...q, status: result.delivery === "uncertain" ? "uncertain" : "submitted" } : q) }
          : { permissions: value.permissions.map(p => p.id === requestId ? { ...p, status: result.delivery === "uncertain" ? "uncertain" : "submitted" } : p) }),
      } : value);
      return true;
    } catch (caught) {
      if (currentScope.signal.aborted) return true;
      const definite = [400, 401, 403, 404, 409, 410, 429].includes((caught as { status?: number })?.status ?? 0);
      if (definite && (action === "message" || action === "interrupt")) {
        if (pendingDraft.current?.clientMessageId === clientMessageId) pendingDraft.current = null;
        setSnapshot(value => value?.submission?.clientMessageId === clientMessageId && value.submission.delivery !== "confirmed" ? { ...value, submission: null } : value);
      }
      if (!definite && (action === "message" || action === "interrupt")) setSnapshot(value => agentDelivery(value, clientMessageId, action, { delivery: "uncertain" }));
      setError(definite ? friendlyError(caught) : "提交结果待确认，请勿重复操作，等待会话同步。");
      return !definite;
    } finally { if (!currentScope.signal.aborted) { busyRef.current = false; setBusy(false); } }
  }
  async function older() {
    if (!historyCursor || historyLock.current || !scope.current) return;
    const controller = scope.current, previousHeight = viewport.current?.scrollHeight ?? 0, previousTop = viewport.current?.scrollTop ?? 0;
    historyLock.current = true; setHistoryBusy(true);
    try {
      const result = await apiGet<{ messages: CodexMessage[]; cursor: string | null }>(buildUrl(endpoint, `${base}/history?${new URLSearchParams({ cursor: historyCursor })}`), token, controller.signal);
      if (controller.signal.aborted) return;
      setHistory(current => agent.id === "deepseek"
        ? agentHistoryWindow(current.length ? current : snapshotRef.current?.messages ?? [], result.messages, maxMessagesPerThread)
        : [...new Map([...result.messages, ...current].map(message => [message.id, message])).values()].slice(-190)); setHistoryCursor(result.cursor);
      requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = previousTop + viewport.current.scrollHeight - previousHeight; });
    } catch (caught) { if (!controller.signal.aborted) setError(friendlyError(caught)); }
    finally { if (!controller.signal.aborted) { historyLock.current = false; setHistoryBusy(false); } }
  }
  const messages = [...new Map([...history, ...(agent.id === "deepseek" && history.length ? [] : snapshot?.messages ?? [])].map(message => [message.id, message])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const unresolved = snapshot?.submission && snapshot.submission.delivery !== "confirmed";
  const queuedSubmission = snapshot?.queue?.items.some(item => item.clientMessageId === snapshot.submission?.clientMessageId);
  const sendEnabled = Boolean(control?.canSend && !busy && !unresolved && draft.trim());
  const waiting = Boolean(snapshot?.questions.length || snapshot?.permissions.length);
  const progress = !online ? "正在核验任务状态" : waiting ? "等待你的处理" : snapshot?.activity === "working" ? `${agent.label} 正在执行` : snapshot?.activity === "outputting" ? `${agent.label} 正在输出` : `${agent.label} 正在思考`;
  return <section className="agent-chat">
    <div className="agent-connection" role="status"><span className={`status-dot ${online ? "ok" : "error"}`} />{online ? `${agent.label} 已连接` : stream === "unauthorized" ? "凭证已失效，请重新配对" : stream === "paused" ? "连接已暂停，返回前台后恢复" : "正在恢复连接…"}</div>
    <div className="messages-viewport" ref={viewport} onScroll={() => { const element = viewport.current; if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
      {snapshot?.partialText && <p className="connection-notice" role="status">{agent.id === "opencode" ? "已从连接时刻继续同步，当前文本段结束后会补齐前文。" : agent.id === "deepseek" ? "当前同步用户与助手文本，可加载更早消息；单条长文本可能截断，附件及工具过程请在电脑查看。" : "当前显示最近会话文本；更早历史或连接前的部分输出尚未同步。"}</p>}
      {agent.id === "claude" && <p className="setting-description">消息会在当前任务结束后处理。同步到手机的提问可在下方回答；审批仅作用于本次请求。其余提示请在电脑处理。</p>}
      {agent.id === "deepseek" && <p className="setting-description">查看历史不会启动任务；发送后继续原会话，运行中可追加。可在下方回答提问，查看完整工具参数后允许一次或拒绝。</p>}
      {snapshot?.operationError && <p className="connection-notice" role="status">{snapshot.operationError.code === "rejected" ? "电脑会话拒绝了本次操作，输入内容已保留。" : "操作尚未送达电脑便已过期，输入内容已保留。"}</p>}
      {historyCursor && (agent.id === "deepseek" || history.length < 190) && <button className="history-button" disabled={historyBusy} onClick={() => void older()}>{historyBusy ? "读取历史中…" : "加载更早的消息"}</button>}
      {agent.id === "deepseek" && history.length > 0 && <button className="history-button" disabled={historyBusy} onClick={() => { setHistory([]); setHistoryCursor(snapshot?.historyCursor ?? null); nearBottom.current = true; requestAnimationFrame(() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight })); }}>正在浏览历史 · 返回最新</button>}
      {agent.id !== "deepseek" && history.length >= 190 && <p className="setting-description">已达到手机历史显示上限，更早记录可在电脑查看。</p>}
      <MessageTimeline messages={messages} renderMessage={message => <MessageBubble message={message} assistantLabel={agent.label} smooth={false} smoothPending={false} onSmoothDone={() => {}} onCopy={() => void writeClipboard(message.text)} />} />
      {snapshot?.questions.map(question => <AgentQuestions key={question.id} request={question} agentLabel={agent.label} disabled={!online || busy} onRespond={answers => operate("question", `/questions/${question.id}/respond`, { answers }, question.id)} />)}
      {snapshot?.permissions.map(permission => <PermissionCard key={permission.id} permission={permission} agentLabel={agent.label} disabled={!online || busy} onRespond={decision => operate("permission", `/permissions/${permission.id}/respond`, { decision }, permission.id)} />)}
      {snapshot?.queue && <AgentQueue queue={snapshot.queue} disabled={!online || busy} onCancel={id => operate("queue-cancel", `/queue/${encodeURIComponent(id)}/cancel`, {}, id)} />}
      {snapshot?.status === "running" && <GenerationStatus label={progress} detail={online ? "与原服务会话同步" : "连接恢复后核验运行状态"} tone={waiting ? "approval" : snapshot.activity === "outputting" ? "outputting" : "thinking"} anchorRole="assistant" />}
      {!snapshot && <p className="inline-loading" role="status"><Loader2 size={18} className="spin" />正在读取原会话…</p>}
    </div>
    <footer className="composer-panel agent-composer">
      {error && <p className="connection-notice" role="status">{error}</p>}
      {unresolved && !queuedSubmission && <p className="connection-notice" role="status">{snapshot?.submission?.delivery === "uncertain" ? "提交结果未知，正在核对；请勿重复发送。" : "已提交，等待服务确认。"}</p>}
      {snapshot?.status === "running" && <div className="agent-running">
        {(agent.id === "deepseek" || control?.canSteer) ? <div className="agent-delivery" aria-label="消息送达方式">{(["steer", "queue"] as const).map(value => <button type="button" key={value} disabled={!control?.canSend || (value === "steer" && !control.canSteer) || busy || Boolean(unresolved)} aria-pressed={delivery === value} className={delivery === value ? "active" : ""} onClick={() => setDelivery(value)}>{value === "steer" ? "引导当前任务" : "排队处理"}</button>)}</div> : <span>{progress}</span>}
        <button className="icon-button" aria-label="打断 Agent 当前任务" disabled={!control?.canInterrupt || busy} onClick={() => void operate("interrupt", "/interrupt", {})}><CircleStop size={18} /></button>
      </div>}
      <form className="agent-input" onSubmit={event => { event.preventDefault(); if (sendEnabled) void operate("message", "/messages", { text: draft, delivery: agent.id === "deepseek" && !control?.canSteer ? "queue" : delivery }); }}>
        <textarea aria-label="发送给当前 Agent 会话" placeholder={online ? `发送给 ${agent.label}…` : "草稿已保留，等待恢复连接…"} rows={2} value={draft} maxLength={20_000} onChange={event => onDraft(event.target.value)} />
      <VoiceInput endpoint={endpoint} token={token} draft={draft} onDraft={onDraft} />
        <button className="icon-button" aria-label="发送 Agent 消息" disabled={!sendEnabled} type="submit"><ArrowUp size={20} /></button>
      </form>
    </footer>
  </section>;
}

function PermissionCard({ permission, disabled, onRespond, agentLabel }: { permission: AgentPermission; disabled: boolean; onRespond: (decision: "once" | "always" | "reject") => Promise<boolean>; agentLabel: string }) {
  const [sent, setSent] = useState(false), submitted = useRef(false);
  const locked = disabled || sent || permission.status !== "pending";
  return <section className="user-input-card agent-permission" aria-label={`${agentLabel} 权限请求`}>
    <header>需要处理权限请求：{permission.action}</header>
    <p>本次请求的操作范围</p><pre>{permission.resources.join("\n") || "未提供操作范围"}</pre>
    {permission.detail !== "{}" && <pre>{permission.detail}</pre>}
    {permission.save.length > 0 && <><p>选择保存规则后，将匹配以下范围</p><pre>{permission.save.join("\n")}</pre></>}
    {permission.unavailableReason && <p role="status">{permission.unavailableReason}</p>}
    <div className="agent-permission-actions">{permission.decisions.map(decision => <button key={decision} className="action-button" disabled={locked} onClick={() => {
      if (locked || submitted.current) return; submitted.current = true; setSent(true);
      void onRespond(decision).then(accepted => { if (!accepted) { submitted.current = false; setSent(false); } });
    }}>{decision === "once" ? "允许一次" : decision === "always" ? "允许并保存规则" : "拒绝"}</button>)}</div>
    {locked && <p role="status">{permission.status === "uncertain" ? "结果待确认，请勿重复操作" : sent || permission.status !== "pending" ? "已提交，等待会话确认" : "连接恢复后重新核验请求"}</p>}
  </section>;
}
