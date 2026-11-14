import type { HandoffPreview, HandoffRequest, HandoffSubmit, HandoffReceipt, HandoffRecord } from '../../../../shared/handoff.js';
import type { CaptureAssetStore } from '../capture/store.js';
import type { OpenHandoffTarget, HandoffConnection } from '../server/handoffChannels.js';
import { handoffMessage, handoffHash } from './handoffMessage.js';
import { workItemError } from './schema.js';
import type { WorkItemStore } from './store.js';
type Guard = () => void;
export class HandoffService {
  private operations = new Map<AbortController, string>();
  private stopped = false;
  private submissions = new Map<string, { hash: string; result: Promise<HandoffReceipt> }>();
  constructor(private root: string, private captures: CaptureAssetStore, private store: () => Promise<WorkItemStore>, private open: OpenHandoffTarget) {}
  revoke(owner: string) { for (const [controller, id] of this.operations) if (id === owner) controller.abort(); }
  stop() { this.stopped = true; for (const controller of this.operations.keys()) controller.abort(); }
  private async connection<T>(target: HandoffRequest['target'], owner: string, guard: Guard, run: (connection: HandoffConnection) => Promise<T>) {
    guard(); if (this.stopped) throw workItemError('work_item_handoff_unavailable', 503);
    if (this.operations.size >= 16 || [...this.operations.values()].filter(id => id === owner).length >= 2) throw workItemError('work_item_handoff_busy', 429);
    const controller = new AbortController(); this.operations.set(controller, owner);
    const timer = setTimeout(() => controller.abort(), 12_000);
    let connection: HandoffConnection | undefined;
    try { connection = await this.open(target, controller.signal); guard(); controller.signal.throwIfAborted(); return await run(connection); }
    finally { clearTimeout(timer); connection?.close(); controller.abort(); this.operations.delete(controller); }
  }
  private async compose(uid: string, input: HandoffRequest, connection: HandoffConnection): Promise<HandoffPreview> {
    const store = await this.store(), { item, storeId } = store.get(uid);
    if (storeId !== input.storeId) throw workItemError('work_item_store_changed');
    if (item.revision !== input.expectedRevision) throw workItemError('work_item_revision_conflict');
    if (item.state !== 'todo') throw workItemError('work_item_handoff_todo_required');
    const records = item.handoffs ?? [];
    if (records.length >= 32) throw workItemError('work_item_handoff_capacity', 507);
    if ((records.at(-1)?.handoffId ?? null) !== (input.retryOf ?? null)) throw workItemError('work_item_handoff_retry_required');
    if (store.handoffBlocked(input.target)) throw workItemError('work_item_handoff_target_locked');
    if (!connection.writable()) throw workItemError('work_item_handoff_control_unavailable');
    const target = connection.target(), message = await handoffMessage(item, target, this.root, this.captures);
    const value = { ...message, target, sendNumber: records.length + 1 };
    return { ...value, previewHash: handoffHash({ ...input, ...value }) };
  }
  async preview(uid: string, input: HandoffRequest, owner: string, guard: Guard) {
    return this.connection(input.target, owner, guard, connection => this.compose(uid, input, connection));
  }
  submit(uid: string, input: HandoffSubmit, owner: string, guard: Guard): Promise<HandoffReceipt> {
    guard();
    const hash = handoffHash({ uid, input, owner }), previous = this.submissions.get(input.handoffId);
    if (previous) {
      if (previous.hash !== hash) throw workItemError('work_item_handoff_id_conflict');
      return previous.result.then(value => { guard(); return value; });
    }
    if (this.submissions.size >= 16) throw workItemError('work_item_handoff_busy', 429);
    const result = Promise.resolve().then(() => this.submitOnce(uid, input, owner, guard)).finally(() => this.submissions.delete(input.handoffId));
    this.submissions.set(input.handoffId, { hash, result }); return result;
  }
  private async submitOnce(uid: string, input: HandoffSubmit, owner: string, guard: Guard): Promise<HandoffReceipt> {
    const store = await this.store(), requestHash = handoffHash({ uid, input, owner });
    guard(); const previous = store.findHandoff(input.handoffId);
    const receipt: HandoffReceipt = { handoffId: input.handoffId, accepted: true };
    if (previous) {
      if (previous.uid !== uid || previous.record.requestHash !== requestHash) throw workItemError('work_item_handoff_id_conflict');
      return receipt;
    }
    return this.connection(input.target, owner, guard, async connection => {
      // previewHash/confirmed are not input to the deterministic preview itself.
      const { previewHash } = input;
      const request: HandoffRequest = { storeId: input.storeId, expectedRevision: input.expectedRevision, handoffId: input.handoffId, target: input.target, ...(input.retryOf ? { retryOf: input.retryOf } : {}) };
      const preview = await this.compose(uid, request, connection);
      if (preview.previewHash !== previewHash) throw workItemError('work_item_handoff_preview_changed');
      const now = new Date().toISOString();
      const record: HandoffRecord = { ...preview, handoffId: input.handoffId, attemptId: store.get(uid).item.currentAttempt.attemptId,
        retryOf: input.retryOf ?? null, owner, requestHash, createdAt: now, updatedAt: now, status: 'sending', reason: null };
      const reserved = await store.reserveHandoff(uid, input.expectedRevision, record, guard);
      if (!reserved) return receipt;
      let attempted = false;
      try {
        guard();
        if (!connection.writable() || handoffHash(connection.target()) !== handoffHash(preview.target)) throw workItemError('work_item_handoff_control_unavailable');
        attempted = true;
        const status = await connection.send(preview.text, input.handoffId, owner);
        await store.settleHandoff(uid, input.handoffId, status, status === 'unknown' ? 'delivery_unknown' : null, guard);
      } catch {
        // Never repeat after invocation, even when recording the receipt failed.
        await store.settleHandoff(uid, input.handoffId, attempted ? 'unknown' : 'rejected', attempted ? 'delivery_unknown' : 'not_sent', guard).catch(() => {});
      }
      guard(); return receipt;
    });
  }
  /** Unlocks an unknown result after the user checked the target session. Never dispatches. */
  async resolve(uid: string, id: string, outcome: 'delivered' | 'not_received', guard: Guard) {
    const store = await this.store(); guard(); store.get(uid);
    const found = store.findHandoff(id);
    if (!found || found.uid !== uid) throw workItemError('work_item_handoff_not_found', 404);
    await store.settleHandoff(uid, id, outcome === 'delivered' ? 'delivered' : 'rejected',
      outcome === 'delivered' ? 'user_confirmed_delivered' : 'user_confirmed_not_received', guard, 'unknown');
    guard(); return { handoff: store.findHandoff(id)!.record };
  }
  async read(uid: string, id: string, owner: string, guard: Guard) {
    const store = await this.store(); guard(); store.get(uid);
    let found = store.findHandoff(id);
    if (!found || found.uid !== uid) throw workItemError('work_item_handoff_not_found', 404);
    if (['sending', 'submitted', 'unknown', 'queued'].includes(found.record.status)) {
      try {
        await this.connection(found.record.target, owner, guard, async connection => {
          const status = connection.evidence(id);
          if (status) await store.settleHandoff(uid, id, status, status === 'unknown' ? 'delivery_unknown' : null, guard);
        });
      } catch { guard(); /* Missing evidence remains unknown; never send from a read. */ }
      found = store.findHandoff(id)!;
      if (['sending', 'submitted'].includes(found.record.status) && Date.now() - Date.parse(found.record.updatedAt) >= 30_000) {
        await store.settleHandoff(uid, id, 'unknown', 'delivery_unknown', guard); found = store.findHandoff(id)!;
      }
    }
    guard(); return { handoff: found.record };
  }
}
