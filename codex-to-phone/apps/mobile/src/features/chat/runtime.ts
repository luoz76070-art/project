import { type ThreadRuntime, type CodexMessage } from "../../app/types";
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

export function loadThreadRuntimeCache(scope = "legacy-disabled"): Record<string, ThreadRuntime> {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${threadRuntimeCacheKey}:${scope}`) ?? "{}") as Record<string, { messages?: CodexMessage[]; cursor?: number; generation?: string; draft?: string; historyBefore?: number; pendingMessageId?: string; pendingMessageText?: string }>;
    const result: Record<string, ThreadRuntime> = {};
    for (const [threadId, item] of Object.entries(parsed)) {
      const messages = Array.isArray(item.messages) ? item.messages.slice(-cachedMessagesPerThread) : [];
      if (messages.length === 0 && !item.draft && !item.pendingMessageText) continue;
      result[threadId] = {
        ...defaultRuntime(),
        messages,
        draft: item.draft ?? "",
        generation: item.generation,
        historyBefore: item.historyBefore,
        pendingMessageId: item.pendingMessageId, pendingMessageText: item.pendingMessageText,
        loaded: true,
        cursor: Number.isFinite(item.cursor) ? Number(item.cursor) : 0,
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
          cursor: runtime.cursor,
          draft: runtime.draft,
          generation: runtime.generation,
          historyBefore: runtime.historyBefore,
          pendingMessageId: runtime.pendingMessageId, pendingMessageText: runtime.pendingMessageText,
          messages: runtime.historyBrowsing ? [] : runtime.messages.slice(-cachedMessagesPerThread),
        },
      ]),
    );
    localStorage.setItem(`${threadRuntimeCacheKey}:${scope}`, JSON.stringify(payload));
  } catch {
    // Cache is a best-effort mobile UX layer.
  }
}
