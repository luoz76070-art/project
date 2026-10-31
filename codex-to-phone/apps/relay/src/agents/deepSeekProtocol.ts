import path from "node:path";
import { z } from "zod";

export const deepSeekConfigSchema = z.object({
  url: z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
    } catch { return false; }
  }),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,512}$/u),
  directory: z.string().max(4096).refine(value => path.isAbsolute(value)).transform(value => path.resolve(value)),
  scope: z.enum(["directory", "all"]).optional(),
}).strict();
export type DeepSeekConfig = z.infer<typeof deepSeekConfigSchema>;
export const deepSeekSessionId = z.string().uuid();
const session = z.object({ id: deepSeekSessionId, title: z.string().max(256), directory: z.string().max(4096), updatedAt: z.string().datetime() });
export const deepSeekInfo = z.object({ protocol: z.literal(1), harnessVersion: z.enum(["0.2.1-rc.2", "0.2.1-rc.3", "0.2.1-rc.5"]), messagePhases: z.boolean().optional(), interactions: z.boolean().optional(), scope: z.literal("all").optional(), history: z.boolean().optional() });
export const deepSeekSessions = z.object({ sessions: z.array(session).max(128), cursor: z.string().uuid().nullable() });
export const deepSeekDelivery = z.object({ ok: z.literal(true), delivery: z.enum(["submitted", "confirmed", "uncertain"]) });
const messages = z.array(z.object({ id: z.string().max(512), timestamp: z.string().datetime(), role: z.enum(["user", "assistant"]), text: z.string().max(32768), kind: z.enum(["user_message", "agent_message"]), turnId: z.string().max(512).optional(), phase: z.enum(["commentary", "final_answer"]).optional() })).max(120);
export const deepSeekHistory = z.object({ messages, cursor: z.string().uuid().nullable() });
export const deepSeekSnapshot = z.object({
  agentId: z.literal("deepseek"), session, connected: z.literal(true), updatedAt: z.string().datetime(),
  status: z.enum(["idle", "running"]), activity: z.enum(["thinking", "working", "outputting"]),
  messages,
  questions: z.array(z.object({
    id: z.string().uuid(), status: z.enum(["pending", "submitted", "uncertain"]), unavailableReason: z.string().max(1024).nullish(),
    questions: z.array(z.object({ question: z.string().max(131072), header: z.string().max(256),
      options: z.array(z.object({ label: z.string().max(10000), description: z.string().max(10000) })).max(32), multiple: z.boolean(), custom: z.boolean() })).min(1).max(16),
  })).max(16), permissions: z.array(z.object({
    id: z.string().uuid(), status: z.enum(["pending", "submitted", "uncertain"]), action: z.string().max(512),
    resources: z.array(z.string().max(4096)).max(16), save: z.array(z.never()).max(0), detail: z.string().max(196608),
    unavailableReason: z.string().max(1024).nullable(), decisions: z.array(z.enum(["once", "reject"])).max(2),
  })).max(16), historyCursor: z.string().uuid().nullable(), partialText: z.boolean(),
  control: z.object({ token: z.string().uuid(), canSend: z.boolean(), canSteer: z.boolean(), canInterrupt: z.boolean() }),
  submission: z.object({ clientMessageId: z.string().uuid(), action: z.enum(["message", "interrupt"]), delivery: z.enum(["submitted", "confirmed", "uncertain"]) }).nullable(),
  operationError: z.object({ clientMessageId: z.string().uuid(), code: z.enum(["rejected", "expired"]) }).nullable(),
  queue: z.object({ available: z.boolean(), items: z.array(z.object({ clientMessageId: z.string().uuid(), text: z.string().max(20000), status: z.enum(["waiting", "paused", "uncertain"]) })).max(1) }).optional(),
});
