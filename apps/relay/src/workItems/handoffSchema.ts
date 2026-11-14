import { z } from 'zod';
export const handoffAgent = z.enum(['codex', 'claude', 'deepseek', 'opencode']);
export const handoffTargetKey = z.object({ agentId: handoffAgent, sessionId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).strict();
export const handoffTarget = handoffTargetKey.extend({ title: z.string().max(1000), cwd: z.string().min(1).max(4096) }).strict();
export const handoffRequest = z.object({ storeId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), handoffId: z.string().uuid(),
  target: handoffTargetKey, retryOf: z.string().uuid().optional() }).strict();
export const handoffResolve = z.object({ outcome: z.enum(['delivered', 'not_received']) }).strict();
export const handoffSubmit = handoffRequest.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict();
export const handoffRecord = z.object({ handoffId: z.string().uuid(), attemptId: z.string().uuid(), retryOf: z.string().uuid().nullable(),
  owner: z.string().max(128), requestHash: z.string().regex(/^[a-f0-9]{64}$/), previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  target: handoffTarget, sendNumber: z.number().int().min(1).max(32), text: z.string().min(1).max(20_000),
  attachments: z.array(z.object({ id: z.string().min(1).max(512), fileName: z.string().max(512), path: z.string().max(8192),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), orientation: z.number().int().min(1).max(8) }).strict()).max(16),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), status: z.enum(['sending', 'submitted', 'queued', 'delivered', 'unknown', 'rejected']),
  reason: z.string().max(128).nullable() }).strict();
