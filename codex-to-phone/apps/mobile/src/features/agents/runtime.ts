import type { AgentDelivery, AgentSessionSnapshot } from "./types";
import type { CodexMessage } from "../../app/types";

/** Keep the older end while paging, so reaching the render budget never blocks history. */
export function agentHistoryWindow(current: CodexMessage[], older: CodexMessage[], limit: number) {
  return [...new Map([...older, ...current].map(message => [message.id, message])).values()].slice(0, limit);
}

export function offlineAgent(snapshot: AgentSessionSnapshot | null): AgentSessionSnapshot | null {
  return snapshot ? { ...snapshot, connected: false, control: null, questions: [], permissions: [],
    ...(snapshot.queue ? { queue: { ...snapshot.queue, available: false } } : {}),
  } : null;
}

/** A late HTTP result cannot restore a card or overwrite authoritative SSE confirmation. */
export function agentDelivery(snapshot: AgentSessionSnapshot | null, clientMessageId: string, action: "message" | "interrupt", result: AgentDelivery): AgentSessionSnapshot | null {
  if (!snapshot?.connected) return snapshot;
  if (snapshot.operationError?.clientMessageId === clientMessageId) return snapshot;
  if (snapshot.submission && (snapshot.submission.clientMessageId !== clientMessageId || snapshot.submission.delivery === "confirmed")) return snapshot;
  return { ...snapshot, submission: { clientMessageId, action, delivery: result.delivery },
    ...(result.delivery === "uncertain" ? { control: snapshot.control ? { ...snapshot.control, canSend: false, canSteer: false, canInterrupt: false } : null } : {}),
  };
}

export type PendingAgentDraft = { clientMessageId: string; text: string };
export function reconcileAgentDraft(draft: string, pending: PendingAgentDraft | null, receipt: AgentSessionSnapshot["submission"], queue?: AgentSessionSnapshot["queue"]) {
  if (!pending || receipt?.clientMessageId !== pending.clientMessageId || receipt.action !== "message") return { draft, pending };
  const queued = queue?.available && queue.items.some(item => item.clientMessageId === pending.clientMessageId && ["waiting", "paused"].includes(item.status));
  if (receipt.delivery !== "confirmed" && !queued) return { draft, pending };
  return { draft: draft === pending.text ? "" : draft, pending: null };
}

export function verifyAgentSnapshot(snapshot: AgentSessionSnapshot, agentId: string, sessionId: string) {
  if (snapshot.agentId !== agentId || snapshot.session?.id !== sessionId || !Array.isArray(snapshot.messages)
    || !Array.isArray(snapshot.questions) || !Array.isArray(snapshot.permissions)
    || !["idle", "running"].includes(snapshot.status)
    || (snapshot.connected && !snapshot.control?.token)) throw new Error("Agent 会话状态不匹配");
  return snapshot;
}

const draftKey = (scope: string) => `mobile-codex:agent-drafts:${scope}`;
function boundedDrafts(value: Record<string, unknown>) {
  let budget = 256_000;
  return Object.fromEntries(Object.entries(value).reverse().flatMap(([key, text]) => {
    if (!/^(?:opencode:ses[a-zA-Z0-9_-]{1,128}|(?:claude|deepseek):[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u.test(key) || typeof text !== "string" || !text || text.length > 20_000 || text.length > budget) return [];
    budget -= text.length; return [[key, text]];
  }).slice(0, 64).reverse()) as Record<string, string>;
}
export function loadAgentDrafts(scope: string, storage?: Pick<Storage, "getItem">): Record<string, string> {
  try {
    const raw = (storage ?? localStorage).getItem(draftKey(scope));
    if (!raw || raw.length > 1_000_000) return {};
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? boundedDrafts(value as Record<string, unknown>) : {};
  } catch { return {}; }
}
export function saveAgentDrafts(scope: string, drafts: Record<string, string>, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? localStorage).setItem(draftKey(scope), JSON.stringify(boundedDrafts(drafts))); } catch { /* Keep the current in-memory draft if storage is unavailable. */ }
}
