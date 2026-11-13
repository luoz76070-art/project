import { readActivityEvidence, type ActivityEvidence } from "./sessionStatusModel";
import type { CodexMessage, ThreadRuntime, LiveTurnSnapshot, DesktopStreamSnapshot } from "../../app/types";
import { capMessages, mergeMessages, mergeMessagesById, turnStatusText, nextSmoothMessageId } from "./messages";
import { turnProgressPatch, desktopApprovalsPatch, desktopControlPatch } from "./runtime";
import { captureSyncRequest, isSyncRequestCurrent, isDesktopDeltaCurrent, type SyncRequest } from "./sync";
import { toFriendlyFetchError } from "../connection/http";
import { mergeLastTurn, type LastTurn } from "./lastTurn";

export type DesktopDelta = { activeTurnId?: string | null; activityEvidence?: ActivityEvidence | null; messages: CodexMessage[]; cursor: number; generation?: string; reset?: boolean; turnStatus?: ThreadRuntime["turnStatus"]; activity?: ThreadRuntime["activity"]; lastTurn?: LastTurn | null };
export type RuntimeSyncContext = {
  getRuntime: () => ThreadRuntime;
  getSignal: () => AbortSignal;
  updateRuntime: (threadId: string, updater: (runtime: ThreadRuntime) => ThreadRuntime) => void;
  read: <T>(route: string, signal: AbortSignal) => Promise<T>;
};

// React owns subscription lifetimes; this boundary owns state and stale-read guards.
// Read refs at call time and keep guards inside the queued React updater as well.
export function createRuntimeSync(context: RuntimeSyncContext) {
  const { updateRuntime } = context;
  function applyLiveTurnSnapshot(threadKey: string, turn: LiveTurnSnapshot, request?: SyncRequest) {
    updateRuntime(threadKey, (runtime) => {
      if (turn.threadId !== threadKey || !isSyncRequestCurrent(runtime, request)) return runtime;
      if (request && (turn.turnId !== request.turnId || runtime.activeTurnId !== request.turnId)) return runtime;
      const messages = capMessages(mergeMessagesById(runtime.messages, turn.messages), runtime);
      return {
        ...runtime,
        syncRevision: (runtime.syncRevision ?? 0) + 1,
        messages,
        sending: turn.status === "starting" || turn.status === "inProgress",
        loaded: true,
        status: turnStatusText(turn.status),
        activeTurnId: turn.status === "starting" || turn.status === "inProgress" ? turn.turnId : null,
        turnStatus: turn.status,
        lastTurn: mergeLastTurn(runtime.lastTurn, turn.lastTurn),
        activityEvidence: turn.connected === false || !["starting", "inProgress"].includes(turn.status) ? null : readActivityEvidence(turn.activityEvidence),
        statusTurnId: turn.turnId, sourceConnected: turn.connected !== false,
        lastEventCount: turn.eventCount,
        lastTurnError: turn.error ?? "",
        approvals: turn.approvals ?? runtime.approvals,
        userInputs: turn.userInputs ?? [],
        smoothMessageId: nextSmoothMessageId(runtime, messages),
      };
    });
  }

  function applyDesktopStreamSnapshot(threadKey: string, snapshot: DesktopStreamSnapshot, signal?: AbortSignal) {
    updateRuntime(threadKey, (runtime) => {
      if (signal?.aborted || snapshot.threadId !== threadKey) return runtime;
      const messages = capMessages(mergeMessagesById(runtime.messages, snapshot.messages, snapshot.inputReplacements), runtime);
      const snapshotActive = snapshot.status === "starting" || snapshot.status === "inProgress";
      return {
        ...runtime,
        syncRevision: (runtime.syncRevision ?? 0) + 1,
        ...turnProgressPatch(runtime, { turnStatus: snapshot.status }),
        lastTurn: mergeLastTurn(runtime.lastTurn, snapshot.lastTurn),
        messages,
        loaded: true,
        status: snapshotActive ? "桌面实时同步中" : turnStatusText(snapshot.status),
        watching: true,
        activeTurnId: null,
        statusTurnId: snapshot.activeTurnId ?? null,
        sourceConnected: snapshot.changeType !== "disconnected",
        activityEvidence: snapshot.changeType === "disconnected" || !snapshotActive ? null : readActivityEvidence(snapshot.activityEvidence),
        lastEventCount: snapshot.eventCount,
        userInputs: snapshot.interactionsAvailable ? snapshot.userInputs ?? [] : [],
        ...desktopApprovalsPatch(runtime, snapshot.approvals, snapshot.interactionsAvailable),
        ...desktopControlPatch(runtime, snapshot.control),
        lastTurnError: snapshot.lastTurn?.status === "failed" ? snapshot.lastTurn.reason.message : "",
        smoothMessageId: nextSmoothMessageId(runtime, messages),
      };
    });
  }

  function applyDesktopDelta(threadId: string, data: DesktopDelta, request?: SyncRequest) {
    updateRuntime(threadId, (runtime) => {
      if (!isSyncRequestCurrent(runtime, request) || !isDesktopDeltaCurrent(runtime, data)) return runtime;
      const nextMessages = capMessages(mergeMessages(data.reset ? [] : runtime.messages, data.messages), runtime);
      return {
        ...runtime,
        syncRevision: (runtime.syncRevision ?? 0) + 1,
        ...turnProgressPatch(data.reset ? { ...runtime, lastTurn: null, turnStatus: "idle", activity: undefined, activityEvidence: null, statusTurnId: null, sending: false, activeTurnId: null } : runtime, data),
        sourceConnected: true, cursor: data.cursor, generation: data.generation,
        messages: nextMessages, watching: true,
        historyBefore: data.reset ? 0 : runtime.historyBefore,
        status: data.turnStatus ? turnStatusText(data.turnStatus) : runtime.status,
        smoothMessageId: nextSmoothMessageId(runtime, nextMessages),
      };
    });
  }

  async function watchDesktopDelta(threadId: string, cursor: number, signal = context.getSignal()) {
    const request = captureSyncRequest(context.getRuntime(), signal);
    const generation = request.expected.generation;
    try {
      const data = await context.read<DesktopDelta>(
        `/api/desktop/threads/${encodeURIComponent(threadId)}/delta?cursor=${cursor}${generation ? `&generation=${encodeURIComponent(generation)}` : ""}`, signal,
      );
      if (!isSyncRequestCurrent(context.getRuntime(), request)) return;
      if (data.cursor !== cursor || data.messages.length || data.reset || data.turnStatus || data.activity || data.activityEvidence !== undefined || data.lastTurn !== undefined) applyDesktopDelta(threadId, data, request);
    } catch (error) {
      if (!isSyncRequestCurrent(context.getRuntime(), request)) return;
      updateRuntime(threadId, runtime => isSyncRequestCurrent(runtime, request) ? { ...runtime, watching: false, activityEvidence: null, sourceConnected: false, status: toFriendlyFetchError(error) } : runtime);
    }
  }

  async function pollLiveTurn(threadKey: string, turnId: string, signal = context.getSignal()) {
    const request = captureSyncRequest(context.getRuntime(), signal);
    if (request.expected.activeTurnId !== turnId) return;
    try {
      const data = await context.read<{ turn: LiveTurnSnapshot | null; error?: string }>(
        `/api/live/turns/${encodeURIComponent(turnId)}`, signal,
      );
      if (!isSyncRequestCurrent(context.getRuntime(), request)) return;
      if (!data.turn) throw new Error(data.error ?? "live turn not found");
      if (data.turn.turnId !== turnId || data.turn.threadId !== threadKey) return;
      applyLiveTurnSnapshot(threadKey, data.turn, request);
    } catch (error) {
      if (!isSyncRequestCurrent(context.getRuntime(), request)) return;
      updateRuntime(threadKey, runtime => isSyncRequestCurrent(runtime, request) ? { ...runtime, activityEvidence: null, sourceConnected: false, status: toFriendlyFetchError(error), lastTurnError: toFriendlyFetchError(error) } : runtime);
    }
  }

  return { applyLiveTurnSnapshot, applyDesktopStreamSnapshot, applyDesktopDelta, watchDesktopDelta, pollLiveTurn };
}
