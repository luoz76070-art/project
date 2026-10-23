import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { interactionError } from "./desktopQuestions.js";
import type { DesktopControlCapability, NativeControlOutcome } from "./desktopNativeControl.js";

const statusSchema = z.enum(["waiting", "sending", "uncertain", "paused", "sent", "cancelled"]);
const entrySchema = z.object({
  threadId: z.string().min(1).max(300), clientMessageId: z.string().uuid(), owner: z.string().min(1).max(300),
  text: z.string().max(20_000), fingerprint: z.string().length(64), createdAt: z.number(), status: statusSchema,
});
type Entry = z.infer<typeof entrySchema>;
export type DesktopQueueSnapshot = { available: boolean; items: { clientMessageId: string; text: string; status: "waiting" | "sending" | "uncertain" | "paused"; createdAt: string }[] };
type QueueView = { control: DesktopControlCapability; status: string };
type Dependencies = {
  view: (threadId: string) => QueueView | null;
  confirmed: (threadId: string, clientMessageId: string) => boolean;
  send: (entry: { threadId: string; message: string; clientMessageId: string; controlToken: string; expectedTurnId: null; mode: "start" }) => Promise<NativeControlOutcome>;
  follow: (threadId: string) => () => void;
  changed: (threadId: string) => void;
};
const active = (entry: Entry) => !["sent", "cancelled"].includes(entry.status);

/** Gateway-owned follow-ups. Never replaces the Desktop owner's native queue. */
export class DesktopMessageQueue {
  private entries: Entry[] = [];
  private file: string | undefined;
  private ownerValid: (owner: string) => boolean = () => true;
  private ready = true;
  private stopped = false;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly follows = new Map<string, () => void>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  constructor(private readonly dependencies: Dependencies) {}

  async open(file: string, ownerValid: (owner: string) => boolean): Promise<void> {
    this.ready = false;
    this.file = file;
    this.ownerValid = ownerValid;
    try {
      const stat = await fs.stat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (stat && stat.size > 4 * 1024 * 1024) throw new Error("queue_file_too_large");
      this.entries = stat ? z.array(entrySchema).max(128).parse(JSON.parse(await fs.readFile(file, "utf8"))) : [];
      for (const entry of this.entries) {
        if (entry.status === "sending") entry.status = "uncertain";
        if (["waiting", "paused"].includes(entry.status) && !ownerValid(entry.owner)) { entry.status = "cancelled"; entry.text = ""; }
      }
      await this.persist(this.entries);
      this.ready = true;
      this.syncFollows();
    } catch { throw interactionError("desktop_queue_unavailable", 503); }
  }

  snapshot(threadId: string): DesktopQueueSnapshot {
    return { available: this.ready && !this.stopped, items: this.entries.filter(e => e.threadId === threadId && active(e)).map(e => ({
      clientMessageId: e.clientMessageId, text: e.text, status: e.status as DesktopQueueSnapshot["items"][number]["status"], createdAt: new Date(e.createdAt).toISOString(),
    })) };
  }

  async enqueue(input: { threadId: string; clientMessageId: string; message: string }, owner: string, admit: () => void): Promise<void> {
    await this.mutate(() => {
      const fingerprint = createHash("sha256").update(JSON.stringify([input.threadId, owner, input.message])).digest("hex");
      const previous = this.entries.find(e => e.clientMessageId === input.clientMessageId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw interactionError("desktop_queue_id_conflict");
        return;
      }
      admit();
      if (!this.ownerValid(owner)) throw interactionError("desktop_queue_unavailable", 403);
      this.entries = this.entries.filter(e => active(e) || e.createdAt > Date.now() - 86_400_000);
      if (this.entries.length >= 128 || this.entries.filter(active).length >= 32 || this.entries.filter(e => active(e) && e.threadId === input.threadId).length >= 8 || new Set([...this.entries.filter(active).map(e => e.threadId), input.threadId]).size > 16) throw interactionError("desktop_queue_limit", 429);
      this.entries.push({ threadId: input.threadId, clientMessageId: input.clientMessageId, owner, text: input.message, fingerprint, createdAt: Date.now(), status: "waiting" });
    });
    this.dependencies.changed(input.threadId);
    this.notify(input.threadId);
  }

  async cancel(threadId: string, clientMessageId: string): Promise<void> {
    await this.mutate(() => {
      const entry = this.entries.find(e => e.threadId === threadId && e.clientMessageId === clientMessageId);
      if (!entry || !active(entry)) return;
      if (entry.status === "sending" || entry.status === "uncertain") throw interactionError("desktop_queue_result_pending");
      entry.status = "cancelled"; entry.text = "";
    });
    this.dependencies.changed(threadId);
    this.notify(threadId);
  }

  async revoke(owner: string): Promise<void> {
    const ids = new Set(this.entries.filter(e => e.owner === owner && active(e)).map(e => e.threadId));
    await this.mutate(() => { for (const entry of this.entries) if (entry.owner === owner && ["waiting", "paused"].includes(entry.status)) { entry.status = "cancelled"; entry.text = ""; } });
    for (const id of ids) this.dependencies.changed(id);
  }

  notify(threadId: string): void {
    if (!this.ready || this.stopped || !this.entries.some(e => e.threadId === threadId && active(e))) return;
    if (this.running.has(threadId)) { this.rerun.add(threadId); return; }
    // Defer until the authoritative snapshot has finished publishing.
    const task = Promise.resolve().then(() => this.drain(threadId)).catch(() => {
      this.ready = false; this.dependencies.changed(threadId);
    }).finally(() => { this.running.delete(threadId); if (this.rerun.delete(threadId)) this.notify(threadId); });
    this.running.set(threadId, task);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const release of this.follows.values()) release();
    this.follows.clear();
    await Promise.allSettled(this.running.values());
    await this.writes;
  }

  private async drain(threadId: string): Promise<void> {
    const entry = this.entries.find(e => e.threadId === threadId && active(e));
    if (!entry) return;
    const view = this.dependencies.view(threadId);
    if (this.dependencies.confirmed(threadId, entry.clientMessageId)) {
      await this.mutate(() => { entry.status = "sent"; entry.text = ""; });
      this.dependencies.changed(threadId);
      // A confirmation can precede the next task's lifecycle snapshot. Re-read it.
      if (!this.stopped) await this.drain(threadId);
      return;
    }
    if (entry.status !== "waiting" || !view?.control.token || !view.control.canSend || view.control.activeTurnId) return;
    if (["interrupted", "failed"].includes(view.status)) {
      await this.mutate(() => { for (const item of this.entries) if (item.threadId === threadId && item.status === "waiting") item.status = "paused"; });
      this.dependencies.changed(threadId); return;
    }
    if (view.status !== "completed" || this.stopped) return;
    let dispatch = false;
    await this.mutate(() => {
      if (entry.status !== "waiting" || this.stopped || !this.ownerValid(entry.owner)) return;
      entry.status = "sending"; dispatch = true;
    });
    if (!dispatch) return;
    this.dependencies.changed(threadId);
    const current = this.dependencies.view(threadId);
    if (this.stopped || !this.ownerValid(entry.owner) || !current?.control.token || current.control.activeTurnId || !current.control.canSend || current.status !== "completed") {
      await this.mutate(() => { entry.status = this.ownerValid(entry.owner) ? "waiting" : "cancelled"; if (entry.status === "cancelled") entry.text = ""; });
      this.dependencies.changed(threadId); return;
    }
    try {
      const result = await this.dependencies.send({ threadId, message: entry.text, clientMessageId: entry.clientMessageId, mode: "start", controlToken: current.control.token, expectedTurnId: null });
      await this.mutate(() => { entry.status = result.delivery === "confirmed" ? "sent" : "uncertain"; if (entry.status === "sent") entry.text = ""; });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      await this.mutate(() => { entry.status = ["desktop_control_refresh_required", "desktop_turn_changed", "desktop_submission_pending"].includes(code ?? "") ? "waiting" : "uncertain"; });
    }
    this.dependencies.changed(threadId);
  }

  private mutate(action: () => void): Promise<void> {
    const work = this.writes.then(async () => {
      if (!this.ready || this.stopped) throw interactionError("desktop_queue_unavailable", 503);
      const before = structuredClone(this.entries);
      action();
      try { await this.persist(this.entries); }
      catch (error) { this.entries = before; this.ready = false; throw error; }
      this.syncFollows();
    });
    this.writes = work.catch(() => {});
    return work;
  }

  private async persist(entries: Entry[]): Promise<void> {
    if (!this.file) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(entries), { mode: 0o600 }); await fs.rename(temporary, this.file); }
    finally { await fs.rm(temporary, { force: true }); }
  }

  private syncFollows(): void {
    if (this.stopped) return;
    const ids = new Set(this.entries.filter(active).map(e => e.threadId));
    for (const [id, release] of this.follows) if (!ids.has(id)) { this.follows.delete(id); release(); }
    for (const id of ids) if (!this.follows.has(id)) this.follows.set(id, this.dependencies.follow(id));
  }
}
