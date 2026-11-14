import { z } from 'zod';
import { captureAssetSchema } from '../capture/store.js';

export const limits = { title: 200, detail: 64 * 1024, message: 96 * 1024, assets: 16, assetBytes: 25 * 1024 * 1024,
  codeRefs: 32, itemBytes: 256 * 1024, items: 1000, storeBytes: 32 * 1024 * 1024, receipts: 64 } as const;
export const bytes = (max: number) => z.string().refine(value => Buffer.byteLength(value) <= max, 'text_too_large');
export const uuid = z.string().uuid();
export const stateSchema = z.enum(['todo', 'in_progress', 'to_verify', 'done', 'returned']);
export const kindSchema = z.enum(['issue', 'idea', 'note', 'task']);
export const titleSchema = z.string().trim().min(1).refine(value => [...value].length <= limits.title, 'title_too_long');
const timestamp = z.string().datetime();
export const lastTurnSchema = z.object({ turnId: bytes(512).min(1), status: z.enum(['completed', 'failed', 'interrupted']),
  reason: z.object({ code: bytes(128).min(1), message: bytes(1024) }).strict(), endedAt: timestamp, timeSource: z.enum(['provider', 'observed']) }).strict();
const legacyAssetSchema = z.object({ id: uuid, relativePath: bytes(4096).min(1), fileName: bytes(512).min(1), mimeType: bytes(256).optional(),
  size: z.number().int().min(1).max(limits.assetBytes), managed: z.literal(false) }).strict();
export const assetSchema = z.union([legacyAssetSchema, captureAssetSchema]);
export const captureSchema = z.object({ id: uuid, mode: z.enum(['image', 'voice']), createdAt: z.string().datetime(),
  assetIds: z.array(uuid).max(32), rawTranscript: bytes(64 * 1024).nullable() }).strict().superRefine((value, ctx) => {
  if (new Set(value.assetIds).size !== value.assetIds.length || (value.mode === 'voice' ? !value.rawTranscript?.trim() : value.rawTranscript !== null || !value.assetIds.length))
    ctx.addIssue({ code: 'custom', message: 'capture_invalid' });
});
export const attemptSchema = z.object({ attemptId: uuid, channel: z.enum(['codex-desktop', 'codex-relay', 'agent']).nullable(),
  agentId: bytes(64).nullable(), sessionId: bytes(512).nullable(), cwd: bytes(4096).nullable(), clientMessageId: uuid.nullable(), turnId: bytes(512).nullable(),
  delivery: z.enum(['none', 'unknown', 'queued', 'delivered']), message: bytes(limits.message).nullable(), lastTurn: lastTurnSchema.nullable() }).strict();
export const fieldsSchema = z.object({ kind: kindSchema, title: titleSchema, detail: bytes(limits.detail),
  assets: z.array(assetSchema).max(limits.assets), codeRefs: z.array(bytes(4096)).max(limits.codeRefs) }).strict();
export const itemSchema = fieldsSchema.extend({ schemaVersion: z.literal(1), uid: uuid, revision: z.number().int().safe().positive(), state: stateSchema,
  createdAt: timestamp, updatedAt: timestamp, createdByDeviceId: bytes(128).min(1),
  source: z.object({ kind: z.enum(['manual', 'legacy-handoff', 'capture']), legacyId: uuid.optional(), importFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), captureSessionId: uuid.optional() }).strict(),
  capture: captureSchema.optional(), currentAttempt: attemptSchema, lastTransition: z.object({ from: stateSchema, to: stateSchema, actor: z.enum(['user', 'system', 'agent']), at: timestamp, reason: bytes(1024).nullable() }).strict().nullable(),
}).strict().refine(value => Buffer.byteLength(JSON.stringify(value)) <= limits.itemBytes, 'item_too_large').superRefine((value, ctx) => {
  const legacy = value.source.kind === 'legacy-handoff';
  if ((value.source.kind === 'capture') !== Boolean(value.capture) || (value.capture && value.capture.id !== value.source.captureSessionId)) ctx.addIssue({ code: 'custom', message: 'capture_identity_invalid' });
  if ((legacy && (!value.source.legacyId || !value.source.importFingerprint)) || (!legacy && (value.source.legacyId || value.source.importFingerprint))
    || (value.lastTransition && value.lastTransition.to !== value.state)
    || (value.state === 'done' && (value.lastTransition?.actor !== 'user' || value.lastTransition.from !== 'to_verify'))
    || (value.currentAttempt.lastTurn && value.currentAttempt.lastTurn.turnId !== value.currentAttempt.turnId)) {
    ctx.addIssue({ code: 'custom', message: 'item_identity_invalid' });
  }
});
export const mutationSchema = z.object({ mutationId: uuid, expectedRevision: z.number().int().safe().min(0) });
export function workItemError(code: string, statusCode = 409): Error & { statusCode: number } {
  return Object.assign(new Error(code), { statusCode });
}
