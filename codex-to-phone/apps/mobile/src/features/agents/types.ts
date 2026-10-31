import type { CodexMessage } from "../../app/types";

export type AgentSession = { id: string; title: string; directory: string; updatedAt: string };
export type AgentQuestion = {
  id: string; status: "pending" | "submitted" | "uncertain";
  unavailableReason?: string | null;
  questions: { question: string; header: string; options: { label: string; description: string }[]; multiple: boolean; custom: boolean }[];
};
export type AgentPermission = {
  id: string; status: "pending" | "submitted" | "uncertain"; action: string; resources: string[]; save: string[];
  detail: string; unavailableReason: string | null; decisions: ("once" | "always" | "reject")[];
};
export type AgentSessionSnapshot = {
  agentId: string; session: AgentSession; connected: boolean; updatedAt: string;
  status: "idle" | "running"; activity: "thinking" | "working" | "outputting";
  messages: CodexMessage[]; questions: AgentQuestion[]; permissions: AgentPermission[]; historyCursor: string | null;
  partialText: boolean;
  queue?: { available: boolean; items: { clientMessageId: string; text: string; status: "waiting" | "paused" | "cancelling" | "uncertain" }[] };
  operationError?: { clientMessageId: string; code: "rejected" | "expired" } | null;
  control: { token: string; canSend: boolean; canSteer: boolean; canInterrupt: boolean } | null;
  submission: { clientMessageId: string; action: "message" | "interrupt"; delivery: "submitted" | "confirmed" | "uncertain" } | null;
};
export type AgentDelivery = { delivery: "submitted" | "confirmed" | "uncertain" };
