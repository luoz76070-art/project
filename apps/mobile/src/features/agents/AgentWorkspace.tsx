import type { HandoffTarget } from "../../../../../shared/handoff";
import { SystemNotice } from "../../shared/SystemNotice";
import { useDeviceRevoked } from "../connection/useDeviceRevoked";
import { deviceRevokedMessage } from "../connection/authorization";
import { ComposerSessionStatus } from "../chat/SessionStatus";
import { agentSessionStatus } from "../chat/sessionStatusModel";
import { loadReadingPositions, saveReadingPositions } from "../chat/readingPositions";
import { productBeforeNavigate, isKelivoHost } from "../product/host";
import { useEffect, useRef, useState } from "react";
import { registerVoiceAgentDrafts } from "../voice/draftRecovery";
import type { VoiceRecoveryPort } from "../voice/useVoiceRecovery";
import { VoiceInput } from "../voice/VoiceInput";
import { ListTodo, ChevronLeft, Loader2, RefreshCcw } from "lucide-react";
import type { CodexMessage, PendingAttachment } from "../../app/types";
import { maxMessagesPerThread } from "../../app/config";
import { MessageBubble, MessageTimeline, AttachmentTray } from "../chat/components";
import { ComputerComposer } from "../chat/ComputerComposer";
import { MessageMediaProvider } from "../chat/MessageImage";
import { composeMessageWithAttachments, mergeAttachments, revokeAttachmentPreviews } from "../chat/attachments";
import { uploadAttachments } from "../chat/uploadAttachments";
import { agentDraftParts, composeAgentDraft } from "./drafts";
import { apiGet, apiPost, buildUrl } from "../connection/http";
import { subscribeEvents, type SubscriptionState } from "../connection/subscription";
import { createSnapshotReducer } from "../connection/snapshotPatch";
import { writeClipboard } from "../../shared/clipboard";
import { AgentQuestions } from "./AgentQuestions";
import { AgentQueue } from "./AgentQueue";
import { agentDelivery, agentHistoryWindow, loadAgentDrafts, loadAgentView, saveAgentView, loadPendingAgentDraft, savePendingAgentDraft, offlineAgent, reconcileAgentDraft, saveAgentDrafts, verifyAgentSnapshot, type PendingAgentDraft } from "./runtime";
import type { AgentDelivery, AgentPermission, AgentSession, AgentSessionSnapshot } from "./types";
import { groupByProject, sessionInRange, sessionListRefreshMs } from "../threads/model";
import { ProjectGroups } from "../threads/ProjectGroups";
import { SessionRangeControl } from "../threads/SessionRangeControl";

type Agent = { id: string; label: string; transport: string; sessionApi?: 1 };
const friendlyError = (error: unknown) => {
  const status = (error as { status?: number })?.status;
  return status === 401 ? deviceRevokedMessage : status === 410 ? "电脑会话暂时离线，请返回会话列表并等待重新连接。" : status === 404 ? "电脑端尚未提供此 Agent，请更新或检查插件配置。"
    : status === 409 ? "会话状态已变化，请等待重新同步后再操作。" : "无法连接 Agent，请确认电脑上的网关与 Agent 服务正在运行。";
};

export default function AgentWorkspace({ handoffTarget, onTargetOpened, onCapture, endpoint, token, scope, onBack, voiceRecovery }: { handoffTarget: HandoffTarget | null; onTargetOpened: () => void; onCapture: () => void; endpoint: string; token: string; scope: string; onBack: () => void; voiceRecovery: VoiceRecoveryPort }) {
  const deviceRevoked = useDeviceRevoked(endpoint, token);
  const restoreView = useRef(isKelivoHost ? loadAgentView(scope) : null);
  const [agents, setAgents] = useState<Agent[]>([]), [agent, setAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]), [selected, setSelected] = useState<AgentSession | null>(null);
  const [query, setQuery] = useState(""), [cursor, setCursor] = useState<string | null>(null);
  const [range, setRange] = useState<"recent" | "all">("recent");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => loadAgentDrafts(scope));
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  useEffect(() => registerVoiceAgentDrafts(scope, {
    read: () => draftsRef.current,
    write: value => { if (!saveAgentDrafts(scope, value)) return false; draftsRef.current = value; setDrafts(value); return true; },
  }), [scope]);
  const controller = useRef<AbortController | null>(null), requestId = useRef(0);
  useEffect(() => {
    const flush = () => saveAgentDrafts(scope, draftsRef.current);
    const beforeNavigate = (event: Event) => { if (!flush()) { event.preventDefault(); setError("草稿保存失败，请保留当前页面并重试。"); } };
    window.addEventListener("pagehide", flush);
    window.addEventListener(productBeforeNavigate, beforeNavigate);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener(productBeforeNavigate, beforeNavigate); flush(); };
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
      const available = data.agents.filter(item => /^[a-z][a-z0-9-]{0,63}$/u.test(item.id) && (item.sessionApi === 1
        || (item.id === "opencode" && item.transport === "opencode-v2-http-sse") || (item.id === "claude" && item.transport === "claude-mods-http") || (item.id === "deepseek" && item.transport === "deepseek-cordis-http-sse")));
      setAgents(available);
      const restore = restoreView.current;
      const target = available.find(item => item.id === restore?.agentId);
      if (target) void loadSessions(target);
      else restoreView.current = null;
    } catch (caught) { if (!request.signal.aborted) setError(friendlyError(caught)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  async function loadSessions(target: Agent, append = false, selectedRange = range, silent = false) {
    const request = begin(silent); setAgent(target);
    if (isKelivoHost && !restoreView.current) saveAgentView(scope, target.id, null);
    try {
      const params = new URLSearchParams({ ...(query.trim() ? { search: query.trim() } : {}), ...(append && cursor ? { cursor } : {}), ...(target.id === "deepseek" ? { range: selectedRange } : {}) });
      const data = await apiGet<{ sessions: AgentSession[]; cursor: string | null }>(buildUrl(endpoint, `/api/agents/${target.id}/sessions?${params}`), token, request.signal);
      if (request.id !== requestId.current) return;
      if (!Array.isArray(data.sessions)) throw new Error("invalid sessions");
      setSessions(current => silent ? [...new Map([...current, ...data.sessions].map(item => [item.id, item])).values()].filter(item => sessionInRange(item.updatedAt, selectedRange) || data.sessions.some(next => next.id === item.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : append ? [...new Map([...current, ...data.sessions].map(item => [item.id, item])).values()] : data.sessions);
      if (!silent || sessions.length < 50) setCursor(data.cursor);
      if (restoreView.current?.agentId === target.id) {
        const restored = data.sessions.find(item => item.id === restoreView.current?.sessionId);
        restoreView.current = null;
        if (restored) setSelected(restored);
      }
    } catch (caught) { if (!request.signal.aborted) setError(friendlyError(caught)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (deviceRevoked || agent?.id !== "deepseek" || selected || loading) return;
    const refresh = () => { if (!document.hidden) void loadSessions(agent, false, range, true); };
    const timer = setInterval(refresh, sessionListRefreshMs);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [agent?.id, selected?.id, loading, range, query, cursor, sessions.length, endpoint, token, deviceRevoked]);
  useEffect(() => {
    if (!handoffTarget || handoffTarget.agentId === 'codex') return;
    const target = agents.find(a => a.id === handoffTarget.agentId);
    if (!target) return;
    restoreView.current = null;
    setAgent(target); setSelected({ id: handoffTarget.sessionId, title: handoffTarget.title, directory: handoffTarget.cwd, updatedAt: new Date().toISOString() });
    onTargetOpened();
  }, [handoffTarget, agents, onTargetOpened]);
  function back() {
    if (!window.dispatchEvent(new Event(productBeforeNavigate, { cancelable: true }))) return;
    if (isKelivoHost) saveAgentView(scope, selected ? agent?.id ?? null : null, null);
    if (selected) { setSelected(null); if (agent) void loadSessions(agent); }
    else if (agent) { ++requestId.current; controller.current?.abort(); setAgent(null); setSessions([]); setCursor(null); setError(""); setLoading(false); }
    else onBack();
  }
  return <main className="agent-workspace">
    <header className="topbar glass-surface">
      <button className="icon-button" aria-label={selected ? "返回 Agent 会话列表" : agent ? "返回 Agent 列表" : "返回 Codex"} onClick={back}><ChevronLeft size={21} /></button>
      <div className="workspace-title"><div><h1>{selected?.title || agent?.label || "选择 Agent"}</h1><p>{selected ? `${agent?.label} · 原服务会话` : "同一连接，分别管理会话"}</p></div></div>
      <button className="icon-button" aria-label="事项" title="事项" onClick={onCapture}><ListTodo size={18} /></button>
      {!selected && <button className="icon-button" aria-label="刷新 Agent 列表" disabled={loading} onClick={() => void (agent ? loadSessions(agent) : loadAgents())}><RefreshCcw size={18} className={loading ? "spin" : ""} /></button>}
    </header>
    {(deviceRevoked || error) && <SystemNotice error>{deviceRevoked ? deviceRevokedMessage : error}</SystemNotice>}
    {selected && agent ? <AgentChat voiceRecovery={voiceRecovery} key={`${agent.id}:${selected.id}`} endpoint={endpoint} token={token} agent={agent} session={selected}
      scopeKey={scope} draft={drafts[`${agent.id}:${selected.id}`] ?? ""} onDraft={value => setDrafts(current => {
        const key = `${agent.id}:${selected.id}`, next = { ...current };
        delete next[key];
        return { ...next, [key]: value };
      })} />
      : <section className="agent-session-list">
        {!agent && <>
          <button className="agent-session-row" onClick={onBack}><strong>Codex</strong><small>电脑桌面会话与手机工作台</small></button>
          {agents.map(item => <button className="agent-session-row" key={item.id} onClick={() => void loadSessions(item)}><strong>{item.label}</strong><small>{item.id === "deepseek" ? "查看电脑会话与历史，继续原线程和处理提问" : item.id === "claude" ? "打开已加载插件的会话，查看输出、排队输入与中断" : "打开现有会话，查看输出与处理提问"}</small></button>)}
          {!loading && !agents.length && !error && <p className="setting-description">电脑端尚未接入其他 Agent。配置 DeepSeek Harness、Claude Code 插件或 OpenCode 服务后，可刷新此页。</p>}
        </>}
        {agent && <>
          {agent.id === "deepseek" && <SessionRangeControl range={range} disabled={loading} onChange={next => { setRange(next); void loadSessions(agent, false, next); }} />}
          <form className="search-field" onSubmit={event => { event.preventDefault(); void loadSessions(agent); }}><input aria-label="搜索 Agent 会话" placeholder="搜索会话" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><button type="submit" disabled={loading}>搜索</button></form>
          {<ProjectGroups key={agent.id} scope={scope} agentId={agent.id} groups={groupByProject(sessions, session => session.directory)} search={query}>
            {session => <button className="agent-session-row" key={session.id} onClick={() => { if (isKelivoHost) saveAgentView(scope, agent.id, session.id); setSelected(session); }}><strong>{session.title || "未命名会话"}</strong><time>{new Date(session.updatedAt).toLocaleString()}</time></button>}
          </ProjectGroups>}
          {!loading && !sessions.length && !error && <p>{agent.id === "deepseek" ? range === "recent" ? "近 30 天没有匹配会话，可查看更早会话。" : "没有匹配的 DeepSeek 会话，请检查电脑插件连接或搜索条件。" : agent.id === "claude" ? `尚无已连接的 ${agent.label} 会话，请先在电脑会话中加载并配置插件。` : "当前目录没有可用的现有会话。"}</p>}
          {cursor && <button className="action-button" disabled={loading} onClick={() => void loadSessions(agent, true)}>加载更多会话</button>}
        </>}
        {loading && <p className="inline-loading" role="status"><Loader2 className="spin" size={18} />正在读取…</p>}
      </section>}
  </main>;
}

function AgentChat({ endpoint, token, agent, session, draft, onDraft, scopeKey, voiceRecovery }: {
  voiceRecovery: VoiceRecoveryPort;
  scopeKey: string; endpoint: string; token: string; agent: Agent; session: AgentSession; draft: string; onDraft: (value: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<AgentSessionSnapshot | null>(null), snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const draftRef = useRef(draft); draftRef.current = draft;
  const draftSession = `${agent.id}:${session.id}`;
  const pendingDraft = useRef<PendingAgentDraft | null>(loadPendingAgentDraft(scopeKey, draftSession));
  const [stream, setStream] = useState<SubscriptionState>("connecting"), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [uploading, setUploading] = useState(false), uploadScope = useRef<AbortController | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null), previews = useRef(new Map<string, PendingAttachment>());
  const input = agentDraftParts(draft);
  const attachments = input.attachments.map(item => previews.current.get(item.path) ?? item);
  useEffect(() => {
    const before = (event: Event) => { if (uploadScope.current) { event.preventDefault(); setError("文件正在上传，请等待完成后离开。"); } };
    window.addEventListener(productBeforeNavigate, before);
    return () => { window.removeEventListener(productBeforeNavigate, before); uploadScope.current?.abort(); revokeAttachmentPreviews([...previews.current.values()]); };
  }, []);
  useEffect(() => {
    const paths = new Set(agentDraftParts(draft).attachments.map(item => item.path));
    for (const [path, item] of previews.current) if (!paths.has(path)) { revokeAttachmentPreviews([item]); previews.current.delete(path); }
  }, [draft]);
  function editText(text: string) {
    const next = composeAgentDraft(text, agentDraftParts(draftRef.current).attachments);
    if (next.length > 20_000) { setError("消息和附件路径合计不能超过 20,000 字，请缩短后重试。"); return; }
    onDraft(next);
  }
  async function uploadFiles(files: FileList | null) {
    if (!files?.length || uploadScope.current) return;
    const controller = new AbortController(); uploadScope.current = controller; setUploading(true); setError("");
    let uploaded: PendingAttachment[] = [];
    try {
      uploaded = await uploadAttachments(endpoint, token, Array.from(files), controller.signal);
      const current = agentDraftParts(draftRef.current), next = composeAgentDraft(current.text, mergeAttachments(current.attachments, uploaded));
      if (next.length > 20_000) throw new Error("附件路径与消息过长，请缩短草稿后重新添加附件。");
      for (const item of uploaded) previews.current.set(item.path, item);
      onDraft(next);
    } catch (caught) {
      revokeAttachmentPreviews(uploaded);
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "文件上传失败，请重试。");
    } finally {
      if (!controller.signal.aborted) { uploadScope.current = null; setUploading(false); if (uploadInput.current) uploadInput.current.value = ""; }
    }
  }
  const [history, setHistory] = useState<CodexMessage[]>([]), [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const historyRef = useRef(history); historyRef.current = history;
  const historyInitialized = useRef(false), [historyBusy, setHistoryBusy] = useState(false);
  const historyLock = useRef(false), viewport = useRef<HTMLDivElement>(null), scope = useRef<AbortController | null>(null);
  const readingScope = `agent:${scopeKey}`;
  const reading = useRef(loadReadingPositions(readingScope));
  const restoredTop = useRef(reading.current[draftSession]);
  const nearBottom = useRef(restoredTop.current === undefined), initialized = useRef(false);
  useEffect(() => {
    const flush = () => saveReadingPositions(readingScope, reading.current);
    window.addEventListener("pagehide", flush);
    window.addEventListener(productBeforeNavigate, flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); window.removeEventListener(productBeforeNavigate, flush); };
  }, [readingScope]);
  const base = `/api/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}`;
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    const reduce = createSnapshotReducer<AgentSessionSnapshot>();
    const unsubscribe = subscribeEvents({
      authorization: { endpoint, token },
      getToken: signal => apiPost(buildUrl(endpoint, `${base}/stream-token`), token, {}, signal),
      url: streamToken => buildUrl(endpoint, `${base}/events?${new URLSearchParams({ streamToken, v: "1" })}`),
      events: { "agent-session": input => {
        const next = verifyAgentSnapshot(reduce(input), agent.id, session.id);
        acceptMessageReceipt(next.submission, next.connected ? next.queue : undefined);
        setSnapshot(next);
        if (!historyInitialized.current) { historyInitialized.current = true; setHistoryCursor(next.historyCursor); }
        if (!historyRef.current.length && nearBottom.current && !next.questions.length && !next.permissions.length) requestAnimationFrame(() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight }));
        if (!initialized.current || next.questions.length || next.permissions.length) requestAnimationFrame(() => {
          if (!initialized.current && restoredTop.current !== undefined && viewport.current) {
            viewport.current.scrollTop = restoredTop.current;
          } else if (!historyRef.current.length && (!initialized.current || nearBottom.current)) {
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
    if (pendingDraft.current !== next.pending && !savePendingAgentDraft(scopeKey, draftSession, next.pending)) return;
    pendingDraft.current = next.pending;
    if (next.draft !== draftRef.current) { draftRef.current = next.draft; onDraft(next.draft); }
  }
  async function operate(action: "message" | "interrupt" | "question" | "permission" | "queue-cancel", suffix: string, extra: Record<string, unknown>, requestId?: string) {
    const current = snapshotRef.current, currentScope = scope.current;
    if (!currentScope || currentScope.signal.aborted || busyRef.current || !current?.connected || !current.control) return false;
    busyRef.current = true; setBusy(true); setError("");
    const clientMessageId = crypto.randomUUID(), controlToken = current.control.token;
    if (action === "message") {
      if (pendingDraft.current) { busyRef.current = false; setBusy(false); setError("上一条输入结果待确认，请先等待电脑同步。"); return false; }
      const pending = { clientMessageId, text: draftRef.current };
      if (!savePendingAgentDraft(scopeKey, draftSession, pending)) { busyRef.current = false; setBusy(false); setError("无法保存输入，请保留当前页面并重试。"); return false; }
      pendingDraft.current = pending;
    }
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
        if (pendingDraft.current?.clientMessageId === clientMessageId && savePendingAgentDraft(scopeKey, draftSession, null)) pendingDraft.current = null;
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
  const messages = [...new Map([...history, ...(agent.id === "deepseek" && history.length ? [] : snapshot?.messages ?? [])].map(message => [message.id, message])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const unresolved = snapshot?.submission && snapshot.submission.delivery !== "confirmed";
  const queuedSubmission = snapshot?.queue?.items.some(item => item.clientMessageId === snapshot.submission?.clientMessageId);
  const sendEnabled = Boolean(control?.canSend && !busy && !uploading && !unresolved && !pendingDraft.current && (input.text.trim() || attachments.length));
  function send(delivery: "steer" | "queue" = "queue") {
    if (!sendEnabled || (delivery === "steer" && !control?.canSteer)) return;
    void operate("message", "/messages", { text: composeMessageWithAttachments(input.text, attachments), delivery });
  }
  const sessionStatus = agentSessionStatus(snapshot, online);
  return <section className="agent-chat">
    <SystemNotice className="agent-connection" error={stream === "unauthorized"}>{online ? `${agent.label} 已连接` : stream === "unauthorized" ? deviceRevokedMessage : stream === "paused" ? "连接已暂停，返回前台后恢复" : "正在恢复连接…"}</SystemNotice>
    <div className="messages-viewport" ref={viewport} onScroll={() => { const element = viewport.current; if (element) { nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; reading.current[draftSession] = element.scrollTop; } }}>
      {(snapshot?.partialText || agent.id === "claude" || agent.id === "deepseek") && <details className="agent-capabilities"><summary>会话能力与同步范围</summary>
        {snapshot?.partialText && <p>当前显示已同步的消息与工具记录，长内容可能截断；更早历史以本通道提供的加载入口为准。</p>}
        {agent.id === "claude" && <p>消息在当前任务结束后处理；提问和单次审批可在手机处理。</p>}
        {agent.id === "deepseek" && <p>查看历史不会启动任务；发送后继续原会话，运行中可引导或排队。权限请求须核对完整参数后允许一次或拒绝。</p>}
      </details>}
      {snapshot?.operationError && <SystemNotice error>{snapshot.operationError.code === "rejected" ? "电脑会话拒绝了本次操作，输入内容已保留。" : "操作尚未送达电脑便已过期，输入内容已保留。"}</SystemNotice>}
      {historyCursor && (agent.id === "deepseek" || history.length < 190) && <button className="history-button" disabled={historyBusy} onClick={() => void older()}>{historyBusy ? "读取历史中…" : "加载更早的消息"}</button>}
      {agent.id === "deepseek" && history.length > 0 && <button className="history-button" disabled={historyBusy} onClick={() => { setHistory([]); setHistoryCursor(snapshot?.historyCursor ?? null); nearBottom.current = true; requestAnimationFrame(() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight })); }}>正在浏览历史 · 返回最新</button>}
      {agent.id !== "deepseek" && history.length >= 190 && <p className="setting-description">已达到手机历史显示上限，更早记录可在电脑查看。</p>}
      <MessageMediaProvider key={draftSession} endpoint={endpoint} token={token} agentId={agent.id} sessionId={session.id}>
        <MessageTimeline messages={messages} running={snapshot?.status === "running"} renderMessage={(message, expandToolDetails, assistantContinuation) => <MessageBubble message={message} assistantContinuation={assistantContinuation} expandToolDetails={expandToolDetails} assistantLabel={agent.label} smooth={false} smoothPending={false} onSmoothDone={() => {}} onCopy={() => writeClipboard(message.text)} />} />
      </MessageMediaProvider>
      {snapshot?.questions.map(question => <AgentQuestions key={question.id} request={question} agentLabel={agent.label} disabled={!online || busy} onRespond={answers => operate("question", `/questions/${question.id}/respond`, { answers }, question.id)} />)}
      {snapshot?.permissions.map(permission => <PermissionCard key={permission.id} permission={permission} agentLabel={agent.label} disabled={!online || busy} onRespond={decision => operate("permission", `/permissions/${permission.id}/respond`, { decision }, permission.id)} />)}
      {!snapshot && <p className="inline-loading" role="status"><Loader2 size={18} className="spin" />正在读取原会话…</p>}
    </div>
    <footer className="composer-panel agent-composer">
      {error && <SystemNotice error>{error}</SystemNotice>}
      {unresolved && !queuedSubmission && <SystemNotice>{snapshot?.submission?.delivery === "uncertain" ? "提交结果未知，正在核对；请勿重复发送。" : "已提交，等待服务确认。"}</SystemNotice>}
      {snapshot?.queue && <AgentQueue queue={snapshot.queue} disabled={!online || busy} onCancel={id => operate("queue-cancel", `/queue/${encodeURIComponent(id)}/cancel`, {}, id)} />}
      {attachments.length > 0 && <AttachmentTray attachments={attachments} onRemove={id => onDraft(composeAgentDraft(input.text, attachments.filter(item => item.id !== id)))} />}
      <input ref={uploadInput} type="file" multiple className="hidden-file-input" onChange={event => void uploadFiles(event.target.files)} />
      <ComputerComposer draft={input.text} onDraft={editText} onSend={send} onStop={() => void operate("interrupt", "/interrupt", {})} onUpload={() => uploadInput.current?.click()}
        voice={<VoiceInput context={{ cwd: session.directory, title: session.title, messages }} scope={scopeKey} thread={draftSession} recovery={voiceRecovery} endpoint={endpoint} token={token} draft={input.text} onDraft={editText} />} label="发送给当前 Agent 会话"
        placeholder={online ? `向 ${agent.label} 发送消息` : "草稿已保留，等待恢复连接…"} status={<ComposerSessionStatus status={sessionStatus} lastTurn={snapshot?.lastTurn} running={snapshot?.status === "running"} fallback={`${agent.label} · 当前会话`} />}
        uploading={uploading} uploadDisabled={!token} busy={busy} running={snapshot?.status === "running"} hasContent={Boolean(input.text.trim() || attachments.length)}
        canSend={sendEnabled} canStop={Boolean(control?.canInterrupt)} deliveries={{ steer: sendEnabled && Boolean(control?.canSteer), queue: sendEnabled }}
        maxLength={Math.max(0, 20_000 - (draft.length - input.text.length))} />
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
