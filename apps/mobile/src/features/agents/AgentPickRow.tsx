import { AgentIcon } from "./AgentIcon";
import { agentStatusLabels, summaryLine, type AgentSummary } from "./agentSummary";

/** U13: one Agent in the picker — icon, name, online status, session count and last activity. */
export function AgentPickRow({ id, label, description, summary, recentOnly = false, now, onOpen }: {
  id: string; label: string; description: string; summary: AgentSummary | undefined; recentOnly?: boolean; now?: number; onOpen: () => void;
}) {
  const status = summary?.status ?? "checking", meta = summaryLine(summary, recentOnly, now);
  return <button type="button" className="agent-session-row agent-pick-row" onClick={onOpen}>
    <span className="agent-glyph"><AgentIcon id={id} size={20} /></span>
    <span className="agent-pick-text">
      <span className="agent-pick-title"><strong>{label}</strong><span className={`agent-pick-status ${status}`}>{agentStatusLabels[status]}</span></span>
      <small>{description}</small>
      {meta && <small className="agent-pick-meta">{meta.split(" · ").flatMap((part, index) => [...(index ? [" · "] : []), <span key={part}>{part}</span>])}</small>}
    </span>
  </button>;
}
