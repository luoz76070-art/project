import type { SessionRange } from "./model";

export function SessionRangeControl({ range, disabled, onChange }: { range: SessionRange; disabled: boolean; onChange: (range: SessionRange) => void }) {
  return <div className="session-range-control">
    <p className="setting-description">{range === "recent" ? "近 30 天 · 按项目归类" : "全部时间 · 按需加载更早会话"}</p>
    <button className="history-button" disabled={disabled} onClick={() => onChange(range === "recent" ? "all" : "recent")}>{range === "recent" ? "查看更早会话" : "只看近 30 天"}</button>
  </div>;
}
