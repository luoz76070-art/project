import { AppServerClient } from "./appServerClient.js";
import type { CodexMessage, CodexThreadSummary } from "./codexStore.js";

type AppThread = {
  id: string;
  name: string | null;
  preview: string;
  updatedAt: number;
  cwd: string | null;
  source: string | null;
  path: string | null;
  turns?: AppTurn[];
};

type AppTurn = {
  id: string;
  items: AppThreadItem[];
  startedAt: number | null;
  completedAt: number | null;
};

type AppThreadItem = {
  type: string;
  id: string;
  text?: string;
  command?: string;
  output?: string;
  content?: unknown;
};

export class LiveCodex {
  constructor(private readonly defaultCwd = process.cwd()) {}

  async status(): Promise<{ ok: boolean; mode: string; threadCount?: number; error?: string }> {
    const client = new AppServerClient();
    try {
      await client.start();
      const response = await client.request<{ data: AppThread[] }>("thread/list", {
        limit: 1,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
      });
      return { ok: true, mode: "app-server-ws", threadCount: response.data.length };
    } catch (error) {
      return { ok: false, mode: "app-server-ws", error: error instanceof Error ? error.message : String(error) };
    } finally {
      await client.stop();
    }
  }

  async listThreads(limit = 50): Promise<CodexThreadSummary[]> {
    const client = new AppServerClient();
    try {
      await client.start();
      const response = await client.request<{ data: AppThread[] }>("thread/list", {
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        sourceKinds: ["vscode", "appServer", "cli", "exec", "unknown"],
      });
      return response.data.map((thread) => ({
        id: thread.id,
        threadName: thread.name ?? thread.preview ?? "Untitled",
        updatedAt: fromUnixSeconds(thread.updatedAt),
        cwd: thread.cwd,
        source: thread.source,
        originator: thread.source === "vscode" ? "Codex Desktop" : "Codex app-server",
        rolloutPath: thread.path,
      }));
    } finally {
      await client.stop();
    }
  }

  async readThread(threadId: string): Promise<{ thread: CodexThreadSummary | null; messages: CodexMessage[] }> {
    const client = new AppServerClient();
    try {
      await client.start();
      const response = await client.request<{ thread: AppThread }>("thread/read", {
        threadId,
        includeTurns: true,
      });
      return {
        thread: toSummary(response.thread),
        messages: threadToMessages(response.thread),
      };
    } finally {
      await client.stop();
    }
  }

  async sendMessage(params: {
    threadId?: string;
    message: string;
    cwd?: string | null;
  }): Promise<{ threadId: string; assistantText: string; messages: CodexMessage[]; thread: CodexThreadSummary | null }> {
    const client = new AppServerClient({ requestTimeoutMs: 120_000 });
    try {
      await client.start();

      let threadId = params.threadId;
      let createdThread: CodexThreadSummary | null = null;
      if (threadId) {
        await client.request("thread/resume", {
          threadId,
          excludeTurns: true,
          persistExtendedHistory: true,
        });
      } else {
        const started = await client.request<{ thread: AppThread }>("thread/start", {
          cwd: params.cwd ?? this.defaultCwd,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          sessionStartSource: "startup",
          experimentalRawEvents: false,
          persistExtendedHistory: true,
        });
        threadId = started.thread.id;
        createdThread = toSummary(started.thread);
        const name = `手机: ${firstLine(params.message) || "新线程"}`;
        await client.request("thread/name/set", { threadId, name }).catch(() => undefined);
      }

      let assistantText = "";
      let completed = false;
      let waitingOnApproval: unknown = null;

      client.on("notification", (event: { method: string; params?: any; id?: string | number }) => {
        if (event.method === "item/agentMessage/delta" && typeof event.params?.delta === "string") {
          assistantText += event.params.delta;
        }
        if (event.method === "turn/completed") {
          completed = true;
          const items = event.params?.turn?.items;
          if (Array.isArray(items)) {
            const message = items.find((item) => item?.type === "agentMessage" && typeof item.text === "string");
            if (message?.text) assistantText = message.text;
          }
        }
        if (event.id !== undefined) {
          waitingOnApproval = event;
        }
      });

      await client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: params.message, text_elements: [] }],
        approvalPolicy: "on-request",
      });

      const deadline = Date.now() + 120_000;
      while (!completed && !waitingOnApproval && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      if (waitingOnApproval) {
        throw new Error("Codex requested approval; mobile approval routing is not enabled yet. Approve or continue from Desktop.");
      }
      if (!completed) {
        throw new Error("Timed out waiting for Codex turn to complete");
      }

      const read = await this.readThread(threadId);
      return { threadId, assistantText, messages: read.messages, thread: read.thread ?? createdThread };
    } finally {
      await client.stop();
    }
  }
}

function toSummary(thread: AppThread): CodexThreadSummary {
  return {
    id: thread.id,
    threadName: thread.name ?? thread.preview ?? "Untitled",
    updatedAt: fromUnixSeconds(thread.updatedAt),
    cwd: thread.cwd,
    source: thread.source,
    originator: thread.source === "vscode" ? "Codex Desktop" : "Codex app-server",
    rolloutPath: thread.path,
  };
}

function threadToMessages(thread: AppThread): CodexMessage[] {
  const messages: CodexMessage[] = [];
  for (const [turnIndex, turn] of (thread.turns ?? []).entries()) {
    const timestamp = fromUnixSeconds(turn.startedAt ?? turn.completedAt ?? thread.updatedAt);
    for (const [itemIndex, item] of turn.items.entries()) {
      const id = `${turn.id}-${item.id ?? itemIndex}`;
      if (item.type === "userMessage") {
        const text = extractUserText(item.content);
        if (text) messages.push({ id, timestamp, role: "user", text, kind: item.type });
        continue;
      }
      if (item.type === "agentMessage" && typeof item.text === "string" && item.text) {
        messages.push({ id, timestamp, role: "assistant", text: item.text, kind: item.type });
        continue;
      }
      if (item.type === "commandExecution") {
        const text = [item.command, item.output].filter(Boolean).join("\n\n");
        if (text) messages.push({ id, timestamp, role: "tool", text, kind: item.type });
        continue;
      }
      const text = typeof item.text === "string" ? item.text : "";
      if (text) messages.push({ id: `${turnIndex}-${id}`, timestamp, role: "tool", text, kind: item.type });
    }
  }
  return messages;
}

function extractUserText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function fromUnixSeconds(value: number): string {
  const millis = value > 10_000_000_000 ? value : value * 1000;
  return new Date(millis).toISOString();
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean)?.trim().slice(0, 72) ?? "";
}
