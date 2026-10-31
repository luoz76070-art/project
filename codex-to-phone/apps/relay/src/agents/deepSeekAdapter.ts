import type { AgentAdapter, AgentStatus } from "./agentGateway.js";
import { DeepSeekClient } from "./deepSeekClient.js";
import { deepSeekDelivery, deepSeekHistory, deepSeekInfo, deepSeekSessionId, deepSeekSessions } from "./deepSeekProtocol.js";
import { agentError, type AgentDelivery, type AgentOperation, type AgentSessionSnapshot, type SessionAdapter } from "./sessions.js";

type Listener = { receive: (snapshot: AgentSessionSnapshot) => void; disconnect: () => void };
type Entry = { listeners: Set<Listener>; snapshot: AgentSessionSnapshot | null; pending: Promise<void>; close?: () => void };
const capabilities = { inspectLoadedSessions: false, sendMessage: false, steer: false, interrupt: false, approve: false };

export class DeepSeekAdapter implements AgentAdapter, SessionAdapter {
  readonly sessionApi: SessionAdapter = this;
  private state: AgentStatus = { id: "deepseek", label: "DeepSeek Harness", state: "unprobed", transport: "deepseek-cordis-http-sse", usesAccessibility: false,
    sameDesktopThreadVerified: false, capabilities: { ...capabilities }, loadedSessions: null, checkedAt: null, errorCode: null };
  private entries = new Map<string, Entry>();
  private stopped = false;
  private interactionLocks = new Map<string, "submitted" | "uncertain">();
  private interactionsAvailable = false;
  private probing: Promise<AgentStatus> | null = null;
  constructor(private readonly client: DeepSeekClient) {}
  validSessionId(id: string) { return deepSeekSessionId.safeParse(id).success; }
  snapshot() { return structuredClone(this.state); }
  probe(): Promise<AgentStatus> {
    if (this.probing) return this.probing;
    this.state = { ...this.state, state: "probing", errorCode: null };
    this.probing = this.listSessions().then(result => {
      if (!this.stopped) this.state = { ...this.state, state: "connected", capabilities: { ...capabilities, inspectLoadedSessions: true, sendMessage: true, steer: true, interrupt: true, approve: this.interactionsAvailable }, loadedSessions: { count: result.sessions.length, hasMore: Boolean(result.cursor) }, checkedAt: new Date().toISOString() };
      return this.snapshot();
    }, error => {
      if (!this.stopped) this.state = { ...this.state, state: "failed", capabilities: { ...capabilities }, errorCode: error.code ?? "DEEPSEEK_CONNECTION_FAILED", checkedAt: new Date().toISOString() };
      return this.snapshot();
    }).finally(() => { this.probing = null; });
    return this.probing;
  }
  private async verify() {
    if (this.stopped) throw agentError("DEEPSEEK_STOPPED", 503);
    const info = await this.client.json("/info", deepSeekInfo);
    if (this.client.config.scope === "all" && (info.scope !== "all" || info.history !== true)) throw agentError("DEEPSEEK_SCOPE_UNAVAILABLE", 409);
    this.interactionsAvailable = info.interactions === true;
  }
  async listSessions(search?: string, cursor?: string, range?: "recent" | "all") {
    await this.verify();
    const all = this.client.config.scope === "all";
    if (cursor && !all) throw agentError("DEEPSEEK_CURSOR_UNSUPPORTED", 400);
    const query = new URLSearchParams({ ...(all && search ? { search } : {}), ...(all && cursor ? { cursor } : {}), ...(all && range ? { range } : {}) });
    const result = await this.client.json("/sessions" + (query.size ? `?${query}` : ""), deepSeekSessions);
    return { ...result, sessions: result.sessions.filter(session => (all || session.directory === this.client.config.directory) && (all || !search || session.title.toLowerCase().includes(search.toLowerCase()))) };
  }
  async readHistory(id: string, cursor: string) {
    if (this.client.config.scope !== "all") throw agentError("DEEPSEEK_HISTORY_UNAVAILABLE", 409);
    if (!this.validSessionId(id) || !deepSeekSessionId.safeParse(cursor).success) throw agentError("DEEPSEEK_INPUT_INVALID", 400);
    return this.client.json(`/sessions/${encodeURIComponent(id)}/history?${new URLSearchParams({ cursor })}`, deepSeekHistory);
  }
  async watchSession(id: string, receive: Listener["receive"], disconnect: Listener["disconnect"]) {
    if (!this.validSessionId(id)) throw agentError("DEEPSEEK_INPUT_INVALID", 400);
    if (this.stopped) throw agentError("DEEPSEEK_STOPPED", 503);
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= 8) throw agentError("DEEPSEEK_BUSY", 429);
      entry = { listeners: new Set(), snapshot: null, pending: Promise.resolve() }; this.entries.set(id, entry);
      const owned = entry;
      entry.pending = this.verify().then(async () => {
        const close = await this.client.events(id, next => { for (const kind of ["questions", "permissions"] as const) {
          const prefix = `${id}:${kind}:`;
          const active = new Set(next[kind].map(request => prefix + request.id));
          for (const key of this.interactionLocks.keys()) if (key.startsWith(prefix) && !active.has(key)) this.interactionLocks.delete(key);
          for (const request of next[kind]) { const locked = this.interactionLocks.get(prefix + request.id); if (locked) request.status = locked; }
        }
        const queuePrefix = `${id}:queue:`;
        const queued = new Set((next.queue?.items ?? []).map(item => queuePrefix + item.clientMessageId));
        for (const key of this.interactionLocks.keys()) if (key.startsWith(queuePrefix) && !queued.has(key)) this.interactionLocks.delete(key);
        const snapshot: AgentSessionSnapshot = next;
        for (const item of snapshot.queue?.items ?? []) {
          const lock = this.interactionLocks.get(queuePrefix + item.clientMessageId);
          if (lock) item.status = lock === "uncertain" ? "uncertain" : "cancelling";
        }
        owned.snapshot = snapshot; for (const listener of owned.listeners) listener.receive(structuredClone(snapshot)); }, () => {
          this.entries.delete(id); for (const listener of owned.listeners) listener.disconnect(); owned.listeners.clear();
        });
        if (this.stopped || this.entries.get(id) !== owned) close(); else owned.close = close;
      });
    }
    const listener = { receive, disconnect }; entry.listeners.add(listener);
    try { await entry.pending; }
    catch (error) { entry.listeners.delete(listener); if (this.entries.get(id) === entry) this.entries.delete(id); throw error; }
    if (this.stopped || this.entries.get(id) !== entry) throw agentError("DEEPSEEK_DISCONNECTED");
    if (entry.snapshot) receive(structuredClone(entry.snapshot));
    return () => { entry.listeners.delete(listener); if (!entry.listeners.size && this.entries.get(id) === entry) { this.entries.delete(id); entry.close?.(); } };
  }
  private async operate(id: string, input: AgentOperation & { text?: string; delivery?: "queue" | "steer" }, action: "message" | "interrupt"): Promise<AgentDelivery> {
    const entry = this.entries.get(id), snapshot = entry?.snapshot;
    if (!snapshot?.connected || snapshot.control?.token !== input.controlToken || !entry?.listeners.size) throw agentError("DEEPSEEK_STALE_CONTROL", 409);
    if ((action === "message" && !snapshot.control.canSend) || (action === "interrupt" && !snapshot.control.canInterrupt)
      || (input.delivery === "steer" && !snapshot.control.canSteer)) throw agentError("DEEPSEEK_CONTROL_UNAVAILABLE", 409);
    // The host owns admission. A lost result locks the local view until authoritative sync.
    snapshot.submission = { clientMessageId: input.clientMessageId, action, delivery: "submitted" };
    snapshot.control = { ...snapshot.control, canSend: false, canSteer: false, canInterrupt: false };
    try { return await this.client.json(`/sessions/${encodeURIComponent(id)}/${action === "message" ? "messages" : "interrupt"}`, deepSeekDelivery, input); }
    catch (error) {
      const current = entry.snapshot;
      if (current?.submission?.clientMessageId === input.clientMessageId && current.submission.delivery === "confirmed") return { ok: true, delivery: "confirmed" };
      if ([400, 403, 404, 409, 410, 429].includes((error as { statusCode?: number }).statusCode ?? 0)) {
        this.entries.delete(id); entry.close?.(); for (const listener of entry.listeners) listener.disconnect(); entry.listeners.clear(); throw error;
      }
      if (current?.submission?.clientMessageId === input.clientMessageId) {
        current.submission.delivery = "uncertain";
        if (current.control) current.control = { ...current.control, canSend: false, canSteer: false, canInterrupt: false };
        for (const listener of entry.listeners) listener.receive(structuredClone(current));
      }
      return { ok: true, delivery: "uncertain" };
    }
  }
  sendMessage(id: string, input: AgentOperation & { text: string; delivery: "queue" | "steer" }) { return this.operate(id, input, "message"); }
  async cancelQueuedMessage(id: string, queuedId: string, input: AgentOperation): Promise<AgentDelivery> {
    const entry = this.entries.get(id), snapshot = entry?.snapshot;
    if (!snapshot?.connected || snapshot.control?.token !== input.controlToken || !entry?.listeners.size) throw agentError("DEEPSEEK_STALE_CONTROL", 409);
    const item = snapshot.queue?.available && snapshot.queue.items.find(value => value.clientMessageId === queuedId);
    if (!item || !["waiting", "paused"].includes(item.status)) throw agentError("DEEPSEEK_QUEUE_ITEM_EXPIRED", 409);
    if (this.interactionLocks.size >= 256) throw agentError("DEEPSEEK_BUSY", 429);
    const key = `${id}:queue:${queuedId}`;
    this.interactionLocks.set(key, "submitted"); item.status = "cancelling";
    for (const listener of entry.listeners) listener.receive(structuredClone(snapshot));
    try {
      const result = await this.client.json(`/sessions/${encodeURIComponent(id)}/queue/${encodeURIComponent(queuedId)}/cancel`, deepSeekDelivery, input);
      if (result.delivery === "uncertain" && this.interactionLocks.has(key)) {
        this.interactionLocks.set(key, "uncertain");
        const active = this.entries.get(id), current = active?.snapshot?.queue?.items.find(value => value.clientMessageId === queuedId);
        if (current) { current.status = "uncertain"; for (const listener of active!.listeners) listener.receive(structuredClone(active!.snapshot!)); }
      }
      return result;
    } catch (error) {
      if ([400, 403, 404, 409, 410, 429].includes((error as { statusCode?: number }).statusCode ?? 0)) {
        this.interactionLocks.delete(key); if (this.entries.get(id) === entry) this.entries.delete(id); entry.close?.();
        for (const listener of entry.listeners) listener.disconnect(); entry.listeners.clear(); throw error;
      }
      if (this.interactionLocks.has(key)) this.interactionLocks.set(key, "uncertain");
      const active = this.entries.get(id), current = active?.snapshot?.queue?.items.find(value => value.clientMessageId === queuedId);
      if (current) { current.status = "uncertain"; for (const listener of active!.listeners) listener.receive(structuredClone(active!.snapshot!)); }
      return { ok: true, delivery: "uncertain" };
    }
  }
  interruptSession(id: string, input: AgentOperation) { return this.operate(id, input, "interrupt"); }
  private async respond(id: string, requestId: string, input: AgentOperation & { answers?: string[][]; decision?: "once" | "always" | "reject" }, kind: "questions" | "permissions"): Promise<AgentDelivery> {
    const entry = this.entries.get(id), snapshot = entry?.snapshot;
    if (!snapshot?.connected || snapshot.control?.token !== input.controlToken || !entry?.listeners.size) throw agentError("DEEPSEEK_STALE_CONTROL", 409);
    const request = snapshot[kind].find(value => value.id === requestId);
    if (!request || request.status !== "pending") throw agentError("DEEPSEEK_REQUEST_EXPIRED", 409);
    if (kind === "permissions" && (!input.decision || !(request as AgentSessionSnapshot["permissions"][number]).decisions.includes(input.decision))) throw agentError("DEEPSEEK_DECISION_UNAVAILABLE", 409);
    if (this.interactionLocks.size >= 256) throw agentError("DEEPSEEK_BUSY", 429);
    const key = `${id}:${kind}:${requestId}`;
    this.interactionLocks.set(key, "submitted");
    request.status = "submitted";
    for (const listener of entry.listeners) listener.receive(structuredClone(snapshot));
    try {
      const result = await this.client.json(`/sessions/${encodeURIComponent(id)}/${kind}/${encodeURIComponent(requestId)}/respond`, deepSeekDelivery, input);
      if (result.delivery === "uncertain" && this.interactionLocks.has(key)) this.interactionLocks.set(key, "uncertain");
      return result;
    }
    catch (error) {
      if ([400, 403, 404, 409, 410, 429].includes((error as { statusCode?: number }).statusCode ?? 0)) {
        this.interactionLocks.delete(key);
        this.entries.delete(id); entry.close?.(); for (const listener of entry.listeners) listener.disconnect(); entry.listeners.clear(); throw error;
      }
      if (this.interactionLocks.has(key)) this.interactionLocks.set(key, "uncertain");
      const current = entry.snapshot?.[kind].find(value => value.id === requestId);
      if (current) { current.status = "uncertain"; for (const listener of entry.listeners) listener.receive(structuredClone(entry.snapshot!)); }
      return { ok: true, delivery: "uncertain" };
    }
  }
  respondQuestion(id: string, requestId: string, input: AgentOperation & { answers: string[][] }) { return this.respond(id, requestId, input, "questions"); }
  respondPermission(id: string, requestId: string, input: AgentOperation & { decision: "once" | "always" | "reject" }) { return this.respond(id, requestId, input, "permissions"); }
  async stop() { this.stopped = true; this.client.stop(); for (const entry of this.entries.values()) { entry.close?.(); for (const listener of entry.listeners) listener.disconnect(); } this.entries.clear(); this.interactionLocks.clear(); }
}
