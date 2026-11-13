import { z } from "zod";
import { formSchema } from "./openCodeProtocol.js";
import { agentError, type AgentQuestion } from "./sessions.js";

type Form = z.infer<typeof formSchema>;
const supportedKeys = new Set(["key", "type", "title", "description", "options", "custom", "required"]);

function unavailable(form: Form): string | null {
  if (form.metadata?.kind !== "question") return "此表单暂未适配，请在电脑处理。";
  if (new Set(form.fields.map(field => field.key)).size !== form.fields.length) return "表单字段重复，请在电脑处理。";
  for (const field of form.fields) {
    if (!["string", "multiselect"].includes(field.type) || Object.keys(field).some(key => !supportedKeys.has(key))) {
      return "此表单含暂不支持的字段、条件或约束，请在电脑处理。";
    }
    const options = field.options ?? [];
    if ((field.type === "multiselect" && !field.options) || (!options.length && field.options && !field.custom)
      || new Set(options.map(option => option.label)).size !== options.length
      || new Set(options.map(option => option.value)).size !== options.length
      || options.some(option => Object.keys(option).some(key => !["value", "label", "description"].includes(key)))) {
      return "此表单的选项无法完整映射，请在电脑处理。";
    }
  }
  return null;
}

export function openCodeQuestionView(form: Form): Pick<AgentQuestion, "questions" | "unavailableReason"> {
  const unavailableReason = unavailable(form);
  return {
    unavailableReason,
    questions: unavailableReason ? [{ header: "OpenCode 表单", question: form.title, options: [], multiple: false, custom: false }]
      : form.fields.map(field => ({
        header: field.title ?? form.title, question: field.description ?? field.title ?? form.title,
        multiple: field.type === "multiselect", custom: field.custom === true || field.options === undefined,
        options: (field.options ?? []).map(option => ({ label: option.label, description: option.description ?? "" })),
      })),
  };
}

/** Answers use original field keys and option values; labels are only the phone's display contract. */
export function openCodeFormReply(source: unknown, answers: string[][]) {
  const form = formSchema.parse(source), view = openCodeQuestionView(form);
  if (view.unavailableReason) throw agentError("OPENCODE_FORM_UNSUPPORTED", 409);
  if (answers.length !== view.questions.length || view.questions.some((question, index) => {
    const answer = answers[index]!;
    return !answer.length || (!question.multiple && answer.length !== 1) || new Set(answer).size !== answer.length
      || (!question.custom && answer.some(label => !question.options.some(option => option.label === label)));
  })) throw agentError("OPENCODE_INVALID_ANSWER", 400);
  return { answer: Object.fromEntries(form.fields.map((field, index) => {
    const values = answers[index]!.map(label => field.options?.find(option => option.label === label)?.value ?? label);
    return [field.key, field.type === "multiselect" ? values : values[0]!];
  })) };
}
