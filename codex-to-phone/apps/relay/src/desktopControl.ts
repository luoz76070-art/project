import { CodexStore, type CodexMessage, type CodexThreadSummary } from "./codexStore.js";
import { DesktopIpcClient, type DesktopIpcClientStatus, type DesktopIpcResponse } from "./desktopIpcClient.js";
import { MacosUiInjector, type MacosUiInjectorStatus } from "./macosUiInjector.js";

type CodexTextInput = {
  type: "text";
  text: string;
  text_elements: [];
};

type DesktopControlAction = "start-turn" | "steer-turn" | "interrupt-turn" | "ui-submit";
type DesktopControlMode = "auto" | "start" | "steer";
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
  messageCount: number;
  eventCount: number;
  updatedAt: string;
  changeType: string | null;
  source: "desktop-ipc";
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
};

export class DesktopControl {
  private readonly client = new DesktopIpcClient({
    clientType: "mobile-codex-relay-desktop-control",
    requestTimeoutMs: 120_000,
  });
  private readonly macosUi = new MacosUiInjector();
  private readonly uiVerificationTimeoutMs = Math.max(0, Number(process.env.MOBILE_CODEX_UI_VERIFY_TIMEOUT_MS ?? 1500));
  private activeConversationId: string | null = null;
  private readonly streamThreads = new Map<string, DesktopStreamThread>();
  private readonly streamStates = new Map<string, unknown>();
  private readonly streamSnapshots = new Map<string, DesktopStreamSnapshot>();
  private readonly streamWaiters = new Set<() => void>();
  private readonly streamSnapshotListeners = new Set<(snapshot: DesktopStreamSnapshot) => void>();

  constructor(private readonly store: CodexStore) {
    this.client.onAnyMessage((message) => this.handleIpcMessage(message));
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
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
    if (process.platform === "darwin") {
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
  }): Promise<DesktopControlResult> {
    const thread = await this.getThread(params.threadId);
    const cwd = params.cwd ?? thread?.cwd ?? null;
    const mode = params.mode ?? "auto";

    if (process.platform === "darwin") {
      return this.sendViaMacosUi(params.threadId, params.message, thread);
    }

    if (mode !== "start") {
      const steer = await this.tryDesktopRequest("thread-follower-steer-turn", {
        conversationId: params.threadId,
        input: toInput(params.message),
        attachments: [],
        restoreMessage: toRestoreMessage(cwd),
      });
      if (steer.ok || mode === "steer") return this.toResult("steer-turn", thread, steer);
      if (!isExpectedSteerMiss(steer.error)) return this.toResult("steer-turn", thread, steer);
    }

    const started = await this.tryDesktopRequest("thread-follower-start-turn", {
      conversationId: params.threadId,
      turnStartParams: {
        input: toInput(params.message),
        cwd,
        inheritThreadSettings: true,
      },
    });
    return this.toResult("start-turn", thread, started);
  }

  async interruptThread(threadId: string): Promise<DesktopControlResult> {
    const thread = await this.getThread(threadId);
    const interrupted = await this.tryDesktopRequest("thread-follower-interrupt-turn", {
      conversationId: threadId,
    });
    return this.toResult("interrupt-turn", thread, interrupted);
  }

  private async tryDesktopRequest(method: string, params: unknown): Promise<{ ok: boolean; ipc: DesktopIpcClientStatus; result?: unknown; error?: string }> {
    try {
      await this.client.connect();
      const response = await this.client.sendRequest(method, params, { version: 1 });
      if (response.resultType === "error") {
        return { ok: false, ipc: this.client.getStatus(), error: response.error ?? "desktop-ipc-request-failed" };
      }
      return { ok: true, ipc: this.client.getStatus(), result: unwrapThreadFollowerResult(response) };
    } catch (error) {
      return { ok: false, ipc: this.client.getStatus(), error: toErrorMessage(error) };
    }
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
    const read = await this.store.readThreadWithCursor(threadId).catch(() => null);
    return read?.thread ?? null;
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
    if (message.method !== "thread-stream-state-changed") return;
    const conversationId = getConversationId(message.params);
    if (!conversationId) return;
    const existing = this.streamThreads.get(conversationId);
    const now = new Date().toISOString();
    const changeType = getChangeType(message.params);
    this.applyStreamChange(conversationId, message.params);

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
    this.streamSnapshots.set(conversationId, snapshot);
    for (const listener of [...this.streamSnapshotListeners]) listener(snapshot);
  }

  private toResult(
    action: DesktopControlAction,
    thread: CodexThreadSummary | null,
    response: { ok: boolean; ipc: DesktopIpcClientStatus; result?: unknown; error?: string },
  ): DesktopControlResult {
    return {
      ok: response.ok,
      mode: "desktop-ipc-follower-control",
      action,
      thread,
      ipc: response.ipc,
      result: response.result,
      error: response.error,
    };
  }
}

function isDesktopBroadcast(value: unknown): value is { type: "broadcast"; method: string; sourceClientId?: unknown; params?: unknown } {
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
  const messages = extractConversationMessages(state).slice(-120);
  return {
    threadId: conversationId,
    status: normalizeStreamStatus(state),
    messages,
    messageCount: messages.length,
    eventCount,
    updatedAt: new Date().toISOString(),
    changeType,
    source: "desktop-ipc",
  };
}

function extractConversationMessages(state: Record<string, unknown>): CodexMessage[] {
  const turns = Array.isArray(state.turns) ? state.turns : [];
  const messages: CodexMessage[] = [];
  turns.forEach((turn, turnIndex) => {
    if (!turn || typeof turn !== "object") return;
    const record = turn as Record<string, unknown>;
    const turnId = typeof record.turnId === "string" ? record.turnId : `turn-${turnIndex}`;
    const timestamp = timestampFromTurn(record);
    const items = Array.isArray(record.items) ? record.items : [];
    const hasUserItem = items.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "userMessage");
    const inputText = hasUserItem ? "" : extractDesktopInputText((record.params as Record<string, unknown> | undefined)?.input);
    if (inputText) {
      messages.push({
        id: `${turnId}-input`,
        timestamp,
        role: "user",
        text: inputText,
        kind: "userMessage",
      });
    }
    items.forEach((item, itemIndex) => {
      const message = desktopItemToMessage(item, turnId, itemIndex, timestamp);
      if (message) messages.push(message);
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
  if (type === "userMessage") {
    const text = extractDesktopInputText(record.content);
    return text ? { id, timestamp, role: "user", text, kind: type } : null;
  }
  if (type === "agentMessage") {
    const text = typeof record.text === "string" ? record.text : "";
    return text.trim() ? { id, timestamp, role: "assistant", text, kind: type } : null;
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

function normalizeStreamStatus(state: Record<string, unknown>): DesktopStreamSnapshot["status"] {
  const turns = Array.isArray(state.turns) ? state.turns : [];
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

function applyStatePatches(target: unknown, patches: unknown[]): unknown {
  const next = structuredClone(target);
  for (const patch of patches) applyStatePatch(next, patch);
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

function toInput(text: string): CodexTextInput[] {
  return [{ type: "text", text, text_elements: [] }];
}

function toRestoreMessage(cwd: string | null) {
  return {
    cwd,
    context: {
      workspaceRoots: cwd ? [cwd] : [],
      collaborationMode: null,
      commentAttachments: [],
    },
    responsesapiClientMetadata: null,
  };
}

function unwrapThreadFollowerResult(response: DesktopIpcResponse): unknown {
  const result = response.result;
  if (result && typeof result === "object" && "result" in result) {
    return (result as { result: unknown }).result;
  }
  return result;
}

function isExpectedSteerMiss(error: string | undefined): boolean {
  const message = (error ?? "").toLowerCase();
  return (
    message.includes("cannot steer") ||
    message.includes("without an active turn") ||
    message.includes("no active turn") ||
    message.includes("run ended") ||
    message.includes("conversation is not being streamed")
  );
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
