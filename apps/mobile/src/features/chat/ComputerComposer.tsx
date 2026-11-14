import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowUp, CircleStop, Loader2, Plus } from "lucide-react";
import { haptic } from "../../shared/haptics";

/** Grow the textarea with its content, and shrink it back when the draft is cleared after sending. */
function fitHeight(element: HTMLTextAreaElement | null) {
  if (!element) return;
  // An empty draft stays one line even when a long placeholder would wrap at large text sizes.
  if (!element.value) { element.style.height = ""; return; }
  element.style.height = "auto";
  element.style.height = `${Math.min(152, element.scrollHeight)}px`;
}

/**
 * Presentation is shared; each channel still owns admission and delivery.
 * U5: one capsule row — attach, text, voice, send. With nothing to send the voice key is the primary
 * action and the send key is hidden; once there is content, send takes the brand fill.
 */
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
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => fitHeight(input.current), [draft]);
  const showSend = hasContent || running;
  return <>
    <div className="composer-status-bar" role="group" aria-label="会话状态与控制">
      <div className="composer-status-copy" role="status" aria-live="polite" title={statusTitle ?? (typeof status === "string" ? status : undefined)}>{status}</div>
      {running && <button type="button" className="composer-stop" onClick={onStop} disabled={!canStop || busy} aria-label="停止生成"><CircleStop size={18} aria-hidden="true" /><span>停止</span></button>}
    </div>
    <div className="composer" data-empty={!hasContent || undefined}>
      <button type="button" className="composer-tool-button" onClick={onUpload} disabled={uploading || uploadDisabled} aria-label="上传文件">
        {uploading ? <Loader2 size={18} className="spin" /> : <Plus size={21} />}
      </button>
      <textarea ref={input} aria-label={label} rows={1} value={draft} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
        onInput={event => fitHeight(event.currentTarget)}
        onChange={event => onDraft(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (canSend) onSend(); }
        }} />
      <div className="composer-toolbar">
        {voice}
        {running && hasContent && deliveries ? <div className="composer-delivery" role="group" aria-label="提交运行中消息">
          <button type="button" onClick={() => { haptic(); onSend("steer"); }} disabled={!deliveries.steer || busy} aria-label="引导发送" title={deliveries.steer ? "发送引导，加入当前任务" : "此会话当前不支持引导"}>引导</button>
          <button type="button" className="composer-queue-send" onClick={() => { haptic(); onSend("queue"); }} disabled={!deliveries.queue || busy} aria-label="排队发送" title="排队发送，当前任务结束后执行">排队<ArrowUp size={16} aria-hidden="true" /></button>
        </div> : running && !hasContent ? null
          : showSend && <button type="button" className="send-button" onClick={() => { haptic(); onSend(); }} disabled={!canSend || busy} aria-label={running ? "发送引导" : "发送"}>
            {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={21} />}
          </button>}
      </div>
    </div>
  </>;
}
