import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

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
  timestamp: string;
  role: "user" | "assistant" | "system" | "developer" | "tool" | "unknown";
  text: string;
  kind: string;
};

export type CodexThreadRead = {
  thread: CodexThreadSummary | null;
  messages: CodexMessage[];
  cursor: number;
  fileSize: number;
  truncated?: boolean;
  windowStart?: number;
};

export type CodexThreadDelta = {
  messages: CodexMessage[];
  cursor: number;
  fileSize: number;
  truncated: boolean;
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

  constructor(private readonly codexHome: string) {}

  async listThreads(limit = 50): Promise<CodexThreadSummary[]> {
    const rows = await this.readSessionIndex();
    const indexed = rows
      .filter((row): row is Required<Pick<SessionIndexRow, "id" | "updated_at">> & SessionIndexRow =>
        Boolean(row.id && row.updated_at),
      )
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, limit * 2);

    const enrichedFromIndex = await Promise.all(
      indexed.map(async (row) => {
        const rolloutPath = await this.findRolloutPath(row.id);
        const meta = rolloutPath ? await this.readSessionMeta(rolloutPath) : null;
        return {
          id: row.id,
          threadName: row.thread_name ?? "Untitled",
          updatedAt: row.updated_at,
          cwd: meta?.cwd ?? null,
          source: meta?.source ?? null,
          originator: meta?.originator ?? null,
          rolloutPath,
        };
      }),
    );

    const enrichedFromRollouts = await this.listRecentRolloutThreads(limit * 2);
    const byId = new Map<string, CodexThreadSummary>();
    for (const thread of [...enrichedFromIndex, ...enrichedFromRollouts]) {
      const existing = byId.get(thread.id);
      if (!existing || Date.parse(thread.updatedAt) > Date.parse(existing.updatedAt)) {
        byId.set(thread.id, thread);
      }
    }

    return [...byId.values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  async readThread(threadId: string): Promise<{ thread: CodexThreadSummary | null; messages: CodexMessage[] }> {
    const read = await this.readThreadWithCursor(threadId);
    return { thread: read.thread, messages: read.messages };
  }

  async readThreadWithCursor(threadId: string): Promise<CodexThreadRead> {
    const [threads, rolloutPath] = await Promise.all([this.listThreads(200), this.findRolloutPath(threadId)]);
    const thread = threads.find((item) => item.id === threadId) ?? null;
    if (!rolloutPath) {
      return { thread, messages: [], cursor: 0, fileSize: 0 };
    }
    const stat = await fs.stat(rolloutPath);
    const lines = await this.readJsonl(rolloutPath);
    return {
      thread: thread
        ? { ...thread, rolloutPath }
        : {
            id: threadId,
            threadName: "Untitled",
            updatedAt: lines.at(-1)?.timestamp ?? "",
            cwd: null,
            source: null,
            originator: null,
            rolloutPath,
          },
      messages: dedupeMessages(lines.flatMap((line, index) => this.toMessage(line, index))),
      cursor: stat.size,
      fileSize: stat.size,
    };
  }

  async readThreadLatest(threadId: string, maxBytes = 262_144, maxMessages = 80): Promise<CodexThreadRead> {
    const rolloutPath = await this.findRolloutPath(threadId);
    if (!rolloutPath) {
      return { thread: null, messages: [], cursor: 0, fileSize: 0, truncated: false, windowStart: 0 };
    }

    const stat = await fs.stat(rolloutPath);
    const [{ lines, windowStart, truncated }, thread] = await Promise.all([
      this.readJsonlTail(rolloutPath, maxBytes),
      this.readThreadSummary(threadId, rolloutPath, stat.mtimeMs),
    ]);
    const messages = dedupeMessages(lines.flatMap((line, index) => this.toMessage(line, index, `latest-${windowStart}`))).slice(-maxMessages);
    return {
      thread,
      messages,
      cursor: stat.size,
      fileSize: stat.size,
      truncated,
      windowStart,
    };
  }

  async readThreadDelta(threadId: string, cursor = 0, maxBytes = 512_000): Promise<CodexThreadDelta> {
    const rolloutPath = await this.findRolloutPath(threadId);
    if (!rolloutPath) {
      return { messages: [], cursor: 0, fileSize: 0, truncated: false };
    }

    const stat = await fs.stat(rolloutPath);
    const start = cursor > stat.size || cursor < 0 ? 0 : cursor;
    if (start === stat.size) {
      return { messages: [], cursor: start, fileSize: stat.size, truncated: false };
    }

    const bytesToRead = Math.min(stat.size - start, maxBytes);
    const file = await fs.open(rolloutPath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await file.read(buffer, 0, bytesToRead, start);
      const completeBytes = completeJsonlByteLength(buffer.subarray(0, bytesRead));
      if (completeBytes === 0) {
        return { messages: [], cursor: start, fileSize: stat.size, truncated: bytesRead === maxBytes };
      }

      const text = buffer.subarray(0, completeBytes).toString("utf8");
      const lines = text.split(/\r?\n/).filter(Boolean).flatMap((line) => parseJson<RolloutLine>(line));
      return {
        messages: dedupeMessages(lines.flatMap((line, index) => this.toMessage(line, index, `d-${start}`))),
        cursor: start + completeBytes,
        fileSize: stat.size,
        truncated: start + bytesRead < stat.size,
      };
    } finally {
      await file.close();
    }
  }

  async getActiveDesktopThread(): Promise<CodexThreadSummary | null> {
    const threads = await this.listThreads(80);
    return threads.find(isDesktopThread) ?? threads[0] ?? null;
  }

  private async readSessionIndex(): Promise<SessionIndexRow[]> {
    const file = path.join(this.codexHome, "session_index.jsonl");
    const lines = await this.readLines(file);
    return lines.flatMap((line) => parseJson<SessionIndexRow>(line));
  }

  private async findRolloutPath(threadId: string): Promise<string | null> {
    const cached = this.rolloutPathCache.get(threadId);
    if (cached && (await fileExists(cached))) return cached;

    const sessionsDir = path.join(this.codexHome, "sessions");
    const stack = [sessionsDir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith(".jsonl")) {
          this.rolloutPathCache.set(threadId, fullPath);
          return fullPath;
        }
      }
    }
    return null;
  }

  private async listRecentRolloutThreads(limit: number): Promise<CodexThreadSummary[]> {
    const sessionsDir = path.join(this.codexHome, "sessions");
    const files: Array<{ file: string; mtimeMs: number }> = [];
    const stack = [sessionsDir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const stat = await fs.stat(fullPath);
        files.push({ file: fullPath, mtimeMs: stat.mtimeMs });
      }
    }

    const recent = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
    return (
      await Promise.all(
        recent.map(async ({ file, mtimeMs }): Promise<CodexThreadSummary | null> => {
          const meta = await this.readSessionMeta(file);
          const id = meta?.id ?? extractThreadIdFromRolloutName(file);
          if (!id) return null;
          return {
            id,
            threadName: await this.extractThreadName(file),
            updatedAt: new Date(mtimeMs).toISOString(),
            cwd: meta?.cwd ?? null,
            source: meta?.source ?? null,
            originator: meta?.originator ?? null,
            rolloutPath: file,
          };
        }),
      )
    ).filter((thread): thread is CodexThreadSummary => Boolean(thread));
  }

  private async readSessionMeta(rolloutPath: string): Promise<Record<string, string> | null> {
    const lines = await this.readJsonl(rolloutPath, 20);
    const meta = lines.find((line) => line.type === "session_meta");
    const payload = meta?.payload;
    if (payload && typeof payload === "object") {
      return payload as Record<string, string>;
    }
    return null;
  }

  private async readThreadSummary(threadId: string, rolloutPath: string, mtimeMs: number): Promise<CodexThreadSummary> {
    const meta = await this.readSessionMeta(rolloutPath);
    return {
      id: meta?.id ?? threadId,
      threadName: await this.extractThreadName(rolloutPath),
      updatedAt: new Date(mtimeMs).toISOString(),
      cwd: meta?.cwd ?? null,
      source: meta?.source ?? null,
      originator: meta?.originator ?? null,
      rolloutPath,
    };
  }

  private async extractThreadName(rolloutPath: string): Promise<string> {
    const lines = await this.readJsonl(rolloutPath, 160);
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

  private async readJsonl(file: string, maxLines?: number): Promise<RolloutLine[]> {
    const lines = await this.readLines(file, maxLines);
    return lines.flatMap((line) => parseJson<RolloutLine>(line));
  }

  private async readJsonlTail(file: string, maxBytes: number): Promise<{ lines: RolloutLine[]; windowStart: number; truncated: boolean }> {
    const stat = await fs.stat(file);
    if (stat.size === 0) return { lines: [], windowStart: 0, truncated: false };

    const bytesToRead = Math.min(stat.size, Math.max(16_384, maxBytes));
    const start = Math.max(0, stat.size - bytesToRead);
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
      let text = buffer.subarray(0, bytesRead).toString("utf8");
      let windowStart = start;
      if (start > 0) {
        const firstNewline = text.indexOf("\n");
        if (firstNewline >= 0) {
          text = text.slice(firstNewline + 1);
          windowStart = start + firstNewline + 1;
        } else {
          text = "";
          windowStart = stat.size;
        }
      }
      const lines = text.split(/\r?\n/).filter(Boolean).flatMap((line) => parseJson<RolloutLine>(line));
      return { lines, windowStart, truncated: start > 0 };
    } finally {
      await handle.close();
    }
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
        return text ? [{ id: `${idPrefix}-${index}`, timestamp, role, text, kind: "message" }] : [];
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

function completeJsonlByteLength(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  if (buffer.at(-1) === 10) return buffer.length;
  const lastNewline = buffer.lastIndexOf(10);
  return lastNewline >= 0 ? lastNewline + 1 : 0;
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
    const key = `${message.timestamp}:${message.role}:${message.kind}:${message.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }
  return result;
}

function extractThreadIdFromRolloutName(file: string): string | null {
  const match = path.basename(file).match(/rollout-.+-(019[0-9a-f-]+)\.jsonl$/i);
  return match?.[1] ?? null;
}

function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !(
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("Knowledge cutoff:") ||
    trimmed.startsWith("You are ")
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
