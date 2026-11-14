import type { CaptureAsset, CaptureSession } from './capture.js';
import type { LastTurn } from './lastTurn.js';

export type WorkItemState = 'todo' | 'in_progress' | 'to_verify' | 'done' | 'returned';
export type WorkItemKind = 'issue' | 'idea' | 'note' | 'task';
export type WorkItemChannel = 'codex-desktop' | 'codex-relay' | 'agent';
export type WorkItemAsset = CaptureAsset | {
  id: string; relativePath: string; fileName: string; mimeType?: string; size: number;
  /** Existing uploads are references, never owned/deleted by an item. */
  managed: false;
};
export type WorkItemAttempt = {
  attemptId: string; channel: WorkItemChannel | null; agentId: string | null;
  sessionId: string | null; cwd: string | null; clientMessageId: string | null; turnId: string | null;
  delivery: 'none' | 'unknown' | 'queued' | 'delivered'; message: string | null; lastTurn: LastTurn | null;
};
export type WorkItem = {
  schemaVersion: 1; uid: string; revision: number; kind: WorkItemKind; title: string; detail: string;
  state: WorkItemState; createdAt: string; updatedAt: string; createdByDeviceId: string;
  source: { kind: 'manual' | 'legacy-handoff' | 'capture'; legacyId?: string; importFingerprint?: string; captureSessionId?: string };
  capture?: CaptureSession;
  assets: WorkItemAsset[]; codeRefs: string[]; currentAttempt: WorkItemAttempt;
  lastTransition: { from: WorkItemState; to: WorkItemState; actor: 'user' | 'system' | 'agent'; at: string; reason: string | null } | null;
};
export type WorkItemSummary = Pick<WorkItem, 'uid' | 'revision' | 'kind' | 'title' | 'state' | 'createdAt' | 'updatedAt'>;
export type WorkItemResponse = { item: WorkItem; storeId: string; storeRevision: number };
export type WorkItemChange = { uid: string; revision: number; storeRevision: number; deleted?: true };
