import { createHash } from "node:crypto";
import type { ClaudeInteractionAnswer, ClaudeInteractionInput, ClaudeInteractionReply } from "./claudeProtocol.js";
import { agentError, type AgentPermission, type AgentQuestion } from "./sessions.js";

type Interaction = {
  input: ClaudeInteractionInput | null; serial: number; signature: string; expires: number; closed: boolean;
  answer: ClaudeInteractionAnswer | null; waiting?: () => void;
};

/** Per activation, in memory only. Repeated host reads never create another tool call. */
export class ClaudeInteractions {
  private readonly requests = new Map<string, Interaction>();
  private readonly cancelled = new Map<string, number>();
  private retiredSerial = 0;
  constructor(private readonly publish: () => void, private readonly pollMs: number, private readonly lifetimeMs = 300_000) {}

  async wait(input: ClaudeInteractionInput, watching: boolean, signal?: AbortSignal): Promise<ClaudeInteractionReply> {
    this.expire();
    if (this.cancelled.has(input.id)) return { status: "closed" };
    const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    let request = this.requests.get(input.id);
    if (request && request.signature !== signature) { this.close(input.id); throw agentError("CLAUDE_REQUEST_CHANGED", 409); }
    if (!request) {
      if (input.serial <= this.retiredSerial) return { status: "closed" };
      if ([...this.requests.values()].some(r => r.serial === input.serial)) throw agentError("CLAUDE_REQUEST_CHANGED", 409);
      if ([...this.requests.values()].filter(r => !r.closed).length >= 16) throw agentError("CLAUDE_REQUEST_LIMIT", 429);
      if (this.requests.size >= 128) {
        const oldest = [...this.requests].find(([, r]) => r.closed);
        if (oldest) { this.retiredSerial = Math.max(this.retiredSerial, oldest[1].serial); this.requests.delete(oldest[0]); }
      }
      request = { input: watching ? input : null, serial: input.serial, signature, closed: !watching, answer: null, expires: Date.now() + this.lifetimeMs };
      this.requests.set(input.id, request); this.publish();
    }
    if (request.waiting) throw agentError("CLAUDE_REQUEST_POLL_BUSY", 409);
    if (!request.closed && !request.answer && !signal?.aborted) {
      const current = request;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); if (current.waiting === finish) delete current.waiting; resolve(); };
        const timer = setTimeout(finish, Math.min(this.pollMs, Math.max(0, current.expires - Date.now())));
        current.waiting = finish; signal?.addEventListener("abort", finish, { once: true });
      });
    }
    this.expire();
    if (signal?.aborted) { this.close(input.id); return { status: "closed" }; }
    if (request.closed) return { status: "closed" };
    return request.answer ? { status: "answered", answer: request.answer } : { status: "pending" };
  }

  respondQuestion(id: string, answers: string[][]) {
    const { request, input } = this.pending(id, "question");
    if (input.request.kind !== "question") throw agentError("CLAUDE_REQUEST_KIND", 409);
    const questions = input.request.questions;
    if (answers.length !== questions.length || questions.some((question, i) => {
      const values = answers[i];
      return !Array.isArray(values) || !values.length || values.length > 10 || (!question.multiple && values.length !== 1)
        || new Set(values).size !== values.length || values.some(value => typeof value !== "string" || !value.trim() || value.length > 10_000);
    })) throw agentError("CLAUDE_INVALID_ANSWER", 400);
    this.submit(request, { answers: answers.map(values => [...values]) });
  }

  respondPermission(id: string, decision: "once" | "always" | "reject") {
    const { request } = this.pending(id, "permission");
    if (decision !== "once" && decision !== "reject") throw agentError("CLAUDE_DECISION_UNAVAILABLE", 400);
    this.submit(request, { decision });
  }

  close(id: string, serial?: number) {
    const request = this.requests.get(id);
    if (!request) {
      if (serial !== undefined) {
        this.cancelled.set(id, serial);
        if (this.cancelled.size > 128) {
          const oldest = this.cancelled.entries().next().value!;
          this.retiredSerial = Math.max(this.retiredSerial, oldest[1]); this.cancelled.delete(oldest[0]);
        }
      }
      return;
    }
    if (serial !== undefined && serial !== request.serial) throw agentError("CLAUDE_REQUEST_CHANGED", 409);
    if (request.closed) return;
    request.closed = true; request.input = null; request.answer = null; request.waiting?.(); this.publish();
  }
  closeAll() { for (const id of this.requests.keys()) this.close(id); }
  retainTurn(turnId: string | null) { for (const [id, request] of this.requests) if (request.input && request.input.turnId !== turnId) this.close(id); }
  expire() { for (const [id, request] of this.requests) if (!request.closed && request.expires <= Date.now()) this.close(id); }
  views(): { questions: AgentQuestion[]; permissions: AgentPermission[] } {
    const questions: AgentQuestion[] = [], permissions: AgentPermission[] = [];
    for (const [id, request] of this.requests) {
      if (request.closed || !request.input) continue;
      const status = request.answer ? "submitted" : "pending";
      if (request.input.request.kind === "question") questions.push({ id, status, questions: request.input.request.questions });
      else {
        const { action, directory, detail } = request.input.request;
        permissions.push({ id, status, action, resources: [directory], detail, save: [], unavailableReason: null, decisions: ["once", "reject"] });
      }
    }
    return { questions, permissions };
  }

  private pending(id: string, kind: "question" | "permission") {
    this.expire();
    const request = this.requests.get(id);
    if (!request || request.closed || !request.input) throw agentError("CLAUDE_REQUEST_EXPIRED", 409);
    if (request.input.request.kind !== kind) throw agentError("CLAUDE_REQUEST_KIND", 409);
    if (request.answer) throw agentError("CLAUDE_REQUEST_ALREADY_SUBMITTED", 409);
    return { request, input: request.input };
  }
  private submit(request: Interaction, answer: ClaudeInteractionAnswer) { request.answer = answer; request.waiting?.(); this.publish(); }
}
