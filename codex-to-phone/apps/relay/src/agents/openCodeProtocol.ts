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
  state: z.object({ status: z.string() }).passthrough().optional(),
});
export const messagesSchema = z.object({ data: z.array(z.object({
  id: messageId, type: z.string().max(256), time: z.object({ created: time, completed: time.optional() }),
  text: z.string().max(1_000_000).optional(), content: z.array(content).max(1000).optional(), error: z.unknown().optional(),
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
  return data.filter(message => message.type === "user" || message.type === "assistant").map(message => ({
    id: message.id, timestamp: new Date(message.time.created).toISOString(), role: message.type,
    text: message.type === "user" ? message.text ?? "" : (message.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n\n"),
    kind: message.type === "user" ? "user_message" : "agent_message",
  })).filter(message => message.text.length > 0).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}
