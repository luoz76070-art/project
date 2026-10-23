import { z } from "zod";

export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  allowOther: boolean;
  secret: boolean;
};

export type UserInputRequest = {
  id: string;
  threadId: string;
  turnId: string;
  kind: "desktop-sync" | "desktop-async" | "relay";
  status: "pending" | "submitting" | "submitted" | "uncertain";
  questions: UserInputQuestion[];
};

export type DesktopQuestionCandidate = Omit<UserInputRequest, "id" | "status" | "kind"> & {
  kind: "desktop-sync" | "desktop-async";
  key: string;
  requestId?: string | number;
};

const text = z.string().min(1).max(10_000);
const questionSchema = z.object({
  id: text, header: z.string().max(200).default(""), question: text,
  options: z.array(z.object({ label: text, description: z.string().max(10_000).default("") })).max(20).nullish(),
  isOther: z.boolean().default(false), isSecret: z.boolean().default(false),
});
const asyncQuestionSchema = z.object({ title: text, options: z.array(text).max(20).default([]) });
const answerSchema = z.record(z.string(), z.array(text).min(1).max(20));
const replyOpen = "<send_user_message_question_reply>";
const replyClose = "</send_user_message_question_reply>";

export function parseUserInputQuestions(value: unknown): UserInputQuestion[] | null {
  const parsed = z.array(questionSchema).min(1).max(20).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(q => q.id)).size !== parsed.data.length) return null;
  return parsed.data.map(q => ({ id: q.id, header: q.header, question: q.question, options: q.options ?? [], allowOther: q.isOther || !q.options?.length, secret: q.isSecret }));
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function conversationTurns(state: Record<string, unknown>): Record<string, unknown>[] {
  const history = record(record(state.turnHistory)?.history);
  if (record(state.turnHistory)?.kind === "canonical" && history) {
    const entities = record(history.entitiesByKey) ?? {};
    return (Array.isArray(history.islands) ? history.islands : []).flatMap(island => {
      const entries = record(island)?.entries;
      return (Array.isArray(entries) ? entries : []).flatMap(entry => {
        const key = record(entry)?.value;
        const turn = typeof key === "string" ? record(entities[key]) : null;
        return turn ? [turn] : [];
      });
    });
  }
  return (Array.isArray(state.turns) ? state.turns : []).flatMap(turn => record(turn) ? [record(turn)!] : []);
}

export function desktopQuestionCandidates(threadId: string, state: Record<string, unknown>): DesktopQuestionCandidate[] {
  const turns = conversationTurns(state);
  const active = turns.filter(turn => turn.status === "inProgress" && typeof turn.turnId === "string");
  const candidates: DesktopQuestionCandidate[] = [];
  for (const value of Array.isArray(state.requests) ? state.requests : []) {
    const request = record(value), params = record(request?.params);
    if (request?.method !== "item/tool/requestUserInput" || !params || params.threadId !== threadId) continue;
    if (!active.some(turn => turn.turnId === params.turnId)) continue;
    if (typeof request.id !== "string" && typeof request.id !== "number") continue;
    const questions = parseUserInputQuestions(params.questions);
    if (!questions) continue;
    candidates.push({
      key: JSON.stringify(["sync", params.turnId, request.id]), requestId: request.id,
      threadId, turnId: String(params.turnId), kind: "desktop-sync",
      questions,
    });
  }
  // Async prompts remain answerable after output ends, until a newer turn supersedes them.
  const latest = turns.at(-1);
  const asynchronous = turns.filter(turn => typeof turn.turnId === "string" && (turn.status === "inProgress" || (turn === latest && turn.status === "completed")));
  for (const turn of asynchronous) {
    const items = (Array.isArray(turn.items) ? turn.items : []).flatMap(item => record(item) ? [record(item)!] : []);
    const answered = new Set(items.flatMap(acceptedQuestionIds));
    for (const item of items) {
      if (item.type !== "agentMessage" || typeof item.id !== "string") continue;
      const parsed = z.array(asyncQuestionSchema).min(1).max(20).safeParse(item.questions);
      if (!parsed.success) continue;
      const questions = parsed.data.map((q, index) => ({
        id: JSON.stringify(["request_user_input_async", item.id, index]),
        header: "", question: q.title, options: q.options.map(label => ({ label, description: "" })), allowOther: true, secret: false,
      })).filter(q => !answered.has(q.id));
      if (questions.length) candidates.push({ key: JSON.stringify(["async", turn.turnId, item.id]), threadId, turnId: String(turn.turnId), kind: "desktop-async", questions });
    }
  }
  return candidates;
}

function acceptedQuestionIds(item: Record<string, unknown>): string[] {
  if (item.type !== "userMessage" && item.type !== "steeringUserMessage") return [];
  if (item.type === "steeringUserMessage" && item.status !== "accepted") return [];
  const input = item.type === "userMessage" ? item.content : item.input;
  if (!Array.isArray(input) || input.length !== 1) return [];
  const part = record(input[0]);
  if (part?.type !== "text" || typeof part.text !== "string") return [];
  const value = part.text.trim();
  if (!value.startsWith(replyOpen) || !value.endsWith(replyClose)) return [];
  try {
    const parsed = JSON.parse(value.slice(replyOpen.length, -replyClose.length));
    return (Array.isArray(parsed) ? parsed : [parsed]).flatMap(reply => typeof reply?.questionItemId === "string" && typeof reply?.question === "string" && typeof reply?.answer === "string" ? [reply.questionItemId] : []);
  } catch { return []; }
}

export function validateQuestionAnswers(request: Pick<UserInputRequest, "questions">, value: unknown): Record<string, string[]> {
  const answers = answerSchema.safeParse(value);
  if (!answers.success || Object.keys(answers.data).length !== request.questions.length) throw interactionError("invalid_answers", 400);
  for (const q of request.questions) {
    const values = answers.data[q.id];
    if (!Object.hasOwn(answers.data, q.id) || !values || values.length !== 1 || !values[0].trim() || (!q.allowOther && !q.options.some(option => option.label === values[0]))) throw interactionError("invalid_answers", 400);
  }
  return answers.data;
}

export function asyncQuestionReply(request: Pick<UserInputRequest, "questions">, answers: Record<string, string[]>): string {
  return `${replyOpen}\n${JSON.stringify(request.questions.map(q => ({ questionItemId: q.id, question: q.question, answer: answers[q.id][0] })))}\n${replyClose}`;
}

export function interactionError(message: string, statusCode = 409): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
