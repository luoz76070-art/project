import { useState, useEffect } from "react";
import { takeSmoothChunk, roleClass, isToolMessage, roleLabel, summarizeToolMessage, toolRawText } from "./messages";
import { smoothTextFrameMs } from "../../app/config";
import { type PendingAttachment, type CodexMessage, type LiveApproval, type LiveApprovalDecision } from "../../app/types";
import { formatFileSize, isImageAttachment, parseMessageAttachments } from "./attachments";
import { X, ImageIcon, Paperclip, Copy, AlertCircle, Terminal, CheckCircle2, CircleStop } from "lucide-react";
import { MessageContent } from "./MessageContent";
import { formatTime } from "../../shared/format";

export function SmoothText({ text, active, pending, onDone }: { text: string; active: boolean; pending: boolean; onDone?: () => void }) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [displayed, setDisplayed] = useState(active && !reducedMotion ? "" : text);
  useEffect(() => {
    if (!active || reducedMotion || !text.startsWith(displayed)) { setDisplayed(text); return; }
    if (displayed === text || document.hidden) return;
    const timer = window.setTimeout(() => setDisplayed(current => current + takeSmoothChunk(text.slice(current.length))), smoothTextFrameMs);
    return () => window.clearTimeout(timer);
  }, [text, active, displayed, reducedMotion]);
  useEffect(() => {
    if (active && !pending && (reducedMotion || displayed === text)) onDone?.();
  }, [active, pending, displayed, text, reducedMotion, onDone]);
  return <MessageContent text={!active || reducedMotion ? text : displayed} />;
}

export function GenerationStatus({
  label,
  detail,
  tone,
  anchorRole,
}: {
  label: string;
  detail: string;
  tone: "thinking" | "outputting" | "approval";
  anchorRole: string;
}) {
  return (
    <div className={`generation-status ${tone} ${roleClass(anchorRole)}`} role="status" aria-live="polite">
      <span className="generation-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>{label}</strong>
        {detail && <em>{detail}</em>}
      </span>
    </div>
  );
}

export function AttachmentTray({ attachments, onRemove }: { attachments: PendingAttachment[]; onRemove: (id: string) => void }) {
  return (
    <div className="attachment-tray" aria-label="待发送附件">
      {attachments.map((attachment) => (
        <div className="attachment-chip" key={attachment.id}>
          <AttachmentPreview attachment={attachment} />
          <span>
            <strong>{attachment.fileName}</strong>
            <em>{formatFileSize(attachment.size)}</em>
          </span>
          <button onClick={() => onRemove(attachment.id)} aria-label={`移除 ${attachment.fileName}`}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function MessageAttachments({ attachments }: { attachments: PendingAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="message-attachments" aria-label="消息附件">
      {attachments.map((attachment) => (
        <div className="message-attachment" key={`${attachment.path}-${attachment.fileName}`}>
          <AttachmentPreview attachment={attachment} />
          <span>
            <strong>{attachment.fileName}</strong>
            <em>{formatFileSize(attachment.size)}</em>
          </span>
        </div>
      ))}
    </div>
  );
}

export function AttachmentPreview({ attachment }: { attachment: PendingAttachment }) {
  if (isImageAttachment(attachment) && attachment.previewUrl) {
    return <img className="attachment-thumb" src={attachment.previewUrl} alt={attachment.fileName} />;
  }
  return (
    <span className="attachment-thumb file">
      {isImageAttachment(attachment) ? <ImageIcon size={18} /> : <Paperclip size={18} />}
    </span>
  );
}

export function MessageBubble({
  message,
  smooth,
  smoothPending,
  onSmoothDone,
  onCopy,
}: {
  message: CodexMessage;
  smooth: boolean;
  smoothPending: boolean;
  onSmoothDone: () => void;
  onCopy: () => void;
}) {
  if (isToolMessage(message)) return <ToolMessageBubble message={message} onCopy={onCopy} />;
  const parsed = parseMessageAttachments(message);

  return (
    <article className={`message-bubble ${roleClass(message.role)}`}>
      {parsed.text && (message.role === "assistant"
        ? <SmoothText text={parsed.text} active={smooth} pending={smoothPending} onDone={onSmoothDone} />
        : <p className="user-message-text">{parsed.text}</p>)}
      <MessageAttachments attachments={parsed.attachments} />
      <footer className="message-actions">
        <button className="copy-icon" onClick={onCopy} aria-label={`复制${roleLabel(message.role)}消息`}><Copy size={15} /></button>
        <time>{formatTime(message.timestamp)}</time>
      </footer>
    </article>
  );
}

export function ToolMessageBubble({ message, onCopy }: { message: CodexMessage; onCopy: () => void }) {
  const summary = summarizeToolMessage(message);
  const rawText = toolRawText(message);
  const hasRawText = rawText.trim().length > 0;
  return (
    <details className={`tool-message ${summary.failed ? "failed" : ""} ${hasRawText ? "" : "no-raw"}`} open={summary.failed || !hasRawText}>
      <summary>
        <span>
          {summary.failed ? <AlertCircle size={15} /> : <Terminal size={15} />}
          <strong>{summary.title}</strong>
          <em>{summary.action}</em>
        </span>
        <time>{formatTime(message.timestamp)}</time>
      </summary>
      <div className="tool-summary">
        <strong>{summary.action}</strong>
        <span>{summary.detail || "没有可展示的原始输出"}</span>
      </div>
      {hasRawText && <pre>{rawText}</pre>}
      {hasRawText && (
        <button className="copy-mini" onClick={onCopy}>
          <Copy size={14} />
          <span>复制原始输出</span>
        </button>
      )}
    </details>
  );
}

export function ApprovalCard({ approval, onRespond }: { approval: LiveApproval; onRespond: (decision: LiveApprovalDecision) => void }) {
  const allowSession = approval.availableDecisions.includes("acceptForSession");
  return (
    <article className={`approval-card ${approval.kind}`}>
      <header>
        <span>
          <AlertCircle size={15} />
          {approval.title}
        </span>
        <em>{formatTime(approval.createdAt)}</em>
      </header>
      <p>{approval.detail}</p>
      {approval.command && <pre>{approval.command}</pre>}
      {approval.cwd && <small>{approval.cwd}</small>}
      <div className="approval-actions">
        {approval.availableDecisions.includes("accept") && (
          <button className="accept" onClick={() => onRespond("accept")}>
            <CheckCircle2 size={14} />
            <span>允许一次</span>
          </button>
        )}
        {allowSession && (
          <button className="accept" onClick={() => onRespond("acceptForSession")}>
            <CheckCircle2 size={14} />
            <span>本会话允许</span>
          </button>
        )}
        {approval.availableDecisions.includes("decline") && (
          <button onClick={() => onRespond("decline")}>
            <X size={14} />
            <span>拒绝</span>
          </button>
        )}
        {approval.availableDecisions.includes("cancel") && (
          <button onClick={() => onRespond("cancel")}>
            <CircleStop size={14} />
            <span>取消</span>
          </button>
        )}
      </div>
    </article>
  );
}
