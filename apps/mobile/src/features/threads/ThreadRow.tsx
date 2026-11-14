import type { ThreadSummary } from "../../app/types";
import { formatDate } from "../../shared/format";
import { cleanTitle, sourceClass, threadSourceBadge, type SourceFilter } from "./model";

export function ThreadRow({ thread, selected, activeDesktop, sourceFilter, onOpen }: {
  thread: ThreadSummary; selected: boolean; activeDesktop: boolean; sourceFilter: SourceFilter; onOpen: () => void;
}) {
  const badge = threadSourceBadge(thread, sourceFilter);
  return <button className={`thread-row ${selected ? "active" : ""}`} onClick={onOpen}>
    <span className="thread-name">{cleanTitle(thread.threadName)}</span>
    <span className="thread-time">{formatDate(thread.updatedAt)}</span>
    {badge && <span className={`thread-source ${sourceClass(thread.source)}`}>{badge}</span>}
    {activeDesktop && <span className="live-chip">当前桌面</span>}
  </button>;
}
