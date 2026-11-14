import { useState } from 'react';
import type { WorkItem, WorkItemResponse } from '../../../../../shared/workItem';
import { stateActionRequest, stateActions, type HandoffSend, type StateAction } from './model';

type Props = { item: WorkItem; send: HandoffSend; disabled: boolean; onItem: (item: WorkItem) => void };
/** Verify what an agent finished, take a card back, or refresh progress written by the relay (W4). */
export function ItemStateActions({ item, send, disabled, onItem }: Props) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run(work: () => Promise<WorkItemResponse>) {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try { onItem((await work()).item); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请刷新后重试'); } finally { setBusy(false); }
  }
  function apply(action: StateAction) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    const reason = action.reasonPrompt ? window.prompt(action.reasonPrompt)?.trim() ?? '' : null;
    if (action.reasonPrompt && !reason) return;
    const request = stateActionRequest(item, action, reason, crypto.randomUUID());
    void run(() => send<WorkItemResponse>(request.route, 'POST', request.body));
  }
  const automatic = item.lastTransition?.actor === 'system' ? item.lastTransition : null;
  return <div className="handoff-actions item-state-actions">
    {automatic && <p className="item-state-note">由 Agent 进度自动更新{automatic.reason ? `：${automatic.reason}` : ''}</p>}
    {stateActions(item.state).map(action => <button key={action.label} disabled={busy || disabled} onClick={() => apply(action)}>{action.label}</button>)}
    {(item.state === 'todo' || item.state === 'in_progress') && <button disabled={busy || disabled} onClick={() => void run(() => send<WorkItemResponse>(`/api/work-items/${item.uid}`))}>刷新状态</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
