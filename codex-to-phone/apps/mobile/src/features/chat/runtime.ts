import { type ThreadRuntime, type CodexMessage, type DesktopControlCapability, type DesktopControlResponse, type LiveApproval } from "../../app/types";
import { composeMessageWithAttachments } from "./attachments";
const threadRuntimeCacheKey = "mobileCodexThreadRuntimeCacheV2";
const cachedMessagesPerThread = 120;
const cachedThreadLimit = 24;

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

export function loadThreadRuntimeCache(scope = "legacy-disabled"): Record<string, ThreadRuntime> {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${threadRuntimeCacheKey}:${scope}`) ?? "{}") as Record<string, { messageIdentityVersion?: number; messages?: CodexMessage[]; cursor?: number; generation?: string; draft?: string; historyBefore?: number; pendingMessageId?: string; pendingMessageText?: string }>;
    const result: Record<string, ThreadRuntime> = {};
    for (const [threadId, item] of Object.entries(parsed)) {
      // Re-read pre-identity server caches once; preserve drafts and unconfirmed local input.
      const refresh = item.messageIdentityVersion !== 2;
      const messages = Array.isArray(item.messages) ? item.messages.filter(message => cacheableMessage(message) && (!refresh || (message.role === "user" && (message.kind === "local" || message.kind === "steeringUserMessage" || /^(local-|desktop-local-|steer-local-)/u.test(message.id))))).slice(-cachedMessagesPerThread) : [];
      if (messages.length === 0 && !item.draft && !item.pendingMessageText) continue;
      result[threadId] = {
        ...defaultRuntime(),
        messages,
        draft: item.draft ?? "",
        generation: refresh ? undefined : item.generation,
        historyBefore: refresh ? undefined : item.historyBefore,
        pendingMessageId: item.pendingMessageId, pendingMessageText: item.pendingMessageText,
        loaded: true,
        cursor: !refresh && Number.isFinite(item.cursor) ? Number(item.cursor) : 0,
        status: `已载入最近 ${messages.length} 条缓存`,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveThreadRuntimeCache(state: Record<string, ThreadRuntime>, scope = "legacy-disabled") {
  try {
    const entries = Object.entries(state)
      .filter(([, runtime]) => (runtime.messages.length > 0 || runtime.draft.length > 0 || Boolean(runtime.pendingMessageText)))
      .sort(([, left], [, right]) => Number(Boolean(right.draft || right.pendingMessageText)) - Number(Boolean(left.draft || left.pendingMessageText)) || (Date.parse(right.messages.at(-1)?.timestamp ?? "") || 0) - (Date.parse(left.messages.at(-1)?.timestamp ?? "") || 0))
      .slice(0, cachedThreadLimit);
    const payload = Object.fromEntries(
      entries.map(([threadId, runtime]) => [
        threadId,
        {
          messageIdentityVersion: 2,
          cursor: runtime.cursor,
          draft: runtime.draft,
          generation: runtime.generation,
          historyBefore: runtime.historyBefore,
          pendingMessageId: runtime.pendingMessageId, pendingMessageText: runtime.pendingMessageText,
          messages: runtime.historyBrowsing ? [] : runtime.messages.filter(cacheableMessage).slice(-cachedMessagesPerThread),
        },
      ]),
    );
    localStorage.setItem(`${threadRuntimeCacheKey}:${scope}`, JSON.stringify(payload));
  } catch {
    // Cache is a best-effort mobile UX layer.
  }
}

function cacheableMessage(message: CodexMessage): boolean {
  return !message.text.includes("<send_user_message_question_reply>") && !/userInputResponse/i.test(message.kind);
}
