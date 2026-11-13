import { activityEvidence, itemActivity, type ActivityEvidence } from "./activityEvidence.js";
import { makeLastTurn, codexReason, type LastTurn } from "./lastTurn.js";

export type TurnProgress = {
  activeTurnId?: string | null;
  activityEvidence?: ActivityEvidence | null;
  turnStatus?: "inProgress" | "completed" | "interrupted" | "failed";
  activity?: "thinking" | "working" | "outputting";
  lastTurn?: LastTurn | null;
};

/** Project lifecycle and public work phases, never reasoning text or tool arguments. */
export function turnProgress(records: Array<{ value: unknown }>, previous?: LastTurn | null): TurnProgress {
  const progress: TurnProgress = {};
  let turnId: unknown;
  for (const { value } of records) {
    if (!value || typeof value !== "object") continue;
    const line = value as { type?: string; timestamp?: unknown; payload?: Record<string, unknown> };
    const payload = line.payload;
    if (!payload) continue;
    const kind = payload.type;
    const explicitTurn = payload.turn_id ?? payload.turnId;
    if (line.type === "turn_context" || (line.type === "event_msg" && kind === "task_started")) {
      turnId = explicitTurn;
      progress.activeTurnId = typeof turnId === "string" ? turnId : null;
      progress.activityEvidence = null;
    }

    if (line.type === "turn_context" || (line.type === "event_msg" && kind === "task_started")) turnId = payload.turn_id ?? payload.turnId;
    if (line.type === "event_msg") {
      if (kind === "task_started") { progress.turnStatus = "inProgress"; progress.activity = "thinking"; }
      if (kind === "task_complete" || kind === "task_completed") progress.turnStatus = "completed";
      if (kind === "turn_aborted") progress.turnStatus = "interrupted";
      if (kind === "task_failed" || kind === "turn_failed") progress.turnStatus = "failed";
      if (["task_complete", "task_completed", "turn_aborted", "task_failed", "turn_failed"].includes(String(kind))) {
        const status = progress.turnStatus as "completed" | "failed" | "interrupted";
        progress.lastTurn = makeLastTurn(payload.turn_id ?? payload.turnId ?? turnId, status,
          status === "completed" ? "ok" : status === "interrupted" ? "cancelled" : codexReason(payload.error), line.timestamp, progress.lastTurn ?? previous);
      }
      if (kind === "agent_message") progress.activity = "outputting";
      if (kind === "item_started" || kind === "item_completed") {
        const item = payload.item as { type?: string } | undefined;
        const type = typeof item?.type === "string" ? item.type.toLowerCase() : undefined;
        if (type === "reasoning") progress.activity = "thinking";
        else if (type === "agentmessage") progress.activity = "outputting";
        else if (type && /command|tool|filechange|websearch/.test(type)) progress.activity = "working";
      }
    }
    if (line.type === "response_item") {
      if (kind === "reasoning") progress.activity = "thinking";
      if (kind === "message" && payload.role === "assistant") progress.activity = "outputting";
      if (kind === "function_call" || kind === "custom_tool_call" || kind === "web_search_call") progress.activity = "working";
    }
    const item = payload.item as { type?: string } | undefined;
    const evidenceKind = line.type === "event_msg" && kind === "item_started" ? itemActivity(item?.type)
      : line.type === "event_msg" && kind === "agent_message" ? "outputting"
      : line.type === "response_item" && kind === "reasoning" ? "thinking"
      : line.type === "response_item" && kind === "message" && payload.role === "assistant" ? "outputting"
      : line.type === "response_item" && ["function_call", "custom_tool_call", "web_search_call"].includes(String(kind)) ? "working" : null;
    if (evidenceKind) {
      progress.activityEvidence = activityEvidence(evidenceKind, explicitTurn ?? turnId);
      if (progress.activityEvidence) progress.activeTurnId = progress.activityEvidence.turnId;
    }
    if (line.type === "event_msg" && kind === "item_completed") progress.activityEvidence = null;
  }
  if (progress.turnStatus && progress.turnStatus !== "inProgress") { progress.activity = undefined; progress.activityEvidence = null; progress.activeTurnId = null; }
  return progress;
}
