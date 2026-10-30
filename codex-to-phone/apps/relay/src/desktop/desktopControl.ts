import { CodexStore, type CodexMessage, type CodexThreadSummary } from "../store/codexStore.js";
import { createHash, randomUUID } from "node:crypto";
import { DesktopIpcClient, getDesktopIpcPipePath, type DesktopIpcClientStatus } from "./desktopIpcClient.js";
import { MacosUiInjector, type MacosUiInjectorStatus } from "./macosUiInjector.js";
import { asyncQuestionReply, conversationTurns, desktopQuestionCandidates, interactionError, record, validateQuestionAnswers, type DesktopQuestionCandidate, type UserInputRequest } from "./desktopQuestions.js";
import { DesktopNativeControl, type DesktopControlCapability, type DesktopTransport, type NativeControlInput, type NativeControlOutcome } from "./desktopNativeControl.js";
import { DesktopApprovals, type DesktopApproval, type DesktopApprovalDecision } from "./desktopApprovals.js";
import { DesktopMessageQueue } from "./desktopMessageQueue.js";

type QuestionBinding = { candidate: DesktopQuestionCandidate; view: UserInputRequest; signature: string };
type PendingQuestion = { threadId: string; status: Exclude<UserInputRequest["status"], "pending"> };
type FollowedThread = { refs: number; epoch: string; owner: string | null; revision: number | null; connecting: boolean; questions: Map<string, QuestionBinding>; deadline?: NodeJS.Timeout };

type DesktopControlAction = "start-turn" | "steer-turn" | "interrupt-turn" | "ui-submit" | "queue-message";
type DesktopControlMode = "auto" | "start" | "steer" | "queue";
type DesktopControlRuntime = "desktop-ipc-follower-control" | "macos-ui-injector-control";
type DesktopThreadSignal = "ipc-stream" | "session-index";
type DesktopStreamThread = {
  conversationId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceClientId: string | null;
  changeType: string | null;
  eventCount: number;
};

export type DesktopStreamSnapshot = {
  threadId: string;
  status: "starting" | "inProgress" | "completed" | "interrupted" | "failed";
  messages: CodexMessage[];
  inputReplacements?: { turnId: string; replacesMessageId: string; nativeMessageId: string; clientMessageId?: string }[];
  messageCount: number;
  eventCount: number;
  updatedAt: string;
  changeType: string | null;
  source: "desktop-ipc";
  userInputs?: UserInputRequest[];
  approvals?: DesktopApproval[];
  interactionsAvailable?: boolean;
  control?: DesktopControlCapability;
};

export type DesktopControlResult = {
  ok: boolean;
  mode: DesktopControlRuntime;
  action: DesktopControlAction;
  thread: CodexThreadSummary | null;
  ipc: DesktopIpcClientStatus;
  macosInput?: MacosUiInjectorStatus;
  result?: unknown;
  warning?: string;
  error?: string;
  delivery?: NativeControlOutcome["delivery"];
  turnStatus?: NativeControlOutcome["turnStatus"];
};

export class DesktopControl {
  private readonly client: DesktopIpcClient;
  private readonly macosUi = new MacosUiInjector();
  private readonly uiVerificationTimeoutMs = Math.max(0, Number(process.env.MOBILE_CODEX_UI_VERIFY_TIMEOUT_MS ?? 1500));
  private activeConversationId: string | null = null;
  private readonly streamThreads = new Map<string, DesktopStreamThread>();
  private readonly streamStates = new Map<string, unknown>();
  private readonly streamSnapshots = new Map<string, DesktopStreamSnapshot>();
  private readonly streamWaiters = new Set<() => void>();
  private readonly streamSnapshotListeners = new Set<(snapshot: DesktopStreamSnapshot) => void>();
  private readonly followed = new Map<string, FollowedThread>();
  private readonly unconfirmedQuestions = new Map<string, PendingQuestion>();
  private retryTimer: NodeJS.Timeout | null = null;
  private retryAttempt = 0;
  private stopped = false;
  private readonly confirmationMs: number;
  private readonly nativeControl: DesktopNativeControl;
  private readonly approvalControl: DesktopApprovals;
  private readonly transport: DesktopTransport;
  readonly messageQueue: DesktopMessageQueue;

  constructor(private readonly store: CodexStore, options: { client?: DesktopIpcClient; codexHome?: string; confirmationMs?: number; transport?: DesktopTransport } = {}) {
    this.client = options.client ?? new DesktopIpcClient({ clientType: "mobile-codex-relay-desktop-control", pipePath: getDesktopIpcPipePath(options.codexHome), requestTimeoutMs: 5_000 });
    this.confirmationMs = options.confirmationMs ?? 2_000;
    this.transport = options.transport ?? (process.platform === "darwin" ? "legacy" : "native");
    this.nativeControl = new DesktopNativeControl({
      read: id => {
        const session = this.followed.get(id), state = record(this.streamStates.get(id));
        return session?.owner && session.revision != null && state && this.client.getStatus().initialized
          ? { owner: session.owner, epoch: session.epoch, state } : null;
      },
      request: (method, params, owner, version) => this.client.sendRequest(method, params, { targetClientId: owner, version }),
      wait: finished => this.waitForNativeConfirmation(finished),
      changed: id => this.emitStreamSnapshot(id, "control"),
    });
    this.messageQueue = new DesktopMessageQueue({
      view: id => { const snapshot = this.streamSnapshots.get(id); return snapshot && this.transport === "native" ? { control: this.nativeControl.capability(id, this.transport), status: snapshot.status } : null; },
      confirmed: (id, messageId) => this.nativeControl.messageConfirmed(id, messageId),
      send: input => this.nativeControl.send(input),
      follow: id => this.followThread(id),
      changed: id => this.emitStreamSnapshot(id, "queue"),
    });
    this.approvalControl = new DesktopApprovals({
      read: id => {
        const session = this.followed.get(id), state = record(this.streamStates.get(id));
        return session?.owner && session.revision != null && state && this.client.getStatus().initialized
          ? { owner: session.owner, epoch: session.epoch, state } : null;
      },
      request: (method, params, owner) => this.client.sendRequest(method, params, { targetClientId: owner, version: 1 }),
      wait: finished => this.waitForNativeConfirmation(finished),
      changed: id => this.emitStreamSnapshot(id, "approval"),
    });
    this.client.onAnyMessage((message) => this.handleIpcMessage(message));
    this.client.onDisconnect(() => {
      for (const [id, session] of this.followed) this.invalidateFollow(id, session);
      this.scheduleFollowRetry();
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.messageQueue.stop();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const [id, session] of this.followed) this.invalidateFollow(id, session);
    this.followed.clear();
    await this.client.disconnect();
  }

  followThread(threadId: string): () => void {
    if (this.stopped) return () => {};
    let session = this.followed.get(threadId);
    if (!session) {
      if (this.followed.size >= 16) throw interactionError("desktop_follow_limit", 429);
      session = { refs: 0, epoch: randomUUID(), owner: null, revision: null, connecting: false, questions: new Map() };
      this.followed.set(threadId, session);
    }
    session.refs++;
    void this.connectFollow(threadId, session);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--session.refs > 0 || this.followed.get(threadId) !== session) return;
      this.followed.delete(threadId);
      this.invalidateFollow(threadId, session);
      void this.client.sendBroadcast("thread-stream-following-changed", { conversationId: threadId, hostId: "local", following: false }, 1).catch(() => {});
    };
  }

  private async connectFollow(threadId: string, session: FollowedThread): Promise<void> {
    if (session.connecting || session.owner || this.stopped) return;
    const epoch = session.epoch;
    session.connecting = true;
    try {
      await this.client.connect();
      const owner = await this.client.sendRequest("thread-owner-discovery", { conversationId: threadId, hostId: "local" }, { version: 1 });
      if (this.followed.get(threadId) !== session || session.epoch !== epoch || this.stopped) return;
      if (owner.resultType !== "success" || !owner.handledByClientId) throw interactionError("desktop_owner_unavailable");
      session.owner = owner.handledByClientId;
      await this.client.sendBroadcast("thread-stream-following-changed", { conversationId: threadId, hostId: "local", following: true }, 1, [session.owner]);
      if (session.revision == null && session.epoch === epoch) {
        session.deadline = setTimeout(() => { this.invalidateFollow(threadId, session); this.scheduleFollowRetry(); }, 5_000);
        session.deadline.unref();
      }
    } catch {
      if (session.epoch === epoch) this.invalidateFollow(threadId, session);
      this.scheduleFollowRetry();
    } finally {
      session.connecting = false;
    }
  }

  private scheduleFollowRetry(): void {
    if (this.stopped || !this.followed.size || this.retryTimer) return;
    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(this.retryAttempt++, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      for (const [id, session] of this.followed) void this.connectFollow(id, session);
    }, delayMs * (0.75 + Math.random() * 0.25));
    this.retryTimer.unref();
  }

  private invalidateFollow(threadId: string, session: FollowedThread): void {
    clearTimeout(session.deadline); session.deadline = undefined;
    for (const pending of this.unconfirmedQuestions.values()) if (pending.threadId === threadId) pending.status = "uncertain";
    session.epoch = randomUUID(); session.owner = null; session.revision = null; session.questions.clear();
    this.approvalControl.invalidate(threadId);
    this.streamStates.delete(threadId);
    const previous = this.streamSnapshots.get(threadId);
    if (previous) {
      const snapshot = { ...previous, userInputs: [], approvals: [], interactionsAvailable: false, control: this.nativeControl.capability(threadId, this.transport), changeType: "disconnected", updatedAt: new Date().toISOString() };
      if (this.transport === "native") snapshot.control.queue = this.messageQueue.snapshot(threadId);
      this.streamSnapshots.set(threadId, snapshot);
      for (const listener of this.streamSnapshotListeners) listener(snapshot);
    }
    for (const waiter of [...this.streamWaiters]) waiter();
  }

  async respondUserInput(threadId: string, inputId: string, value: unknown): Promise<{ status: "resolved" | "submitted" | "uncertain" }> {
    const session = this.followed.get(threadId);
    const binding = session?.questions.get(inputId);
    if (!session || !binding || !session.owner || session.revision == null || !this.client.getStatus().initialized) throw interactionError("question_expired");
    if (binding.view.status !== "pending" || this.unconfirmedQuestions.has(binding.signature)) throw interactionError("question_already_submitted");
    const answers = validateQuestionAnswers(binding.view, value);
    const candidate = binding.candidate;
    const capability = candidate.kind === "desktop-async" ? this.nativeControl.capability(threadId, "native") : null;
    if (capability && !capability.canSend) throw interactionError("desktop_submission_pending");
    if (capability?.activeTurnId != null && capability.activeTurnId !== candidate.turnId) throw interactionError("question_expired");
    if (this.unconfirmedQuestions.size >= 128) throw interactionError("desktop_question_limit", 429);
    const epoch = session.epoch;
    const owner = session.owner;
    const pending: PendingQuestion = { threadId, status: "submitting" };
    this.unconfirmedQuestions.set(binding.signature, pending);
    binding.view.status = "submitting";
    this.emitStreamSnapshot(threadId, "user-input");
    try {
      if (capability) {
        const outcome = await this.nativeControl.send({
          threadId, controlToken: capability.token!, expectedTurnId: capability.activeTurnId,
          clientMessageId: randomUUID(), message: asyncQuestionReply(binding.view, answers),
          mode: capability.activeTurnId ? "steer" : "start",
        });
        if (session.epoch !== epoch) throw interactionError("question_response_unknown");
        if (!session.questions.has(inputId)) return { status: "resolved" };
        if (outcome.delivery === "uncertain") throw interactionError("question_response_unknown");
      } else {
        const method = "thread-follower-submit-user-input";
        const response = await this.client.sendRequest(method, {
          conversationId: threadId, requestId: candidate.requestId,
          response: { answers: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, { answers: values }])) },
        }, { targetClientId: owner, version: 1 });
        if (session.epoch !== epoch) throw interactionError("question_response_unknown");
        if (!session.questions.has(inputId)) return { status: "resolved" };
        const outer = record(response.result), result = record(outer?.result ?? outer);
        if (response.resultType !== "success" || response.method !== method || response.handledByClientId !== owner || (outer?.method != null && outer.method !== method) || result?.ok !== true) throw interactionError("question_response_unknown");
      }
      pending.status = binding.view.status = "submitted";
      this.emitStreamSnapshot(threadId, "user-input");
      // An IPC acknowledgement can also mean the owner ignored a stale request.
      // Only a subsequent authoritative state proves that the question was handled.
      if (!capability) await this.waitForQuestionResolution(session, inputId, epoch);
      if (session.epoch !== epoch) return { status: "uncertain" };
      return { status: session.questions.has(inputId) ? "submitted" : "resolved" };
    } catch {
      if (session.epoch === epoch && !session.questions.has(inputId)) return { status: "resolved" };
      pending.status = "uncertain";
      if (session.epoch === epoch && session.questions.has(inputId)) {
        binding.view.status = "uncertain";
        this.emitStreamSnapshot(threadId, "user-input");
      }
      return { status: "uncertain" };
    }
  }

  private waitForQuestionResolution(session: FollowedThread, id: string, epoch: string): Promise<void> {
    return this.waitForNativeConfirmation(() => !session.questions.has(id) || session.epoch !== epoch);
  }

  respondApproval(threadId: string, approvalId: string, decision: DesktopApprovalDecision) {
    return this.approvalControl.respond(threadId, approvalId, decision);
  }

  private waitForNativeConfirmation(finished: () => boolean): Promise<void> {
    if (finished()) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.streamWaiters.delete(check); resolve(); };
      const check = () => { if (finished()) done(); };
      const timer = setTimeout(done, this.confirmationMs);
      this.streamWaiters.add(check);
    });
  }

  async status(): Promise<{
    ok: boolean;
    mode: DesktopControlRuntime;
    ipc: DesktopIpcClientStatus;
    macosInput?: MacosUiInjectorStatus;
    activeThread: CodexThreadSummary | null;
    activeThreadSource: DesktopThreadSignal;
    activeStreamThreadId: string | null;
    streamThreadIds: string[];
    capabilities: string[];
    error?: string;
  }> {
    if (process.platform === "darwin" && this.transport === "legacy") {
      await this.client.connect().catch(() => undefined);
      const { thread: activeThread, source: activeThreadSource } = await this.getActiveThreadFromSignals();
      return {
        ok: true,
        mode: "macos-ui-injector-control",
        ipc: this.client.getStatus(),
        macosInput: this.macosUi.status(),
        activeThread,
        activeThreadSource,
        activeStreamThreadId: this.activeConversationId,
        streamThreadIds: [...this.streamThreads.keys()],
        capabilities: ["desktop-tail", "macos-codex-deeplink-focus", "macos-ui-input", "desktop-ipc-follower-control"],
      };
    }

    try {
      const ipc = await this.client.connect();
      const { thread: activeThread, source: activeThreadSource } = await this.getActiveThreadFromSignals();
      return {
        ok: true,
        mode: "desktop-ipc-follower-control",
        ipc,
        activeThread,
        activeThreadSource,
        activeStreamThreadId: this.activeConversationId,
        streamThreadIds: [...this.streamThreads.keys()],
        capabilities: ["desktop-tail", "active-stream-detection", "start-turn", "steer-turn", "interrupt-turn"],
      };
    } catch (error) {
      const activeThread = await this.store.getActiveDesktopThread().catch(() => null);
      return {
        ok: false,
        mode: "desktop-ipc-follower-control",
        ipc: this.client.getStatus(),
        activeThread,
        activeThreadSource: "session-index",
        activeStreamThreadId: this.activeConversationId,
        streamThreadIds: [...this.streamThreads.keys()],
        capabilities: ["desktop-tail"],
        error: toErrorMessage(error),
      };
    }
  }

  async getActiveThread(): Promise<{ thread: CodexThreadSummary | null; source: DesktopThreadSignal; streamThreadIds: string[] }> {
    await this.client.connect().catch(() => undefined);
    const { thread, source } = await this.getActiveThreadFromSignals();
    return { thread, source, streamThreadIds: [...this.streamThreads.keys()] };
  }

  getStreamSnapshot(threadId: string): DesktopStreamSnapshot | null {
    return this.streamSnapshots.get(threadId) ?? null;
  }

  onStreamSnapshot(handler: (snapshot: DesktopStreamSnapshot) => void): () => void {
    this.streamSnapshotListeners.add(handler);
    return () => this.streamSnapshotListeners.delete(handler);
  }

  async sendMessage(params: {
    threadId: string;
    message: string;
    cwd?: string | null;
    mode?: DesktopControlMode;
    clientMessageId?: string;
    controlToken?: string;
    expectedTurnId?: string | null;
    owner?: string;
  }): Promise<DesktopControlResult> {
    const thread = await this.getThread(params.threadId);

    if (process.platform === "darwin" && this.transport === "legacy") {
      if (params.mode === "queue") throw interactionError("desktop_queue_unavailable", 409);
      return this.sendViaMacosUi(params.threadId, params.message, thread);
    }
    if (params.mode === "queue") {
      if (!params.clientMessageId) throw interactionError("desktop_control_refresh_required");
      await this.messageQueue.enqueue({ threadId: params.threadId, clientMessageId: params.clientMessageId, message: params.message }, params.owner ?? "admin", () => { this.nativeControl.validate(params); });
      return { ok: true, action: "queue-message", delivery: "confirmed", mode: "desktop-ipc-follower-control", thread, ipc: this.client.getStatus() };
    }
    return { ...await this.nativeControl.send({ ...params, mode: params.mode }), mode: "desktop-ipc-follower-control", thread, ipc: this.client.getStatus() };
  }

  async interruptThread(threadId: string, guard: Omit<NativeControlInput, "threadId"> = {}): Promise<DesktopControlResult> {
    const thread = await this.getThread(threadId);
    return { ...await this.nativeControl.interrupt({ threadId, ...guard }), mode: "desktop-ipc-follower-control", thread, ipc: this.client.getStatus() };
  }

  private async sendViaMacosUi(
    threadId: string,
    message: string,
    thread: CodexThreadSummary | null,
  ): Promise<DesktopControlResult> {
    const startedAtMs = Date.now();
    try {
      const injection = await this.macosUi.sendMessage({ threadId, message });
      const verification = await this.waitForUserMessage(threadId, message, startedAtMs);
      return {
        ok: true,
        mode: "macos-ui-injector-control",
        action: "ui-submit",
        thread,
        ipc: this.client.getStatus(),
        macosInput: this.macosUi.status(),
        result: { injection, verification },
        warning: verification.ok ? undefined : verification.reason,
      };
    } catch (error) {
      return {
        ok: false,
        mode: "macos-ui-injector-control",
        action: "ui-submit",
        thread,
        ipc: this.client.getStatus(),
        macosInput: this.macosUi.status(),
        error: toErrorMessage(error),
      };
    }
  }

  private async waitForUserMessage(
    threadId: string,
    message: string,
    startedAtMs: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const expected = normalizeInjectedText(message);
    const deadline = Date.now() + this.uiVerificationTimeoutMs;
    while (Date.now() < deadline) {
      const read = await this.store.readThreadLatest(threadId, 786_432, 160).catch(() => null);
      const found = read?.messages.some((item) => {
        if (item.role !== "user") return false;
        const timestampMs = Date.parse(item.timestamp);
        if (Number.isFinite(timestampMs) && timestampMs < startedAtMs - 5_000) return false;
        return normalizeInjectedText(item.text) === expected;
      });
      if (found) return { ok: true };
      await delay(250);
    }
    return { ok: false, reason: "macOS UI injector submitted, but the bound Codex Desktop thread has not recorded the phone message yet" };
  }

  private async getThread(threadId: string): Promise<CodexThreadSummary | null> {
    return this.store.getThreadSummary(threadId).catch(() => null);
  }

  private async getActiveThreadFromSignals(): Promise<{ thread: CodexThreadSummary | null; source: DesktopThreadSignal }> {
    if (!this.activeConversationId) await this.waitForStreamSignal(800);
    const candidateId = this.activeConversationId ?? this.streamThreads.keys().next().value ?? null;
    if (candidateId) {
      const thread = await this.getThread(candidateId);
      if (thread) return { thread, source: "ipc-stream" };
    }
    return { thread: await this.store.getActiveDesktopThread(), source: "session-index" };
  }

  private waitForStreamSignal(timeoutMs: number): Promise<void> {
    if (this.activeConversationId || timeoutMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        this.streamWaiters.delete(done);
        resolve();
      };
      const timeout = setTimeout(done, timeoutMs);
      this.streamWaiters.add(done);
    });
  }

  private handleIpcMessage(message: unknown): void {
    if (!isDesktopBroadcast(message)) return;
    if (message.method === "ipc-connection-reset" || message.method === "client-status-changed") {
      const params = record(message.params);
      for (const [id, session] of this.followed) {
        if (message.method === "ipc-connection-reset" || (params?.status === "disconnected" && params.clientId === session.owner)) this.invalidateFollow(id, session);
      }
      this.scheduleFollowRetry();
      return;
    }
    if (message.method === "thread-stream-following-status-requested") {
      const params = record(message.params);
      const id = typeof params?.conversationId === "string" ? params.conversationId : "";
      const session = this.followed.get(id);
      if (session?.owner && params?.hostId === "local") void this.client.sendBroadcast("thread-stream-following-changed", { conversationId: id, hostId: "local", following: true }, 1, [session.owner]).catch(() => {});
      return;
    }
    if (message.method !== "thread-stream-state-changed") return;
    const conversationId = getConversationId(message.params);
    if (!conversationId) return;
    const session = this.followed.get(conversationId);
    if (message.version === 11) {
      if (!session || !this.applyFollowedChange(conversationId, session, message)) return;
    } else {
      // Legacy broadcasts remain read-only. They cannot validate pending questions.
      if (session || (message.version !== undefined && message.version !== 1)) return;
      this.applyStreamChange(conversationId, message.params);
    }
    this.pruneStreams(conversationId);
    const existing = this.streamThreads.get(conversationId);
    const now = new Date().toISOString();
    const changeType = getChangeType(message.params);

    this.streamThreads.set(conversationId, {
      conversationId,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      sourceClientId: typeof message.sourceClientId === "string" ? message.sourceClientId : null,
      changeType,
      eventCount: (existing?.eventCount ?? 0) + 1,
    });
    if (!this.activeConversationId || changeType !== "snapshot") {
      this.activeConversationId = conversationId;
    }
    this.emitStreamSnapshot(conversationId, changeType);
    for (const waiter of [...this.streamWaiters]) waiter();
  }

  private applyFollowedChange(threadId: string, session: FollowedThread, message: { sourceClientId?: unknown; params?: unknown }): boolean {
    const params = record(message.params), change = record(params?.change);
    if (!session.owner || message.sourceClientId !== session.owner || params?.hostId !== "local" || !change) return false;
    if (!Number.isSafeInteger(change.revision) || Number(change.revision) < 0) return false;
    const revision = Number(change.revision);
    if (session.revision != null && revision < session.revision) return false;
    let state: Record<string, unknown> | null = null;
    if (change.type === "snapshot") {
      state = record(change.conversationState);
      if (!state || state.id !== threadId || (state.hostId != null && state.hostId !== "local")) return false;
    } else if (change.type === "patches") {
      if (session.revision === revision) return false;
      if (session.revision == null || change.baseRevision !== session.revision || !Array.isArray(change.patches)) {
        this.invalidateFollow(threadId, session); this.scheduleFollowRetry(); void this.connectFollow(threadId, session); return false;
      }
      try { state = record(applyStatePatches(this.streamStates.get(threadId), change.patches, true)); }
      catch { this.invalidateFollow(threadId, session); this.scheduleFollowRetry(); void this.connectFollow(threadId, session); return false; }
      if (!state || state.id !== threadId) return false;
    } else return false;
    this.streamStates.set(threadId, state);
    clearTimeout(session.deadline); session.deadline = undefined;
    this.retryAttempt = 0;
    session.revision = revision;
    this.approvalControl.sync(threadId, state);
    const previous = new Map([...session.questions.values()].map(binding => [binding.candidate.key, binding]));
    const candidates = desktopQuestionCandidates(threadId, state).map(candidate => ({ candidate, signature: createHash("sha256").update(JSON.stringify(candidate)).digest("hex") }));
    const signatures = new Set(candidates.map(({ signature }) => signature));
    for (const [signature, pending] of this.unconfirmedQuestions) if (pending.threadId === threadId && !signatures.has(signature)) this.unconfirmedQuestions.delete(signature);
    session.questions.clear();
    for (const { candidate, signature } of candidates) {
      const old = previous.get(candidate.key);
      const binding: QuestionBinding = old?.signature === signature ? old : { candidate, signature, view: {
        id: randomUUID(), threadId, turnId: candidate.turnId, kind: candidate.kind, status: this.unconfirmedQuestions.get(signature)?.status ?? "pending", questions: candidate.questions,
      } };
      session.questions.set(binding.view.id, binding);
    }
    return true;
  }

  private pruneStreams(incomingId: string) {
    const ordered = [...this.streamThreads.entries()].sort(([,a],[,b]) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt));
    for (const [id, thread] of ordered) {
      if (id === incomingId || id === this.activeConversationId || this.followed.has(id)) continue;
      if (this.streamThreads.size < 16 && Date.now() - Date.parse(thread.lastSeenAt) < 30 * 60_000) continue;
      this.streamThreads.delete(id); this.streamStates.delete(id); this.streamSnapshots.delete(id);
    }
  }

  private applyStreamChange(conversationId: string, params: unknown): void {
    const change = getChange(params);
    if (!change) return;
    const type = typeof change.type === "string" ? change.type : null;
    if (type === "snapshot" && change.conversationState && typeof change.conversationState === "object") {
      this.streamStates.set(conversationId, change.conversationState);
      return;
    }
    if (type !== "patches") return;
    const patches = Array.isArray(change.patches) ? change.patches : [];
    const current = this.streamStates.get(conversationId);
    if (!current || patches.length === 0) return;
    try {
      this.streamStates.set(conversationId, applyStatePatches(current, patches));
    } catch {
      // If Codex changes the private patch format, keep the last valid snapshot and let rollout polling repair the phone UI.
    }
  }

  private emitStreamSnapshot(conversationId: string, changeType: string | null): void {
    const conversationState = this.streamStates.get(conversationId);
    if (!conversationState) return;
    const streamThread = this.streamThreads.get(conversationId);
    const snapshot = conversationToStreamSnapshot(conversationId, conversationState, changeType, streamThread?.eventCount ?? 0);
    if (!snapshot) return;
    const session = this.followed.get(conversationId);
    snapshot.interactionsAvailable = Boolean(session?.owner && session.revision != null);
    snapshot.control = this.nativeControl.capability(conversationId, this.transport);
    if (this.transport === "native") snapshot.control.queue = this.messageQueue.snapshot(conversationId);
    snapshot.userInputs = session ? [...session.questions.values()].map(binding => ({ ...binding.view })) : [];
    snapshot.approvals = snapshot.interactionsAvailable ? this.approvalControl.snapshot(conversationId) : [];
    this.streamSnapshots.set(conversationId, snapshot);
    for (const listener of [...this.streamSnapshotListeners]) listener(snapshot);
    this.messageQueue.notify(conversationId);
  }

}

function isDesktopBroadcast(value: unknown): value is { type: "broadcast"; method: string; sourceClientId?: unknown; version?: number; params?: unknown } {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "broadcast");
}

function getConversationId(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  return typeof record.conversationId === "string" && record.conversationId.length > 0 ? record.conversationId : null;
}

function getChangeType(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const change = (params as Record<string, unknown>).change;
  if (!change || typeof change !== "object") return null;
  const type = (change as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

function getChange(params: unknown): Record<string, unknown> | null {
  if (!params || typeof params !== "object") return null;
  const change = (params as Record<string, unknown>).change;
  return change && typeof change === "object" && !Array.isArray(change) ? (change as Record<string, unknown>) : null;
}

function conversationToStreamSnapshot(
  conversationId: string,
  conversationState: unknown,
  changeType: string | null,
  eventCount: number,
): DesktopStreamSnapshot | null {
  if (!conversationState || typeof conversationState !== "object") return null;
  const state = conversationState as Record<string, unknown>;
  const allMessages = extractConversationMessages(state);
  const messages = allMessages.slice(-120);
  // Keep identity repair independent of the bounded message tail. No body or
  // control data is included; only the latest 240 initial-input relations.
  const inputReplacements = allMessages.filter(message => message.turnId && message.replacesMessageId).slice(-240).map(message => ({
    turnId: message.turnId!, replacesMessageId: message.replacesMessageId!, nativeMessageId: message.id,
    ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
  }));
  return {
    threadId: conversationId,
    status: normalizeStreamStatus(state),
    messages,
    inputReplacements,
    messageCount: messages.length,
    eventCount,
    updatedAt: new Date().toISOString(),
    changeType,
    source: "desktop-ipc",
  };
}

function extractConversationMessages(state: Record<string, unknown>): CodexMessage[] {
  const turns = conversationTurns(state);
  const messages: CodexMessage[] = [];
  turns.forEach((turn, turnIndex) => {
    if (!turn || typeof turn !== "object") return;
    const record = turn as Record<string, unknown>;
    const turnId = typeof record.turnId === "string" ? record.turnId : `turn-${turnIndex}`;
    const timestamp = timestampFromTurn(record);
    const items = Array.isArray(record.items) ? record.items : [];
    const initialUserIndex = items.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "userMessage");
    const hasUserItem = initialUserIndex >= 0;
    const inputText = hasUserItem ? "" : extractDesktopInputText((record.params as Record<string, unknown> | undefined)?.input);
    if (inputText && isDisplayableUserText(inputText)) {
      messages.push({
        id: `${turnId}-input`,
        timestamp,
        role: "user",
        text: inputText,
        kind: "userMessage",
        turnId,
        ...(typeof record.params === "object" && record.params && typeof (record.params as Record<string, unknown>).clientUserMessageId === "string"
          ? { clientMessageId: (record.params as Record<string, unknown>).clientUserMessageId as string } : {}),
      });
    }
    items.forEach((item, itemIndex) => {
      const message = desktopItemToMessage(item, turnId, itemIndex, timestamp);
      if (message) messages.push({
        ...message,
        ...(typeof record.turnId === "string" ? { turnId: record.turnId } : {}),
        // Only the original user item replaces params.input. Accepted steering
        // is a separate occurrence even when its text is exactly the same.
        ...(itemIndex === initialUserIndex && message.role === "user" ? { replacesMessageId: `${turnId}-input` } : {}),
      });
    });
  });
  return dedupeStreamMessages(messages);
}

function desktopItemToMessage(item: unknown, turnId: string, itemIndex: number, fallbackTimestamp: string): CodexMessage | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (!type) return null;
  const itemId = typeof record.id === "string" ? record.id : `${type}-${itemIndex}`;
  const id = `desktop-${turnId}-${itemId}`;
  const timestamp = timestampFromItem(record) ?? fallbackTimestamp;
  if (type === "userMessage" || type === "steeringUserMessage") {
    if (type === "steeringUserMessage" && record.status !== "accepted") return null;
    const text = extractDesktopInputText(type === "userMessage" ? record.content : record.input);
    const clientMessageId = typeof record.clientUserMessageId === "string" ? record.clientUserMessageId : record.clientId;
    return text && isDisplayableUserText(text) ? { id, timestamp, role: "user", text, kind: "userMessage", turnId,
      ...(typeof clientMessageId === "string" ? { clientMessageId } : {}) } : null;
  }
  if (type === "agentMessage") {
    const text = typeof record.text === "string" ? record.text : "";
    return text.trim() ? { id, timestamp, role: "assistant", text, kind: type,
      ...(typeof record.id === "string" ? { sourceItemId: record.id } : {}),
      ...(record.phase === "commentary" || record.phase === "final_answer" ? { phase: record.phase } : {}),
    } : null;
  }
  if (type === "plan") {
    const text = typeof record.text === "string" ? record.text : "";
    return text.trim() ? { id, timestamp, role: "tool", text, kind: type } : null;
  }
  if (type === "commandExecution") {
    const command = typeof record.command === "string" ? record.command : "";
    const output = typeof record.aggregatedOutput === "string" ? record.aggregatedOutput : typeof record.output === "string" ? record.output : "";
    const text = formatDesktopCommand(command, output);
    return text ? { id, timestamp, role: "tool", text, kind: type } : null;
  }
  if (type === "fileChange") {
    const text = [record.action, record.path, record.output].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n");
    return text ? { id, timestamp, role: "tool", text: truncateStreamText(text), kind: type } : null;
  }
  const text = typeof record.text === "string" ? record.text : "";
  return text.trim() ? { id, timestamp, role: "tool", text: truncateStreamText(text), kind: type } : null;
}

function extractDesktopInputText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      return typeof record.input_text === "string" ? record.input_text : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !isGeneratedContextText(trimmed);
}

function isGeneratedContextText(trimmed: string): boolean {
  // Compatibility for user items without source metadata: reserved envelopes
  // identify context; natural-language role prompts do not.
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<app-context>") ||
    trimmed.startsWith("<collaboration_mode>") ||
    trimmed.startsWith("<personality_spec>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<plugins_instructions>") ||
    trimmed.startsWith("<send_user_message_question_reply>") ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<INSTRUCTIONS>")
  );
}

function normalizeStreamStatus(state: Record<string, unknown>): DesktopStreamSnapshot["status"] {
  const turns = conversationTurns(state);
  const latest = [...turns].reverse().find((turn) => turn && typeof turn === "object") as Record<string, unknown> | undefined;
  const raw = String(latest?.status ?? state.threadRuntimeStatus ?? "").toLowerCase();
  if (/fail|error/.test(raw)) return "failed";
  if (/interrupt|cancel|aborted/.test(raw)) return "interrupted";
  if (/start|pending|queued/.test(raw)) return "starting";
  if (/progress|running|stream|active|execut/.test(raw)) return "inProgress";
  return "completed";
}

function timestampFromTurn(turn: Record<string, unknown>): string {
  const started = numericTimestamp(turn.turnStartedAtMs) ?? numericTimestamp(turn.createdAtMs) ?? numericTimestamp(turn.updatedAtMs);
  return new Date(started ?? Date.now()).toISOString();
}

function timestampFromItem(item: Record<string, unknown>): string | null {
  const value = numericTimestamp(item.createdAtMs) ?? numericTimestamp(item.updatedAtMs) ?? numericTimestamp(item.completedAtMs);
  return value == null ? null : new Date(value).toISOString();
}

function numericTimestamp(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number < 10_000_000_000 ? number * 1000 : number;
}

function formatDesktopCommand(command: string, output: string): string {
  const lines: string[] = [];
  if (command.trim()) lines.push(`Command: ${command.trim()}`);
  if (output.trim()) lines.push(truncateStreamText(output.trim()));
  return lines.join("\n\n");
}

function truncateStreamText(value: string, max = 12_000): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}\n...` : value;
}

function dedupeStreamMessages(messages: CodexMessage[]): CodexMessage[] {
  const byId = new Map<string, CodexMessage>();
  const order: string[] = [];
  for (const message of messages) {
    if (!byId.has(message.id)) order.push(message.id);
    byId.set(message.id, message);
  }
  return order.map((id) => byId.get(id)).filter((message): message is CodexMessage => Boolean(message));
}

function applyStatePatches(target: unknown, patches: unknown[], strict = false): unknown {
  let next = structuredClone(target);
  for (const patch of patches) {
    if (strict) {
      const value = record(patch);
      const path = value?.path;
      if (!value || !["add", "remove", "replace"].includes(String(value.op)) || !Array.isArray(path) || path.some(key => !["string", "number"].includes(typeof key) || ["__proto__", "prototype", "constructor"].includes(String(key)))) throw new Error("desktop-patch-invalid");
      if (!path.length) {
        if (value.op === "remove") throw new Error("desktop-patch-root-remove");
        next = structuredClone(value.value); continue;
      }
      let parent = next;
      for (const key of path.slice(0, -1)) {
        if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) throw new Error("desktop-patch-path");
        parent = (parent as Record<string, unknown>)[key];
      }
      const key = path.at(-1)!;
      if (!parent || typeof parent !== "object" || (Array.isArray(parent) && (!Number.isSafeInteger(key) || key < 0 || key > parent.length || (value.op !== "add" && key === parent.length))) || (value.op !== "add" && !Object.hasOwn(parent, key))) throw new Error("desktop-patch-path");
    }
    applyStatePatch(next, patch);
  }
  return next;
}

function applyStatePatch(target: unknown, patch: unknown): void {
  if (!patch || typeof patch !== "object") return;
  const record = patch as Record<string, unknown>;
  const op = typeof record.op === "string" ? record.op : "";
  const path = normalizePatchPath(record.path);
  if (!op || path.length === 0) return;
  const parent = getPatchParent(target, path);
  if (!parent) return;
  const key = path[path.length - 1];
  if (op === "remove") {
    if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
    else if (isObjectRecord(parent)) delete parent[String(key)];
    return;
  }
  if (op !== "replace" && op !== "add") return;
  if (Array.isArray(parent) && typeof key === "number") {
    if (op === "add") parent.splice(key, 0, record.value);
    else parent[key] = record.value;
    return;
  }
  if (isObjectRecord(parent)) parent[String(key)] = record.value;
}

function normalizePatchPath(pathValue: unknown): Array<string | number> {
  if (Array.isArray(pathValue)) {
    return pathValue.filter((item): item is string | number => typeof item === "string" || typeof item === "number");
  }
  if (typeof pathValue !== "string") return [];
  return pathValue
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function getPatchParent(target: unknown, path: Array<string | number>): unknown {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
    } else if (isObjectRecord(current)) {
      current = current[String(segment)];
    } else {
      return null;
    }
  }
  return current;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeInjectedText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
