import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, RefreshCcw, X } from 'lucide-react';
import type { WorkItemState, WorkItemSummary } from '../../../../../shared/workItem';
import { apiGet, apiPost, buildUrl } from '../connection/http';
import { subscribeEvents } from '../connection/subscription';
import { deviceRevokedMessage } from '../connection/authorization';
import { useDeviceRevoked } from '../connection/useDeviceRevoked';
import { formatDate } from '../../shared/format';
import { defaultTab, emptyText, groupWorkItems, loadAllWorkItems, stateHints, workItemTabs } from './model';
import './workItems.css';

type Props = { endpoint: string; token: string; open: boolean; onClose: () => void; onNew: () => void; onOpenItem: (uid: string) => void };
type Page = { storeId: string; items: WorkItemSummary[]; nextCursor: string | null };
/** W5: every work item by state, live while open. Opening a row hands it to the capture panel. */
export function WorkItemsPage({ endpoint, token, open, onClose, onNew, onOpenItem }: Props) {
  const [items, setItems] = useState<WorkItemSummary[] | null>(null), [truncated, setTruncated] = useState(false);
  const [tab, setTab] = useState<WorkItemState | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const revoked = useDeviceRevoked(endpoint, token);
  const generation = useRef(0), card = useRef<HTMLElement | null>(null);
  const groups = useMemo(() => groupWorkItems(items ?? []), [items]);
  const current = tab ?? defaultTab(groups);
  async function load() {
    const run = ++generation.current; setLoading(true); setError('');
    try {
      const result = await loadAllWorkItems(cursor => apiGet<Page>(buildUrl(endpoint, `/api/work-items?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), token));
      if (run !== generation.current) return;
      setItems(result.items); setTruncated(result.truncated);
    } catch (caught) {
      if (run === generation.current) setError((caught as { status?: number }).status === 401 ? deviceRevokedMessage : '暂时读不到事项，请检查和电脑的连接后重试。');
    } finally { if (run === generation.current) setLoading(false); }
  }
  useEffect(() => {
    if (!open || !endpoint || !token || revoked) return;
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 300); };
    const unsubscribe = subscribeEvents({ authorization: { endpoint, token },
      getToken: signal => apiPost(buildUrl(endpoint, '/api/work-items/stream-token'), token, {}, signal),
      url: streamToken => buildUrl(endpoint, `/api/work-items/events?${new URLSearchParams({ streamToken })}`),
      events: { 'work-item.changed': changed, 'work-item.deleted': changed }, onState: () => {} });
    return () => { clearTimeout(timer); unsubscribe(); generation.current++; };
    // load only reads props captured here; re-subscribing on every render would drop the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpoint, token, revoked]);
  useEffect(() => { if (open) card.current?.focus(); else setTab(null); }, [open]);
  if (!open) return null;
  return createPortal(<div className="handoff-scrim work-items-scrim">
    <section ref={card} tabIndex={-1} className="handoff-card work-items-page" role="dialog" aria-modal="true" aria-labelledby="work-items-title"
      onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <header className="work-items-header">
        <h2 id="work-items-title">事项</h2>
        <button type="button" className="icon-button" onClick={() => void load()} disabled={loading || revoked} aria-label="刷新事项" title="刷新事项"><RefreshCcw size={18} /></button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭事项" title="关闭"><X size={18} /></button>
      </header>
      <button type="button" className="primary-button work-items-new" onClick={onNew}><Plus size={18} aria-hidden="true" />新建事项</button>
      {revoked && <p role="alert">{deviceRevokedMessage}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="work-items-tabs" role="tablist" aria-label="按状态查看事项">
        {workItemTabs.map(({ state, label }) => <button type="button" key={state} role="tab" aria-selected={current === state}
          className={`work-items-tab${current === state ? ' active' : ''}`} onClick={() => setTab(state)}>
          <span>{label}</span><span className={`work-items-count${state === 'to_verify' && groups.to_verify.length ? ' signal' : ''}`}>{groups[state].length}</span>
        </button>)}
      </div>
      <p className="work-items-hint">{stateHints[current]}</p>
      {items === null ? <p className="inline-loading">{error ? '' : '正在读取事项…'}</p>
        : groups[current].length === 0 ? <p className="work-items-empty">{emptyText[current]}</p>
        : <ul className="work-items-list" role="tabpanel" aria-label={workItemTabs.find(t => t.state === current)?.label}>
          {groups[current].map(item => <li key={item.uid}><button type="button" className="work-items-row" onClick={() => onOpenItem(item.uid)}>
            <span className="work-items-title">{item.title}</span>
            <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
          </button></li>)}
        </ul>}
      {truncated && <p className="work-items-hint">只显示最近更新的 200 件事项。</p>}
    </section>
  </div>, document.body);
}
