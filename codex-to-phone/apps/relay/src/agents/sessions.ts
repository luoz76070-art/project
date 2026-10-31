export type AgentSession = { id: string; title: string; directory: string; updatedAt: string };
export type AgentMessage = { id: string; timestamp: string; role: string; text: string; kind: string; turnId?: string; phase?: "commentary" | "final_answer" };
export type AgentQuestion = {
  id: string; status: "pending" | "submitted" | "uncertain";
  unavailableReason?: string | null;
  questions: { question: string; header: string; options: { label: string; description: string }[]; multiple: boolean; custom: boolean }[];
};
export type AgentPermission = {
  id: string; status: "pending" | "submitted" | "uncertain";
  action: string; resources: string[]; save: string[]; detail: string; unavailableReason: string | null;
  decisions: ("once" | "always" | "reject")[];
};
export type AgentSessionSnapshot = {
  agentId: string; session: AgentSession; connected: boolean; updatedAt: string;
  status: "idle" | "running"; activity: "thinking" | "working" | "outputting";
  messages: AgentMessage[]; questions: AgentQuestion[]; permissions: AgentPermission[];
  historyCursor: string | null;
  partialText: boolean;
  queue?: { available: boolean; items: { clientMessageId: string; text: string; status: "waiting" | "paused" | "cancelling" | "uncertain" }[] };
  operationError?: { clientMessageId: string; code: "rejected" | "expired" } | null;
  control: { token: string; canSend: boolean; canSteer: boolean; canInterrupt: boolean } | null;
  submission: { clientMessageId: string; action: "message" | "interrupt"; delivery: "submitted" | "confirmed" | "uncertain" } | null;
};
export type AgentOperation = { controlToken: string; clientMessageId: string };
export type AgentDelivery = { ok: true; delivery: "submitted" | "confirmed" | "uncertain" };

/** Existing server sessions only. Explicit DeepSeek history sends may restore the original Agent inside its Host. */
export interface SessionAdapter {
  validSessionId(id: string): boolean;
  listSessions(search?: string, cursor?: string, range?: "recent" | "all"): Promise<{ sessions: AgentSession[]; cursor: string | null }>;
  readHistory(sessionId: string, cursor: string): Promise<{ messages: AgentMessage[]; cursor: string | null }>;
  watchSession(sessionId: string, onSnapshot: (snapshot: AgentSessionSnapshot) => void, onDisconnect: () => void): Promise<() => void>;
  sendMessage(sessionId: string, input: AgentOperation & { text: string; delivery: "steer" | "queue" }): Promise<AgentDelivery>;
  interruptSession(sessionId: string, input: AgentOperation): Promise<AgentDelivery>;
  cancelQueuedMessage?(sessionId: string, id: string, input: AgentOperation): Promise<AgentDelivery>;
  respondQuestion(sessionId: string, id: string, input: AgentOperation & { answers: string[][] }): Promise<AgentDelivery>;
  respondPermission(sessionId: string, id: string, input: AgentOperation & { decision: "once" | "always" | "reject" }): Promise<AgentDelivery>;
}

export function agentError(code: string, statusCode = 502) {
  return Object.assign(new Error(code), { code, statusCode });
}
