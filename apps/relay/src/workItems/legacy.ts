import { z } from 'zod';
import { bytes, limits, uuid, workItemError } from './schema.js';

const target = z.object({ scope: bytes(4096).min(1), threadId: uuid, title: bytes(4096), cwd: bytes(4096).nullable().optional() }).strict();
export const legacyHandoffSchema = z.object({ revision: z.literal(1), id: uuid, status: z.enum(['draft', 'uncertain', 'confirmed']),
  text: bytes(limits.detail), createdAt: z.number().int().nonnegative().max(8640000000000000), clientMessageId: uuid.optional(),
  message: bytes(limits.message).optional(), acceptance: z.enum(['desktop', 'queue']).optional(), target: target.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status !== 'draft' && (!value.target || !value.message || value.clientMessageId !== value.id
    || (value.status === 'confirmed' && !value.acceptance))) ctx.addIssue({ code: 'custom', message: 'legacy_submission_invalid' });
});
export const legacyDraftSchema = z.object({ id: uuid, text: bytes(limits.detail), scope: bytes(4096).min(1), targetId: bytes(512),
  attachments: z.array(z.object({ id: bytes(512), path: bytes(4096).min(1), fileName: bytes(512).min(1), size: z.number().int().positive().max(limits.assetBytes),
    relativePath: bytes(4096).optional(), mimeType: bytes(256).optional(), createdAt: bytes(128).optional(),
  }).strict()).max(limits.assets),
}).strict();
export const importSchema = z.object({ storeId: uuid, scope: bytes(4096).min(1), handoff: legacyHandoffSchema.nullable(), draft: legacyDraftSchema.nullable() }).strict();
export type LegacyImport = z.infer<typeof importSchema>;
export function legacyEntries(input: LegacyImport) {
  if (!input.handoff && !input.draft) throw workItemError('work_item_import_empty', 400);
  if ((input.handoff?.target && input.handoff.target.scope !== input.scope) || (input.draft && input.draft.scope !== input.scope)) throw workItemError('work_item_import_scope');
  const entries: { legacyId: string; handoff: LegacyImport['handoff']; draft: LegacyImport['draft'] }[] = [];
  if (input.handoff) entries.push({ legacyId: input.handoff.id, handoff: input.handoff, draft: input.draft?.id === input.handoff.id ? input.draft : null });
  if (input.draft && input.draft.id !== input.handoff?.id) entries.push({ legacyId: input.draft.id, handoff: null, draft: input.draft });
  return entries;
}
