import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { RolloutIndex } from "./rolloutIndex.js";
import { readJsonlWindow } from "./jsonl.js";
import { turnProgress, type TurnProgress } from "./turnActivity.js";

export type CodexThreadSummary = {
  id: string;
  threadName: string;
  updatedAt: string;
  cwd: string | null;
  source: string | null;
  originator: string | null;
  rolloutPath: string | null;
};

export type CodexMessage = {
  id: string;
  clientMessageId?: string;
  sourceItemId?: string;
  replacesMessageId?: string;
  turnId?: string;
  phase?: "commentary" | "final_answer";
  timestamp: string;
  role: "user" | "assistant" | "system" | "developer" | "tool" | "unknown";
  text: string;
  kind: string;
};

export type CodexThreadRead = TurnProgress & {
  thread: CodexThreadSummary | null;
  messages: CodexMessage[];
  cursor: number;
  fileSize: number;
  truncated?: boolean;
  windowStart?: number;
  generation?: string;
  reset?: boolean;
};

export type CodexThreadDelta = TurnProgress & {
  messages: CodexMessage[];
  cursor: number;
  fileSize: number;
  truncated: boolean;
  generation?: string;
  reset?: boolean;
};

type SessionIndexRow = {
  id?: string;
  thread_name?: string;
  updated_at?: string;
};

type RolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: unknown;
};

export class CodexStore {
  private readonly rolloutPathCache = new Map<string, string>();

  private readonly index: RolloutIndex;
  private indexRows: { signature: string; rows: SessionIndexRow[] } | null = null;
  private indexRead: Promise<SessionIndexRow[]> | null = null;
  private readonly indexNames = new Map<string, string>();
  private readonly headReads = new Map<string, Promise<RolloutLine[]>>();
  private readonly heads = new Map<string, { signature: string; lines: RolloutLine[] }>();

  constructor(private readonly codexHome: string) { this.index = new RolloutIndex(path.join(codexHome, "sessions")); }

  close() { this.index.close(); }


  async getThreadSummary(threadId: string): Promise<CodexThreadSummary | null> {
    const file = await this.findRolloutPath(threadId);
    if (!file) return null;
    return this.readThreadSummary(threadId, file, (await fs.stat(file)).mtimeMs);
  }

  async listThreads(limit = 50, offset = 0, query = "", since = 0): Promise<CodexThreadSummary[]> {
    const [rows, files] = await Promise.all([this.readSessionIndex(), this.index.files()]);
    const candidates = new Map<string, { id: string; name: string | null; updatedAt: number; file: string | null }>();
    for (const row of rows) {
      if (!row.id) continue;
      candidates.set(row.id, { id: row.id, name: row.thread_name ?? null, updatedAt: Date.parse(row.updated_at ?? "") || 0, file: null });
    }
    for (const entry of files) {
      const id = extractThreadIdFromRolloutName(entry.file) ?? (await this.readSessionMeta(entry.file))?.id;
      if (!id) continue;
      const previous = candidates.get(id);
      candidates.set(id, { id, name: previous?.name ?? null, file: entry.file, updatedAt: Math.max(entry.mtimeMs, previous?.updatedAt ?? 0) });
      this.rolloutPathCache.set(id, entry.file);
    }
    while (this.rolloutPathCache.size > 10000) this.rolloutPathCache.delete(this.rolloutPathCache.keys().next().value!);
    const needle = query.trim().toLowerCase();
    const ordered = [...candidates.values()].filter(candidate => candidate.updatedAt >= since).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const matching = [];
    for (const candidate of ordered) {
      if (needle) {
        const name = candidate.name ?? (candidate.file ? await this.extractThreadName(candidate.file) : "Untitled");
        if (!`${name} ${candidate.id}`.toLowerCase().includes(needle)) continue;
      }
      matching.push(candidate);
      if (matching.length >= offset + limit) break;
    }
    return Promise.all(matching.slice(offset, offset + limit).map(async candidate => {
      if (candidate.file) return this.readThreadSummary(candidate.id, candidate.file, candidate.updatedAt);
      return { id: candidate.id, threadName: candidate.name ?? "Untitled", updatedAt: new Date(candidate.updatedAt).toISOString(), cwd: null, source: null, originator: null, rolloutPath: null };
    }));
  }

  async readThread(threadId: string): Promise<{ thread: CodexThreadSummary | null; messages: CodexMessage[] }> {
    const read = await this.readThreadWithCursor(threadId);
    return { thread: read.thread, messages: read.messages };
  }

  async readThreadWithCursor(threadId: string): Promise<CodexThreadRead> {
    const file = await this.findRolloutPath(threadId);
    if (!file) return { thread: null, messages: [], cursor: 0, fileSize: 0 };
    const stat = await fs.stat(file);
    let cursor = 0;
    let generation: string | undefined;
    const messages: CodexMessage[] = [];
    do {
      const page = await readJsonlWindow(file, { cursor, before: stat.size, maxBytes: 512_000, generation });
      if (page.reset) throw Object.assign(new Error("History changed during read; retry required"), { statusCode: 409 });
      generation = page.generation;
      messages.push(...page.records.flatMap(({ value, offset }) => this.toMessage(value as RolloutLine, offset, `log-${generation}`)));
      if (page.cursor === cursor) break; // Incomplete final record is left for the next delta.
      cursor = page.cursor;
    } while (cursor < stat.size);
    return { thread: await this.readThreadSummary(threadId, file, stat.mtimeMs), messages: dedupeMessages(messages), cursor, fileSize: stat.size, generation, windowStart: 0 };

  }

  async readThreadLatest(threadId: string, maxBytes = 262_144, maxMessages = 80, before?: number, generation?: string): Promise<CodexThreadRead> {
    const rolloutPath = await this.findRolloutPath(threadId);
    if (!rolloutPath) return { thread: null, messages: [], cursor: 0, fileSize: 0, windowStart: 0 };
    const [window, stat] = await Promise.all([readJsonlWindow(rolloutPath, { before, maxBytes }), fs.stat(rolloutPath)]);
    if (before !== undefined && generation && window.generation !== generation) {
      return { ...await this.readThreadLatest(threadId, maxBytes, maxMessages), reset: true };
    }
    const { records, ...metadata } = window;
    const thread = await this.readThreadSummary(threadId, rolloutPath, stat.mtimeMs);
    const messages = dedupeMessages(records.flatMap(({ value, offset }) => this.toMessage(value as RolloutLine, offset, `log-${window.generation}`)));
    const progress = turnProgress(records);
    let statusBefore = window.windowStart;
    let scanned = window.cursor - statusBefore;
    // A phone can join after task_started. Restore lifecycle without changing its history page.
    while (before === undefined && !progress.turnStatus && statusBefore > 0 && scanned < 8 * 1024 * 1024) {
      const page = await readJsonlWindow(rolloutPath, { before: statusBefore, maxBytes: Math.min(maxBytes, 8 * 1024 * 1024 - scanned) });
      if (page.generation !== window.generation) return { ...await this.readThreadLatest(threadId, maxBytes, maxMessages), reset: true };
      if (page.windowStart >= statusBefore) break;
      const older = turnProgress(page.records);
      progress.turnStatus ??= older.turnStatus;
      progress.activity ??= older.activity;
      scanned += statusBefore - page.windowStart;
      statusBefore = page.windowStart;
    }
    if (progress.turnStatus && progress.turnStatus !== "inProgress") progress.activity = undefined;
    // Pagination advances to the earliest returned record, not past omitted messages.
    const kept = messages.slice(-maxMessages);
    const firstOffset = kept.length < messages.length ? Number(kept[0]?.id.split("-").at(-1)) : window.windowStart;
    return { ...metadata, ...progress, thread, messages: kept, windowStart: Number.isFinite(firstOffset) ? firstOffset : window.windowStart };
  }

  async readThreadDelta(threadId: string, cursor = 0, maxBytes = 512_000, generation?: string): Promise<CodexThreadDelta> {
    const rolloutPath = await this.findRolloutPath(threadId);
    if (!rolloutPath) return { messages: [], cursor: 0, fileSize: 0, truncated: false, reset: cursor > 0 };
    const window = await readJsonlWindow(rolloutPath, { cursor, maxBytes, generation });
    const { records, ...metadata } = window;
    const messages = records.flatMap(({ value, offset }) => this.toMessage(value as RolloutLine, offset, `log-${window.generation}`));
    return { ...metadata, ...turnProgress(records), messages: dedupeMessages(messages) };
  }

  async getActiveDesktopThread(): Promise<CodexThreadSummary | null> {
    const threads = await this.listThreads(80);
    return threads.find(isDesktopThread) ?? threads[0] ?? null;
  }

  async listActiveDesktopThreads(limit = 8, activeWindowMs = 30 * 60_000): Promise<CodexThreadSummary[]> {
    const threads = (await this.listThreads(Math.max(limit * 4, 20))).filter(isDesktopThread);
    if (threads.length === 0) return [];

    const latestMs = Math.max(...threads.map((thread) => Date.parse(thread.updatedAt)).filter(Number.isFinite));
    if (!Number.isFinite(latestMs)) return threads.slice(0, Math.min(limit, 3));

    const recent = threads.filter((thread) => Date.parse(thread.updatedAt) >= latestMs - activeWindowMs);
    return (recent.length > 0 ? recent : threads.slice(0, 3)).slice(0, limit);
  }

  private async readSessionIndex(): Promise<SessionIndexRow[]> {
    if (this.indexRead) return this.indexRead;
    this.indexRead = (async () => {
      const file = path.join(this.codexHome, "session_index.jsonl");
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) return [];
      const signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
      if (this.indexRows?.signature === signature) return this.indexRows.rows;
      const rows = (await this.readLines(file)).flatMap(line => parseJson<SessionIndexRow>(line));
      const byId = new Map<string, SessionIndexRow>();
      for (const row of rows) if (row.id) byId.set(row.id, row);
      this.indexNames.clear();
      for (const [id, row] of byId) if (row.thread_name) this.indexNames.set(id, row.thread_name);
      this.indexRows = { signature, rows: [...byId.values()] };
      return this.indexRows.rows;
    })().finally(() => { this.indexRead = null; });
    return this.indexRead;
  }

  private async findRolloutPath(threadId: string): Promise<string | null> {
    const cached = this.rolloutPathCache.get(threadId);
    if (cached && (await fileExists(cached))) return cached;
    const files = await this.index.files();
    const found = files.find(({ file }) => path.basename(file).includes(threadId))?.file ?? null;
    if (found) this.rolloutPathCache.set(threadId, found);
    if (this.rolloutPathCache.size > 10000) this.rolloutPathCache.delete(this.rolloutPathCache.keys().next().value!);
    return found;
  }

  private async readSessionMeta(rolloutPath: string): Promise<Record<string, string> | null> {
    const lines = await this.readSessionHead(rolloutPath);
    const meta = lines.find((line) => line.type === "session_meta");
    const payload = meta?.payload;
    if (payload && typeof payload === "object") {
      return payload as Record<string, string>;
    }
    return null;
  }

  private async readThreadSummary(threadId: string, rolloutPath: string, mtimeMs: number): Promise<CodexThreadSummary> {
    const [meta, indexedName, extractedName] = await Promise.all([
      this.readSessionMeta(rolloutPath),
      this.readIndexedThreadName(threadId),
      this.extractThreadName(rolloutPath),
    ]);
    return {
      id: meta?.id ?? threadId,
      threadName: chooseThreadName(indexedName, extractedName),
      updatedAt: new Date(mtimeMs).toISOString(),
      cwd: meta?.cwd ?? null,
      source: meta?.source ?? null,
      originator: meta?.originator ?? null,
      rolloutPath,
    };
  }

  private async readIndexedThreadName(threadId: string): Promise<string | null> {
    await this.readSessionIndex();
    return this.indexNames.get(threadId) ?? null;
  }

  private async extractThreadName(rolloutPath: string): Promise<string> {
    const lines = await this.readSessionHead(rolloutPath);
    for (const line of lines) {
      const payload = line.payload as Record<string, unknown> | undefined;
      if (line.type === "event_msg" && payload?.type === "user_message" && typeof payload.message === "string") {
        if (isDisplayableUserText(payload.message)) return payload.message.slice(0, 80);
      }
      if (line.type === "response_item" && payload?.type === "message" && payload.role === "user") {
        const text = extractContentText(payload.content);
        if (isDisplayableUserText(text)) return text.slice(0, 80);
      }
    }
    return "Untitled";
  }

  private async readSessionHead(file: string): Promise<RolloutLine[]> {
    const pending = this.headReads.get(file);
    if (pending) return pending;
    const reading = (async () => {
      const stat = await fs.stat(file);
      const signature = `${stat.ino}:${stat.birthtimeMs}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const cached = this.heads.get(file);
      if (cached?.signature === signature) return cached.lines;
      const lines = (await this.readHeadLines(file, 160)).flatMap(line => parseJson<RolloutLine>(line));
      this.heads.set(file, { signature, lines });
      if (this.heads.size > 1000) this.heads.delete(this.heads.keys().next().value!);
      return lines;
    })().finally(() => { this.headReads.delete(file); });
    this.headReads.set(file, reading);
    return reading;
  }

  private async readLines(file: string, maxLines?: number): Promise<string[]> {
    if (typeof maxLines === "number") {
      return this.readHeadLines(file, maxLines);
    }
    const content = await fs.readFile(file, "utf8");
    return content.split(/\r?\n/).filter(Boolean);
  }

  private async readHeadLines(file: string, maxLines: number): Promise<string[]> {
    const handle = await fs.open(file, "r");
    const decoder = new StringDecoder("utf8");
    const chunks: string[] = [];
    const buffer = Buffer.alloc(32_768);
    const maxBytes = 256_000;
    let offset = 0;
    let lines = 0;
    try {
      while (offset < maxBytes && lines < maxLines) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        const chunk = decoder.write(buffer.subarray(0, bytesRead));
        chunks.push(chunk);
        lines += countNewlines(chunk);
        offset += bytesRead;
      }
      const tail = decoder.end();
      if (tail) chunks.push(tail);
      return chunks.join("").split(/\r?\n/).filter(Boolean).slice(0, maxLines);
    } finally {
      await handle.close();
    }
  }

  private toMessage(line: RolloutLine, index: number, idPrefix = "m"): CodexMessage[] {
    const timestamp = line.timestamp ?? "";
    if (line.type === "response_item") {
      const payload = line.payload as Record<string, unknown> | undefined;
      if (payload?.type === "message") {
        const role = normalizeRole(payload.role);
        const text = extractContentText(payload.content);
        const metadata = payload.internal_chat_message_metadata_passthrough as Record<string, unknown> | undefined;
        if (role === "user" && !isDisplayableUserText(text)) return [];
        return text ? [{ id: `${idPrefix}-${index}`, timestamp, role, text, kind: "message",
          ...((role === "assistant" || role === "user") && typeof payload.id === "string" ? { sourceItemId: payload.id } : {}),
          ...((role === "user" || role === "assistant") && typeof metadata?.turn_id === "string" ? { turnId: metadata.turn_id } : {}),
          ...(payload.phase === "commentary" || payload.phase === "final_answer" ? { phase: payload.phase } : {}),
        }] : [];
      }
      if (payload?.type === "function_call") {
        const text = formatFunctionCall(payload);
        return text ? [{ id: `${idPrefix}-${index}`, timestamp, role: "tool", text, kind: "function_call" }] : [];
      }
      if (payload?.type === "function_call_output") {
        const output = typeof payload.output === "string" ? payload.output : "";
        return output
          ? [{ id: `${idPrefix}-${index}`, timestamp, role: "tool", text: truncateToolOutput(output), kind: "function_call_output" }]
          : [];
      }
    }

    if (line.type === "event_msg") {
      const payload = line.payload as Record<string, unknown> | undefined;
      if (payload?.type === "user_message" && typeof payload.message === "string") {
        if (!isDisplayableUserText(payload.message)) return [];
        return [{ id: `${idPrefix}-${index}`, timestamp, role: "user", text: payload.message, kind: "user_message" }];
      }
      if (payload?.type === "agent_message" && typeof payload.message === "string") {
        return [{ id: `${idPrefix}-${index}`, timestamp, role: "assistant", text: payload.message, kind: "agent_message" }];
      }
      if (payload?.type === "task_started") {
        return [{ id: `${idPrefix}-${index}`, timestamp, role: "tool", text: "Codex turn started", kind: "task_started" }];
      }
    }

    return [];
  }
}


function parseJson<T>(line: string): T[] {
  try {
    return [JSON.parse(line) as T];
  } catch {
    return [];
  }
}

function normalizeRole(value: unknown): CodexMessage["role"] {
  if (value === "user" || value === "assistant" || value === "system" || value === "developer" || value === "tool") {
    return value;
  }
  return "unknown";
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      return typeof record.input_text === "string" ? record.input_text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function formatFunctionCall(payload: Record<string, unknown>): string {
  const name = typeof payload.name === "string" ? payload.name : "tool";
  const args = typeof payload.arguments === "string" ? parseJsonObject(payload.arguments) : null;
  if (args && typeof args.command === "string") {
    const lines = [`Tool: ${name}`, `Command: ${args.command}`];
    if (typeof args.workdir === "string") lines.push(`Workdir: ${args.workdir}`);
    return lines.join("\n");
  }
  if (typeof payload.arguments === "string" && payload.arguments.trim()) {
    return `Tool: ${name}\n${payload.arguments}`;
  }
  return `Tool: ${name}`;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function truncateToolOutput(value: string): string {
  const maxLength = 6_000;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[output truncated: ${value.length - maxLength} chars hidden on mobile]`;
}

function countNewlines(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function dedupeMessages(messages: CodexMessage[]): CodexMessage[] {
  const seen = new Set<string>();
  const result: CodexMessage[] = [];
  for (const message of messages) {
    const key = JSON.stringify([message.sourceItemId ?? null, message.timestamp, message.role, message.kind, message.text]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }
  return result;
}

function chooseThreadName(primary: string | null | undefined, fallback: string | null | undefined): string {
  const first = normalizeThreadName(primary);
  if (first && !isContextOrGeneratedThreadName(first)) return first;
  const second = normalizeThreadName(fallback);
  if (second && !isContextOrGeneratedThreadName(second)) return second;
  return first || second || "Untitled";
}

function normalizeThreadName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function isContextOrGeneratedThreadName(value: string): boolean {
  return (
    value === "Untitled" ||
    value.startsWith("# AGENTS.md instructions") ||
    value.startsWith("<INSTRUCTIONS>") ||
    value.startsWith("<environment_context>") ||
    value.startsWith("<permissions instructions>") ||
    value.startsWith("<app-context>") ||
    value.startsWith("<collaboration_mode>") ||
    value.startsWith("<personality_spec>") ||
    value.startsWith("<skills_instructions>") ||
    value.startsWith("<plugins_instructions>") ||
    value.startsWith("<send_user_message_question_reply>")
  );
}

function extractThreadIdFromRolloutName(file: string): string | null {
  const match = path.basename(file).match(/(?:^rollout-|^rollout-.+-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] ?? null;
}

function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Legacy rollouts encode injected context as user text. Recognize only
  // reserved envelopes, never prose such as "You are" or "Knowledge cutoff".
  return !(
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

function isDesktopThread(thread: CodexThreadSummary): boolean {
  return thread.source === "vscode" || thread.originator?.toLowerCase().includes("desktop") === true;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}
