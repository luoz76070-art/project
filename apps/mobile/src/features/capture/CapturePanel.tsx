import { ItemHandoff } from '../handoff/ItemHandoff';
import { ItemStateActions } from '../handoff/ItemStateActions';
import type { HandoffTarget } from '../../../../../shared/handoff';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkItem } from '../../../../../shared/workItem';
import { voiceDraftHash } from '../voice/recovery';
import { VoiceInput } from '../voice/VoiceInput';
import { useDeviceRevoked } from '../connection/useDeviceRevoked';
import { deviceRevokedMessage } from '../connection/authorization';
import { captureApi, canvasPreview, captureTransaction, type CaptureList, type CaptureTransaction } from './model';
import { useCaptureVoice } from './useCaptureVoice';
import './capture.css';

type Props = { onOpenTarget: (target: HandoffTarget) => void; endpoint: string; token: string; scope: string; open: boolean; onClose: () => void };
export function CapturePanel({ endpoint, token, scope, open, onClose, onOpenTarget }: Props) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const currentDraft = useRef({ draftId, detail: '', writable: false });
  const [title, setTitle] = useState(''), [detail, setDetail] = useState(''), [raw, setRaw] = useState<string | null>(null), [files, setFiles] = useState<File[]>([]);
  const [item, setItem] = useState<WorkItem | null>(null), [list, setList] = useState<CaptureList | null>(null);
  const [images, setImages] = useState<{ id: string; src: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const revoked = useDeviceRevoked(endpoint, token);
  const lifetime = useRef(new AbortController()), api = useMemo(() => captureApi(endpoint, token, () => lifetime.current.signal), [endpoint, token]);
  const tx = useRef<CaptureTransaction | null>(null), working = useRef(false), card = useRef<HTMLElement | null>(null), input = useRef<HTMLInputElement | null>(null);
  const pending = useRef<{ kind: 'edit' | 'delete'; uid: string; mutationId: string; expectedRevision: number; title: string; detail: string } | null>(null);
  currentDraft.current = { draftId, detail, writable: !tx.current && !item };
  const voice = useCaptureVoice(`capture:${scope}:${draftId}`, endpoint, token, async (text, record) => {
    const before = currentDraft.current, hash = await voiceDraftHash(before.detail);
    if (currentDraft.current.draftId !== before.draftId || !currentDraft.current.writable) return;
    if (record.draftHash !== hash || currentDraft.current.detail !== before.detail) { setNotice(`已取回原始转写，说明已变化，未覆盖：${text}`); return; }
    setRaw(text); setDetail(before.detail ? `${before.detail}\n\n${text}` : text); setNotice('已取回原始转写');
  });
  const locked = busy || Boolean(tx.current || pending.current), connected = online && Boolean(endpoint && token) && !revoked;
  useEffect(() => {
    lifetime.current = new AbortController();
    const network = () => setOnline(navigator.onLine); window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { lifetime.current.abort(); window.removeEventListener('online', network); window.removeEventListener('offline', network); };
  }, [lifetime]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null; card.current?.focus();
    return () => previous?.focus();
  }, [open]);
  async function run(action: () => Promise<void>) {
    if (working.current || !connected) { if (!connected) setError(revoked ? deviceRevokedMessage : '需要连接电脑'); return; }
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (caught) {
      if (!lifetime.current.signal.aborted) {
        const status = (caught as { status?: number }).status, message = caught instanceof Error ? caught.message : '';
        setError(status === 401 ? deviceRevokedMessage : !online || /fetch|Network|timeout|Connect|ECONN/i.test(message) ? '需要连接电脑；当前内容仍保留，请连接后重试。'
          : status === 507 ? '捕获存储或单卡容量已满，请减少图片或联系电脑端处理。'
          : status === 413 ? '图片尺寸或内容超过上限，请减少大小后重试。'
          : status === 422 ? '图片格式或结构不支持，请选择有效的静态 JPEG、PNG、WebP。'
          : `未完成：${message || '需要连接电脑'}。当前内容仍保留，请核对后重试。`);
        if (status === 410) { pending.current = null; tx.current = null; setItem(null); setNotice('这张卡已被删除；当前文字仍保留，可复制或用于新卡。'); }
      }
    } finally { working.current = false; if (!lifetime.current.signal.aborted) setBusy(false); }
  }
  function show(value: WorkItem) { setItem(value); setTitle(value.title); setDetail(value.detail); setRaw(value.capture?.rawTranscript ?? null); setFiles([]); setImages([]); }
  function reset() { setDraftId(crypto.randomUUID()); setItem(null); setTitle(''); setDetail(''); setRaw(null); setFiles([]); setImages([]); tx.current = null; pending.current = null; setNotice(''); setError(''); }
  async function refresh(append = false) {
    const page = await api.list(append ? list?.nextCursor ?? undefined : undefined);
    setList(previous => append && previous?.storeId === page.storeId ? { ...page, items: [...previous.items, ...page.items] } : page);
  }
  async function save() {
    if (item) {
      pending.current ??= { kind: 'edit', uid: item.uid, mutationId: crypto.randomUUID(), expectedRevision: item.revision, title: title.trim() || item.title, detail };
      const p = pending.current; if (p.kind !== 'edit') throw new Error('请先重试删除或刷新卡片');
      const saved = await api.edit(p.uid, { mutationId: p.mutationId, expectedRevision: p.expectedRevision, title: p.title, detail: p.detail });
      show(saved.item); pending.current = null; setNotice('修改已保存');
    } else {
      tx.current ??= captureTransaction({ title, detail, rawTranscript: raw, files });
      const saved = await api.save(tx.current, canvasPreview); show(saved.item); tx.current = null; setNotice('事项已保存 · 待处理');
    }
    await refresh();
  }
  async function remove() {
    if (!item) return;
    pending.current ??= { kind: 'delete', uid: item.uid, mutationId: crypto.randomUUID(), expectedRevision: item.revision, title, detail };
    const p = pending.current; if (p.kind !== 'delete') throw new Error('请先重试保存或刷新卡片');
    await api.remove(p.uid, { mutationId: p.mutationId, expectedRevision: p.expectedRevision }); reset(); await refresh(); setNotice('捕获卡已删除');
  }
  async function evidence() {
    if (!item?.capture) return;
    const next: typeof images = [];
    for (const id of item.capture.assetIds) {
      if (item.assets.some(a => a.id === id)) continue;
      const value = await api.image(id);
      if (value.asset.role === 'preview') next.push({ id, src: `data:${value.asset.mimeType};base64,${value.dataBase64}`, label: value.asset.fileName });
    }
    setImages(next);
  }
  const controlsDisabled = busy || !connected;
  return <>
    {open && createPortal(<div className="handoff-scrim"><section ref={card} tabIndex={-1} className="handoff-card capture-card" role="dialog" aria-modal="true" aria-labelledby="capture-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not([hidden]):not(:disabled)'));
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id="capture-title">{item ? '捕获事项' : '新建事项'}</h2>
      <p>图片和原始转写保留为独立事项，保存后为待处理。</p>
      {!connected && <p role="alert">{revoked ? deviceRevokedMessage : '需要连接电脑'}</p>}
      <label>标题<input aria-label="事项标题" value={title} disabled={locked || !connected} onChange={e => setTitle(e.target.value)} placeholder="留空使用默认标题" /></label>
      <label>说明<textarea aria-label="事项说明" value={detail} disabled={locked || !connected} onChange={e => setDetail(e.target.value)} rows={5} /></label>
      {raw !== null && <details><summary>原始转写（保留原文）</summary><textarea aria-label="事项原始转写" readOnly value={raw} rows={4} /></details>}
      {!item && <>
        <input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => {
          const selected = Array.from(event.target.files ?? []); event.target.value = '';
          if (files.length + selected.length > 16 || [...files, ...selected].reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) { setError('每张卡最多16张图片，合计不超过100MiB（含预览）'); return; }
          if (selected.some(f => !['image/jpeg','image/png','image/webp'].includes(f.type) || f.size > 25 * 1024 * 1024)) { setError('只支持25MiB以内的静态 JPEG、PNG、WebP'); return; }
          setFiles(current => [...current, ...selected]);
        }} />
        <div className="handoff-actions"><button disabled={locked || !connected} onClick={() => input.current?.click()}>从相册选图</button>
          {!locked && connected && <VoiceInput capture onCapture={setRaw} endpoint={endpoint} token={token} draft={detail} onDraft={setDetail} scope={`capture:${scope}:${draftId}`} thread={`capture:${draftId}`} recovery={voice} />}</div>
        <ul>{files.map((file,index) => <li key={index}>{file.name} <button disabled={locked} onClick={() => setFiles(current => current.filter((_,i) => i !== index))}>移除</button></li>)}</ul>
      </>}
      {item && <><p>状态：{{ todo: '待处理', in_progress: '进行中', to_verify: '待验证', done: '完成', returned: '退回' }[item.state]}</p>
        <ItemStateActions item={item} send={api.request} disabled={controlsDisabled || locked} onItem={setItem} />
        <button disabled={controlsDisabled} onClick={() => void run(evidence)}>查看图片预览</button>
        <ul>{item.assets.map(a => <li key={a.id}><button disabled={controlsDisabled} onClick={() => void run(async () => {
          const value = await api.image(a.id); setImages([{ id: a.id, src: `data:${value.asset.mimeType};base64,${value.dataBase64}`, label: `${a.fileName}（原图，方向 ${value.asset.orientation}）` }]);
        })}>{a.fileName} · 查看原图</button></li>)}</ul></>}
      {images.map(image => <figure key={image.id}><img src={image.src} alt={image.label} /><figcaption>{image.label}</figcaption></figure>)}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
      {tx.current && !tx.current.confirmed && <p>当前保存内容已固定，请重试同一事项；关闭应用后未确认内容无法恢复。</p>}
      {item && <ItemHandoff key={item.uid} item={item} send={api.request} disabled={controlsDisabled || locked || title !== item.title || detail !== item.detail} onItem={setItem} onOpenTarget={onOpenTarget} />}
      {item && (title !== item.title || detail !== item.detail) && <p>交接前请先保存修改。</p>}
      <div className="handoff-actions">
        <button disabled={busy} onClick={() => onClose()}>关闭</button>
        <button disabled={controlsDisabled || pending.current?.kind === 'delete'} className="primary-button" onClick={() => void run(save)}>{busy ? '处理中…' : tx.current ? '重试保存并核对' : item ? '保存修改' : '保存事项'}</button>
        {item?.everDispatched && <button disabled>已交给 Agent，删除会让对方读不到图片</button>}
        {item?.capture && !item.everDispatched && item.state === 'todo' && item.currentAttempt.delivery === 'none' && <button disabled={controlsDisabled || pending.current?.kind === 'edit'} onClick={() => { if (pending.current?.kind === 'delete' || window.confirm('删除这张尚未派发的捕获卡？')) void run(remove); }}>删除事项</button>}
        {!tx.current && <button disabled={busy || Boolean(pending.current)} onClick={reset}>新建另一张</button>}
        {tx.current && !tx.current.posted && <button disabled={busy} onClick={() => { tx.current = null; setError(''); }}>返回编辑</button>}
        {pending.current && item && <button disabled={controlsDisabled} onClick={() => void run(async () => { const value = await api.get(item.uid); pending.current = null; setItem(value.item); setNotice('已刷新版本；你的标题和说明仍保留，请核对后再保存'); })}>刷新版本并核对</button>}
      </div>
      <details onToggle={event => { if (event.currentTarget.open && !list && !working.current && connected) void run(() => refresh()); }}><summary>已有事项</summary><button disabled={controlsDisabled || locked} onClick={() => void run(() => refresh())}>刷新</button>
        <ul>{list?.items.map(saved => <li key={saved.uid}><button disabled={controlsDisabled || locked} onClick={() => void run(async () => show((await api.get(saved.uid)).item))}>{saved.title}</button></li>)}</ul>
        {list?.nextCursor && <button disabled={controlsDisabled || locked} onClick={() => void run(() => refresh(true))}>加载更多</button>}</details>
    </section></div>, document.body)}
  </>;
}
