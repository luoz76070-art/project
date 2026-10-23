import path from "node:path";
import { z } from "zod";

export const claudeConfigSchema = z.object({ bridgeToken: z.string().min(32).max(512) }).strict();
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>;
export const claudeSessionId = z.string().uuid();
export const claudeRegisterSchema = z.object({
  sessionId: claudeSessionId, activationId: z.string().uuid(), version: z.string().regex(/^2\.1\.\d+$/u).refine(v => Number(v.split(".")[2]) >= 287),
  directory: z.string().max(4096).refine(v => path.isAbsolute(v) && !v.includes("\0")),
  turnId: z.string().min(1).max(256).nullable(),
  interactions: z.literal(1).optional(),
}).strict();
const messageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(64_000) }).strict();
export const claudeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), turnId: z.string().min(1).max(256).nullable(), activity: z.enum(["thinking", "working", "outputting"]), aborted: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("text"), turnId: z.string().min(1).max(256), id: z.string().min(1).max(512), text: z.string().max(32_000) }).strict(),
  z.object({ type: z.literal("messages"), messages: z.array(messageSchema).max(80), partial: z.boolean() }).strict(),
  z.object({ type: z.literal("partial") }).strict(),
  z.object({ type: z.literal("receipt"), id: z.string().uuid(), delivery: z.enum(["confirmed", "uncertain", "rejected"]) }).strict(),
  z.object({ type: z.literal("ended") }).strict(),
]);
export type ClaudeEvent = z.infer<typeof claudeEventSchema>;
export const claudeBatchSchema = z.object({ generation: z.string().uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), events: z.array(claudeEventSchema).min(1).max(128) }).strict();
export type ClaudeCommand = { id: string; type: "snapshot" } | { id: string; type: "message"; text: string } | { id: string; type: "interrupt"; turnId: string };

const question = z.object({
  question: z.string().min(1).max(4000), header: z.string().max(48),
  options: z.array(z.object({ label: z.string().min(1).max(1000), description: z.string().max(24_000) }).strict()).min(2).max(4).refine(options => new Set(options.map(o => o.label)).size === options.length),
  multiple: z.boolean(), custom: z.literal(true),
}).strict();
export const claudeInteractionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), questions: z.array(question).min(1).max(4).refine(questions => new Set(questions.map(q => q.question)).size === questions.length) }).strict(),
  z.object({ kind: z.literal("permission"), action: z.string().min(1).max(256), directory: z.string().max(4096).refine(v => path.isAbsolute(v) && !v.includes("\0")), detail: z.string().min(1).max(32_000) }).strict(),
]);
export const claudeInteractionWaitSchema = z.object({
  generation: z.string().uuid(), id: z.string().uuid(), serial: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), turnId: z.string().min(1).max(256), request: claudeInteractionSchema,
}).strict();
export type ClaudeInteractionInput = z.infer<typeof claudeInteractionWaitSchema>;
export type ClaudeInteractionAnswer = { answers: string[][] } | { decision: "once" | "reject" };
export type ClaudeInteractionReply = { status: "pending" | "closed" } | { status: "answered"; answer: ClaudeInteractionAnswer };
