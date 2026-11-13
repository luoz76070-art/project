import { z } from "zod";
import type { LastTurn, LastTurnStatus } from "../../../../shared/lastTurn.js";
export type { LastTurn, LastTurnStatus } from "../../../../shared/lastTurn.js";

export const turnReasons = {
  ok: "本轮已完成。",
  cancelled: "本轮已中断。",
  provider_error: "本轮执行失败，请在电脑端查看详情。",
  model_unavailable: "模型暂不可用，请稍后重试或在电脑端切换模型。",
  invalid_request: "模型服务拒绝了本次请求，请检查模型配置。",
  transport_error: "模型服务连接失败，请检查网络与服务。",
  timeout: "模型服务响应超时。",
  rate_limited: "模型服务请求受限，请稍后重试。",
  token_limit: "本轮已达到上下文或输出限制，未正常完成。",
  blocked: "本轮被阻止，未正常完成。",
  engine_exited: "执行引擎已退出，本轮未正常完成。",
} as const;
export type TurnReasonCode = keyof typeof turnReasons;

export function isTurnStatus(value: unknown): value is LastTurnStatus {
  return value === "completed" || value === "failed" || value === "interrupted";
}

export function makeLastTurn(turnId: unknown, status: LastTurnStatus, code: TurnReasonCode,
  endedAt?: unknown, previous?: LastTurn | null): LastTurn | null {
  if (typeof turnId !== "string" || !turnId.length || turnId.length > 512) return null;
  const time = typeof endedAt === "string" ? Date.parse(endedAt) : typeof endedAt === "number" ? endedAt : NaN;
  const provided = Number.isFinite(time) && time >= 0 && time <= 8.64e15;
  // Keep duplicates stable, but let an authoritative time refine an observation.
  if (previous?.turnId === turnId && previous.status === status && previous.reason.code === code
    && (previous.timeSource === "provider" || !provided)) return previous;
  return { turnId, status, reason: { code, message: turnReasons[code] },
    endedAt: new Date(provided ? time : Date.now()).toISOString(), timeSource: provided ? "provider" : "observed" };
}

export function codexReason(error: unknown): TurnReasonCode {
  const info = error && typeof error === "object" ? (error as Record<string, unknown>).codexErrorInfo : null;
  const kind = typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] : null;
  if (kind === "contextWindowExceeded") return "token_limit";
  if (kind === "usageLimitExceeded") return "rate_limited";
  if (kind === "serverOverloaded") return "model_unavailable";
  if (kind === "badRequest" || kind === "unauthorized") return "invalid_request";
  if (kind === "cyberPolicy" || kind === "sandboxError") return "blocked";
  if (kind && /^(httpConnectionFailed|responseStreamConnectionFailed|responseStreamDisconnected)$/.test(kind)) return "transport_error";
  return "provider_error";
}

export function codexLastTurn(value: unknown, previous?: LastTurn | null): LastTurn | null {
  if (!value || typeof value !== "object") return null;
  const turn = value as Record<string, unknown>;
  if (!isTurnStatus(turn.status)) return null;
  const code = turn.status === "completed" ? "ok" : turn.status === "interrupted" ? "cancelled" : codexReason(turn.error);
  const endedAt = typeof turn.completedAtMs === "number" ? turn.completedAtMs
    : typeof turn.completedAt === "number" ? turn.completedAt * 1000 : undefined;
  return makeLastTurn(turn.turnId ?? turn.id, turn.status, code, endedAt, previous);
}

/** One result per session, bounded to 128 sessions; no disk or host recovery. */
export class LastTurnCache {
  private readonly results = new Map<string, { result: LastTurn | null; generation?: string }>();
  get(key: string, generation?: string) {
    const entry = this.results.get(key);
    return entry && entry.generation === generation ? entry.result : null;
  }
  set(key: string, result: LastTurn | null, generation?: string) {
    this.results.delete(key);
    this.results.set(key, { result, generation });
    while (this.results.size > 128) this.results.delete(this.results.keys().next().value!);
    return result;
  }
  clear() { this.results.clear(); }
}

export const lastTurnSchema = z.object({
  turnId: z.string().min(1).max(512), status: z.enum(["completed", "failed", "interrupted"]),
  reason: z.object({ code: z.enum(Object.keys(turnReasons) as [TurnReasonCode, ...TurnReasonCode[]]), message: z.string().max(512) }),
  endedAt: z.string().datetime(), timeSource: z.enum(["provider", "observed"]),
}).transform(value => ({ ...value, reason: { code: value.reason.code, message: turnReasons[value.reason.code] } }));
