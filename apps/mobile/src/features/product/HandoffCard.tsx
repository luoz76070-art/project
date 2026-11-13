import { useEffect, useRef, useState } from 'react';
import type { PendingAttachment, ThreadSummary } from '../../app/types';
import { isDesktopSource, shortPath } from '../threads/model';
import { ProductHost, productBeforeNavigate } from './host';
import { loadHandoffDraft, saveHandoffDraft, removeHandoffDraft, submitProductHandoff, type HandoffDraft, type ProductHandoff } from './handoff';

export function HandoffCard({ handoff, scope, threads, selectedId, ready, queue, changed, select, refresh, upload, send }: {
  handoff: ProductHandoff; scope: string; threads: ThreadSummary[]; selectedId?: string; ready: boolean; queue: boolean;
  changed: (value: ProductHandoff | null) => void; select: (thread: ThreadSummary) => void;
  refresh: () => void; upload: (file: File) => Promise<PendingAttachment>;
  send: (message: string, id: string, threadId: string) => Promise<'confirmed' | 'queued' | 'uncertain' | 'rejected'>;
}) {
  const [initial] = useState(() => {
    try { return { draft: loadHandoffDraft(handoff, scope), error: '' }; }
    catch (error) { return { draft: null, error: String(error instanceof Error ? error.message : error) }; }
  });
  const [draft, setDraft] = useState<HandoffDraft | null>(initial.draft);
  const [error, setError] = useState(initial.error);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLElement>(null);
  const blocked = useRef(Boolean(initial.error));
  const busyRef = useRef(false);
  const locked = handoff.status !== 'draft';
  const sameScope = draft?.scope === scope;
  const available = threads.filter(isDesktopSource);
  const target = available.find(thread => thread.id === draft?.targetId);
  const projects = [...new Set(available.map(thread => thread.cwd ?? ''))];
  const [project, setProject] = useState(() => available.find(thread => thread.id === initial.draft?.targetId)?.cwd ?? '');
  useEffect(() => {
    const prevent = (event: Event) => { if (busyRef.current || blocked.current) event.preventDefault(); };
    window.addEventListener(productBeforeNavigate, prevent);
    return () => window.removeEventListener(productBeforeNavigate, prevent);
  }, []);
  useEffect(() => {
    if (visible && sameScope && target && selectedId !== target.id && !locked) select(target);
  }, [visible, sameScope, target, selectedId, locked, select]);
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement;
    card.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [visible]);

  function edit(next: HandoffDraft) {
    setDraft(next);
    try { saveHandoffDraft(next); blocked.current = false; setError(''); }
    catch (error) { blocked.current = true; setError(error instanceof Error ? error.message : '交接草稿保存失败'); }
  }
  async function files(files: FileList | null) {
    if (!files?.length || !draft || busyRef.current || locked || !sameScope) return;
    if (draft.attachments.length + files.length > 16) { setError('每次交接最多添加16个附件。'); return; }
    busyRef.current = true; setBusy(true); setError('');
    let next = draft;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} 超过25MB`);
        const attachment = await upload(file);
        next = { ...next, attachments: [...next.attachments, attachment] };
        edit(next);
        if (blocked.current) break;
      }
    } catch (error) { setError(error instanceof Error ? error.message : '附件上传失败，请重试。'); }
    finally { busyRef.current = false; setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function confirm() {
    if (busyRef.current || !draft || !target || locked) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await submitProductHandoff({ handoff, draft, scope, target, ready: ready && selectedId === target.id,
        host: ProductHost, persist: saveHandoffDraft, changed, send });
      blocked.current = false;
    } catch (error) { setError(error instanceof Error ? error.message : '交接结果待确认，请勿重复发送。'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function close() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await ProductHost.handoff({ id: handoff.id, action: 'close' });
      blocked.current = false;
      changed(null);
      try { removeHandoffDraft(); } catch { /* A retired ID is ignored by the next handoff. */ }
    } catch (error) { setError(error instanceof Error ? error.message : '交接状态未能保存。'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (!visible) return <button className="handoff-resume" onClick={() => setVisible(true)}>查看交接任务{locked ? '状态' : '卡'}</button>;
  return <div className="handoff-scrim">
    <section ref={card} tabIndex={-1} className="handoff-card" role="dialog" aria-modal="true" aria-labelledby="handoff-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busyRef.current && !blocked.current) setVisible(false); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled), input:not([hidden]):not(:disabled)'));
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card.current)) { event.preventDefault(); first.focus(); }
    }}>
      <h2 id="handoff-title">交给电脑</h2>
      <p>{handoff.status === 'confirmed' ? handoff.acceptance === 'queue' ? '交接已加入待发队列，执行状态以目标会话为准。' : '电脑已确认收到本次交接。' : locked ? '提交结果待确认，请勿重复发送。可以稍后查看原目标会话。' : '核对任务说明，按需添加附件，再选择电脑会话。'}</p>
      {locked ? <>
        <p>目标：{handoff.target?.title} · {shortPath(handoff.target?.cwd ?? '')}</p>
        <pre className="handoff-preview">{handoff.message}</pre>
      </> : draft ? <>
        <label>任务说明<textarea aria-label="交接任务说明" value={draft.text} disabled={busy} onChange={event => edit({ ...draft, text: event.target.value })} /></label>
        {!sameScope ? <p role="alert">这张任务卡属于另一连接。切回原连接可继续，或<button onClick={() => { edit({ ...draft, scope, targetId: '', attachments: [] }); setProject(''); }}>改用当前连接并清空附件</button></p> : <>
          <label>项目<select aria-label="交接项目" value={target?.cwd ?? project} disabled={busy} onChange={event => { setProject(event.target.value); edit({ ...draft, targetId: '' }); }}>
            <option value="">选择项目</option>{projects.filter(Boolean).map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>已有电脑会话<select aria-label="交接会话" value={draft.targetId} disabled={busy} onChange={event => {
            const next = available.find(item => item.id === event.target.value);
            edit({ ...draft, targetId: event.target.value }); if (next) select(next);
          }}>
            <option value="">选择会话</option>
            {draft.targetId && !target && <option value={draft.targetId} disabled>目标尚未加载，请刷新会话</option>}
            {available.filter(thread => (thread.cwd ?? '') === (target?.cwd ?? project)).map(thread => <option key={thread.id} value={thread.id}>{thread.threadName || thread.id}</option>)}
          </select></label>
          <div className="handoff-actions"><button disabled={busy} onClick={refresh}>加载全部会话</button><button disabled title="原Desktop新建能力尚未接入">新建电脑会话（待接入）</button></div>
          <input ref={input} hidden type="file" multiple onChange={event => void files(event.target.files)} />
          <button disabled={busy || blocked.current} onClick={() => input.current?.click()}>添加附件</button>
          <ul>{draft.attachments.map(item => <li key={item.id}><span>{item.fileName}</span><button disabled={busy} aria-label={`移除附件 ${item.fileName}`} onClick={() => edit({ ...draft, attachments: draft.attachments.filter(value => value.id !== item.id) })}>移除</button></li>)}</ul>
        </>}
      </> : null}
      {error && <p role="alert">{error}</p>}
      {!locked && blocked.current && draft && <button onClick={() => edit(draft)}>重试保存交接草稿</button>}
      {!locked && !ready && target && <p>正在等待目标会话的原生控制状态，当前不会发送。</p>}
      <div className="handoff-actions">
        <button disabled={busy || blocked.current} onClick={() => setVisible(false)}>稍后处理</button>
        {handoff.status !== 'uncertain' && <button disabled={busy} onClick={() => void close()}>{locked ? '完成' : '取消交接'}</button>}
        {!locked && <button className="primary-button" disabled={busy || !sameScope || !target || selectedId !== target.id || !ready || blocked.current || !draft || (!draft.text.trim() && !draft.attachments.length)} onClick={() => void confirm()}>{busy ? '正在处理…' : queue ? '确认并排队交接' : '确认交接'}</button>}
      </div>
    </section>
  </div>;
}
