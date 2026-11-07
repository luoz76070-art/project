import path from "node:path";
import { z } from "zod";
import { agentError, type AgentMessage, type AgentSession } from "./sessions.js";

// OpenCode v2.0.16 protocol OpenAPI, /api/. One decoder owns the upstream shapes.
export const openCodeVersion = "2.0.16";
export const serverInfoSchema = z.object({ version: z.string().max(128) });
export const sessionIdSchema = z.string().regex(/^ses[a-zA-Z0-9_-]{1,128}$/u);
const messageId = z.string().regex(/^msg_[a-zA-Z0-9_-]{1,128}$/u);
const time = z.number().finite().min(0).max(8.64e15);
export const sessionSchema = z.object({
  id: sessionIdSchema, title: z.string().max(2000).default("未命名会话"), time: z.object({ updated: time }),
  location: z.object({ directory: z.string().max(4096), workspaceID: z.string().optional() }),
});
// Official 2.0.16 emits explicit nulls at the ends of session and message pages.
const cursorSchema = z.object({ previous: z.string().max(8192).nullish(), next: z.string().max(8192).nullish() });
export const sessionsSchema = z.object({ data: z.array(sessionSchema).max(100), cursor: cursorSchema });
export const oneSessionSchema = z.object({ data: sessionSchema });
export const activeSchema = z.object({ data: z.record(z.string(), z.object({ type: z.literal("running") })) });
export const formSchema = z.object({
  id: z.string().regex(/^frm_[a-zA-Z0-9_-]{1,128}$/u), sessionID: sessionIdSchema,
  title: z.string().max(2000), metadata: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.object({
    key: z.string().min(1).max(256), type: z.string().max(256),
    title: z.string().max(2000).optional(), description: z.string().max(20_000).optional(),
    options: z.array(z.object({ value: z.string().min(1).max(1000), label: z.string().min(1).max(1000), description: z.string().max(10_000).optional() }).passthrough()).max(100).optional(),
    custom: z.boolean().optional(), required: z.boolean().optional(),
  }).passthrough()).min(1).max(20),
}).passthrough();
export const formsSchema = z.object({ data: z.array(formSchema).max(100) });
export const permissionsSchema = z.object({ data: z.array(z.object({
  id: z.string().regex(/^per[a-zA-Z0-9_-]{1,128}$/u), sessionID: sessionIdSchema,
  action: z.string().min(1).max(256), resources: z.array(z.string().max(8192)).max(200),
  save: z.array(z.string().max(8192)).max(200).default([]), metadata: z.record(z.string(), z.unknown()).default({}),
}).passthrough()).max(100) });
const content = z.object({
  type: z.string().max(256), text: z.string().max(1_000_000).optional(),
  id: z.string().max(512).optional(), name: z.string().max(256).optional(),
  state: z.object({ status: z.string(), input: z.union([z.string().max(1_000_000), z.record(z.string(), z.unknown())]).optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().max(1_000_000).optional() })).max(1000).optional(),
  }).optional(),
});
export const messagesSchema = z.object({ data: z.array(z.object({
  id: messageId, type: z.string().max(256), time: z.object({ created: time, completed: time.optional() }),
  text: z.string().max(1_000_000).optional(), content: z.array(content).max(1000).optional(), error: z.unknown().optional(),
  outcome: z.enum(["succeeded", "failed", "interrupted"]).optional(),
})).max(100), cursor: cursorSchema });
export const admittedSchema = z.object({ data: z.object({
  id: messageId, sessionID: sessionIdSchema, type: z.literal("user"), payload: z.object({ text: z.string().max(20_000) }), delivery: z.enum(["steer", "queue"]),
}) });
export const interruptSchema = z.object({ interrupted: z.boolean() });

export function sessionView(session: z.infer<typeof sessionSchema>, directory: string): AgentSession {
  // Directory is the configured control scope. Workspace sessions need their own explicit adapter.
  if (path.normalize(session.location.directory) !== path.normalize(directory) || session.location.workspaceID) throw agentError("OPENCODE_SESSION_OUT_OF_SCOPE", 403);
  return { id: session.id, title: session.title, directory: session.location.directory, updatedAt: new Date(session.time.updated).toISOString() };
}

export function messagesView(data: z.infer<typeof messagesSchema>["data"]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let finalCandidate: AgentMessage | undefined;
  const bounded = (text: string) => text.length > 32768 ? `${text.slice(0, 32740)}\n[内容已截断]` : text;
  for (const message of [...data].sort((a, b) => a.time.created - b.time.created)) {
    if (message.type === "idle") {
      // The official idle marker owns the turn outcome; step completion alone does not.
      if (message.outcome === "succeeded" && finalCandidate) finalCandidate.phase = "final_answer";
      finalCandidate = undefined; continue;
    }
    const timestamp = new Date(message.time.created).toISOString();
    if (message.type === "user" && message.text) messages.push({ id: message.id, timestamp, role: "user", kind: "user_message", text: message.text });
    if (message.type !== "assistant") continue;
    finalCandidate = undefined;
    const parts = message.content ?? [];
    let ordinal = 0;
    for (const part of parts) {
      const id = part.type === "text" ? (ordinal++ === 0 ? message.id : `${message.id}:text-${ordinal - 1}`) : `${message.id}:tool-${part.id}`;
      if (part.type === "text" && part.text) {
        const visible: AgentMessage = { id, timestamp, role: "assistant", kind: "agent_message", text: part.text, phase: "commentary" };
        messages.push(visible); finalCandidate = visible;
      } else if (part.type === "tool" && part.id && part.name && part.state) {
        const args = part.state.status === "streaming" ? "[正在接收工具参数]" : JSON.stringify(part.state.input ?? {});
        messages.push({ id: `${id}:call`, timestamp, role: "tool", kind: "function_call", text: bounded(`Tool: ${part.name}\n${args}`) });
        if (["completed", "error"].includes(part.state.status)) {
          const output = (part.state.content ?? []).filter(block => block.type === "text").map(block => block.text ?? "").join("\n");
          messages.push({ id: `${id}:output`, timestamp, role: "tool", kind: "function_call_output", text: bounded(`${part.state.status === "error" ? "Status: failed\n" : ""}${output || (part.state.status === "error" ? "工具执行失败，请在电脑查看详情。" : "工具执行完成，无文本输出。")}`) });
        }
      }
    }
    if (parts.some(part => part.type === "tool")) finalCandidate = undefined;
  }
  return messages;
}
