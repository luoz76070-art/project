import { type ThreadRuntime } from "../../app/types";

// A poll may finish after a newer SSE event, even before React cleans its effect up.
// Compare only synchronization fields so editing a draft does not invalidate reads.
export function captureSyncRequest(runtime: ThreadRuntime, signal: AbortSignal) {
  return {
    signal,
    turnId: runtime.activeTurnId,
    expected: {
      syncRevision: runtime.syncRevision,
      activeTurnId: runtime.activeTurnId,
      turnStatus: runtime.turnStatus,
      lastEventCount: runtime.lastEventCount,
      cursor: runtime.cursor,
      generation: runtime.generation,
      watchMode: runtime.watchMode,
      loading: runtime.loading,
      pendingMessageId: runtime.pendingMessageId,
    },
  };
}

export type SyncRequest = {
  signal: AbortSignal;
  turnId?: string | null;
  expected?: ReturnType<typeof captureSyncRequest>["expected"];
};

export function isSyncRequestCurrent(runtime: ThreadRuntime, request?: SyncRequest): boolean {
  return !request || (!request.signal.aborted && Object.entries(request.expected ?? {}).every(
    ([key, value]) => runtime[key as keyof ThreadRuntime] === value,
  ));
}

export function isDesktopDeltaCurrent(runtime: ThreadRuntime, data: { cursor: number; generation?: string; reset?: boolean }): boolean {
  if (!Number.isSafeInteger(data.cursor) || data.cursor < 0) return false;
  // Explicit reset also covers truncation of the same file (same generation).
  if (data.reset) return true;
  if (runtime.generation && data.generation && runtime.generation !== data.generation) return false;
  return data.cursor >= runtime.cursor;
}

export function createPollScope(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) abort();
  return {
    controller,
    dispose: () => { abort(); parent.removeEventListener("abort", abort); },
  };
}
