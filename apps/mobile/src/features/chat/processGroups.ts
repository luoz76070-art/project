import type { CodexMessage } from "../../app/types";

export type MessageGroup =
  | { kind: "message"; message: CodexMessage }
  | { kind: "process"; id: string; messages: CodexMessage[]; completed: boolean; turnId?: string };

const processToolKinds = new Set(["plan", "commandExecution", "fileChange", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output", "mcpToolCall", "webSearch", "task_started"]);
export function isProcessMessage(message: CodexMessage) {
  return (message.role === "assistant" && message.phase === "commentary") || (message.role === "tool" && processToolKinds.has(message.kind));
}

export function groupMessageProcesses(messages: CodexMessage[]): MessageGroup[] {
  const completed = new Set<string>();
  const finalTurns = new Set<string>();
  let followingFinal: CodexMessage | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      followingFinal = null;
    } else if (message.role === "assistant" && message.phase === "final_answer") {
      followingFinal = message;
      if (message.turnId) finalTurns.add(message.turnId);
    } else if (isProcessMessage(message)) {
      const sameTurn = message.turnId && finalTurns.has(message.turnId);
      const sameSegment = followingFinal && (!message.turnId || !followingFinal.turnId || message.turnId === followingFinal.turnId);
      if (sameTurn || sameSegment) completed.add(message.id);
    }
  }

  const groups: MessageGroup[] = [];
  for (const message of messages) {
    if (!isProcessMessage(message)) {
      groups.push({ kind: "message", message });
      continue;
    }
    const previous = groups[groups.length - 1];
    const isCompleted = completed.has(message.id);
    if (previous?.kind === "process" && previous.completed === isCompleted && (!previous.turnId || !message.turnId || previous.turnId === message.turnId)) {
      previous.messages.push(message);
      previous.turnId ??= message.turnId;
    } else {
      groups.push({ kind: "process", id: message.id, messages: [message], completed: isCompleted, turnId: message.turnId });
    }
  }
  return groups;
}
