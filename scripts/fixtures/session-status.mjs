import { turnResults } from './last-turn.mjs';
export const channels = ['codex-desktop', 'codex-relay', 'claude', 'deepseek', 'opencode'];
export const evidence = (kind, turnId = 'current') => ({ kind, turnId, observedAt: '2026-11-13T12:00:00.000Z' });
export const statusInputs = {
  preparing: { phase: 'starting' },
  thinking: { phase: 'running', activityEvidence: evidence('thinking') },
  executing: { phase: 'running', activityEvidence: evidence('working') },
  waiting: { phase: 'running', questions: [{ status: 'pending' }] },
  ...Object.fromEntries(turnResults.map(result => [result.status, { phase: 'idle', lastTurn: result }])),
};
export const input = patch => ({ phase: 'idle', online: true, turnId: 'current', questions: [], approvals: [], ...patch });
