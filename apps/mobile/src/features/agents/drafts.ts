import type { PendingAttachment } from "../../app/types";
import { attachmentFromModernLine, composeMessageWithAttachments } from "../chat/attachments";

/** Keep the existing bounded string cache and pending identity, including file references. */
export function agentDraftParts(draft: string) {
  const block = /\n\n已上传附件：\n((?:- .+(?:\n|$))+)$/u.exec(draft);
  if (!block) return { text: draft, attachments: [] as PendingAttachment[] };
  const lines = block[1].split(/\r?\n/u).filter(Boolean);
  if (lines.some(line => !/^- .+ \| \/.+/u.test(line))) return { text: draft, attachments: [] as PendingAttachment[] };
  const attachments = block[1].split(/\r?\n/u).map(attachmentFromModernLine).filter((item): item is PendingAttachment => item !== null);
  return { text: draft.slice(0, block.index), attachments };
}

export function composeAgentDraft(text: string, attachments: PendingAttachment[]) {
  return attachments.length ? `${text}\n\n${composeMessageWithAttachments("", attachments)}` : text;
}
