import type { ActivityEvidence } from "../../../../../shared/activityEvidence";
import type { ThreadRuntime } from "../../app/types";
import type { AgentSessionSnapshot } from "../agents/types";
import { validLastTurn, type LastTurn } from "./lastTurn";
export type { ActivityEvidence };

export type SessionStatusKind = "preparing" | "thinking" | "executing" | "waiting" | "completed" | "failed" | "interrupted";
export const sessionStatusLabels: Record<SessionStatusKind, string> = {
  preparing: "准备中", thinking: "思考中", executing: "执行中", waiting: "等待", completed: "完成", failed: "失败", interrupted: "中断",
};
export type SessionStatus = { kind: SessionStatusKind; label: string; detail: string; result?: LastTurn };
export type SessionStatusInput = {
  phase: "starting" | "running" | "idle" | "unknown";
  online: boolean;
  turnId?: string | null;
  activityEvidence?: ActivityEvidence | null;
  approvals: ReadonlyArray<{ status: string }>;
  questions: ReadonlyArray<{ status: string }>;
  lastTurn?: LastTurn | null;
};

/** Decode a bounded whitelist; never forward arbitrary observation fields to UI. */
export function readActivityEvidence(value: unknown): ActivityEvidence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as ActivityEvidence;
  if (!["thinking", "working", "outputting"].includes(v.kind) || typeof v.turnId !== "string" || !v.turnId.length || v.turnId.length > 512
    || typeof v.observedAt !== "string" || v.observedAt.length > 32 || !Number.isFinite(Date.parse(v.observedAt))) return null;
  return { kind: v.kind, turnId: v.turnId, observedAt: v.observedAt };
}
export function resultStatus(result: unknown): SessionStatus | null {
  return validLastTurn(result) ? { kind: result.status, label: sessionStatusLabels[result.status], detail: result.reason.message, result } : null;
}
export function deriveSessionStatus(input: SessionStatusInput): SessionStatus | null {
  const active = input.phase === "starting" || input.phase === "running";
  const result = resultStatus(input.lastTurn);
  // A terminal result for this exact turn supersedes stale active observations.
  if (result && input.turnId && result.result?.turnId === input.turnId) return result;
  if (!input.online) return active || input.phase === "unknown" ? null : result;
  const approval = input.approvals.some(r => r.status === "pending"), question = input.questions.some(r => r.status === "pending");
  if (approval || question) return { kind: "waiting", label: sessionStatusLabels.waiting, detail: approval && question ? "等待审批和回答" : approval ? "等待审批" : "等待你回答" };
  if (input.phase === "starting") return { kind: "preparing", label: sessionStatusLabels.preparing, detail: "正在启动本轮" };
  if (active) {
    // Delivery receipts are not a resumed activity signal.
    if ([...input.approvals, ...input.questions].some(r => ["submitting", "submitted", "uncertain"].includes(r.status))) return null;
    const evidence = readActivityEvidence(input.activityEvidence);
    if (!evidence || !input.turnId || evidence.turnId !== input.turnId) return null;
    const kind = evidence.kind === "thinking" ? "thinking" : "executing";
    return { kind, label: sessionStatusLabels[kind], detail: evidence.kind === "outputting" ? "正在输出" : evidence.kind === "working" ? "正在执行操作" : "正在处理当前请求" };
  }
  return input.phase === "idle" ? result : null;
}
export function codexSessionStatus(runtime: ThreadRuntime, online: boolean): SessionStatus | null {
  return deriveSessionStatus({ online: online && runtime.sourceConnected !== false, turnId: runtime.statusTurnId,
    phase: runtime.turnStatus === "starting" ? "starting" : runtime.turnStatus === "inProgress" ? "running" : ["idle", "completed", "failed", "interrupted"].includes(runtime.turnStatus) ? "idle" : "unknown",
    activityEvidence: runtime.activityEvidence, approvals: runtime.approvals, questions: runtime.userInputs ?? [], lastTurn: runtime.lastTurn });
}
export function agentSessionStatus(snapshot: AgentSessionSnapshot | null, online: boolean): SessionStatus | null {
  if (!snapshot) return null;
  return deriveSessionStatus({ online: online && snapshot.connected, turnId: snapshot.activeTurnId,
    phase: snapshot.status === "running" ? "running" : snapshot.status === "idle" ? "idle" : "unknown",
    activityEvidence: snapshot.activityEvidence, approvals: snapshot.permissions, questions: snapshot.questions, lastTurn: snapshot.lastTurn });
}
export function isActiveSessionStatus(status: SessionStatus | null): status is SessionStatus {
  return Boolean(status && !status.result);
}
