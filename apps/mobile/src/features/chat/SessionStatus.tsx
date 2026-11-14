import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleStop } from "lucide-react";
import type { LastTurn } from "./lastTurn";
import { resultStatus } from "./sessionStatusModel";
import { roleClass } from "./messages";
import type { SessionStatus as Status } from "./sessionStatusModel";

/** Shared status presentation; inference remains in sessionStatusModel. */
export function SessionStatus({ status, variant = "inline", previous = false, anchorRole = "assistant" }: {
  status: Status | null; variant?: "inline" | "notice" | "composer"; previous?: boolean; anchorRole?: string;
}) {
  if (!status) return null;
  const result = status.result;
  const label = `${previous ? "上轮" : ""}${status.label}`;
  if (variant === "composer") return <span className="session-status-text" data-session-status={status.kind} data-turn-result={result?.status} title={status.detail}>
    {result ? status.kind === "failed" ? <AlertCircle size={14} aria-hidden="true" /> : status.kind === "interrupted" ? <CircleStop size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" /> : <span className="session-status-dot" aria-hidden="true" />}
    <span><strong>{label}</strong>{status.detail && <> · {status.detail}</>}{result && <> <time dateTime={result.endedAt}>{new Date(result.endedAt).toLocaleString("zh-CN", { hour12: false })}{result.timeSource === "observed" ? "（记录时间）" : ""}</time></>}</span>
  </span>;
  if (variant === "notice") return <p className="connection-notice turn-result-notice" role="status" data-session-status={status.kind} data-turn-result={result?.status}>
    <strong>{label}</strong>{status.detail && <> · {status.detail}</>}{result && <> <time dateTime={result.endedAt}>{new Date(result.endedAt).toLocaleString("zh-CN", { hour12: false })}{result.timeSource === "observed" ? "（记录时间）" : ""}</time></>}
  </p>;
  const tone = status.kind === "waiting" ? "approval" : status.kind === "executing" ? "outputting" : "thinking";
  return <div className={`generation-status ${tone} ${roleClass(anchorRole)}`} role="status" aria-live="polite" data-session-status={status.kind}>
    {!result && <span className="generation-dots" aria-hidden="true"><i /><i /><i /></span>}
    <span><strong>{label}</strong>{status.detail && <em>{status.detail}</em>}</span>
  </div>;
}

/** Keep S2's previous-result visibility without repeating the current terminal result. */
export function ComposerSessionStatus({ status, lastTurn, running = false, fallback, feedback }: {
  status: Status | null; lastTurn?: LastTurn | null; running?: boolean; fallback: ReactNode; feedback?: string;
}) {
  const last = resultStatus(lastTurn);
  const current = status ?? (!running ? last : null);
  const previous = last && last.result?.turnId !== current?.result?.turnId ? last : null;
  return <>
    {current ? <SessionStatus status={current} variant="composer" /> : <span>{fallback}</span>}
    {previous && <SessionStatus status={previous} variant="composer" previous={running} />}
    {feedback && <span>{feedback}</span>}
  </>;
}
