import type { ThreadSummary } from "../../app/types";

type WorkspaceCache = { threads: ThreadSummary[]; selectedId: string | null; isNewThread: boolean };
const key = (scope: string) => `mobileCodexWorkspaceV1:${scope}`;

export function loadWorkspaceCache(scope: string): WorkspaceCache {
  try {
    const data = JSON.parse(localStorage.getItem(key(scope)) ?? "{}") as Partial<WorkspaceCache>;
    const threads = Array.isArray(data.threads) ? data.threads.filter(thread => typeof thread?.id === "string" && typeof thread.threadName === "string").slice(0, 120) : [];
    return { threads, selectedId: typeof data.selectedId === "string" ? data.selectedId : null, isNewThread: data.isNewThread === true };
  } catch { return { threads: [], selectedId: null, isNewThread: false }; }
}

export function saveWorkspaceCache(scope: string, data: WorkspaceCache) {
  try {
    const selected = data.threads.find(thread => thread.id === data.selectedId);
    const threads = selected ? [selected, ...data.threads.filter(thread => thread.id !== selected.id)].slice(0, 120) : data.threads.slice(0, 120);
    localStorage.setItem(key(scope), JSON.stringify({ ...data, threads }));
  } catch { /* Metadata cache failure must not block online work. */ }
}
