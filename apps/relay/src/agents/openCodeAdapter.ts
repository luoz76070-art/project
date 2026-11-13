import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentAdapter, AgentStatus } from "./agentGateway.js";
import { OpenCodeClient, type OpenCodeEvent } from "./openCodeClient.js";
import { activeSchema, admittedSchema, formsSchema, interruptSchema, messagesSchema, messagesView, oneSessionSchema, openCodeVersion, permissionsSchema, serverInfoSchema, sessionIdSchema, sessionsSchema, sessionView } from "./openCodeProtocol.js";
import { openCodeFormReply, openCodeQuestionView } from "./openCodeForms.js";
import { agentError, type AgentDelivery, type AgentOperation, type AgentPermission, type AgentQuestion, type AgentSessionSnapshot, type SessionAdapter } from "./sessions.js";
import { OpenCodeStreamText } from "./openCodeStream.js";

type RequestState<T> = { sourceId: string; signature: string; source: unknown; view: T };
type Listener = { snapshot: (snapshot: AgentSessionSnapshot) => void; disconnect: () => void };
type Entry = {
  id: string; epoch: number; token: string; runKey: string; listeners: Set<Listener>;
  snapshot: AgentSessionSnapshot | null; questions: Map<string, RequestState<AgentQuestion>>; permissions: Map<string, RequestState<AgentPermission>>;
  refresh: Promise<void> | null; dirty: boolean; timer?: NodeJS.Timeout; writing: boolean;
  rawMessages: z.infer<typeof messagesSchema>["data"]; text: OpenCodeStreamText; textTimer?: NodeJS.Timeout;
  activityHint: AgentSessionSnapshot["activity"] | null;
};
type Submission = NonNullable<AgentSessionSnapshot["submission"]> & { messageId?: string; textSignature?: string; expectedDelivery?: "steer" | "queue" };
const signature = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emptyCapabilities = { inspectLoadedSessions: false, sendMessage: false, steer: false, interrupt: false, approve: false };
const operationSchema = z.object({ controlToken: z.string().uuid(), clientMessageId: z.string().uuid() });
const voidSchema = z.undefined();

export class OpenCodeAdapter implements AgentAdapter, SessionAdapter {
  private state: AgentStatus = {
    id: "opencode", label: "OpenCode", state: "unprobed", transport: "opencode-v2-http-sse",
    usesAccessibility: false, sameDesktopThreadVerified: false, capabilities: { ...emptyCapabilities },
    loadedSessions: null, checkedAt: null, errorCode: null,
  };
  private readonly entries = new Map<string, Entry>();
  private readonly submittedRequests = new Map<string, "submitted" | "uncertain">();
  private readonly submissions = new Map<string, Submission>();
  private epoch = 0;
  private connection: Promise<void> | null = null;
  private closeEvents: (() => void) | null = null;
  private stopped = false;
  private probing: Promise<AgentStatus> | null = null;
  private readonly seenEvents = new Set<string>();

  constructor(private readonly client: OpenCodeClient) {}
  readonly sessionApi: SessionAdapter = this;
  validSessionId(id: string) { return sessionIdSchema.safeParse(id).success; }
  snapshot(): AgentStatus { return structuredClone(this.state); }

  probe(): Promise<AgentStatus> {
    if (this.probing) return this.probing;
    this.state = { ...this.state, state: "probing", errorCode: null };
    const pending = (async () => {
      try { await this.listSessions(); }
      catch (error) { this.failed(error); }
      return this.snapshot();
    })().finally(() => { if (this.probing === pending) this.probing = null; });
    return this.probing = pending;
  }

  async listSessions(search = "", cursor?: string) {
    this.assertRunning();
    await this.health();
    const query = new URLSearchParams({ directory: this.client.config.directory, limit: "50", ...(cursor ? { cursor } : { order: "desc" }), ...(search ? { search } : {}) });
    const result = await this.client.json(`/api/session?${query}`, sessionsSchema);
    this.assertRunning();
    const sessions = result.data.flatMap(session => {
      try { return [sessionView(session, this.client.config.directory)]; } catch { return []; }
    });
    this.state = { ...this.state, state: "connected", errorCode: null, checkedAt: new Date().toISOString(),
      loadedSessions: { count: sessions.length, hasMore: Boolean(result.cursor.next) },
      capabilities: { inspectLoadedSessions: true, sendMessage: true, steer: true, interrupt: true, approve: true } };
    return { sessions, cursor: result.cursor.next ?? null };
  }

  async readHistory(sessionId: string, cursor: string) {
    await this.health();
    await this.session(sessionId);
    const result = await this.client.json(`${this.route(sessionId)}/message?${new URLSearchParams({ limit: "50", cursor })}`, messagesSchema);
    this.assertRunning();
    return { messages: messagesView(result.data), cursor: result.cursor.next ?? null };
  }

  async watchSession(sessionId: string, onSnapshot: Listener["snapshot"], onDisconnect: () => void) {
    this.assertRunning(); sessionIdSchema.parse(sessionId);
    let entry = this.entries.get(sessionId);
    if (!entry) {
      if (this.entries.size >= 4) throw agentError("OPENCODE_SESSION_LIMIT", 429);
      entry = { id: sessionId, epoch: this.epoch, token: randomUUID(), runKey: "", listeners: new Set(), snapshot: null,
        questions: new Map(), permissions: new Map(), refresh: null, dirty: false, writing: false,
        rawMessages: [], text: new OpenCodeStreamText(), activityHint: null };
      this.entries.set(sessionId, entry);
    }
    const listener = { snapshot: onSnapshot, disconnect: onDisconnect };
    entry.listeners.add(listener);
    const target = entry;
    const unsubscribe = () => {
      target.listeners.delete(listener);
      if (target.listeners.size) return;
      clearTimeout(target.timer);
      clearTimeout(target.textTimer);
      if (this.entries.get(sessionId) === target) this.entries.delete(sessionId);
      if (!this.entries.size) this.disconnect(false);
    };
    try {
      await this.ensureEvents();
      if (this.entries.get(sessionId) !== target || !target.listeners.has(listener)) throw agentError("OPENCODE_DISCONNECTED");
      await this.refresh(target);
      if (!target.snapshot?.connected || !this.current(target)) throw agentError("OPENCODE_DISCONNECTED");
      return unsubscribe;
    } catch (error) { unsubscribe(); throw error; }
  }

  async sendMessage(sessionId: string, raw: AgentOperation & { text: string; delivery: "steer" | "queue" }): Promise<AgentDelivery> {
    const input = operationSchema.extend({ text: z.string().trim().min(1).max(20_000), delivery: z.enum(["steer", "queue"]) }).parse(raw);
    const entry = this.lock(sessionId, input.controlToken);
    let attempted = false;
    try {
      const previous = this.submissions.get(sessionId);
      if (previous && previous.delivery !== "confirmed") throw agentError("OPENCODE_PREVIOUS_RESULT_UNKNOWN", 409);
      await this.session(sessionId); this.guard(entry, input.controlToken);
      const messageId = `msg_${input.clientMessageId.replaceAll("-", "")}`;
      this.reserveSubmission(sessionId, { clientMessageId: input.clientMessageId, action: "message", delivery: "submitted", messageId, textSignature: signature(input.text), expectedDelivery: input.delivery });
      attempted = true; this.publish(entry);
      const response = await this.client.json(`${this.route(sessionId)}/prompt`, admittedSchema, { id: messageId, text: input.text, delivery: input.delivery });
      if (response.data.id !== messageId || response.data.sessionID !== sessionId || response.data.delivery !== input.delivery || response.data.payload.text !== input.text) throw agentError("OPENCODE_PROTOCOL_ERROR");
      // The response proves admission of this ID, never completion of the task.
      this.submissions.set(sessionId, { clientMessageId: input.clientMessageId, action: "message", delivery: "confirmed", messageId, textSignature: signature(input.text) });
      return { ok: true, delivery: "confirmed" };
    } catch (error) {
      if (!attempted) throw error;
      const pending = this.submissions.get(sessionId)!;
      if (pending.delivery !== "confirmed") pending.delivery = "uncertain";
      return { ok: true, delivery: pending.delivery };
    } finally { entry.writing = false; this.publish(entry); this.schedule(entry); }
  }

  async interruptSession(sessionId: string, raw: AgentOperation): Promise<AgentDelivery> {
    const input = operationSchema.parse(raw), entry = this.lock(sessionId, input.controlToken);
    let attempted = false;
    try {
      const previous = this.submissions.get(sessionId);
      if (previous && previous.delivery !== "confirmed") throw agentError("OPENCODE_PREVIOUS_RESULT_UNKNOWN", 409);
      await this.session(sessionId);
      const active = await this.client.json("/api/session/active", activeSchema);
      this.guard(entry, input.controlToken);
      if (!active.data[sessionId]) throw agentError("OPENCODE_SESSION_IDLE", 409);
      this.reserveSubmission(sessionId, { clientMessageId: input.clientMessageId, action: "interrupt", delivery: "submitted" });
      attempted = true; this.publish(entry);
      const result = await this.client.json(`${this.route(sessionId)}/interrupt`, interruptSchema, undefined, "POST");
      if (!result.interrupted) {
        this.submissions.delete(sessionId); attempted = false;
        throw agentError("OPENCODE_SESSION_IDLE", 409);
      }
      return { ok: true, delivery: "submitted" };
    } catch (error) {
      if (!attempted) throw error;
      const pending = this.submissions.get(sessionId)!;
      if (pending.delivery !== "confirmed") pending.delivery = "uncertain";
      return { ok: true, delivery: pending.delivery };
    } finally { entry.writing = false; this.publish(entry); this.schedule(entry); }
  }

  respondQuestion(sessionId: string, id: string, raw: AgentOperation & { answers: string[][] }) {
    const input = operationSchema.extend({ answers: z.array(z.array(z.string().trim().min(1).max(10_000)).min(1).max(100)).min(1).max(20) }).parse(raw);
    return this.respond(sessionId, id, input, "question", request => openCodeFormReply(request.source, input.answers));
  }

  respondPermission(sessionId: string, id: string, raw: AgentOperation & { decision: "once" | "always" | "reject" }) {
    const input = operationSchema.extend({ decision: z.enum(["once", "always", "reject"]) }).parse(raw);
    return this.respond(sessionId, id, input, "permission", request => {
      if (!(request as RequestState<AgentPermission>).view.decisions.includes(input.decision)) throw agentError("OPENCODE_DECISION_UNAVAILABLE", 400);
      return { decision: input.decision };
    });
  }

  async stop() { this.stopped = true; this.disconnect(true); this.client.stop(); }

  private async respond(sessionId: string, id: string, input: AgentOperation, kind: "question" | "permission", body: (request: RequestState<AgentQuestion> | RequestState<AgentPermission>) => unknown): Promise<AgentDelivery> {
    const entry = this.lock(sessionId, input.controlToken);
    const requests = kind === "question" ? entry.questions : entry.permissions;
    const request = requests.get(id);
    let attempted = false, key = "";
    try {
      if (!request || request.view.status !== "pending") throw agentError("OPENCODE_REQUEST_EXPIRED", 409);
      const payload = body(request);
      await this.session(sessionId);
      const current = kind === "question"
        ? await this.client.json(`${this.route(sessionId)}/form`, formsSchema)
        : await this.client.json(`${this.route(sessionId)}/permission`, permissionsSchema);
      this.guard(entry, input.controlToken);
      const pending = current.data.find(item => item.id === request.sourceId && item.sessionID === sessionId);
      if (!pending || signature(pending) !== request.signature) throw agentError("OPENCODE_REQUEST_EXPIRED", 409);
      key = `${sessionId}:${kind}:${request.sourceId}:${request.signature}`;
      if (this.submittedRequests.has(key)) throw agentError("OPENCODE_REQUEST_ALREADY_SUBMITTED", 409);
      if (this.submittedRequests.size >= 128) throw agentError("OPENCODE_PENDING_LIMIT", 429);
      this.submittedRequests.set(key, "submitted"); request.view.status = "submitted";
      attempted = true; this.publish(entry);
      await this.client.json(`${this.route(sessionId)}/${kind === "question" ? "form" : "permission"}/${encodeURIComponent(request.sourceId)}/reply`, voidSchema, payload);
      return { ok: true, delivery: "submitted" };
    } catch (error) {
      if (!attempted) throw error;
      if (this.submittedRequests.has(key)) this.submittedRequests.set(key, "uncertain");
      request!.view.status = "uncertain";
      return { ok: true, delivery: "uncertain" };
    } finally { entry.writing = false; this.publish(entry); this.schedule(entry); }
  }

  private async health() {
    this.assertRunning();
    const info = await this.client.json("/api/info", serverInfoSchema);
    this.assertRunning();
    if (info.version !== openCodeVersion) throw agentError("OPENCODE_VERSION_UNSUPPORTED");
  }
  private async session(id: string) {
    this.assertRunning(); sessionIdSchema.parse(id);
    const response = await this.client.json(this.route(id), oneSessionSchema);
    this.assertRunning();
    if (response.data.id !== id) throw agentError("OPENCODE_PROTOCOL_ERROR");
    return sessionView(response.data, this.client.config.directory);
  }
  private route(id: string) { return `/api/session/${encodeURIComponent(id)}`; }
  private assertRunning() { if (this.stopped) throw agentError("OPENCODE_STOPPED", 503); }
  private current(entry: Entry) { return !this.stopped && this.entries.get(entry.id) === entry && entry.epoch === this.epoch && Boolean(this.closeEvents); }
  private guard(entry: Entry, token: string) {
    if (!this.current(entry) || entry.token !== token || !entry.snapshot?.connected || !entry.listeners.size) throw agentError("OPENCODE_CONTROL_EXPIRED", 409);
  }
  private lock(id: string, token: string) {
    this.assertRunning(); const entry = this.entries.get(id);
    if (!entry) throw agentError("OPENCODE_CONTROL_EXPIRED", 409);
    this.guard(entry, token);
    if (entry.writing) throw agentError("OPENCODE_WRITE_BUSY", 409);
    entry.writing = true; return entry;
  }
  private reserveSubmission(id: string, value: Submission) {
    if (!this.submissions.has(id) && this.submissions.size >= 128) {
      const completed = [...this.submissions].find(([, item]) => item.delivery === "confirmed");
      if (!completed) throw agentError("OPENCODE_PENDING_LIMIT", 429);
      this.submissions.delete(completed[0]);
    }
    this.submissions.set(id, value);
  }

  private ensureEvents(): Promise<void> {
    if (this.connection) return this.connection;
    const epoch = this.epoch;
    const pending = this.health().then(() => {
      if (this.stopped || epoch !== this.epoch) throw agentError("OPENCODE_DISCONNECTED");
      return this.client.events(event => this.event(event), () => this.disconnect(true));
    }).then(close => {
      if (this.stopped || epoch !== this.epoch) { close(); throw agentError("OPENCODE_DISCONNECTED"); }
      this.closeEvents = close;
    }).catch(error => {
      if (this.connection === pending) { this.connection = null; this.failed(error); }
      throw error;
    });
    return this.connection = pending;
  }
  private event(event: OpenCodeEvent) {
    if (event.type.startsWith("server.")) return;
    if (this.seenEvents.has(event.id)) return;
    this.seenEvents.add(event.id);
    if (this.seenEvents.size > 2048) this.seenEvents.delete(this.seenEvents.values().next().value!);
    const data = event.data;
    const id = data?.sessionID;
    for (const entry of this.entries.values()) {
      if (typeof id === "string" && entry.id !== id) continue;
      if (event.type === "session.inbox.enqueued") {
        const parsed = z.object({ sessionID: sessionIdSchema, inboxID: z.string(), item: z.object({ type: z.literal("user"), delivery: z.enum(["steer", "queue"]), payload: z.object({ text: z.string() }) }) }).safeParse(data);
        const submission = this.submissions.get(entry.id);
        if (parsed.success && parsed.data.sessionID === entry.id && submission?.messageId === parsed.data.inboxID && submission.expectedDelivery === parsed.data.item.delivery && submission.textSignature === signature(parsed.data.item.payload.text)) {
          submission.delivery = "confirmed"; this.publish(entry);
        }
      }
      try {
        if (event.type === "session.reasoning.delta" || event.type === "session.tool.input.delta") {
          const activity = event.type === "session.reasoning.delta" ? "thinking" : "working";
          if (entry.activityHint !== activity) { entry.activityHint = activity; this.publish(entry); }
          // Private token payloads do not change canonical messages or pending requests.
          continue;
        }
        const text = entry.text.apply(event, entry.id);
        if (text) entry.activityHint = "outputting";
        else if (event.type.startsWith("session.tool.") || event.type.startsWith("session.shell.")) entry.activityHint = "working";
        else if (event.type.startsWith("session.reasoning.") || event.type === "session.step.started") entry.activityHint = "thinking";
        if (text && event.type === "session.text.delta") {
          // No REST polling per token. At most 25 downstream updates per second.
          if (!entry.textTimer) entry.textTimer = setTimeout(() => { entry.textTimer = undefined; this.publish(entry); }, 40);
          continue;
        }
      } catch { this.invalidate(entry); continue; }
      this.schedule(entry);
    }
  }
  private schedule(entry: Entry) {
    if (!this.current(entry)) return;
    entry.dirty = true;
    if (entry.timer || entry.refresh) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.refresh(entry).catch(() => this.invalidate(entry));
    }, 120);
    entry.timer.unref();
  }
  private refresh(entry: Entry): Promise<void> {
    if (entry.refresh) { entry.dirty = true; return entry.refresh; }
    entry.dirty = false;
    const pending = this.readSnapshot(entry).finally(() => {
      if (entry.refresh === pending) entry.refresh = null;
      if (entry.dirty) this.schedule(entry);
    });
    return entry.refresh = pending;
  }
  private async readSnapshot(entry: Entry) {
    const [session, active] = await Promise.all([this.session(entry.id), this.client.json("/api/session/active", activeSchema)]);
    const [messages, questions, permissions] = await Promise.all([
      this.client.json(`${this.route(entry.id)}/message?limit=50&order=desc`, messagesSchema),
      this.client.json(`${this.route(entry.id)}/form`, formsSchema),
      this.client.json(`${this.route(entry.id)}/permission`, permissionsSchema),
    ]);
    if (!this.current(entry)) return;
    if (questions.data.some(q => q.sessionID !== entry.id) || permissions.data.some(p => p.sessionID !== entry.id)) throw agentError("OPENCODE_PROTOCOL_ERROR");
    const status = active.data[entry.id] ? "running" : "idle";
    const view = messagesView(messages.data);
    const runKey = `${status}:${view.filter(m => m.role === "user").at(-1)?.id ?? ""}`;
    if (entry.runKey && entry.runKey !== runKey) entry.token = randomUUID();
    entry.runKey = runKey;
    entry.questions = this.requests(entry, "question", questions.data, entry.questions, data => ({
      id: randomUUID(), status: "pending", ...openCodeQuestionView(data),
    }));
    entry.permissions = this.requests(entry, "permission", permissions.data, entry.permissions, data => {
      const detail = JSON.stringify(data.metadata, null, 2);
      const unavailableReason = !data.resources.length || detail.length > 16_000 ? "请求明细不完整或过长，请在电脑处理允许操作。" : null;
      return { id: randomUUID(), status: "pending", action: data.action, resources: data.resources, save: data.save,
        detail: detail.length > 16_000 ? "明细过长，请在电脑查看完整请求。" : detail, unavailableReason,
        decisions: unavailableReason ? ["reject"] : data.save.length ? ["once", "always", "reject"] : ["once", "reject"] };
    });
    const submission = this.submissions.get(entry.id);
    if (submission?.messageId && view.some(m => m.id === submission.messageId && m.role === "user" && signature(m.text) === submission.textSignature)) submission.delivery = "confirmed";
    if (submission?.action === "interrupt" && status === "idle") submission.delivery = "confirmed";
    const latest = [...messages.data].sort((a, b) => a.time.created - b.time.created).at(-1);
    const activeContent = latest?.type === "assistant" && !latest.time.completed ? latest.content ?? [] : [];
    const activity = activeContent.some(p => p.type === "tool" && ["running", "pending"].includes(p.state?.status ?? "")) ? "working"
      : activeContent.some(p => p.type === "text" && p.text) ? "outputting" : "thinking";
    entry.rawMessages = messages.data;
    if (status === "idle") entry.activityHint = null;
    entry.snapshot = { agentId: "opencode", session, connected: true, updatedAt: new Date().toISOString(), status, activity,
      messages: view, questions: [], permissions: [], historyCursor: messages.cursor.next ?? null, partialText: false, control: null, submission: null };
    this.publish(entry);
  }
  private requests<T extends { id: string; status: "pending" | "submitted" | "uncertain" }, D extends { id: string; sessionID: string }>(
    entry: Entry, kind: string, data: D[], previous: Map<string, RequestState<T>>, make: (value: D) => T,
  ) {
    const result = new Map<string, RequestState<T>>(), keys = new Set<string>();
    for (const item of data) {
      const digest = signature(item), key = `${entry.id}:${kind}:${item.id}:${digest}`; keys.add(key);
      const existing = [...previous.values()].find(value => value.sourceId === item.id && value.signature === digest);
      const request = existing ?? { sourceId: item.id, signature: digest, source: item, view: make(item) };
      request.view.status = this.submittedRequests.get(key) ?? "pending";
      result.set(request.view.id, request);
    }
    for (const key of this.submittedRequests.keys()) if (key.startsWith(`${entry.id}:${kind}:`) && !keys.has(key)) this.submittedRequests.delete(key);
    return result;
  }
  private publish(entry: Entry) {
    if (!entry.snapshot || !this.current(entry)) return;
    const submission = this.submissions.get(entry.id);
    const unresolved = Boolean(submission && submission.delivery !== "confirmed");
    let text: ReturnType<OpenCodeStreamText["project"]>;
    try { text = entry.text.project(entry.rawMessages); } catch { this.invalidate(entry); return; }
    const snapshot: AgentSessionSnapshot = { ...entry.snapshot, ...text, updatedAt: new Date().toISOString(),
      activity: entry.snapshot.status === "running" ? entry.activityHint ?? entry.snapshot.activity : entry.snapshot.activity,
      questions: [...entry.questions.values()].map(q => q.view), permissions: [...entry.permissions.values()].map(p => p.view),
      control: { token: entry.token, canSend: !entry.writing && !unresolved, canSteer: !entry.writing && !unresolved,
        canInterrupt: entry.snapshot.status === "running" && !entry.writing && !unresolved },
      submission: submission ? { clientMessageId: submission.clientMessageId, action: submission.action, delivery: submission.delivery } : null,
    };
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener.snapshot(structuredClone(snapshot));
  }
  private invalidate(entry: Entry) {
    clearTimeout(entry.timer);
    clearTimeout(entry.textTimer);
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    if (entry.snapshot) for (const listener of entry.listeners) listener.snapshot({ ...entry.snapshot, connected: false, control: null, questions: [], permissions: [] });
    for (const listener of entry.listeners) listener.disconnect();
    if (!this.entries.size) this.disconnect(false);
  }
  private failed(error: unknown) {
    if (this.stopped) return;
    const code = (error as { code?: unknown })?.code;
    this.state = { ...this.state, state: "failed", errorCode: typeof code === "string" && code.startsWith("OPENCODE_") ? code : "OPENCODE_CONNECTION_FAILED", capabilities: { ...emptyCapabilities }, checkedAt: new Date().toISOString() };
  }
  private disconnect(failed: boolean) {
    ++this.epoch;
    this.seenEvents.clear();
    this.closeEvents?.(); this.closeEvents = null; this.connection = null;
    if (failed) this.failed(agentError("OPENCODE_DISCONNECTED"));
    const entries = [...this.entries.values()]; this.entries.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      clearTimeout(entry.textTimer);
      if (entry.snapshot) for (const listener of entry.listeners) listener.snapshot({ ...entry.snapshot, connected: false, control: null, questions: [], permissions: [] });
      for (const listener of entry.listeners) listener.disconnect();
    }
  }
}
