import path from 'node:path';
import type { HandoffRequest, HandoffStatus, HandoffTarget } from '../../../../shared/handoff.js';
import type { LastTurn } from '../../../../shared/lastTurn.js';
import type { AgentGateway } from '../agents/agentGateway.js';
import type { AgentSessionSnapshot } from '../agents/sessions.js';
import type { DesktopControl, DesktopStreamSnapshot } from '../desktop/desktopControl.js';
import type { CodexStore } from '../store/codexStore.js';
import { workItemError } from '../workItems/schema.js';
export type HandoffConnection = {
  target(): HandoffTarget;
  writable(): boolean;
  evidence(id: string): HandoffStatus | null;
  send(text: string, id: string, owner: string): Promise<HandoffStatus>;
  /** Native turn that consumed this clientMessageId, or null when the channel cannot say so exactly (W4b). */
  turnFor(id: string): string | null;
  lastTurn(): LastTurn | null;
  close(): void;
};
export type OpenHandoffTarget = (target: HandoffRequest['target'], signal: AbortSignal, onChange?: () => void) => Promise<HandoffConnection>;
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(workItemError('work_item_handoff_unavailable', 503));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function directory(cwd: string | null | undefined) {
  if (!cwd || !path.isAbsolute(cwd) || /[\0\r\n]/.test(cwd)) throw workItemError('work_item_handoff_cwd_invalid', 409);
  return cwd;
}
/** Scoped subscriptions borrow the existing authoritative controls; no new session or input fallback. */
export function openHandoffTarget(deps: { gateway: AgentGateway; desktop: DesktopControl; codex: CodexStore }): OpenHandoffTarget {
  return async (key, signal, onChange) => {
    let closed = false, release: (() => void) | undefined, unfollow: (() => void) | undefined;
    const close = () => { closed = true; release?.(); unfollow?.(); signal.removeEventListener('abort', close); };
    signal.throwIfAborted(); signal.addEventListener('abort', close, { once: true });
    let ready!: () => void;
    const first = new Promise<void>(resolve => { ready = resolve; });
    try {
      if (key.agentId === 'codex') {
        const thread = await abortable(deps.codex.getThreadSummary(key.sessionId), signal);
        if (!thread || !(thread.source === 'vscode' || thread.originator?.toLowerCase().includes('desktop'))) throw workItemError('work_item_handoff_target_invalid', 404);
        let snapshot: DesktopStreamSnapshot | null = null;
        release = deps.desktop.onStreamSnapshot(value => { if (value.threadId === key.sessionId && !closed) { snapshot = value; if (value.control?.token) ready(); onChange?.(); } });
        unfollow = deps.desktop.followThread(key.sessionId, { allowLoad: true });
        snapshot = deps.desktop.getStreamSnapshot(key.sessionId);
        if (!snapshot?.control?.token) await abortable(first, signal);
        const control = () => snapshot?.control;
        const writable = () => !closed && control()?.transport === 'native' && Boolean(control()?.token && control()?.canSend);
        const evidence = (id: string): HandoffStatus | null => {
          if (closed || !control()?.token) return null;
          const queued = control()?.queue?.items.find(v => v.clientMessageId === id);
          if (queued) return queued.status === 'uncertain' ? 'unknown' : 'queued';
          const receipt = control()?.submission;
          if (receipt?.clientMessageId === id && receipt.action !== 'interrupt-turn' && receipt.delivery === 'confirmed') return 'delivered';
          if (snapshot?.messages.some(m => m.role === 'user' && m.clientMessageId === id)) return 'delivered';
          return receipt?.clientMessageId === id && receipt.delivery === 'uncertain' ? 'unknown' : null;
        };
        const turnFor = (id: string) => snapshot?.messages.find(m => m.role === 'user' && m.clientMessageId === id)?.turnId
          ?? snapshot?.inputReplacements?.find(r => r.clientMessageId === id)?.turnId ?? null;
        return { target: () => ({ ...key, title: thread.threadName ?? key.sessionId, cwd: directory(thread.cwd) }), writable, evidence, close, turnFor, lastTurn: () => snapshot?.lastTurn ?? null,
          async send(text, id, owner) {
            if (!writable()) throw workItemError('work_item_handoff_control_unavailable');
            const c = control()!, mode = c.activeTurnId ? 'queue' : 'start';
            const result = await abortable(deps.desktop.sendMessage({ threadId: key.sessionId, message: text, clientMessageId: id, owner,
              mode, controlToken: c.token!, expectedTurnId: c.activeTurnId }), signal);
            return evidence(id) ?? (result.delivery === 'confirmed' ? mode === 'queue' ? 'queued' : 'delivered' : result.delivery === 'submitted' ? 'submitted' : 'unknown');
          } };
      }
      const adapter = deps.gateway.sessions(key.agentId);
      if (!adapter.validSessionId(key.sessionId)) throw workItemError('work_item_handoff_target_invalid', 400);
      let snapshot: AgentSessionSnapshot | null = null;
      const watching = adapter.watchSession(key.sessionId, value => {
        if (!closed && value.agentId === key.agentId && value.session.id === key.sessionId) {
          snapshot = value;
          // Claude first publishes an unsubscribed view, then the host's requested snapshot.
          if (value.connected && value.control && (value.control.canSend || value.submission || value.operationError)) ready();
          onChange?.();
        }
      }, close).then(stop => { release = stop; if (closed) stop(); });
      await abortable(watching, signal); await abortable(first, signal);
      const current = () => snapshot as AgentSessionSnapshot | null;
      const writable = () => !closed && Boolean(current()?.connected && current()?.control?.token && current()?.control?.canSend);
      const evidence = (id: string): HandoffStatus | null => {
        const view = current(); if (!view?.connected || closed) return null;
        const queued = view.queue?.items.find(v => v.clientMessageId === id);
        if (queued) return queued.status === 'uncertain' ? 'unknown' : 'queued';
        if (view.operationError?.clientMessageId === id) return 'rejected';
        if (view.submission?.clientMessageId !== id || view.submission.action !== 'message') return null;
        return view.submission.delivery === 'confirmed' ? 'delivered' : view.submission.delivery === 'uncertain' ? 'unknown' : null;
      };
      // Agent messages carry no clientMessageId; only a host-reported binding counts (DeepSeek bridge 0.2.8+, W4b). Others stay null.
      return { target: () => ({ ...key, title: current()!.session.title, cwd: directory(current()?.session.directory) }), writable, evidence, close,
        turnFor: (id: string) => current()?.consumedTurns?.find(v => v.clientMessageId === id)?.turnId ?? null, lastTurn: () => current()?.lastTurn ?? null,
        async send(text, id) {
          if (!writable()) throw workItemError('work_item_handoff_control_unavailable');
          const result = await abortable(adapter.sendMessage(key.sessionId, { text, clientMessageId: id, controlToken: current()!.control!.token, delivery: 'queue' }), signal);
          return evidence(id) ?? (result.delivery === 'confirmed' ? 'delivered' : result.delivery === 'submitted' ? 'submitted' : 'unknown');
        } };
    } catch (error) { close(); throw error; }
  };
}
