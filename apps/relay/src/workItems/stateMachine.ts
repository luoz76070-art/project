import { randomUUID } from 'node:crypto';
import type { LastTurn } from '../../../../shared/lastTurn.js';
import type { WorkItem, WorkItemAttempt, WorkItemState } from '../../../../shared/workItem.js';
import { attemptSchema, lastTurnSchema, workItemError } from './schema.js';

export type UserAction = 'start' | 'review' | 'return' | 'reopen';
export type InternalBinding = Pick<WorkItemAttempt, 'attemptId' | 'channel' | 'agentId' | 'sessionId' | 'turnId'>;
export function newAttempt(): WorkItemAttempt {
  return { attemptId: randomUUID(), channel: null, agentId: null, sessionId: null, cwd: null, clientMessageId: null,
    turnId: null, delivery: 'none', message: null, lastTurn: null };
}
function move(item: WorkItem, to: WorkItemState, actor: 'user' | 'system' | 'agent', at: string, reason: string | null): WorkItem {
  return { ...item, state: to, lastTransition: { from: item.state, to, actor, at, reason } };
}
export function userAction(item: WorkItem, action: UserAction, at: string, reason: string | null = null): WorkItem {
  const allowed = action === 'start' ? item.state === 'todo' : action === 'review' ? item.state === 'in_progress'
    : action === 'return' ? ['todo', 'in_progress', 'to_verify'].includes(item.state)
    : action === 'reopen' ? ['returned', 'done'].includes(item.state) : false;
  if (!allowed) throw workItemError('work_item_transition_invalid');
  if (action === 'start' && item.currentAttempt.delivery === 'unknown') throw workItemError('work_item_delivery_unknown');
  const to = { start: 'in_progress', review: 'to_verify', return: 'returned', reopen: 'todo' } as const;
  const next = move(item, to[action], 'user', at, reason);
  return action === 'reopen' ? { ...next, currentAttempt: newAttempt() } : next;
}
/** Only the user verification route calls this function. Internal events cannot express acceptance. */
export function verifyItem(item: WorkItem, decision: 'accept' | 'return', at: string, reason: string | null = null): WorkItem {
  if (item.state !== 'to_verify' || !['accept', 'return'].includes(decision)) throw workItemError('work_item_transition_invalid');
  return move(item, decision === 'accept' ? 'done' : 'returned', 'user', at, reason);
}
/** W4: attach the native turn that consumed the delivered message. Binds once; never rebinds or moves state. */
export function bindTurn(item: WorkItem, attemptId: string, clientMessageId: string, turnId: string): WorkItem {
  const current = item.currentAttempt;
  if (item.state !== 'in_progress' || current.attemptId !== attemptId || current.clientMessageId !== clientMessageId || current.turnId
    || !turnId || turnId.length > 512) return item;
  return { ...item, currentAttempt: { ...current, turnId } };
}
/** Called by W4 progress tracking when a W3 handoff is delivered. */
export function recordDelivery(item: WorkItem, binding: WorkItemAttempt, at: string, actor: 'system' | 'agent'): WorkItem {
  if (!['system', 'agent'].includes(actor)) throw workItemError('work_item_actor_invalid');
  const attempt = attemptSchema.parse(binding);
  if (item.state !== 'todo' || item.currentAttempt.attemptId !== attempt.attemptId || !attempt.channel || !attempt.sessionId || !attempt.clientMessageId
    || (attempt.channel === 'agent' && !attempt.agentId) || attempt.delivery !== 'delivered' || attempt.lastTurn !== null) throw workItemError('work_item_binding_invalid');
  return { ...move(item, 'in_progress', actor, at, null), currentAttempt: attempt };
}
/** W4 progress tracking. Unknown, stale and repeated evidence cannot undo a user's decision. */
export function applyTurnResult(item: WorkItem, binding: InternalBinding, result: LastTurn | null | undefined, at: string, actor: 'system' | 'agent'): WorkItem {
  if (!['system', 'agent'].includes(actor)) throw workItemError('work_item_actor_invalid');
  const parsed = lastTurnSchema.safeParse(result), current = item.currentAttempt;
  if (!parsed.success || item.state !== 'in_progress' || !current.turnId || !current.channel || !current.sessionId
    || Object.keys(binding).length !== 5 || (['attemptId', 'channel', 'agentId', 'sessionId', 'turnId'] as const).some(key => binding[key] !== current[key])
    || parsed.data.turnId !== current.turnId || current.lastTurn?.turnId === parsed.data.turnId) return item;
  const next = move(item, parsed.data.status === 'completed' ? 'to_verify' : 'returned', actor, at, parsed.data.reason.message);
  return { ...next, currentAttempt: { ...current, lastTurn: parsed.data } };
}
