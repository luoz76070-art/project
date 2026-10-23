import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { AgentAdapter, AgentStatus } from "./agentGateway.js";
import { claudeRegisterSchema, claudeSessionId, claudeInteractionWaitSchema, type ClaudeCommand, type ClaudeEvent, type ClaudeInteractionInput } from "./claudeProtocol.js";
import { ClaudeInteractions } from "./claudeInteractions.js";
import { agentError, type AgentDelivery, type AgentMessage, type AgentOperation, type AgentSessionSnapshot, type SessionAdapter } from "./sessions.js";

type Listener = { snapshot: (snapshot: AgentSessionSnapshot) => void; disconnect: () => void };
type Pending = { command: ClaudeCommand; sent: boolean; expires: number };
type Entry = {
  sessionId: string; activationId: string; generation: string; sequence: number; touched: number; connected: boolean;
  version: string; directory: string; turnId: string | null; activity: AgentSessionSnapshot["activity"];
  messages: AgentMessage[]; live: Map<string, AgentMessage>; partial: boolean; ready: boolean;
  listeners: Set<Listener>; queue: ClaudeCommand[]; poll?: () => void;
  submission: AgentSessionSnapshot["submission"]; pending: Pending | null;
  operationError: AgentSessionSnapshot["operationError"];
  interactions?: 1; requests: ClaudeInteractions;
};
const inactive = { inspectLoadedSessions: false, sendMessage: false, steer: false, interrupt: false, approve: false };

/** A host-loaded mod owns its session. This adapter never runs Claude or resumes a transcript. */
export class ClaudeAdapter implements AgentAdapter, SessionAdapter {
  private readonly entries = new Map<string, Entry>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  constructor(private readonly limits: { leaseMs: number; pollMs: number; operationMs: number; interactionMs?: number } = { leaseMs: 45_000, pollMs: 20_000, operationMs: 30_000 }) {}
  readonly sessionApi: SessionAdapter = this;

  validSessionId(id: string) { return claudeSessionId.safeParse(id).success; }
  snapshot(): AgentStatus {
    this.expire();
    const count = [...this.entries.values()].filter(e => e.connected).length;
    return { id: "claude", label: "Claude Code", transport: "claude-mods-http", usesAccessibility: false, sameDesktopThreadVerified: false,
      state: count ? "connected" : "unprobed", capabilities: count ? { ...inactive, inspectLoadedSessions: true, sendMessage: true, interrupt: true,
        approve: [...this.entries.values()].some(e => e.connected && e.interactions === 1) } : { ...inactive },
      loadedSessions: { count, hasMore: false }, checkedAt: null, errorCode: null };
  }
  async probe() { this.running(); return this.snapshot(); }

  register(input: z.infer<typeof claudeRegisterSchema>) {
    this.running(); this.expire(); input = claudeRegisterSchema.parse(input);
    let entry = this.entries.get(input.sessionId);
    if (entry?.connected && entry.activationId !== input.activationId) throw agentError("CLAUDE_SESSION_ALREADY_ATTACHED", 409);
    if (entry?.connected && (entry.directory !== input.directory || entry.version !== input.version || entry.interactions !== input.interactions)) throw agentError("CLAUDE_REGISTRATION_CHANGED", 409);
    if (!entry?.connected) {
      if (this.entries.size >= 32 && !entry) {
        for (const [id, previous] of this.entries) if (!previous.connected && previous.submission?.delivery !== "uncertain") { this.entries.delete(id); break; }
      }
      if (this.entries.size >= 32 && !entry) throw agentError("CLAUDE_SESSION_LIMIT", 429);
      const previous = entry;
      const requests = new ClaudeInteractions(() => { if (entry) this.publish(entry); }, this.limits.pollMs, this.limits.interactionMs);
      entry = { ...input, requests, generation: randomUUID(), sequence: 0, touched: Date.now(), connected: true, activity: "thinking", messages: [], live: new Map(),
        partial: true, ready: false, listeners: new Set(), queue: [], submission: previous?.submission ?? null, pending: null, operationError: null };
      this.entries.set(input.sessionId, entry);
    }
    entry.touched = Date.now();
    if (!this.timer) { this.timer = setInterval(() => this.expire(), Math.min(5000, this.limits.leaseMs)); this.timer.unref(); }
    return { generation: entry.generation, watching: entry.listeners.size > 0, leaseMs: this.limits.leaseMs };
  }

  ingest(sessionId: string, generation: string, sequence: number, events: ClaudeEvent[]) {
    const entry = this.host(sessionId, generation);
    if (sequence <= entry.sequence) return { ok: true, watching: entry.listeners.size > 0 };
    if (sequence !== entry.sequence + 1) { this.disconnect(entry); throw agentError("CLAUDE_EVENT_GAP", 409); }
    // Event batches are parsed at the HTTP boundary; no arbitrary host fields enter the phone DTO.
    for (const event of events) {
      if (!entry.connected) break;
      this.apply(entry, event);
    }
    entry.sequence = sequence; entry.touched = Date.now(); this.publish(entry);
    return { ok: true, watching: entry.listeners.size > 0 };
  }

  async poll(sessionId: string, generation: string, signal?: AbortSignal) {
    const entry = this.host(sessionId, generation);
    if (entry.poll) throw agentError("CLAUDE_POLL_BUSY", 409);
    if (!entry.queue.length && !signal?.aborted) await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); if (entry.poll === finish) delete entry.poll; resolve(); };
      const timer = setTimeout(finish, this.limits.pollMs);
      entry.poll = finish; signal?.addEventListener("abort", finish, { once: true });
    });
    if (signal?.aborted) return { commands: [], watching: false };
    this.host(sessionId, generation);
    // A response may be lost after dequeue. Never redeliver a model command on the next poll.
    const commands = entry.queue.splice(0);
    if (entry.pending && commands.some(c => c.id === entry.pending!.command.id)) entry.pending.sent = true;
    entry.touched = Date.now();
    return { commands, watching: entry.listeners.size > 0 };
  }

  end(sessionId: string, generation: string) { this.disconnect(this.host(sessionId, generation)); return { ok: true }; }

  waitInteraction(id: string, input: ClaudeInteractionInput, signal?: AbortSignal) {
    input = claudeInteractionWaitSchema.parse(input);
    const entry = this.host(id, input.generation);
    if (entry.interactions !== 1) throw agentError("CLAUDE_INTERACTIONS_UNAVAILABLE", 409);
    if (entry.turnId !== input.turnId) throw agentError("CLAUDE_REQUEST_EXPIRED", 409);
    return entry.requests.wait(input, entry.listeners.size > 0, signal);
  }
  closeInteraction(id: string, generation: string, requestId: string, serial: number) { this.host(id, generation).requests.close(requestId, serial); return { ok: true }; }

  async listSessions(search = "", cursor?: string) {
    this.running(); this.expire();
    if (cursor) throw agentError("CLAUDE_HISTORY_UNAVAILABLE", 409);
    return { sessions: [...this.entries.values()].filter(e => e.connected).map(e => this.session(e))
      .filter(e => `${e.title}\n${e.directory}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), cursor: null };
  }
  async readHistory(_sessionId: string, _cursor: string): Promise<{ messages: AgentMessage[]; cursor: string | null }> { throw agentError("CLAUDE_HISTORY_UNAVAILABLE", 409); }

  async watchSession(id: string, snapshot: Listener["snapshot"], disconnect: Listener["disconnect"]) {
    const entry = this.current(id), listener = { snapshot, disconnect };
    entry.listeners.add(listener);
    try { snapshot(this.view(entry)); } catch (error) { entry.listeners.delete(listener); throw error; }
    if (!entry.queue.some(c => c.type === "snapshot")) entry.queue.push({ id: randomUUID(), type: "snapshot" });
    entry.poll?.();
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) { entry.requests.closeAll(); entry.messages = []; entry.live.clear(); entry.ready = false; entry.partial = true; entry.queue = entry.queue.filter(c => c.type !== "snapshot"); entry.poll?.(); }
    };
  }

  async sendMessage(id: string, input: AgentOperation & { text: string; delivery: "steer" | "queue" }): Promise<AgentDelivery> {
    const entry = this.guard(id, input);
    if (input.delivery !== "queue") throw agentError("CLAUDE_STEER_UNAVAILABLE", 409);
    if (!input.text.trim() || input.text.length > 20_000) throw agentError("invalid_message", 400);
    return this.enqueue(entry, { id: input.clientMessageId, type: "message", text: input.text });
  }
  async interruptSession(id: string, input: AgentOperation): Promise<AgentDelivery> {
    const entry = this.guard(id, input);
    if (!entry.turnId) throw agentError("CLAUDE_NO_RUNNING_TURN", 409);
    return this.enqueue(entry, { id: input.clientMessageId, type: "interrupt", turnId: entry.turnId });
  }
  async respondQuestion(id: string, requestId: string, input: AgentOperation & { answers: string[][] }): Promise<AgentDelivery> {
    const entry = this.interactionGuard(id, input); entry.requests.respondQuestion(requestId, input.answers); return { ok: true, delivery: "submitted" };
  }
  async respondPermission(id: string, requestId: string, input: AgentOperation & { decision: "once" | "always" | "reject" }): Promise<AgentDelivery> {
    const entry = this.interactionGuard(id, input); entry.requests.respondPermission(requestId, input.decision); return { ok: true, delivery: "submitted" };
  }

  async stop() { this.stopped = true; clearInterval(this.timer); this.timer = undefined; for (const entry of this.entries.values()) this.disconnect(entry); this.entries.clear(); }

  private enqueue(entry: Entry, command: ClaudeCommand): AgentDelivery {
    entry.operationError = null;
    entry.pending = { command, sent: false, expires: Date.now() + this.limits.operationMs };
    entry.submission = { clientMessageId: command.id, action: command.type === "interrupt" ? "interrupt" : "message", delivery: "submitted" };
    entry.queue.push(command); this.publish(entry); entry.poll?.(); return { ok: true, delivery: "submitted" };
  }
  private guard(id: string, input: AgentOperation) {
    const entry = this.interactionGuard(id, input, false);
    if (entry.pending || (entry.submission && entry.submission.delivery !== "confirmed")) throw agentError("CLAUDE_OPERATION_PENDING", 409);
    return entry;
  }
  private interactionGuard(id: string, input: AgentOperation, requireInteractions = true) {
    const entry = this.current(id);
    if (!entry.ready || !entry.listeners.size || entry.generation !== input.controlToken) throw agentError("CLAUDE_CONTROL_EXPIRED", 409);
    if (requireInteractions && entry.interactions !== 1) throw agentError("CLAUDE_INTERACTIONS_UNAVAILABLE", 409);
    return entry;
  }
  private host(id: string, generation: string) { const entry = this.current(id); if (entry.generation !== generation) throw agentError("CLAUDE_GENERATION_CHANGED", 409); return entry; }
  private current(id: string) {
    this.running(); this.expire();
    if (!this.validSessionId(id)) throw agentError("CLAUDE_SESSION_INVALID", 400);
    const entry = this.entries.get(id); if (!entry?.connected) throw agentError("CLAUDE_SESSION_OFFLINE", 410); return entry;
  }
  private running() { if (this.stopped) throw agentError("CLAUDE_BRIDGE_STOPPED", 503); }
  private expire() {
    for (const entry of this.entries.values()) {
      if (!entry.connected) continue;
      if (entry.touched + this.limits.leaseMs <= Date.now()) { this.disconnect(entry); continue; }
      entry.requests.expire();
      if (entry.pending && entry.pending.expires <= Date.now()) {
        const pending = entry.pending;
        if (pending.sent) pending.expires = Infinity;
        else entry.pending = null;
        entry.queue = entry.queue.filter(c => c.id !== pending.command.id);
        entry.submission = pending.sent ? { ...entry.submission!, delivery: "uncertain" } : null;
        entry.operationError = pending.sent ? null : { clientMessageId: pending.command.id, code: "expired" };
        this.publish(entry);
      }
    }
  }
  private disconnect(entry: Entry) {
    if (!entry.connected) return;
    entry.connected = false;
    entry.requests.closeAll();
    if (entry.pending) entry.submission = entry.pending.sent ? { ...entry.submission!, delivery: "uncertain" } : null;
    entry.pending = null; entry.queue = []; entry.poll?.();
    for (const listener of [...entry.listeners]) { try { listener.disconnect(); } catch { /* subscriber owns its stream */ } }
    entry.listeners.clear(); entry.messages = []; entry.live.clear(); entry.ready = false;
  }
  private apply(entry: Entry, event: ClaudeEvent) {
    switch (event.type) {
      case "state": {
        const previousTurn = entry.turnId;
        entry.turnId = event.turnId; entry.activity = event.activity;
        entry.requests.retainTurn(event.turnId);
        if (entry.pending?.command.type === "interrupt" && !event.turnId && entry.pending.command.turnId === previousTurn) {
          entry.submission = { ...entry.submission!, delivery: event.aborted ? "confirmed" : "uncertain" }; entry.pending = null;
        }
        break;
      }
      case "text": {
        if (!entry.listeners.size || event.turnId !== entry.turnId) break;
        const existing = entry.live.get(event.id);
        const bytes = [...entry.live.values()].reduce((n, m) => n + m.text.length, 0);
        if ((!existing && entry.live.size >= 128) || bytes + event.text.length > 256_000) { entry.partial = true; break; }
        entry.live.set(event.id, { id: event.id, timestamp: existing?.timestamp ?? new Date().toISOString(), role: "assistant", kind: "agent_message", text: (existing?.text ?? "") + event.text });
        entry.activity = "outputting"; break;
      }
      case "messages": {
        if (!entry.listeners.size) break;
        entry.messages = event.messages.map((m, i) => ({ ...m, id: `claude:${entry.generation}:${i}`, kind: m.role === "user" ? "user_message" : "agent_message", timestamp: new Date().toISOString() }));
        if (!entry.turnId) entry.live.clear();
        entry.ready = true; entry.partial = event.partial || Boolean(entry.turnId); break;
      }
      case "receipt": {
        if (entry.pending?.command.id !== event.id) break;
        if (event.delivery === "rejected") { entry.pending = null; entry.submission = null; entry.operationError = { clientMessageId: event.id, code: "rejected" }; break; }
        // abort() returning is not a turn end. Only a matching aborted lifecycle confirms an interruption.
        if (entry.pending.command.type === "interrupt" && event.delivery === "confirmed") break;
        entry.submission = { ...entry.submission!, delivery: event.delivery }; entry.pending = null; break;
      }
      case "ended": this.disconnect(entry); break;
      case "partial": entry.partial = true; break;
    }
  }
  private session(entry: Entry) { return { id: entry.sessionId, title: entry.messages.find(m => m.role === "user" && m.text.trim())?.text.slice(0, 100) ?? "Claude Code 会话", directory: entry.directory, updatedAt: new Date(entry.touched).toISOString() }; }
  private view(entry: Entry): AgentSessionSnapshot {
    const enabled = entry.connected && entry.ready && !entry.pending && (!entry.submission || entry.submission.delivery === "confirmed");
    return { agentId: "claude", session: this.session(entry), connected: entry.connected, updatedAt: new Date().toISOString(), status: entry.turnId ? "running" : "idle", activity: entry.activity,
      messages: [...entry.messages, ...entry.live.values()], ...entry.requests.views(), historyCursor: null, partialText: entry.partial,
      operationError: entry.operationError,
      control: entry.connected ? { token: entry.generation, canSend: enabled, canSteer: false, canInterrupt: enabled && Boolean(entry.turnId) } : null,
      submission: entry.submission ? { ...entry.submission } : null };
  }
  private publish(entry: Entry) { if (entry.connected) for (const listener of entry.listeners) { try { listener.snapshot(this.view(entry)); } catch { /* the SSE owner closes failed subscribers */ } } }
}
