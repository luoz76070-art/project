export type HandoffAgent = 'codex' | 'claude' | 'deepseek' | 'opencode';
export type HandoffTarget = { agentId: HandoffAgent; sessionId: string; title: string; cwd: string };
export type HandoffStatus = 'sending' | 'submitted' | 'queued' | 'delivered' | 'unknown' | 'rejected';
export type HandoffAttachment = { id: string; fileName: string; path: string; sha256: string; orientation: number };
export type HandoffRequest = {
  storeId: string; expectedRevision: number; handoffId: string;
  target: Pick<HandoffTarget, 'agentId' | 'sessionId'>; retryOf?: string;
};
export type HandoffPreview = { text: string; attachments: HandoffAttachment[]; target: HandoffTarget; sendNumber: number; previewHash: string };
export type HandoffRecord = HandoffPreview & {
  handoffId: string; attemptId: string; retryOf: string | null; owner: string; requestHash: string;
  createdAt: string; updatedAt: string; status: HandoffStatus; reason: string | null;
};
export type HandoffSubmit = HandoffRequest & { previewHash: string; confirmed: true };
export type HandoffReceipt = { handoffId: string; accepted: true };
/** The user's own conclusion after checking the target session; only allowed while the result is unknown. */
export type HandoffResolution = { outcome: 'delivered' | 'not_received' };
