import { AppServerClient } from "./appServerClient.js";
import { EventEmitter } from "node:events";
import type { CodexMessage, CodexThreadSummary } from "./codexStore.js";

type AppThread = {
  id: string;
  name: string | null;
  preview: string;
  updatedAt: number;
  cwd: string | null;
  source: string | null;
  path: string | null;
};

type AppTurn = {
  id: string;
  items: unknown[];
  status: LiveTurnStatus;
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
};

type AppThreadItem = Record<string, unknown> & {
  id?: string;
  type?: string;
  text?: string;
  content?: unknown;
  command?: string;
  aggregatedOutput?: string | null;
  output?: string | null;
};

type RpcEvent = {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
};

type ThreadStartResponse = {
  thread: AppThread;
};

type TurnStartResponse = {
  turn: AppTurn;
};

type ThreadReadResponse = {
  thread: AppThread & {
    turns?: Array<{
      id: string;
      items: AppThreadItem[];
      startedAt: number | null;
      completedAt: number | null;
    }>;
  };
};

export type LiveTurnStatus = "starting" | "inProgress" | "completed" | "interrupted" | "failed";

export type LiveTurnEvent = {
  seq: number;
  timestamp: string;
  method: string;
  text: string;
};

export type LiveApprovalKind = "command" | "fileChange" | "permissions" | "unsupported";
export type LiveApprovalStatus = "pending" | "approved" | "declined" | "cancelled" | "failed";
export type LiveApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type LiveApproval = {
  id: string;
  requestId: string | number;
  kind: LiveApprovalKind;
  status: LiveApprovalStatus;
  title: string;
  detail: string;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  availableDecisions: LiveApprovalDecision[];
  createdAt: string;
  updatedAt: string;
};

export type LiveTurnSnapshot = {
  threadId: string;
  turnId: string;
  status: LiveTurnStatus;
  messageCount: number;
  eventCount: number;
  messages: CodexMessage[];
  events: LiveTurnEvent[];
  approvals: LiveApproval[];
  thread: CodexThreadSummary | null;
  error: string | null;
  updatedAt: string;
};

type LiveTurnState = LiveTurnSnapshot & {
  itemText: Map<string, string>;
  approvalParams: Map<string, Record<string, unknown>>;
  snapshotTimer: NodeJS.Timeout | null;
  pendingSnapshot: boolean;
};

export class LiveTurnController extends EventEmitter {
  private client: AppServerClient | null = null;
  private readonly turns = new Map<string, LiveTurnState>();
  private readonly activeByThread = new Map<string, string>();
  private seq = 1;
  private starting: Promise<void> | null = null;
  private readonly snapshotThrottleMs = 700;

  constructor(private readonly defaultCwd = process.cwd()) {
    super();
  }

  async status(): Promise<{ ok: boolean; mode: string; activeTurns: number; error?: string }> {
    try {
      await this.ensureClient();
      return { ok: true, mode: "app-server-ws-control", activeTurns: this.turns.size };
    } catch (error) {
      return {
        ok: false,
        mode: "app-server-ws-control",
        activeTurns: this.turns.size,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async startTurn(params: {
    threadId?: string;
    message: string;
    cwd?: string | null;
    approvalPolicy?: "never" | "on-request";
    sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  }): Promise<LiveTurnSnapshot> {
    const client = await this.ensureClient();
    let threadId = params.threadId;
    let thread: CodexThreadSummary | null = null;
    const approvalPolicy = params.approvalPolicy ?? "never";
    const sandbox = params.sandbox ?? "workspace-write";

    if (threadId) {
      await client.request("thread/resume", {
        threadId,
        excludeTurns: true,
        persistExtendedHistory: true,
      });
    } else {
      const started = await client.request<ThreadStartResponse>("thread/start", {
        cwd: params.cwd ?? this.defaultCwd,
        approvalPolicy,
        sandbox,
        sessionStartSource: "startup",
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      });
      threadId = started.thread.id;
      thread = toSummary(started.thread, params.message);
      await client
        .request("thread/name/set", {
          threadId,
          name: `手机: ${firstLine(params.message) || "新线程"}`,
        })
        .catch(() => undefined);
    }

    const response = await client.request<TurnStartResponse>("turn/start", {
      threadId,
      input: toInput(params.message),
      approvalPolicy,
    });

    const state = this.createState({
      threadId,
      turnId: response.turn.id,
      thread,
      userText: params.message,
      status: response.turn.status === "completed" ? "completed" : "inProgress",
    });
    this.turns.set(response.turn.id, state);
    this.activeByThread.set(threadId, response.turn.id);
    this.pushEvent(state, "turn/start", `已启动 turn ${response.turn.id}`);
    this.emitSnapshot(state);
    return this.snapshot(state);
  }

  getTurn(turnId: string): LiveTurnSnapshot | null {
    const state = this.turns.get(turnId);
    return state ? this.snapshot(state) : null;
  }

  listActiveTurns(): LiveTurnSnapshot[] {
    return [...this.turns.values()].map((state) => this.snapshot(state));
  }

  async steerTurn(params: { threadId: string; turnId: string; message: string }): Promise<LiveTurnSnapshot> {
    const client = await this.ensureClient();
    const state = this.requireTurn(params.turnId);
    await client.request("turn/steer", {
      threadId: params.threadId,
      expectedTurnId: params.turnId,
      input: toInput(params.message),
    });
    this.upsertMessage(state, {
      id: `steer-${Date.now()}`,
      timestamp: new Date().toISOString(),
      role: "user",
      text: params.message,
      kind: "steeringUserMessage",
    });
    this.pushEvent(state, "turn/steer", "已发送引导消息");
    state.updatedAt = new Date().toISOString();
    this.emitSnapshot(state);
    return this.snapshot(state);
  }

  async interruptTurn(params: { threadId: string; turnId: string }): Promise<LiveTurnSnapshot> {
    const client = await this.ensureClient();
    const state = this.requireTurn(params.turnId);
    await client.request("turn/interrupt", {
      threadId: params.threadId,
      turnId: params.turnId,
    });
    state.status = "interrupted";
    state.updatedAt = new Date().toISOString();
    this.pushEvent(state, "turn/interrupt", "已发送打断请求");
    this.emitSnapshot(state);
    return this.snapshot(state);
  }

  async respondApproval(params: {
    turnId: string;
    approvalId: string;
    decision: LiveApprovalDecision;
  }): Promise<LiveTurnSnapshot> {
    const client = await this.ensureClient();
    const state = this.requireTurn(params.turnId);
    const approval = state.approvals.find((item) => item.id === params.approvalId);
    if (!approval) throw new Error(`Unknown approval request: ${params.approvalId}`);
    if (approval.status !== "pending") return this.snapshot(state);

    if (!approval.availableDecisions.includes(params.decision)) {
      throw new Error(`Decision ${params.decision} is not available for this approval`);
    }

    const rawParams = state.approvalParams.get(approval.id);
    try {
      if (approval.kind === "command" || approval.kind === "fileChange") {
        client.respond(approval.requestId, { decision: params.decision });
      } else if (approval.kind === "permissions") {
        client.respond(approval.requestId, toPermissionsResponse(params.decision, rawParams));
      } else {
        client.respondError(approval.requestId, -32601, "Unsupported mobile approval request");
      }
      approval.status = decisionToApprovalStatus(params.decision);
      approval.updatedAt = new Date().toISOString();
      this.pushEvent(state, "approval/respond", `${approval.title}: ${approval.status}`);
      this.emitSnapshot(state);
      return this.snapshot(state);
    } catch (error) {
      approval.status = "failed";
      approval.updatedAt = new Date().toISOString();
      state.error = error instanceof Error ? error.message : String(error);
      this.pushEvent(state, "approval/respond", state.error);
      this.emitSnapshot(state);
      throw error;
    }
  }

  async refreshTurn(turnId: string): Promise<LiveTurnSnapshot> {
    const state = this.requireTurn(turnId);
    await this.refreshThreadMessages(state.threadId, turnId);
    return this.snapshot(state);
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    this.starting = null;
  }

  private async ensureClient(): Promise<AppServerClient> {
    if (this.client) return this.client;
    if (!this.starting) {
      const client = new AppServerClient({ requestTimeoutMs: 120_000 });
      this.client = client;
      client.on("notification", (event: RpcEvent) => this.handleNotification(event));
      this.starting = client
        .start()
        .catch((error) => {
          if (this.client === client) this.client = null;
          throw error;
        })
        .finally(() => {
          this.starting = null;
        });
    }
    await this.starting;
    return this.client!;
  }

  private handleNotification(event: RpcEvent): void {
    const params = event.params ?? {};
    const turnId = typeof params.turnId === "string" ? params.turnId : getTurnIdFromTurn(params.turn);
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    const state = turnId ? this.turns.get(turnId) : threadId ? this.getStateByThread(threadId) : null;

    if (!state) return;

    if (event.id !== undefined) {
      this.addApprovalRequest(state, event);
      this.emitSnapshot(state);
      return;
    }

    if (event.method === "turn/started") {
      state.status = "inProgress";
      this.pushEvent(state, event.method, "turn started");
      this.emitSnapshot(state);
      return;
    }

    if (event.method === "turn/completed") {
      const status = getTurnStatus(params.turn);
      state.status = status ?? "completed";
      this.pushEvent(state, event.method, `turn ${state.status}`);
      void this.refreshThreadMessages(state.threadId, state.turnId);
      this.emitSnapshot(state);
      return;
    }

    if (event.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      this.appendItemDelta(state, params.itemId, params.delta, "assistant", "agentMessage");
      return;
    }

    if (event.method === "item/commandExecution/outputDelta" && typeof params.delta === "string") {
      this.appendItemDelta(state, params.itemId, params.delta, "tool", "commandExecution");
      return;
    }

    if (event.method === "item/plan/delta" && typeof params.delta === "string") {
      this.appendItemDelta(state, params.itemId, params.delta, "tool", "plan");
      return;
    }

    if (event.method === "item/completed") {
      const message = itemToMessage(params.item as AppThreadItem, state.turnId);
      if (message) this.upsertMessage(state, message);
      this.pushEvent(state, event.method, String((params.item as AppThreadItem | undefined)?.type ?? "item completed"));
      return;
    }

    if (event.method === "error") {
      state.status = "failed";
      state.error = JSON.stringify(params);
      this.pushEvent(state, event.method, state.error);
      this.emitSnapshot(state);
      return;
    }

    if (event.method.startsWith("turn/") || event.method.startsWith("item/")) {
      this.pushEvent(state, event.method, event.method);
    }
  }

  private createState(params: {
    threadId: string;
    turnId: string;
    thread: CodexThreadSummary | null;
    userText: string;
    status: LiveTurnStatus;
  }): LiveTurnState {
    const timestamp = new Date().toISOString();
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      status: params.status,
      messageCount: 1,
      eventCount: 0,
      messages: [
        {
          id: `user-${params.turnId}`,
          timestamp,
          role: "user",
          text: params.userText,
          kind: "userMessage",
        },
      ],
      events: [],
      approvals: [],
      thread: params.thread,
      error: null,
      updatedAt: timestamp,
      itemText: new Map(),
      approvalParams: new Map(),
      snapshotTimer: null,
      pendingSnapshot: false,
    };
  }

  private getStateByThread(threadId: string): LiveTurnState | null {
    const turnId = this.activeByThread.get(threadId);
    return turnId ? this.turns.get(turnId) ?? null : null;
  }

  private requireTurn(turnId: string): LiveTurnState {
    const state = this.turns.get(turnId);
    if (!state) throw new Error(`Unknown live turn: ${turnId}`);
    return state;
  }

  private appendItemDelta(
    state: LiveTurnState,
    itemId: unknown,
    delta: string,
    role: CodexMessage["role"],
    kind: string,
  ): void {
    const id = `${state.turnId}-${typeof itemId === "string" ? itemId : kind}`;
    const text = `${state.itemText.get(id) ?? ""}${delta}`;
    state.itemText.set(id, text);
    this.upsertMessage(state, {
      id,
      timestamp: new Date().toISOString(),
      role,
      text,
      kind,
    });
  }

  private upsertMessage(state: LiveTurnState, message: CodexMessage): void {
    const existing = state.messages.findIndex((item) => item.id === message.id);
    if (existing >= 0) {
      state.messages[existing] = message;
    } else {
      state.messages.push(message);
    }
    state.messageCount = state.messages.length;
    state.updatedAt = new Date().toISOString();
    this.emitSnapshot(state);
  }

  private pushEvent(state: LiveTurnState, method: string, text: string): void {
    state.events.push({
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      method,
      text,
    });
    if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
    state.eventCount = state.events.length;
    state.updatedAt = new Date().toISOString();
  }

  private addApprovalRequest(state: LiveTurnState, event: RpcEvent): void {
    const params = event.params ?? {};
    const id = String(event.id);
    const existing = state.approvals.find((item) => item.id === id);
    if (existing) return;

    const approval = approvalFromRequest(id, event.id!, event.method, params);
    state.approvals.push(approval);
    state.approvalParams.set(approval.id, params);
    this.pushEvent(state, event.method, approval.detail || approval.title);
  }

  private async refreshThreadMessages(threadId: string, turnId: string): Promise<void> {
    const client = this.client;
    const state = this.turns.get(turnId);
    if (!client || !state) return;
    try {
      const read = await client.request<ThreadReadResponse>("thread/read", {
        threadId,
        includeTurns: true,
      });
      state.thread = toSummary(read.thread);
      const messages = threadToMessages(read.thread);
      if (messages.length > 0) {
        state.messages = messages;
        state.messageCount = messages.length;
      }
      state.updatedAt = new Date().toISOString();
      this.emitSnapshotNow(state);
    } catch (error) {
      this.pushEvent(state, "thread/read", error instanceof Error ? error.message : String(error));
      this.emitSnapshotNow(state);
    }
  }

  private snapshot(state: LiveTurnState): LiveTurnSnapshot {
    return {
      threadId: state.threadId,
      turnId: state.turnId,
      status: state.status,
      messageCount: state.messageCount,
      eventCount: state.eventCount,
      messages: state.messages,
      events: state.events,
      approvals: state.approvals,
      thread: state.thread,
      error: state.error,
      updatedAt: state.updatedAt,
    };
  }

  private emitSnapshot(state: LiveTurnState): void {
    if (state.status === "completed" || state.status === "interrupted" || state.status === "failed") {
      this.emitSnapshotNow(state);
      return;
    }
    if (state.snapshotTimer) {
      state.pendingSnapshot = true;
      return;
    }
    state.snapshotTimer = setTimeout(() => {
      state.snapshotTimer = null;
      state.pendingSnapshot = false;
      this.emitSnapshotNow(state);
    }, this.snapshotThrottleMs);
  }

  private emitSnapshotNow(state: LiveTurnState): void {
    if (state.snapshotTimer) {
      clearTimeout(state.snapshotTimer);
      state.snapshotTimer = null;
    }
    state.pendingSnapshot = false;
    this.emit("snapshot", this.snapshot(state));
  }
}

function toInput(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

function approvalFromRequest(
  id: string,
  requestId: string | number,
  method: string,
  params: Record<string, unknown>,
): LiveApproval {
  const now = new Date().toISOString();
  const command = typeof params.command === "string" ? params.command : null;
  const cwd = typeof params.cwd === "string" ? params.cwd : null;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const decisions = parseAvailableDecisions(params.availableDecisions);

  if (method === "item/commandExecution/requestApproval") {
    return {
      id,
      requestId,
      kind: "command",
      status: "pending",
      title: "命令执行审批",
      detail: command ?? reason ?? "Codex 请求执行命令",
      command,
      cwd,
      reason,
      availableDecisions: decisions,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (method === "item/fileChange/requestApproval") {
    const grantRoot = typeof params.grantRoot === "string" ? params.grantRoot : cwd;
    return {
      id,
      requestId,
      kind: "fileChange",
      status: "pending",
      title: "文件修改审批",
      detail: grantRoot ? `允许修改 ${grantRoot}` : reason ?? "Codex 请求修改文件",
      command: null,
      cwd: grantRoot ?? cwd,
      reason,
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (method === "item/permissions/requestApproval") {
    return {
      id,
      requestId,
      kind: "permissions",
      status: "pending",
      title: "权限扩大审批",
      detail: reason ?? summarizePermissions(params.permissions),
      command: null,
      cwd,
      reason,
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id,
    requestId,
    kind: "unsupported",
    status: "pending",
    title: "未知审批请求",
    detail: `${method} 暂未适配手机端审批`,
    command: null,
    cwd,
    reason,
    availableDecisions: ["cancel"],
    createdAt: now,
    updatedAt: now,
  };
}

function parseAvailableDecisions(value: unknown): LiveApprovalDecision[] {
  const fallback: LiveApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];
  if (!Array.isArray(value)) return fallback;
  const decisions = value.filter((item): item is LiveApprovalDecision => isSimpleDecision(item));
  return decisions.length > 0 ? decisions : fallback;
}

function isSimpleDecision(value: unknown): value is LiveApprovalDecision {
  return value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel";
}

function decisionToApprovalStatus(decision: LiveApprovalDecision): LiveApprovalStatus {
  if (decision === "accept" || decision === "acceptForSession") return "approved";
  if (decision === "decline") return "declined";
  return "cancelled";
}

function toPermissionsResponse(decision: LiveApprovalDecision, params: Record<string, unknown> | undefined): unknown {
  if (decision === "decline" || decision === "cancel") {
    return {
      permissions: {},
      scope: "turn",
      strictAutoReview: true,
    };
  }
  const requested = params?.permissions && typeof params.permissions === "object" ? (params.permissions as Record<string, unknown>) : {};
  return {
    permissions: {
      network: requested.network ?? undefined,
      fileSystem: requested.fileSystem ?? undefined,
    },
    scope: decision === "acceptForSession" ? "session" : "turn",
    strictAutoReview: false,
  };
}

function summarizePermissions(value: unknown): string {
  if (!value || typeof value !== "object") return "Codex 请求扩大权限";
  const permissions = value as { network?: unknown; fileSystem?: unknown };
  const parts: string[] = [];
  if (permissions.network) parts.push("网络");
  if (permissions.fileSystem) parts.push("文件系统");
  return parts.length > 0 ? `Codex 请求扩大${parts.join("、")}权限` : "Codex 请求扩大权限";
}

function getTurnIdFromTurn(value: unknown): string | null {
  return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
    ? (value as { id: string }).id
    : null;
}

function getTurnStatus(value: unknown): LiveTurnStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = (value as { status?: unknown }).status;
  if (status === "completed" || status === "interrupted" || status === "failed" || status === "inProgress") return status;
  return null;
}

function toSummary(thread: AppThread, fallbackName?: string): CodexThreadSummary {
  return {
    id: thread.id,
    threadName: thread.name ?? thread.preview ?? (fallbackName ? `手机: ${firstLine(fallbackName)}` : "Untitled"),
    updatedAt: fromUnixSeconds(thread.updatedAt),
    cwd: thread.cwd,
    source: thread.source,
    originator: thread.source === "vscode" ? "Codex Desktop" : "Codex app-server",
    rolloutPath: thread.path,
  };
}

function threadToMessages(thread: ThreadReadResponse["thread"]): CodexMessage[] {
  const messages: CodexMessage[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      const message = itemToMessage(item, turn.id, fromUnixSeconds(turn.startedAt ?? turn.completedAt ?? thread.updatedAt));
      if (message) messages.push(message);
    }
  }
  return dedupeMessages(messages);
}

function itemToMessage(item: AppThreadItem | undefined, turnId: string, timestamp = new Date().toISOString()): CodexMessage | null {
  if (!item?.type) return null;
  const id = `${turnId}-${item.id ?? item.type}`;
  if (item.type === "userMessage") {
    const text = extractUserText(item.content);
    return text && isDisplayableUserText(text) ? { id, timestamp, role: "user", text, kind: item.type } : null;
  }
  if (item.type === "agentMessage" && typeof item.text === "string" && item.text) {
    return { id, timestamp, role: "assistant", text: item.text, kind: item.type };
  }
  if (item.type === "plan" && typeof item.text === "string" && item.text) {
    return { id, timestamp, role: "tool", text: item.text, kind: item.type };
  }
  if (item.type === "commandExecution") {
    const text = [item.command, item.aggregatedOutput ?? item.output].filter(Boolean).join("\n\n");
    return text ? { id, timestamp, role: "tool", text: truncate(text), kind: item.type } : null;
  }
  const text = typeof item.text === "string" ? item.text : "";
  return text ? { id, timestamp, role: "tool", text, kind: item.type } : null;
}

function extractUserText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && (item as { type?: unknown }).type === "text" ? (item as { text?: string }).text ?? "" : ""))
    .filter(Boolean)
    .join("\n\n");
}

function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !isGeneratedContextText(trimmed);
}

function isGeneratedContextText(trimmed: string): boolean {
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<app-context>") ||
    trimmed.startsWith("<collaboration_mode>") ||
    trimmed.startsWith("<personality_spec>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<plugins_instructions>") ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<INSTRUCTIONS>") ||
    trimmed.startsWith("Knowledge cutoff:") ||
    trimmed.startsWith("You are ")
  );
}

function fromUnixSeconds(value: number | null): string {
  if (!value) return new Date().toISOString();
  const millis = value > 10_000_000_000 ? value : value * 1000;
  return new Date(millis).toISOString();
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean)?.trim().slice(0, 72) ?? "";
}

function truncate(value: string): string {
  const maxLength = 16_000;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[output truncated: ${value.length - maxLength} chars hidden on mobile]`;
}

function dedupeMessages(messages: CodexMessage[]): CodexMessage[] {
  const byId = new Map<string, CodexMessage>();
  const order: string[] = [];
  for (const message of messages) {
    if (!byId.has(message.id)) order.push(message.id);
    byId.set(message.id, message);
  }
  return order.map((id) => byId.get(id)).filter((message): message is CodexMessage => Boolean(message));
}
