import { validLastTurn, type LastTurn } from "./lastTurn";

/** S1's passive result notice; ongoing execution states remain in their existing UI. */
export function TurnResultNotice({ result, running = false }: { result?: LastTurn | null; running?: boolean }) {
  if (!validLastTurn(result)) return null;
  const label = { completed: "已完成", failed: "执行失败", interrupted: "已中断" }[result.status];
  return <p className="connection-notice turn-result-notice" role="status" data-turn-result={result.status}>
    <strong>{running ? "上轮" : "本轮"}{label}</strong> · {result.reason.message}{" "}
    <time dateTime={result.endedAt}>{new Date(result.endedAt).toLocaleString("zh-CN", { hour12: false })}{result.timeSource === "observed" ? "（记录时间）" : ""}</time>
  </p>;
}
