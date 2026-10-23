import { useState } from "react";
import { MessageSquare, ArrowUp } from "lucide-react";
import type { UserInputRequest } from "../../app/types";

export function UserInputCard({ request, disabled, onRespond }: {
  request: UserInputRequest;
  disabled: boolean;
  onRespond: (answers: Record<string, string[]>) => Promise<void>;
}) {
  // Form values are deliberately local to this card, never part of the draft/cache.
  const [drafts, setDrafts] = useState<Record<string, { option: number | "other"; text: string }>>({});
  const [sent, setSent] = useState(false);
  const locked = disabled || sent || request.status !== "pending";
  const answer = (q: UserInputRequest["questions"][number]) => {
    const draft = drafts[q.id];
    return draft?.option === "other" ? draft.text.trim() : draft ? q.options[draft.option]?.label ?? "" : "";
  };
  const ready = request.questions.every(q => Boolean(answer(q)));
  const label = disabled ? "连接恢复后重新核验题目" : request.status === "uncertain" ? "结果待确认，请先查看会话状态" : sent || request.status !== "pending" ? "已发送，等待会话确认" : "等待你选择";
  return (
    <form className="user-input-card" aria-label="Codex 提问" onSubmit={event => {
      event.preventDefault();
      if (locked || !ready) return;
      const answers = Object.fromEntries(request.questions.map(q => [q.id, [answer(q)]]));
      setSent(true);
      setDrafts({});
      void onRespond(answers);
    }}>
      <header><MessageSquare size={16} aria-hidden="true" /><span>{label}</span><small>{request.questions.length} 个问题</small></header>
      {request.questions.map((q, index) => (
        <fieldset key={q.id} disabled={locked}>
          <legend>{q.header && <small>{q.header}</small>}{request.questions.length > 1 && <span>{index + 1}. </span>}{q.question}</legend>
          {q.options.map((option, optionIndex) => (
            <label className="question-option" key={optionIndex}>
              <input type="radio" name={`${request.id}:${q.id}`} checked={drafts[q.id]?.option === optionIndex} onChange={() => setDrafts(current => ({ ...current, [q.id]: { option: optionIndex, text: "" } }))} />
              <span>{option.label}{option.description && <small>{option.description}</small>}</span>
            </label>
          ))}
          {q.allowOther && q.options.length > 0 && (
            <label className="question-option question-other">
              <input type="radio" name={`${request.id}:${q.id}`} checked={drafts[q.id]?.option === "other"} onChange={() => setDrafts(current => ({ ...current, [q.id]: { option: "other", text: current[q.id]?.text ?? "" } }))} />
              <span>其他回答</span>
            </label>
          )}
          {q.allowOther && (q.options.length === 0 || drafts[q.id]?.option === "other") && (
            q.secret ? <input className="question-freeform" type="password" autoComplete="off" aria-label={`${q.question}的回答`} maxLength={10_000} value={drafts[q.id]?.text ?? ""} onChange={event => setDrafts(current => ({ ...current, [q.id]: { option: "other", text: event.target.value } }))} /> :
              <textarea className="question-freeform" rows={2} autoComplete="off" aria-label={`${q.question}的回答`} placeholder="输入你的回答…" maxLength={10_000} value={drafts[q.id]?.text ?? ""} onChange={event => setDrafts(current => ({ ...current, [q.id]: { option: "other", text: event.target.value } }))} />
          )}
        </fieldset>
      ))}
      <button className="question-submit" type="submit" disabled={locked || !ready}><span>{locked ? "等待确认" : "提交回答"}</span><ArrowUp size={16} aria-hidden="true" /></button>
      <p role="status">{request.kind === "desktop-async" ? "回答发送到电脑上的当前会话" : "确认后 Codex 将继续处理"}</p>
    </form>
  );
}
