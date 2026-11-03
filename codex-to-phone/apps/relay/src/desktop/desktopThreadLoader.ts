import { execFile } from "node:child_process";
import type { CodexStore } from "../store/codexStore.js";

export type DesktopThreadLoad = (threadId: string, stillNeeded: () => boolean) => Promise<void>;
type OpenThread = (url: string) => Promise<void>;

// The host's existing-thread URL hydrates its own manager. It carries no prompt.
const openThread: OpenThread = url => new Promise((resolve, reject) => {
  execFile("/usr/bin/open", ["-g", url], { timeout: 5_000, maxBuffer: 4096 }, error => {
    if (error) reject(new Error("desktop_thread_load_failed")); else resolve();
  });
});

/** Only foreground phone subscriptions may request this recovery, never a catalog scan or queue. */
export function createDesktopThreadLoader(store: Pick<CodexStore, "getThreadSummary">, options: {
  platform?: NodeJS.Platform; open?: OpenThread; now?: () => number;
} = {}): DesktopThreadLoad {
  const pending = new Map<string, { promise: Promise<void>; viewers: Set<() => boolean> }>(), attempts = new Map<string, number>();
  const now = options.now ?? Date.now;
  let serial = Promise.resolve();
  return (threadId, stillNeeded) => {
    if ((options.platform ?? process.platform) !== "darwin" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
      return Promise.reject(new Error("desktop_thread_load_unavailable"));
    }
    const existing = pending.get(threadId);
    if (existing) { existing.viewers.add(stillNeeded); return existing.promise; }
    if (pending.size >= 128) return Promise.reject(new Error("desktop_thread_load_throttled"));
    const viewers = new Set([stillNeeded]);
    const needed = () => [...viewers].some(viewer => viewer());
    const work = serial.then(async () => {
      if (!needed()) return;
      for (const [id, at] of attempts) if (now() - at >= 60_000) attempts.delete(id);
      if (attempts.has(threadId) || attempts.size >= 128) throw new Error("desktop_thread_load_throttled");
      const summary = await store.getThreadSummary(threadId);
      if (!needed()) return;
      if (!summary || summary.id !== threadId) throw new Error("desktop_thread_load_unavailable");
      attempts.set(threadId, now());
      await (options.open ?? openThread)(`codex://threads/${threadId}`);
    }).finally(() => { if (pending.get(threadId)?.promise === work) pending.delete(threadId); });
    pending.set(threadId, { promise: work, viewers });
    serial = work.catch(() => {});
    return work;
  };
}
