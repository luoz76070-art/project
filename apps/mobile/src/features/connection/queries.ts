import { type ThreadSummary, type LiveTurnSnapshot, type CodexMessage } from "../../app/types";
import { apiGet, buildUrl } from "./http";
import { turnStatusText } from "../chat/messages";
import { isDesktopSource, sessionInRange, type SessionRange } from "../threads/model";
import { desktopLatestMaxBytes, desktopLatestMaxMessages } from "../../app/config";

export async function loadThreadList(endpoint: string, token: string, signal?: AbortSignal, offset = 0, query = "", range: SessionRange = "recent"): Promise<{ threads: ThreadSummary[]; hasMore?: boolean; nextOffset?: number }> {
  try {
    const data = await apiGet<{ threads: ThreadSummary[]; hasMore?: boolean; nextOffset?: number }>(buildUrl(endpoint, `/api/threads?${new URLSearchParams({ limit: "120", offset: String(offset), query, range })}`), token, signal);
    return { ...data, threads: data.threads.filter(thread => sessionInRange(thread.updatedAt, range)) };
  } catch {
    signal?.throwIfAborted();
    const data = await apiGet<{ threads: ThreadSummary[] }>(buildUrl(endpoint, "/api/live/threads?limit=120"), token, signal);
    return { threads: data.threads.filter(thread => sessionInRange(thread.updatedAt, range) && thread.threadName.toLowerCase().includes(query.trim().toLowerCase())) };
  }
}

export async function loadActiveTurns(endpoint: string, token: string, signal?: AbortSignal): Promise<LiveTurnSnapshot[]> {
  const data = await apiGet<{ turns: LiveTurnSnapshot[] }>(buildUrl(endpoint, "/api/live/turns"), token, signal);
  return data.turns;
}

export function threadFromLiveTurn(turn: LiveTurnSnapshot): ThreadSummary | null {
  if (turn.thread) return turn.thread;
  return {
    id: turn.threadId,
    threadName: `手机: ${turnStatusText(turn.status) || "运行中"}`,
    updatedAt: turn.updatedAt,
    cwd: null,
    source: "appServer",
    originator: "Codex app-server",
    rolloutPath: null,
  };
}

export async function readThread(endpoint: string, token: string, thread: ThreadSummary, signal?: AbortSignal): Promise<{ messages: CodexMessage[]; cursor?: number; generation?: string; windowStart?: number; turnStatus?: "inProgress" | "completed" | "interrupted" | "failed"; activity?: "thinking" | "working" | "outputting" }> {
  if (isDesktopSource(thread)) {
    return await apiGet<Awaited<ReturnType<typeof readThread>>>(
      buildUrl(
        endpoint,
        `/api/desktop/threads/${encodeURIComponent(thread.id)}?latest=true&maxBytes=${desktopLatestMaxBytes}&maxMessages=${desktopLatestMaxMessages}`,
      ),
      token, signal,
    );
  }
  try {
    return await apiGet<{ messages: CodexMessage[]; cursor?: number; generation?: string; windowStart?: number }>(buildUrl(endpoint, `/api/live/threads/${encodeURIComponent(thread.id)}`), token, signal);
  } catch {
    signal?.throwIfAborted();
    return await apiGet<{ messages: CodexMessage[] }>(buildUrl(endpoint, `/api/threads/${encodeURIComponent(thread.id)}`), token, signal);
  }
}
