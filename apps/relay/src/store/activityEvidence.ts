import { z } from "zod";
import type { ActivityEvidence } from "../../../../shared/activityEvidence.js";
export type { ActivityEvidence };

// Whitelist projection: upstream payloads must never enter status evidence.
export const activityEvidenceSchema = z.object({
  kind: z.enum(["thinking", "working", "outputting"]),
  turnId: z.string().min(1).max(512),
  observedAt: z.string().max(32).datetime(),
});
export function activityEvidence(kind: unknown, turnId: unknown, observedAt = new Date().toISOString()): ActivityEvidence | null {
  const parsed = activityEvidenceSchema.safeParse({ kind, turnId, observedAt });
  return parsed.success ? parsed.data : null;
}

export function itemActivity(type: unknown): ActivityEvidence["kind"] | null {
  switch (typeof type === "string" ? type.toLowerCase() : "") {
    case "reasoning": return "thinking";
    case "agentmessage": return "outputting";
    case "commandexecution": case "filechange": case "mcptoolcall": case "dynamictoolcall": case "websearch": return "working";
    default: return null;
  }
}
