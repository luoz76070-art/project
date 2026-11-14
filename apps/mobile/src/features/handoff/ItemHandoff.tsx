import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkItem, WorkItemResponse } from '../../../../../shared/workItem';
import type { HandoffAgent, HandoffPreview, HandoffRecord, HandoffRequest, HandoffTarget } from '../../../../../shared/handoff';
import { handoffClient, handoffLabels, agentLabels, type HandoffSend } from './model';
import { deviceRevokedMessage } from '../connection/authorization';
import './handoff.css';
type Props = { item: WorkItem; send: HandoffSend; disabled: boolean; onItem: (item: WorkItem) => void; onOpenTarget: (target: HandoffTarget) => void };
export function ItemHandoff({ item, send, disabled, onItem, onOpenTarget }: Props) {
  const client = useMemo(() => handoffClient(send), [send]);
  const [choosing, setChoosing] = useState(false), [agents, setAgents] = useState<HandoffAgent[]>([]), [agent, setAgent] = useState<HandoffAgent>('codex');
  const [sessions, setSessions] = useState<HandoffTarget[]>([]), [target, setTarget] = useState<HandoffTarget | null>(null), [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ request: HandoffRequest; preview: HandoffPreview } | null>(null);
  const [unknown, setUnknown] = useState<{ id: string; target: HandoffTarget } | null>(null);
  const alive = useRef(true), working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const last = item.handoffs?.at(-1);
  async function run(action: () => Promise<void>) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { if (alive.current) setError((e as { status?: number }).status === 401 ? deviceRevokedMessage : e instanceof Error ? e.message : '连接失败，请核对后重试'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function load(id: HandoffAgent, append = false) {
    const data = await client.sessions(id, search, append ? cursor : null);
    if (!alive.current) return;
    setSessions(previous => append ? [...previous, ...data.sessions.filter(s => !previous.some(p => p.sessionId === s.sessionId))] : data.sessions);
    setCursor(data.cursor); if (!append) { setTarget(null); setConfirmation(null); }
  }
  async function refresh(id: string) {
    const result = await client.read(item.uid, id);
    const response = await send<WorkItemResponse>(`/api/work-items/${item.uid}`);
    if (alive.current) { onItem(response.item); setUnknown(null); setConfirmation(null); }
    return result.handoff;
  }
  async function preview() {
    if (!target) return;
    const fresh = await send<WorkItemResponse>(`/api/work-items/${item.uid}`);
    if (!alive.current) return;
    onItem(fresh.item);
    const request: HandoffRequest = { storeId: fresh.storeId, expectedRevision: fresh.item.revision, handoffId: crypto.randomUUID(),
      target: { agentId: target.agentId, sessionId: target.sessionId }, ...(fresh.item.handoffs?.length ? { retryOf: fresh.item.handoffs.at(-1)!.handoffId } : {}) };
    const value = await client.preview(item.uid, request);
    if (alive.current) setConfirmation({ request, preview: value });
  }
  async function confirm() {
    if (!confirmation) return;
    const value = confirmation; setConfirmation(null); setChoosing(false);
    // Mark unknown before HTTP so a lost response cannot expose a retry-send button.
    setUnknown({ id: value.request.handoffId, target: value.preview.target });
    onItem({ ...item, everDispatched: true });
    try { await client.confirm(item.uid, value.request, value.preview, true); await refresh(value.request.handoffId); }
    catch (e) {
      const status = (e as { status?: number }).status;
      // Explicit HTTP validation failures happen before reservation. A transport failure stays unknown.
      if (alive.current && status && [400, 404, 409, 410, 413, 422, 429, 507].includes(status)) {
        setUnknown(null);
        const current = await send<WorkItemResponse>(`/api/work-items/${item.uid}`).catch(() => null);
        if (alive.current && current) onItem(current.item);
      }
      throw e;
    }
  }
  async function resolve(record: HandoffRecord, outcome: 'delivered' | 'not_received') {
    const question = outcome === 'delivered' ? '确认已在目标会话里看到这次交接？' : '确认目标会话没有收到这次交接？标记后这个会话可以再次接收交接，再发一次会记为新的一次发送。';
    if (!window.confirm(question)) return;
    await client.resolve(item.uid, record.handoffId, outcome);
    const response = await send<WorkItemResponse>(`/api/work-items/${item.uid}`);
    if (alive.current) { onItem(response.item); setUnknown(null); }
  }
  function status(record: HandoffRecord) {
    return <li key={record.handoffId}>
      <span className={record.status === 'unknown' || record.status === 'queued' ? 'handoff-signal' : undefined}>第{record.sendNumber}次发送 · {handoffLabels[record.status]}</span>
      <p>{agentLabels[record.target.agentId]} · {record.target.title} · {record.target.cwd}</p>
      <button disabled={busy || disabled} onClick={() => onOpenTarget(record.target)}>去目标会话核对</button>
      <button disabled={busy || disabled} onClick={() => void run(() => refresh(record.handoffId).then(() => {}))}>查询送达结果</button>
      {record.status === 'unknown' && <span className="handoff-resolve">
        <button disabled={busy || disabled} onClick={() => void run(() => resolve(record, 'delivered'))}>核对后：已收到</button>
        <button disabled={busy || disabled} onClick={() => void run(() => resolve(record, 'not_received'))}>核对后：没收到</button>
      </span>}
    </li>;
  }
  return <section className="item-handoff" aria-label="交给 Agent">
    {item.handoffs?.length ? <ul>{item.handoffs.map(status)}</ul> : null}
    {unknown && <p className="handoff-signal" role="status">结果不明，绝不自动重发。
      <button disabled={busy || disabled} onClick={() => onOpenTarget(unknown.target)}>去目标会话核对</button>
      <button disabled={busy || disabled} onClick={() => void run(() => refresh(unknown.id).then(() => {}))}>查询本次结果</button></p>}
    {error && <p role="alert">{error}</p>}
    {item.state !== 'todo' ? <p>只有待处理事项可以交接；请先按事项状态规则重新打开。</p> : !choosing && <button disabled={busy || disabled || Boolean(unknown)} onClick={() => void run(async () => {
      const available = await client.agents(); if (!alive.current) return; setAgents(available); setChoosing(true); await load(agent);
    })}>{last ? '手动再次交接' : '交给 Agent'}</button>}
    {choosing && !confirmation && <>
      {last && <p>将发起第{item.handoffs!.length + 1}次发送，可能重复。结果不明的目标要先核对并标记“已收到”或“没收到”，否则请选择其他会话。</p>}
      <label>Agent<select value={agent} disabled={busy || disabled} onChange={e => { const value = e.target.value as HandoffAgent; setAgent(value); setTarget(null); setSessions([]); void run(() => load(value)); }}>{agents.map(id => <option value={id} key={id}>{agentLabels[id]}</option>)}</select></label>
      <label>搜索会话<input value={search} disabled={busy || disabled} onChange={e => setSearch(e.target.value)} maxLength={200} /></label>
      <button disabled={busy || disabled} onClick={() => void run(() => load(agent))}>搜索 / 刷新会话</button>
      <label>已有会话<select value={target?.sessionId ?? ''} disabled={busy || disabled} onChange={e => setTarget(sessions.find(s => s.sessionId === e.target.value) ?? null)}><option value="">请选择会话</option>{sessions.map(s => <option key={s.sessionId} value={s.sessionId}>{s.title} · {s.cwd}</option>)}</select></label>
      {cursor && <button disabled={busy || disabled} onClick={() => void run(() => load(agent, true))}>加载更多会话</button>}
      <button disabled={busy || disabled || !target} onClick={() => void run(preview)}>预览交接</button>
    </>}
    {confirmation && <div aria-label="交接确认预览">
      <h3>{confirmation.preview.sendNumber > 1 ? `第${confirmation.preview.sendNumber}次发送，可能重复` : '确认交接'}</h3>
      <p>{agentLabels[confirmation.preview.target.agentId]} · {confirmation.preview.target.title}<br />{confirmation.preview.target.cwd}</p>
      <p>Agent 需要能读取这些 Mac 本地路径。忙碌会话默认排队，不会自动引导当前任务。</p>
      <pre className="handoff-preview">{confirmation.preview.text}</pre>
      <ul>{confirmation.preview.attachments.map(a => <li key={a.id}>{a.fileName} · {a.path}</li>)}</ul>
      <button disabled={busy || disabled} onClick={() => void run(confirm)}>确认发送</button>
    </div>}
    {choosing && <button disabled={busy} onClick={() => { setChoosing(false); setConfirmation(null); setError(''); }}>取消交接</button>}
  </section>;
}
