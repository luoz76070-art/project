import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

type RolloutFile = { file: string; mtimeMs: number };

/** One cold inventory, file notifications for changes, and periodic reconciliation. */
export class RolloutIndex {
  private readonly entries = new Map<string, RolloutFile>();
  private readonly dirty = new Set<string>();
  private refreshing: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private reconciledAt = 0;
  private closed = false;
  private directoryIdentity = "";

  constructor(private readonly directory: string) {}

  close() { this.closed = true; this.watcher?.close(); this.watcher = null; }

  async files(): Promise<RolloutFile[]> {
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
    }
    await this.refreshing;
    return [...this.entries.values()];
  }

  private async refresh() {
    if (this.closed) return;
    const rootStat = await fs.stat(this.directory).catch(() => null);
    if (this.closed) return;
    const identity = rootStat ? `${rootStat.dev}:${rootStat.ino}:${rootStat.birthtimeMs}` : "missing";
    if (identity !== this.directoryIdentity) {
      this.watcher?.close();
      this.watcher = null;
      this.directoryIdentity = identity;
      this.reconciledAt = 0;
    }
    if (!this.watcher) {
      try {
        this.watcher = watch(this.directory, { recursive: true }, (_event, filename) => {
          if (filename) this.dirty.add(path.join(this.directory, filename.toString()));
          else this.reconciledAt = 0;
        });
        this.watcher.unref();
        this.watcher.on("error", () => { this.watcher?.close(); this.watcher = null; this.reconciledAt = 0; });
      } catch { /* Periodic reconciliation covers unsupported filesystems. */ }
    }
    if (Date.now() - this.reconciledAt > 60_000) {
      const found = new Set<string>();
      await this.scan(this.directory, found);
      for (const file of this.entries.keys()) if (!found.has(file)) this.entries.delete(file);
      this.reconciledAt = Date.now();
    }
    const changed = [...this.dirty];
    this.dirty.clear();
    // Bound concurrent IO during a burst of file notifications.
    for (let i = 0; i < changed.length; i += 16) {
      await Promise.all(changed.slice(i, i + 16).map(async file => {
        try {
          const stat = await fs.stat(file);
          if (stat.isDirectory()) await this.scan(file);
          else if (file.endsWith(".jsonl")) this.entries.set(file, { file, mtimeMs: stat.mtimeMs });
        } catch {
          this.entries.delete(file);
          for (const entry of this.entries.keys()) if (entry.startsWith(`${file}${path.sep}`)) this.entries.delete(entry);
        }
      }));
    }
    // Without notifications, refresh only recent candidates between reconciliations.
    if (!this.watcher) {
      const recent = [...this.entries.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 240);
      await Promise.all(recent.map(async entry => {
        try { entry.mtimeMs = (await fs.stat(entry.file)).mtimeMs; } catch { this.entries.delete(entry.file); }
      }));
    }
  }

  private async scan(directory: string, found?: Set<string>) {
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (let i = 0; i < children.length; i += 16) {
      await Promise.all(children.slice(i, i + 16).map(async entry => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { await this.scan(file, found); return; }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
        found?.add(file);
        try {
          const stat = await fs.stat(file);
          this.entries.set(file, { file, mtimeMs: stat.mtimeMs });
        } catch { this.entries.delete(file); }
      }));
    }
  }
}
