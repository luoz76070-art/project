import { useRef, useState } from "react";
import type { AgentSessionSnapshot } from "./types";

type QueueItem = NonNullable<AgentSessionSnapshot["queue"]>["items"][number];

export function AgentQueue({ queue, disabled, onCancel }: {
  queue: NonNullable<AgentSessionSnapshot["queue"]>; disabled: boolean; onCancel: (id: string) => Promise<boolean>;
}) {
  if (!queue.items.length) return null;
  return <details className="agent-queue">
    <summary>待发 {queue.items.length} 条 · {queue.items.some(item => item.status === "uncertain") ? "取消结果待确认" : queue.items.some(item => item.status === "paused") ? "等待电脑继续" : "当前任务结束后处理"}</summary>
    {queue.items.map(item => <QueuedInput key={item.clientMessageId} item={item} disabled={disabled || !queue.available} onCancel={onCancel} />)}
  </details>;
}

function QueuedInput({ item, disabled, onCancel }: { item: QueueItem; disabled: boolean; onCancel: (id: string) => Promise<boolean> }) {
  const [sent, setSent] = useState(false), lockedRef = useRef(false);
  const pending = sent || item.status === "cancelling" || item.status === "uncertain";
  return <div className="agent-queue-item">
    <p>{item.text}</p>
    <button type="button" className="action-button" disabled={disabled || pending} onClick={() => {
      if (disabled || pending || lockedRef.current) return;
      lockedRef.current = true; setSent(true);
      void onCancel(item.clientMessageId).then(accepted => { if (!accepted) { lockedRef.current = false; setSent(false); } });
    }}>取消待发</button>
    {pending && <small role="status">{item.status === "uncertain" ? "取消结果待确认，请勿重复操作。" : "正在核对取消结果…"}</small>}
  </div>;
}
