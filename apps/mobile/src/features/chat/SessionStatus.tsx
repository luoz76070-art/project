import { roleClass } from "./messages";
import type { SessionStatus as Status } from "./sessionStatusModel";

/** Presentation only: U2 can change the placement/skin without changing inference. */
export function SessionStatus({ status, variant = "inline", previous = false, anchorRole = "assistant" }: {
  status: Status | null; variant?: "inline" | "notice" | "composer"; previous?: boolean; anchorRole?: string;
}) {
  if (!status) return null;
  const result = status.result;
  const label = `${previous ? "上轮" : ""}${status.label}`;
  if (variant === "composer") return <span data-session-status={status.kind} title={status.detail}>{label}</span>;
  if (variant === "notice") return <p className="connection-notice turn-result-notice" role="status" data-session-status={status.kind} data-turn-result={result?.status}>
    <strong>{label}</strong>{status.detail && <> · {status.detail}</>}{result && <> <time dateTime={result.endedAt}>{new Date(result.endedAt).toLocaleString("zh-CN", { hour12: false })}{result.timeSource === "observed" ? "（记录时间）" : ""}</time></>}
  </p>;
  const tone = status.kind === "waiting" ? "approval" : status.kind === "executing" ? "outputting" : "thinking";
  return <div className={`generation-status ${tone} ${roleClass(anchorRole)}`} role="status" aria-live="polite" data-session-status={status.kind}>
    {!result && <span className="generation-dots" aria-hidden="true"><i /><i /><i /></span>}
    <span><strong>{label}</strong>{status.detail && <em>{status.detail}</em>}</span>
  </div>;
}
