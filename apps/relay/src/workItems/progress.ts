import type { HandoffRecord } from '../../../../shared/handoff.js';
import type { WorkItem } from '../../../../shared/workItem.js';
import type { HandoffConnection, OpenHandoffTarget } from '../server/handoffChannels.js';
import { applyTurnResult, bindTurn, recordDelivery } from './stateMachine.js';
import type { WorkItemStore } from './store.js';

export const progressLimits = { watches: 8, maxAgeMs: 24 * 60 * 60 * 1000, openMs: 30_000, retryMs: 60_000 };
type Watch = { handoffId: string; controller: AbortController; connection?: HandoffConnection; queue: Promise<void>; timer?: ReturnType<typeof setTimeout> };

/** The card's last handoff when it still needs automatic progress; null otherwise. */
export function progressCandidate(item: WorkItem, now = Date.now()): HandoffRecord | null {
  const record = item.handoffs?.at(-1), attempt = item.currentAttempt;
  if (!record || now - Date.parse(record.createdAt) > progressLimits.maxAgeMs) return null;
  if (item.state === 'todo') return attempt.attemptId === record.attemptId && attempt.delivery === 'none'
    && ['submitted', 'queued', 'delivered'].includes(record.status) ? record : null;
  // Only Codex Desktop can bind the consuming turn exactly; agent cards wait for the user after delivery (W4b).
  if (item.state === 'in_progress') return attempt.channel === 'codex-desktop' && attempt.clientMessageId === record.handoffId && !attempt.lastTurn ? record : null;
  return null;
}

/**
 * W4: writes delivery and turn results of W3 handoffs back to work items as the system actor.
 * delivered -> in_progress; the bound turn completed -> to_verify; failed/interrupted -> returned.
 * Only the W1 state machine moves state, so nothing here can reach done or override a user's decision.
 * It never sends anything; missing or ambiguous evidence just leaves the card for the user.
 */
export class WorkItemProgress {
  private watches = new Map<string, Watch>();
  private store?: WorkItemStore;
  private unsubscribe?: () => void;
  private stopped = false;
  constructor(private open: OpenHandoffTarget, private now = () => Date.now()) {}
  attach(store: WorkItemStore) {
    if (this.store || this.stopped) return;
    this.store = store;
    this.unsubscribe = store.subscribe(event => event.deleted ? this.close(event.uid) : this.consider(event.uid));
    this.sweep();
  }
  stop() { this.stopped = true; this.unsubscribe?.(); for (const uid of [...this.watches.keys()]) this.close(uid, false); }
  watching() { return [...this.watches.keys()]; }
  private sweep() {
    if (!this.store || this.stopped) return;
    let uids: string[]; try { uids = this.store.uids(); } catch { return; /* A corrupt store answers 503 per request. */ }
    for (const uid of uids) this.consider(uid);
  }
  private item(uid: string) { try { return this.store!.get(uid).item; } catch { return null; } }
  private consider(uid: string) {
    if (!this.store || this.stopped) return;
    const item = this.item(uid), record = item && progressCandidate(item, this.now()), watch = this.watches.get(uid);
    if (!record) { if (watch) this.close(uid); return; }
    if (watch?.handoffId === record.handoffId) { this.evaluate(uid); return; }
    if (watch) this.close(uid, false);
    if (this.watches.size < progressLimits.watches) this.watch(uid, record);
  }
  private watch(uid: string, record: HandoffRecord) {
    const controller = new AbortController(), entry: Watch = { handoffId: record.handoffId, controller, queue: Promise.resolve() };
    this.watches.set(uid, entry);
    entry.timer = setTimeout(() => controller.abort(), progressLimits.openMs);
    this.open(record.target, controller.signal, () => this.evaluate(uid)).then(connection => {
      clearTimeout(entry.timer);
      if (controller.signal.aborted || this.watches.get(uid) !== entry) { connection.close(); return; }
      entry.connection = connection; this.evaluate(uid);
    }, () => {
      clearTimeout(entry.timer);
      if (this.stopped || this.watches.get(uid) !== entry) return;
      // Desktop closed or agent offline: look again later instead of guessing.
      entry.timer = setTimeout(() => { if (this.watches.get(uid) === entry) { this.watches.delete(uid); this.consider(uid); } }, progressLimits.retryMs);
      entry.timer.unref?.();
    });
  }
  private close(uid: string, refill = true) {
    const watch = this.watches.get(uid); if (!watch) return;
    this.watches.delete(uid); clearTimeout(watch.timer); watch.controller.abort(); watch.connection?.close();
    if (refill) queueMicrotask(() => this.sweep());
  }
  private evaluate(uid: string) {
    const watch = this.watches.get(uid); if (!watch?.connection) return;
    watch.queue = watch.queue.then(() => this.step(uid, watch)).catch(() => { /* The next snapshot or sweep retries. */ });
  }
  private async step(uid: string, watch: Watch) {
    const store = this.store, connection = watch.connection;
    if (!store || !connection || this.stopped || this.watches.get(uid) !== watch) return;
    const item = this.item(uid), record = item && progressCandidate(item, this.now());
    if (!item || !record || record.handoffId !== watch.handoffId) { this.close(uid); return; }
    const id = record.handoffId, at = new Date(this.now()).toISOString(), none = () => {};
    if (item.state === 'todo') {
      const seen = record.status === 'delivered' ? 'delivered' : connection.evidence(id);
      if (!seen || (seen === record.status && seen !== 'delivered')) return;
      if (seen !== 'delivered') { await store.settleHandoff(uid, id, seen, seen === 'unknown' ? 'delivery_unknown' : null, none); return; }
      if (record.status !== 'delivered') await store.settleHandoff(uid, id, 'delivered', null, none);
      const { target } = record, codex = target.agentId === 'codex';
      await store.progress(uid, current => current.state !== 'todo' || current.currentAttempt.attemptId !== record.attemptId || current.currentAttempt.delivery !== 'none' ? current
        : recordDelivery(current, { attemptId: record.attemptId, channel: codex ? 'codex-desktop' : 'agent', agentId: codex ? null : target.agentId,
          sessionId: target.sessionId, cwd: target.cwd, clientMessageId: id, turnId: connection.turnFor(id), delivery: 'delivered', message: null, lastTurn: null }, at, 'system'));
      return;
    }
    const attempt = item.currentAttempt;
    if (!attempt.turnId) {
      const turnId = connection.turnFor(id);
      if (turnId) await store.progress(uid, current => bindTurn(current, attempt.attemptId, id, turnId));
      return;
    }
    const result = connection.lastTurn();
    if (!result || result.turnId !== attempt.turnId) return;
    await store.progress(uid, current => applyTurnResult(current, { attemptId: attempt.attemptId, channel: attempt.channel, agentId: attempt.agentId,
      sessionId: attempt.sessionId, turnId: attempt.turnId }, result, at, 'system'));
  }
}
