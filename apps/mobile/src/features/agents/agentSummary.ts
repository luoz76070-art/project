/** U13: what the Agent picker shows per Agent — reachability, how many sessions, when it was last active. */
export type AgentSummary = { status: "checking" | "online" | "offline"; count: number | null; more: boolean; updatedAt: string | null };

export const checkingSummary: AgentSummary = { status: "checking", count: null, more: false, updatedAt: null };
export const offlineSummary: AgentSummary = { status: "offline", count: null, more: false, updatedAt: null };
export const agentStatusLabels: Record<AgentSummary["status"], string> = { checking: "检测中", online: "在线", offline: "离线" };

export function summarizeSessions(sessions: { updatedAt: string }[], more: boolean): AgentSummary {
  let latest: string | null = null, latestTime = -Infinity;
  for (const session of sessions) {
    const time = Date.parse(session.updatedAt);
    if (Number.isFinite(time) && time > latestTime) { latest = session.updatedAt; latestTime = time; }
  }
  return { status: "online", count: sessions.length, more, updatedAt: latest };
}

export function relativeActivity(iso: string | null, now = Date.now()) {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return "";
  const minute = 60_000, hour = 60 * minute, day = 24 * hour, diff = Math.max(0, now - time);
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const date = new Date(time), sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
}

/** One line under the Agent name; `recentOnly` marks lists that only cover the last 30 days (DeepSeek). */
export function summaryLine(summary: AgentSummary | undefined, recentOnly = false, now = Date.now()) {
  if (!summary || summary.status === "checking") return "";
  if (summary.status === "offline") return "暂时连不上，点开查看原因";
  if (summary.count === null) return "";
  const scope = recentOnly ? "近 30 天" : "";
  if (summary.count === 0) return `${scope}还没有会话`;
  const count = `${scope ? `${scope} ` : ""}${summary.count}${summary.more ? "+" : ""} 个会话`;
  const when = relativeActivity(summary.updatedAt, now);
  return when ? `${count} · 最近活动 ${when}` : count;
}
