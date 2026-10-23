import { conversationTurns, interactionError, record } from "./desktopQuestions.js";
import type { DesktopIpcResponse } from "./desktopIpcClient.js";
import type { DesktopQueueSnapshot } from "./desktopMessageQueue.js";

export type DesktopTransport = "legacy" | "native";
export type DesktopControlCapability = {
  transport: DesktopTransport;
  token: string | null;
  activeTurnId: string | null;
  canSend: boolean;
  canInterrupt: boolean;
  queue?: DesktopQueueSnapshot;
  submission: { clientMessageId: string; action: NativeControlOutcome["action"]; delivery: NativeControlOutcome["delivery"]; turnStatus?: NativeControlOutcome["turnStatus"] } | null;
};
export type NativeThreadView = { epoch: string; owner: string; state: Record<string, unknown> };
export type NativeControlInput = { threadId: string; controlToken?: string; expectedTurnId?: string | null; clientMessageId?: string };
export type NativeControlOutcome = {
  ok: boolean;
  action: "start-turn" | "steer-turn" | "interrupt-turn";
  delivery: "confirmed" | "submitted" | "uncertain";
  turnStatus?: "starting" | "inProgress" | "completed" | "interrupted" | "failed";
  warning?: string;
  error?: string;
};
type PendingControl = { action: NativeControlOutcome["action"]; messageId: string; turnId: string | null };
type NativeControlDependencies = {
  read: (threadId: string) => NativeThreadView | null;
  request: (method: string, params: unknown, owner: string, version: number) => Promise<DesktopIpcResponse>;
  wait: (finished: () => boolean) => Promise<void>;
  changed: (threadId: string) => void;
};

/** Only this boundary builds ordinary Desktop follower writes. It never falls back or replays. */
export class DesktopNativeControl {
  private readonly pending = new Map<string, PendingControl>();
  private readonly inFlight = new Set<string>();
  private readonly receipts = new Map<string, NonNullable<DesktopControlCapability["submission"]>>();
  constructor(private readonly dependencies: NativeControlDependencies) {}

  capability(threadId: string, transport: DesktopTransport): DesktopControlCapability {
    const view = this.dependencies.read(threadId);
    const turn = currentTurn(view?.state);
    const pending = this.pending.get(threadId);
    const confirmed = view && pending ? controlConfirmed(view.state, pending) : null;
    if (confirmed && pending) {
      this.pending.delete(threadId);
      this.receipt(threadId, { clientMessageId: pending.messageId, action: pending.action, delivery: "confirmed", turnStatus: confirmed.status });
    }
    const ready = Boolean(view && turn.ready && !this.pending.has(threadId) && !this.inFlight.has(threadId));
    return { transport, token: view?.epoch ?? null, activeTurnId: turn.id, canSend: ready, canInterrupt: ready && turn.id !== null, submission: this.receipts.get(threadId) ?? null };
  }

  async send(input: NativeControlInput & { message: string; mode?: "auto" | "start" | "steer" }): Promise<NativeControlOutcome> {
    const view = this.validate(input);
    const turn = currentTurn(view.state);
    const action = turn.id ? "steer-turn" : "start-turn";
    if ((input.mode === "start" && turn.id) || (input.mode === "steer" && !turn.id)) throw interactionError("desktop_turn_changed");
    const messageId = input.clientMessageId!;
    const cwd = typeof view.state.cwd === "string" ? view.state.cwd : null;
    const params = action === "start-turn" ? {
      conversationId: input.threadId,
      turnStart: {
        request: { threadId: input.threadId, input: desktopTextInput(input.message), clientUserMessageId: messageId },
        context: { inheritThreadSettings: true, restoreMessage: desktopRestoreMessage(cwd), attachments: [], commentAttachments: [] },
      },
    } : {
      conversationId: input.threadId, clientUserMessageId: messageId, input: desktopTextInput(input.message),
      restoreMessage: desktopRestoreMessage(cwd), attachments: [],
    };
    return this.execute(input, view, { action, messageId, turnId: turn.id }, params, action === "start-turn" ? 2 : 1);
  }

  async interrupt(input: NativeControlInput): Promise<NativeControlOutcome> {
    const view = this.validate(input);
    const turnId = currentTurn(view.state).id;
    if (!turnId) throw interactionError("desktop_turn_changed");
    return this.execute(input, view, { action: "interrupt-turn", messageId: input.clientMessageId!, turnId }, {
      conversationId: input.threadId, mode: "user-stop", expectedTurnId: turnId,
    }, 4);
  }

  validate(input: NativeControlInput): NativeThreadView {
    const capability = this.capability(input.threadId, "native");
    const view = this.dependencies.read(input.threadId);
    if (!view || !input.controlToken || input.controlToken !== view.epoch || !input.clientMessageId) throw interactionError("desktop_control_refresh_required");
    if (input.expectedTurnId !== capability.activeTurnId) throw interactionError("desktop_turn_changed");
    if (!capability.canSend) throw interactionError("desktop_submission_pending");
    if (!this.pending.has(input.threadId) && this.pending.size >= 128) throw interactionError("desktop_control_limit", 429);
    return view;
  }

  messageConfirmed(threadId: string, messageId: string): boolean {
    const state = this.dependencies.read(threadId)?.state;
    return Boolean(state && controlConfirmed(state, { action: "start-turn", messageId, turnId: null }));
  }

  private async execute(input: NativeControlInput, view: NativeThreadView, pending: PendingControl, params: unknown, version: number): Promise<NativeControlOutcome> {
    const id = input.threadId;
    this.pending.set(id, pending);
    this.inFlight.add(id);
    this.receipt(id, { clientMessageId: pending.messageId, action: pending.action, delivery: "submitted" });
    this.dependencies.changed(id);
    let acknowledged = false;
    try {
      const method = `thread-follower-${pending.action}`;
      const response = await this.dependencies.request(method, params, view.owner, version);
      const current = this.dependencies.read(id);
      const outer = record(response.result);
      const result = record(outer?.result ?? outer);
      const startedTurnId = record(result?.turn)?.id;
      if (current?.epoch === view.epoch && response.resultType === "success" && response.method === method && response.handledByClientId === view.owner && (outer?.method == null || outer.method === method)) {
        acknowledged = pending.action === "interrupt-turn"
          ? result?.ok === true && result.interruptedTurnId === pending.turnId
          : pending.action === "start-turn" ? typeof startedTurnId === "string" && startedTurnId.length > 0 : result?.turnId === pending.turnId;
      }
      if (acknowledged) await this.dependencies.wait(() => {
        const now = this.dependencies.read(id);
        return now?.epoch !== view.epoch || Boolean(now && controlConfirmed(now.state, pending));
      });
    } catch {
      // The owner may have accepted a write before the reply was lost. Do not retry it.
    } finally {
      this.inFlight.delete(id);
    }
    const current = this.dependencies.read(id);
    const observed = this.receipts.get(id);
    const confirmed = (current ? controlConfirmed(current.state, pending) : null) ?? (observed?.clientMessageId === pending.messageId && observed.delivery === "confirmed" && observed.turnStatus ? { status: observed.turnStatus } : null);
    if (confirmed) this.pending.delete(id);
    const delivery = confirmed ? "confirmed" : acknowledged && current?.epoch === view.epoch ? "submitted" : "uncertain";
    this.receipt(id, { clientMessageId: pending.messageId, action: pending.action, delivery, turnStatus: confirmed?.status });
    this.dependencies.changed(id);
    return {
      ok: delivery !== "uncertain", action: pending.action, delivery,
      ...(confirmed ? { turnStatus: confirmed.status } : {}),
      ...(delivery !== "confirmed" ? { warning: "desktop_confirmation_pending" } : {}),
      ...(delivery === "uncertain" ? { error: "desktop_submission_unknown" } : {}),
    };
  }

  private receipt(id: string, value: NonNullable<DesktopControlCapability["submission"]>): void {
    this.receipts.delete(id);
    this.receipts.set(id, value);
    if (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value!);
  }
}

function currentTurn(state: Record<string, unknown> | undefined): { id: string | null; ready: boolean } {
  if (!state) return { id: null, ready: false };
  const turns = conversationTurns(state);
  const turn = [...turns].reverse().find(t => t.status === "inProgress" || t.status === "starting");
  if (turn) return { id: typeof turn.turnId === "string" && turn.turnId.length > 0 ? turn.turnId : null, ready: typeof turn.turnId === "string" && turn.turnId.length > 0 };
  return { id: null, ready: record(state.threadRuntimeStatus)?.type !== "active" };
}

function controlConfirmed(state: Record<string, unknown>, pending: PendingControl): { status: NonNullable<NativeControlOutcome["turnStatus"]> } | null {
  if (Array.isArray(state.unconfirmedTurnSubmissions) && state.unconfirmedTurnSubmissions.some(v => record(v)?.clientUserMessageId === pending.messageId)) return null;
  for (const turn of conversationTurns(state)) {
    const status = turn.status;
    if (!["starting", "inProgress", "completed", "interrupted", "failed"].includes(String(status))) continue;
    const result = { status: status as NonNullable<NativeControlOutcome["turnStatus"]> };
    if (pending.action === "interrupt-turn") {
      if (turn.turnId === pending.turnId && ["completed", "interrupted", "failed"].includes(String(status))) return result;
    } else {
      if (pending.action === "start-turn" && typeof turn.turnId === "string" && record(turn.params)?.clientUserMessageId === pending.messageId && !turn.pendingUserMessageAdmission) return result;
      if (Array.isArray(turn.items) && turn.items.some(value => {
        const item = record(value);
        return item?.clientUserMessageId === pending.messageId && (item.type === "userMessage" || (item.type === "steeringUserMessage" && item.status === "accepted"));
      })) return result;
    }
  }
  return null;
}

export function desktopTextInput(text: string): { type: "text"; text: string; text_elements: [] }[] {
  return [{ type: "text", text, text_elements: [] }];
}

export function desktopRestoreMessage(cwd: string | null) {
  return { cwd, context: { workspaceRoots: cwd ? [cwd] : [], collaborationMode: null, commentAttachments: [] }, responsesapiClientMetadata: null };
}
