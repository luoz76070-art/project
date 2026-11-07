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
function validDraftKey(key: string) {
  const match = /^([a-z][a-z0-9-]{0,63}):([a-zA-Z0-9_-]{1,160})$/u.exec(key);
  if (!match || match[1] === "codex") return false;
  if (match[1] === "opencode") return /^ses[a-zA-Z0-9_-]{1,128}$/u.test(match[2]);
  return !["claude", "deepseek"].includes(match[1]) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(match[2]);
}
function boundedDrafts(value: Record<string, unknown>) {
  let budget = 256_000;
  return Object.fromEntries(Object.entries(value).reverse().flatMap(([key, text]) => {
    if (!validDraftKey(key) || typeof text !== "string" || !text || text.length > 20_000 || text.length > budget) return [];
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
export function saveAgentDrafts(scope: string, drafts: Record<string, string>, storage?: Pick<Storage, "setItem">): boolean {
  try { (storage ?? localStorage).setItem(draftKey(scope), JSON.stringify(boundedDrafts(drafts))); return true; }
  catch { return false; }
}

const pendingDraftKey = (scope: string, session: string) => `mobileCodexAgentPendingV1:${scope}:${session}`;
export function loadPendingAgentDraft(scope: string, session: string): PendingAgentDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingDraftKey(scope, session)) ?? "null");
    if (value === null) return null;
    if (typeof value.clientMessageId === "string" && typeof value.text === "string") return value;
  } catch { /* Fail closed when pending delivery cannot be recovered. */ }
  return { clientMessageId: "unreadable-pending-delivery", text: "" };
}
export function savePendingAgentDraft(scope: string, session: string, pending: PendingAgentDraft | null): boolean {
  try { localStorage.setItem(pendingDraftKey(scope, session), JSON.stringify(pending)); return true; }
  catch { return false; }
}

export function loadAgentView(scope: string): { agentId: string; sessionId: string | null } | null {
  try {
    const raw = localStorage.getItem(`mobileCodexAgentViewV1:${scope}`) ?? "null";
    if (raw.length > 8192) return null;
    const value = JSON.parse(raw);
    return value && typeof value.agentId === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value.agentId) && (value.sessionId === null || (typeof value.sessionId === "string" && value.sessionId.length <= 1024)) ? value : null;
  } catch { return null; }
}
export function saveAgentView(scope: string, agentId: string | null, sessionId: string | null) {
  try { localStorage.setItem(`mobileCodexAgentViewV1:${scope}`, JSON.stringify(agentId ? { agentId, sessionId } : null)); } catch { /* No task is submitted on restore. */ }
}
