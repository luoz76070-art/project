import { Fragment, useState, useEffect, useId, type ReactNode } from "react";
import { groupMessageProcesses } from "./processGroups";
import { messageDisplayKey } from "./messageReconciliation";
import { takeSmoothChunk, roleClass, isToolMessage, roleLabel, summarizeToolMessage, toolRawText } from "./messages";
import { smoothTextFrameMs } from "../../app/config";
import { type PendingAttachment, type CodexMessage, type LiveApproval, type LiveApprovalDecision } from "../../app/types";
import { formatFileSize, isImageAttachment, parseMessageAttachments } from "./attachments";
import { X, ImageIcon, Paperclip, Copy, AlertCircle, Terminal, CheckCircle2, CircleStop, ChevronRight, UserRound, Bot, Info, Loader2 } from "lucide-react";
import { haptic } from "../../shared/haptics";
import { useMessageInteraction } from "./useMessageInteraction";
import { commandRisks, diffLines, fileKindLabels } from "./approvalModel";
import { MessageContent } from "./MessageContent";
import { formatMessageTime, formatTime } from "../../shared/format";

export function SmoothText({ text, active, pending, onDone }: { text: string; active: boolean; pending: boolean; onDone?: () => void }) {
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  assistantLabel = "Codex",
  expandToolDetails = false,
  assistantContinuation = false,
}: {
  message: CodexMessage;
  smooth: boolean;
  smoothPending: boolean;
  onSmoothDone: () => void;
  onCopy: () => void | boolean | Promise<void | boolean>;
  assistantContinuation?: boolean;
  assistantLabel?: string;
  expandToolDetails?: boolean;
}) {
  const interaction = useMessageInteraction(message.id, onCopy);
  if (isToolMessage(message)) return <ToolMessageBubble message={message} onCopy={() => void interaction.copy()} copyFeedback={interaction.feedback} expanded={expandToolDetails} />;
  const parsed = parseMessageAttachments(message);

  return (
    <article className={`message-bubble ${roleClass(message.role)}${assistantContinuation ? " assistant-continuation" : ""}`} data-message-id={message.id} data-message-role={message.role}
      tabIndex={0} aria-label={`${message.role === "assistant" ? assistantLabel : roleLabel(message.role)}消息，聚焦查看时间和复制`} {...interaction.handlers}>
      {!assistantContinuation && <header className="message-identity">
        <span className="message-avatar" aria-hidden="true">{message.role === "user" ? <UserRound size={16} /> : message.role === "assistant" ? <Bot size={16} /> : <Info size={16} />}</span>
        <span className="message-author"><strong>{message.role === "assistant" ? assistantLabel : roleLabel(message.role)}</strong></span>
      </header>}
      {parsed.text && (message.role === "assistant"
        ? <SmoothText text={parsed.text} active={smooth} pending={smoothPending} onDone={onSmoothDone} />
        : <p className={message.role === "user" ? "user-message-text" : "system-message-text"}>{parsed.text}</p>)}
      <MessageAttachments attachments={parsed.attachments} />
      {interaction.revealed && <div className="message-meta">
        <time dateTime={message.timestamp ?? undefined}>{formatMessageTime(message.timestamp)}</time>
        <button type="button" className="copy-icon" onClick={() => void interaction.copy()} aria-label={`复制${message.role === "assistant" ? assistantLabel : roleLabel(message.role)}消息`}><Copy size={16} /></button>
      </div>}
      <span className="message-copy-feedback" role="status" aria-live="polite">{interaction.feedback}</span>
    </article>
  );
}

type RenderMessage = (message: CodexMessage, expandToolDetails?: boolean, assistantContinuation?: boolean) => ReactNode;

export function MessageTimeline({ messages, renderMessage, running = false }: { messages: CodexMessage[]; renderMessage: RenderMessage; running?: boolean }) {
  const keyCounts = new Map<string, number>();
  for (const message of messages) {
    const key = messageDisplayKey(message);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  // Tools keep the current turn's assistant identity; untagged prose uses adjacency.
  const continuations = new Set<CodexMessage>();
  let identityTurn: string | undefined;
  let hasAssistant = false;
  messages.forEach((message, index) => {
    if (message.role === "user" || (message.turnId && message.turnId !== identityTurn)) {
      identityTurn = message.turnId;
      hasAssistant = false;
    }
    if (message.role !== "assistant" || isToolMessage(message)) return;
    if (message.turnId) {
      if (hasAssistant) continuations.add(message);
      hasAssistant = true;
    } else {
      const previous = messages[index - 1];
      if (previous?.role === "assistant" && !previous.turnId && !isToolMessage(previous)) continuations.add(message);
    }
  });
  const renderGroupedMessage: RenderMessage = (message, expanded) => renderMessage(message, expanded, continuations.has(message));
  const groups = groupMessageProcesses(messages);
  return groups.map((group, index) => group.kind === "message"
    ? <Fragment key={`message:${(keyCounts.get(messageDisplayKey(group.message)) ?? 0) > 1 ? group.message.id : messageDisplayKey(group.message)}`}>{renderGroupedMessage(group.message)}</Fragment>
    : <MessageProcess key={`process:${group.id}`} messages={group.messages} completed={group.completed} running={running && index === groups.length - 1} renderMessage={renderGroupedMessage} />);
}

function MessageProcess({ messages, completed, running, renderMessage }: { messages: CodexMessage[]; completed: boolean; running: boolean; renderMessage: RenderMessage }) {
  const records: Array<{ kind: "message"; message: CodexMessage } | { kind: "tools"; messages: CodexMessage[] }> = [];
  for (const message of messages) {
    if (!isToolMessage(message)) {
      records.push({ kind: "message", message });
      continue;
    }
    const previous = records.at(-1);
    if (previous?.kind === "tools") previous.messages.push(message);
    else records.push({ kind: "tools", messages: [message] });
  }
  return records.map((record, index) => record.kind === "message"
    ? <Fragment key={`record:${record.message.id}`}>{renderMessage(record.message)}</Fragment>
    : <ToolProcess key={`tools:${record.messages[0].id}`} messages={record.messages} completed={completed} running={running && index === records.length - 1} renderMessage={renderMessage} />);
}

function ToolProcess({ messages, completed, running, renderMessage }: { messages: CodexMessage[]; completed: boolean; running: boolean; renderMessage: RenderMessage }) {
  const contentId = useId();
  const [choice, setChoice] = useState<{ completed: boolean; expanded: boolean } | null>(null);
  const expanded = choice?.completed === completed ? choice.expanded : false;
  const failures = messages.filter(message => summarizeToolMessage(message).failed).length;
  const latest = messages.at(-1);
  const action = latest ? summarizeToolMessage(latest).action : "正在处理请求";
  const active = running && !completed;
  return <section className="message-process" aria-label="命令与输出">
    <button type="button" className="process-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setChoice({ completed, expanded: !expanded })}>
      {active ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Terminal size={15} aria-hidden="true" />}
      <span><strong>{active ? "正在执行" : completed ? "执行完成" : "执行记录"}</strong><em>{action}</em></span>
      <small className={failures ? "process-failures" : undefined}>{failures ? `${failures} 项异常 · ` : ""}{messages.length} 项</small><ChevronRight size={15} className="process-chevron" aria-hidden="true" />
    </button>
    <div id={contentId} className="process-content" hidden={!expanded}>
      {expanded && messages.map(message => <Fragment key={message.id}>{renderMessage(message, true)}</Fragment>)}
    </div>
  </section>;
}

export function ToolMessageBubble({ message, onCopy, copyFeedback = "", expanded = false }: { message: CodexMessage; onCopy: () => void; copyFeedback?: string; expanded?: boolean }) {
  const summary = summarizeToolMessage(message);
  const rawText = toolRawText(message);
  const hasRawText = rawText.trim().length > 0;
  return (
    <details className={`tool-message ${summary.failed ? "failed" : ""} ${hasRawText ? "" : "no-raw"}`} open={expanded || !hasRawText}>
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
      <span className="message-copy-feedback" role="status" aria-live="polite">{copyFeedback}</span>
    </details>
  );
}

export function ApprovalCard({ approval, onRespond }: { approval: LiveApproval; onRespond: (decision: LiveApprovalDecision) => void }) {
  const respond = (decision: LiveApprovalDecision) => { haptic(decision === "decline" || decision === "cancel" ? "warn" : "confirm"); onRespond(decision); };
  const allowSession = approval.availableDecisions.includes("acceptForSession");
  const locked = approval.status !== "pending";
  const statusText = approval.status === "submitting" ? "正在提交决定…" : approval.status === "submitted" ? "已提交，等待桌面同步；请勿重复操作" : approval.status === "uncertain" ? "提交结果待确认，请查看电脑或等待会话同步" : "";
  const risks = commandRisks(approval.command);
  const files = approval.kind === "fileChange" ? approval.files ?? [] : [];
  return (
    <article className={`approval-card ${approval.kind}${risks.length ? " risky" : ""}`}>
      <header>
        <span>
          <AlertCircle size={15} />
          {approval.title}
        </span>
        <em>{formatTime(approval.createdAt)}</em>
      </header>
      <p>{approval.detail}</p>
      {approval.reason && <p>原因：{approval.reason}</p>}
      {approval.command && <pre className="approval-command">{approval.command}</pre>}
      {risks.length > 0 && <p className="approval-risk" role="note"><AlertCircle size={14} aria-hidden="true" /><span>高风险：{risks.join("、")}。请确认后再允许。</span></p>}
      {approval.cwd && <small>目录：{approval.cwd}</small>}
      {files.length > 0 ? <ul className="approval-files" aria-label="要修改的文件">
        {files.map((file, index) => {
          const diff = diffLines(file);
          return <li key={`${file.path}:${index}`}><details open={files.length <= 3}>
            <summary><span className={`approval-file-kind ${file.kind}`}>{fileKindLabels[file.kind]}</span>
              <span className="approval-file-path">{file.path}{file.movePath ? ` → ${file.movePath}` : ""}</span>
              <span className="approval-file-count"><span className="diff-add">+{diff.added}</span> <span className="diff-del">−{diff.removed}</span></span></summary>
            <pre className="approval-diff">{diff.lines.map((line, n) => <span key={n} className={`diff-line diff-${line.type}`}>{line.text || " "}</span>)}</pre>
            {diff.hidden > 0 && <small>还有 {diff.hidden} 行未显示，请在电脑查看完整差异。</small>}
          </details></li>;
        })}
      </ul> : approval.preview && <details className="approval-preview" open><summary>操作与权限详情</summary><pre>{approval.preview}</pre></details>}
      {approval.unavailableReason && <p>{approval.unavailableReason}</p>}
      {statusText && <p role="status" aria-live="polite">{statusText}</p>}
      <div className="approval-actions">
        {approval.availableDecisions.includes("accept") && (
          <button disabled={locked} className="accept primary" onClick={() => respond("accept")}>
            <CheckCircle2 size={14} />
            <span>允许一次</span>
          </button>
        )}
        {allowSession && (
          <button disabled={locked} className="accept" onClick={() => respond("acceptForSession")}>
            <CheckCircle2 size={14} />
            <span>本会话允许</span>
          </button>
        )}
        {approval.availableDecisions.includes("decline") && (
          <button disabled={locked} className="decline" onClick={() => respond("decline")}>
            <X size={14} />
            <span>拒绝</span>
          </button>
        )}
        {approval.availableDecisions.includes("cancel") && (
          <button disabled={locked} className="quiet" onClick={() => respond("cancel")}>
            <CircleStop size={14} />
            <span>取消</span>
          </button>
        )}
      </div>
    </article>
  );
}
