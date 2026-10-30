import { type ThreadRuntime, type CodexMessage, type DesktopControlCapability, type DesktopControlResponse, type LiveApproval } from "../../app/types";
import { composeMessageWithAttachments } from "./attachments";
import { reconcileMessages } from "./messageReconciliation";
const threadRuntimeCacheKey = "mobileCodexThreadRuntimeCacheV2";
const cachedMessagesPerThread = 120;
const cachedThreadLimit = 24;
const threadInputCacheKey = "mobileCodexThreadInputCacheV1";
const inputCacheByteBudget = 1024 * 1024;
const messageCacheByteBudget = 2 * 1024 * 1024;

type CachedInput = Pick<ThreadRuntime, "draft" | "pendingMessageId" | "pendingMessageText"> & { localMessages?: CodexMessage[] };
type CachedThread = Partial<CachedInput> & {
  messageIdentityVersion?: number; messages?: CodexMessage[]; cursor?: number;
  generation?: string; historyBefore?: number; lastAccessedAt?: number;
};
export type ThreadCacheSaveResult = { status: "saved" | "history-reduced" | "input-failed" };

export function threadCacheSaveNotice(result: ThreadCacheSaveResult): string {
  if (result.status === "input-failed") return "草稿或待确认输入尚未保存，请保留当前页面并重试。";
  if (result.status === "history-reduced") return "草稿与待确认输入已保存，部分历史将在联网后重新加载。";
  return "";
}

export function defaultRuntime(): ThreadRuntime {
  return {
    messages: [],
    draft: "",
    sending: false,
    loading: false,
    status: "",
    loaded: false,
    cursor: 0,
    watchMode: "none",
    watching: false,
    readonlyReason: "",
    activeTurnId: null,
    turnStatus: "idle",
    lastEventCount: 0,
    lastTurnError: "",
    approvals: [],
    userInputs: [],
    smoothMessageId: null,
    attachments: [],
  };
}

export function turnProgressPatch(
  runtime: ThreadRuntime,
  progress: { turnStatus?: ThreadRuntime["turnStatus"]; activity?: ThreadRuntime["activity"] },
) {
  const turnStatus = progress.turnStatus ?? runtime.turnStatus;
  const active = turnStatus === "starting" || turnStatus === "inProgress";
  const ended = turnStatus === "completed" || turnStatus === "interrupted" || turnStatus === "failed";
  return {
    turnStatus,
    activity: active ? progress.activity ?? runtime.activity : undefined,
    sending: ended ? false : active ? true : runtime.sending,
    activeTurnId: ended ? null : runtime.activeTurnId,
    lastTurnError: progress.turnStatus && progress.turnStatus !== "failed" ? "" : runtime.lastTurnError,
  };
}

export function getRuntime(state: Record<string, ThreadRuntime>, key: string): ThreadRuntime {
  if (!key) return defaultRuntime();
  return state[key] ?? defaultRuntime();
}

export function desktopSendControl(runtime: ThreadRuntime, serverMode?: string) {
  const control = runtime.desktopControl;
  const native = control?.transport === "native" || serverMode === "desktop-ipc-follower-control";
  if (!native) return { native, ready: control?.transport === "legacy" || serverMode === "macos-ui-injector-control", guard: undefined };
  const ready = Boolean(control?.transport === "native" && control.token && control.canSend && !runtime.desktopSubmission);
  return { native, ready, guard: ready ? { controlToken: control!.token!, expectedTurnId: control!.activeTurnId } : undefined };
}

export function desktopRejectedSendPatch(runtime: ThreadRuntime, code: unknown, clientMessageId: string): Partial<ThreadRuntime> {
  // These two guards reject before any follower write. Unknown results retain their identity.
  if ((code === "desktop_control_refresh_required" || code === "desktop_turn_changed") &&
      runtime.pendingMessageId === clientMessageId && !runtime.desktopSubmission &&
      runtime.desktopControl?.submission?.clientMessageId !== clientMessageId) {
    return { pendingMessageId: undefined, pendingMessageText: undefined };
  }
  return {};
}

function desktopAcceptedSendPatch(runtime: ThreadRuntime, clientMessageId: string, action: DesktopControlResponse["action"]): Partial<ThreadRuntime> {
  const matching = runtime.pendingMessageId === clientMessageId;
  const submission = runtime.desktopSubmission?.clientMessageId === clientMessageId;
  if (!matching && !submission) return {};
  const unchanged = matching && runtime.pendingMessageText === composeMessageWithAttachments(runtime.draft, runtime.attachments);
  const feedback = action === "queue-message" ? "已排队，当前任务结束后执行" : action === "steer-turn" ? "桌面已确认收到引导" : "桌面已确认收到消息";
  return {
    ...(matching ? { pendingMessageId: undefined, pendingMessageText: undefined } : {}),
    ...(!runtime.desktopSubmission || submission ? { desktopSubmission: undefined } : {}),
    ...(unchanged ? { draft: "", attachments: [] } : {}),
    desktopSendFeedback: feedback,
    status: feedback,
    lastTurnError: "",
  };
}

export function desktopMessageReceived(runtime: ThreadRuntime, clientMessageId: string): boolean {
  return Boolean(runtime.desktopControl?.queue?.items.some(item => item.clientMessageId === clientMessageId)
    || (runtime.desktopControl?.submission?.clientMessageId === clientMessageId && runtime.desktopControl.submission.delivery === "confirmed")
    || runtime.messages.some(message => message.role === "user" && (message.kind === "userMessage" || (["message", "user_message"].includes(message.kind) && message.sourceItemId)) && message.clientMessageId === clientMessageId));
}

export function desktopControlPatch(runtime: ThreadRuntime, control: DesktopControlCapability | undefined): Partial<ThreadRuntime> {
  const receipt = control?.submission;
  const interrupt = receipt && receipt.clientMessageId === runtime.desktopInterrupt?.clientMessageId;
  const queued = control?.queue?.items.find(item => item.clientMessageId === runtime.pendingMessageId || item.clientMessageId === runtime.desktopSubmission?.clientMessageId);
  return {
    desktopControl: control,
    ...(receipt?.delivery === "confirmed" && receipt.action !== "interrupt-turn" ? desktopAcceptedSendPatch(runtime, receipt.clientMessageId, receipt.action) : {}),
    ...(receipt && receipt.delivery !== "confirmed" && receipt.action !== "interrupt-turn" ? { desktopSubmission: { clientMessageId: receipt.clientMessageId, delivery: receipt.delivery } } : {}),
    ...(interrupt && receipt.delivery === "confirmed" ? { desktopInterrupt: undefined } : {}),
    ...(receipt?.action === "interrupt-turn" && receipt.delivery !== "confirmed" ? { desktopInterrupt: { clientMessageId: receipt.clientMessageId, delivery: receipt.delivery } } : {}),
    ...(queued ? desktopAcceptedSendPatch(runtime, queued.clientMessageId, "queue-message") : {}),
  };
}

export function desktopControlOfflinePatch(runtime: ThreadRuntime): Partial<ThreadRuntime> {
  return { userInputs: [], approvals: runtime.approvals.filter(item => item.source !== "desktop"), ...(runtime.desktopControl ? { desktopControl: { ...runtime.desktopControl, token: null, canSend: false, canInterrupt: false } } : {}) };
}

export function desktopApprovalsPatch(runtime: ThreadRuntime, approvals: LiveApproval[] | undefined, available: boolean | undefined): Partial<ThreadRuntime> {
  return { approvals: available ? (approvals ?? []).map(item => {
    const previous = runtime.approvals.find(old => old.id === item.id);
    // Keep the local reservation while a snapshot races the HTTP submission.
    return item.status === "pending" && previous && ["submitting", "submitted", "uncertain"].includes(previous.status) ? { ...item, status: previous.status } : item;
  }) : [] };
}

export function approvalResponsePatch(runtime: ThreadRuntime, id: string, status: "resolved" | "submitting" | "submitted" | "uncertain"): Partial<ThreadRuntime> {
  return { approvals: status === "resolved" ? runtime.approvals.filter(item => item.id !== id) : runtime.approvals.map(item => item.id === id
    ? { ...item, status: item.status === "uncertain" && status === "submitted" ? "uncertain" : status } : item) };
}

export function desktopControlResponsePatch(runtime: ThreadRuntime, response: Pick<DesktopControlResponse, "action" | "delivery">, clientMessageId: string): Partial<ThreadRuntime> {
  if ((runtime.pendingMessageId && runtime.pendingMessageId !== clientMessageId) || (runtime.desktopSubmission && runtime.desktopSubmission.clientMessageId !== clientMessageId)) return {};
  const observed = runtime.desktopControl?.submission;
  // A later SSE confirmation wins over an earlier HTTP acknowledgement or timeout.
  const confirmed = response.delivery === "confirmed" || desktopMessageReceived(runtime, clientMessageId);
  if (confirmed) return desktopAcceptedSendPatch(runtime, clientMessageId, observed?.clientMessageId === clientMessageId && observed.delivery === "confirmed" ? observed.action : response.action);
  return { desktopSubmission: { clientMessageId, delivery: response.delivery === "submitted" ? "submitted" : "uncertain" }, desktopSendFeedback: undefined, status: "提交结果待确认，正在同步会话", lastTurnError: "" };
}

export function desktopInterruptResponsePatch(runtime: ThreadRuntime, response: Pick<DesktopControlResponse, "delivery" | "turnStatus">, clientMessageId: string): Partial<ThreadRuntime> {
  const observed = runtime.desktopControl?.submission;
  const confirmed = response.delivery === "confirmed" || (observed?.clientMessageId === clientMessageId && observed.delivery === "confirmed");
  const turnStatus = observed?.clientMessageId === clientMessageId && observed.delivery === "confirmed" ? observed.turnStatus : response.turnStatus;
  return {
    desktopInterrupt: confirmed ? undefined : { clientMessageId, delivery: response.delivery === "submitted" ? "submitted" : "uncertain" },
    status: confirmed ? turnStatus === "interrupted" ? "桌面已确认打断" : "桌面任务已结束" : "打断结果待确认，正在同步会话",
    lastTurnError: "",
  };
}

export type ThreadMessageCacheSnapshot = {
  status: "available" | "missing" | "unreadable";
  messageIdentityVersion: number | null;
  messages: CodexMessage[];
  invalidMessageCount: number;
};

export function readThreadMessageCacheForDiagnostics(scope: string, threadId: string): ThreadMessageCacheSnapshot {
  const empty = { messageIdentityVersion: null, messages: [], invalidMessageCount: 0 };
  try {
    const parsed = JSON.parse(localStorage.getItem(`${threadRuntimeCacheKey}:${scope}`) ?? "{}");
    const item = parsed?.[threadId];
    if (!item) return { ...empty, status: "missing" };
    if (!Array.isArray(item.messages)) return { ...empty, status: "unreadable" };
    const messages = item.messages.filter((message: unknown): message is CodexMessage => Boolean(message) &&
      typeof message === "object" && ["id", "timestamp", "role", "text", "kind"].every(key => typeof (message as Record<string, unknown>)[key] === "string"));
    return {
      status: "available",
      messageIdentityVersion: Number.isSafeInteger(item.messageIdentityVersion) ? item.messageIdentityVersion : null,
      messages,
      invalidMessageCount: item.messages.length - messages.length,
    };
  } catch {
    return { ...empty, status: "unreadable" };
  }
}

function readCacheObject<T>(key: string): Record<string, T> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function localInputMessage(message: CodexMessage): boolean {
  return message.role === "user" && (message.kind === "local" || message.kind === "steeringUserMessage" || /^(local-|desktop-local-|steer-local-)/u.test(message.id));
}

function inputFromRuntime(runtime: Partial<ThreadRuntime>): CachedInput {
  return {
    draft: typeof runtime.draft === "string" ? runtime.draft : "",
    pendingMessageId: typeof runtime.pendingMessageId === "string" ? runtime.pendingMessageId : undefined,
    pendingMessageText: typeof runtime.pendingMessageText === "string" ? runtime.pendingMessageText : undefined,
    localMessages: reconcileMessages([], (Array.isArray(runtime.messages) ? runtime.messages : []).filter(message => cacheableMessage(message) && localInputMessage(message))),
  };
}

function hasInput(input: CachedInput): boolean {
  return Boolean(input.draft || input.pendingMessageId || input.pendingMessageText || input.localMessages?.length);
}

export function loadThreadRuntimeCache(scope = "legacy-disabled"): Record<string, ThreadRuntime> {
  const body = readCacheObject<CachedThread>(`${threadRuntimeCacheKey}:${scope}`);
  const inputKey = `${threadInputCacheKey}:${scope}`;
  let hasSeparateInputs = false;
  try { hasSeparateInputs = localStorage.getItem(inputKey) !== null; } catch { /* Storage may be disabled. */ }
  const inputs = hasSeparateInputs ? readCacheObject<CachedInput>(inputKey) : {};
  const result: Record<string, ThreadRuntime> = {};
  for (const threadId of new Set([...Object.keys(body), ...Object.keys(inputs)])) {
    const stored = body[threadId];
    const item = stored && typeof stored === "object" ? stored : {};
    // An empty independent snapshot is authoritative too: never revive cleared
    // drafts/pending identities from an older body write that failed afterwards.
    const input = hasSeparateInputs ? inputs[threadId] ?? { draft: "" } : inputFromRuntime(item);
    if (!input || typeof input !== "object") continue;
    const refresh = item.messageIdentityVersion !== 3;
    const cached = Array.isArray(item.messages) ? item.messages.filter(message => cacheableMessage(message) &&
      (!refresh || localInputMessage(message)) && (!hasSeparateInputs || !localInputMessage(message))) : [];
    const local = (Array.isArray(input.localMessages) ? input.localMessages : []).filter(message => cacheableMessage(message) && localInputMessage(message));
    const messages = reconcileMessages([], [...cached.slice(-cachedMessagesPerThread), ...local]);
    if (!messages.length && !hasInput(input)) continue;
    result[threadId] = {
      ...defaultRuntime(), messages,
      draft: typeof input.draft === "string" ? input.draft : "",
      pendingMessageId: input.pendingMessageId, pendingMessageText: input.pendingMessageText,
      generation: refresh ? undefined : item.generation,
      historyBefore: refresh ? undefined : item.historyBefore,
      lastAccessedAt: item.lastAccessedAt,
      loaded: true,
      cursor: !refresh && Number.isFinite(item.cursor) ? Number(item.cursor) : 0,
      status: `已载入最近 ${messages.length} 条缓存`,
    };
  }
  return result;
}

function bodyCachePayload(state: Record<string, ThreadRuntime>): { text: string; reduced: boolean } {
  const entries = Object.entries(state).filter(([, runtime]) => runtime.messages.length && !runtime.historyBrowsing)
    .sort(([, left], [, right]) => (right.lastAccessedAt ?? (Date.parse(right.messages.at(-1)?.timestamp ?? "") || 0)) - (left.lastAccessedAt ?? (Date.parse(left.messages.at(-1)?.timestamp ?? "") || 0)))
    .slice(0, cachedThreadLimit);
  const payload: Record<string, CachedThread> = {};
  let bytes = 4, reduced = false;
  for (const [threadId, runtime] of entries) {
    const item: CachedThread = { messageIdentityVersion: 3, cursor: runtime.cursor, generation: runtime.generation, historyBefore: runtime.historyBefore, lastAccessedAt: runtime.lastAccessedAt, messages: [] };
    // localStorage uses strings; count UTF-16 bytes including JSON overhead.
    const overhead = 2 * (JSON.stringify(threadId).length + JSON.stringify(item).length + 2);
    const messages = reconcileMessages([], runtime.messages.filter(cacheableMessage)).slice(-cachedMessagesPerThread);
    const kept: CodexMessage[] = [];
    let size = overhead;
    for (let index = messages.length - 1; index >= 0; index--) {
      const cost = 2 * (JSON.stringify(messages[index]).length + (kept.length ? 1 : 0));
      if (bytes + size + cost > messageCacheByteBudget) { reduced = true; break; }
      kept.unshift(messages[index]); size += cost;
    }
    if (!kept.length) continue;
    payload[threadId] = { ...item, messages: kept };
    bytes += size;
  }
  return { text: JSON.stringify(payload), reduced };
}

function isQuotaError(error: unknown): boolean {
  return error instanceof Error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

function releaseBodyCache(scope: string) {
  const key = `${threadRuntimeCacheKey}:${scope}`;
  if (localStorage.getItem(`${threadInputCacheKey}:${scope}`) !== null) {
    localStorage.removeItem(key);
    return;
  }
  // During migration the old body may still be the only saved copy of inputs.
  // Compact it in place before retrying; a failed retry leaves those inputs intact.
  const compact = Object.fromEntries(Object.entries(readCacheObject<CachedThread>(key)).flatMap(([id, item]) => {
    if (!item || typeof item !== "object") return [];
    const input = inputFromRuntime(item);
    return hasInput(input) ? [[id, { messageIdentityVersion: 3, ...input, messages: input.localMessages }]] : [];
  }));
  localStorage.setItem(key, JSON.stringify(compact));
}

export function saveThreadRuntimeCache(state: Record<string, ThreadRuntime>, scope = "legacy-disabled"): ThreadCacheSaveResult {
  let releasedBody = false;
  try {
    const inputs = Object.fromEntries(Object.entries(state).flatMap(([id, runtime]) => {
      const input = inputFromRuntime(runtime);
      return hasInput(input) ? [[id, input]] : [];
    }));
    const serialized = JSON.stringify(inputs);
    if (serialized.length * 2 > inputCacheByteBudget) return { status: "input-failed" };
    try { localStorage.setItem(`${threadInputCacheKey}:${scope}`, serialized); }
    catch (error) {
      if (!isQuotaError(error)) return { status: "input-failed" };
      releaseBodyCache(scope);
      releasedBody = true;
      localStorage.setItem(`${threadInputCacheKey}:${scope}`, serialized);
    }
  } catch { return { status: "input-failed" }; }

  try {
    const body = bodyCachePayload(state);
    localStorage.setItem(`${threadRuntimeCacheKey}:${scope}`, body.text);
    return { status: body.reduced || releasedBody ? "history-reduced" : "saved" };
  } catch {
    // Inputs are already durable. Only this scope's rebuildable body may be dropped.
    try { localStorage.removeItem(`${threadRuntimeCacheKey}:${scope}`); } catch { /* Best effort. */ }
    return { status: "history-reduced" };
  }
}

function cacheableMessage(message: CodexMessage): boolean {
  return Boolean(message) && typeof message.text === "string" && !message.text.includes("<send_user_message_question_reply>") && !/userInputResponse/i.test(message.kind);
}
