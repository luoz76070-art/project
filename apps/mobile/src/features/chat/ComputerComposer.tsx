import type { ReactNode } from "react";
import { ArrowUp, CircleStop, Loader2, Plus } from "lucide-react";

/** Presentation is shared; each channel still owns admission and delivery. */
export function ComputerComposer({ draft, onDraft, onSend, onStop, onUpload, voice, status, statusTitle, placeholder,
  disabled = false, uploading = false, uploadDisabled = disabled, busy = false, running = false, hasContent, canSend, canStop = false,
  deliveries, label = "消息", maxLength,
}: {
  draft: string; onDraft: (text: string) => void; onSend: (delivery?: "steer" | "queue") => void;
  onStop: () => void; onUpload: () => void; voice: ReactNode; status: ReactNode; statusTitle?: string; placeholder: string;
  disabled?: boolean; uploading?: boolean; uploadDisabled?: boolean; busy?: boolean; running?: boolean; hasContent: boolean;
  canSend: boolean; canStop?: boolean; deliveries?: { steer: boolean; queue: boolean };
  label?: string; maxLength?: number;
}) {
  return <div className="composer">
    <textarea aria-label={label} rows={2} value={draft} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
      onInput={event => { const element = event.currentTarget; element.style.height = "auto"; element.style.height = `${Math.min(152, element.scrollHeight)}px`; }}
      onChange={event => onDraft(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (canSend) onSend(); }
      }} />
    <div className="composer-toolbar">
      <button type="button" className="composer-tool-button" onClick={onUpload} disabled={uploading || uploadDisabled} aria-label="上传文件">
        {uploading ? <Loader2 size={18} className="spin" /> : <Plus size={21} />}
      </button>
      <span className="composer-mode" role="status" aria-live="polite" title={statusTitle ?? (typeof status === "string" ? status : undefined)}>
        {running && <span className="composer-activity-dot" aria-hidden="true" />}<span>{status}</span>
      </span>
      {running && hasContent && <button type="button" className="composer-tool-button" onClick={onStop} disabled={!canStop || busy} aria-label="停止生成"><CircleStop size={20} /></button>}
      {voice}
      {running && hasContent && deliveries ? <div className="composer-delivery" role="group" aria-label="提交运行中消息">
        <button type="button" onClick={() => onSend("steer")} disabled={!deliveries.steer || busy} aria-label="引导发送" title={deliveries.steer ? "发送引导，加入当前任务" : "此会话当前不支持引导"}>引导</button>
        <button type="button" className="composer-queue-send" onClick={() => onSend("queue")} disabled={!deliveries.queue || busy} aria-label="排队发送" title="排队发送，当前任务结束后执行">排队<ArrowUp size={16} aria-hidden="true" /></button>
      </div> : running && !hasContent ? <button type="button" className="send-button" onClick={onStop} disabled={!canStop || busy} aria-label="停止生成"><CircleStop size={22} /></button>
        : <button type="button" className="send-button" onClick={() => onSend()} disabled={!canSend || busy} aria-label={running ? "发送引导" : "发送"}>
          {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={21} />}
        </button>}
    </div>
  </div>;
}
