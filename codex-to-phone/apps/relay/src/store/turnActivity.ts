export type TurnProgress = {
  turnStatus?: "inProgress" | "completed" | "interrupted" | "failed";
  activity?: "thinking" | "working" | "outputting";
};

/** Project lifecycle and public work phases, never reasoning text or tool arguments. */
export function turnProgress(records: Array<{ value: unknown }>): TurnProgress {
  const progress: TurnProgress = {};
  for (const { value } of records) {
    if (!value || typeof value !== "object") continue;
    const line = value as { type?: string; payload?: Record<string, unknown> };
    const payload = line.payload;
    if (!payload) continue;
    const kind = payload.type;
    if (line.type === "event_msg") {
      if (kind === "task_started") { progress.turnStatus = "inProgress"; progress.activity = "thinking"; }
      if (kind === "task_complete" || kind === "task_completed") progress.turnStatus = "completed";
      if (kind === "turn_aborted") progress.turnStatus = "interrupted";
      if (kind === "task_failed" || kind === "turn_failed") progress.turnStatus = "failed";
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
  }
  if (progress.turnStatus && progress.turnStatus !== "inProgress") progress.activity = undefined;
  return progress;
}
