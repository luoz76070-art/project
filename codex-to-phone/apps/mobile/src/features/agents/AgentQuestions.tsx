import { useRef, useState } from "react";
import { ArrowUp, MessageSquare } from "lucide-react";
import type { AgentQuestion } from "./types";

export function AgentQuestions({ request, disabled, onRespond, agentLabel }: { request: AgentQuestion; disabled: boolean; onRespond: (answers: string[][]) => Promise<boolean>; agentLabel: string }) {
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [customOn, setCustomOn] = useState<Record<number, boolean>>({});
  const [sent, setSent] = useState(false), submitted = useRef(false);
  const locked = disabled || sent || request.status !== "pending" || Boolean(request.unavailableReason);
  const answer = (index: number) => [...(answers[index] ?? []), ...((customOn[index] || !request.questions[index]?.options.length) && custom[index]?.trim() ? [custom[index].trim()] : [])];
  const ready = request.questions.every((q, i) => answer(i).length > 0 && (q.multiple || answer(i).length === 1));
  const label = disabled ? "连接恢复后重新核验题目" : request.unavailableReason ? "需要在电脑处理" : request.status === "uncertain" ? "结果待确认，请勿重复提交" : locked ? "已提交，等待会话确认" : "等待你选择";
  return <form className="user-input-card" aria-label={`${agentLabel} 提问`} onSubmit={event => {
    event.preventDefault();
    if (submitted.current || locked || !ready) return;
    submitted.current = true; setSent(true);
    const values = request.questions.map((_, index) => [...new Set(answer(index))]);
    void onRespond(values).then(accepted => {
      if (accepted) { setAnswers({}); setCustom({}); setCustomOn({}); }
      else { submitted.current = false; setSent(false); }
    });
  }}>
    <header><MessageSquare size={16} aria-hidden="true" /><span>{label}</span><small>{request.questions.length} 个问题</small></header>
    {request.questions.map((question, index) => <fieldset key={index} disabled={locked}>
      <legend><small>{question.header}{question.multiple ? " · 可多选" : ""}</small>{question.question}</legend>
      {question.options.map((option, optionIndex) => <label className="question-option" key={optionIndex}>
        <input type={question.multiple ? "checkbox" : "radio"} name={`${request.id}:${index}`} checked={(answers[index] ?? []).includes(option.label)} onChange={event => {
          const checked = event.target.checked;
          setAnswers(current => ({ ...current, [index]: question.multiple ? checked ? [...(current[index] ?? []), option.label] : (current[index] ?? []).filter(value => value !== option.label) : [option.label] }));
          if (!question.multiple) setCustomOn(current => ({ ...current, [index]: false }));
        }} /><span>{option.label}{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {question.custom && <>
        {question.options.length > 0 && <label className="question-option"><input type={question.multiple ? "checkbox" : "radio"} name={`${request.id}:${index}`} checked={customOn[index] ?? false} onChange={event => {
          const checked = event.target.checked; setCustomOn(current => ({ ...current, [index]: checked }));
          if (!question.multiple) setAnswers(current => ({ ...current, [index]: [] }));
        }} /><span>填写自己的回答</span></label>}
        {(customOn[index] || !question.options.length) && <textarea className="question-freeform" aria-label={`${question.question}的回答`} maxLength={10_000} rows={2} value={custom[index] ?? ""} onChange={event => setCustom(current => ({ ...current, [index]: event.target.value }))} />}
      </>}
    </fieldset>)}
    <button className="question-submit" type="submit" disabled={locked || !ready}>提交回答<ArrowUp size={16} aria-hidden="true" /></button>
    <p role="status">{request.unavailableReason ?? `${label} · 回答发送到当前 ${agentLabel} 会话`}</p>
  </form>;
}
