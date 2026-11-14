import type { HandoffAgent, HandoffPreview, HandoffRecord, HandoffRequest, HandoffReceipt, HandoffResolution, HandoffTarget } from '../../../../../shared/handoff';
import type { ThreadSummary } from '../../app/types';
import type { WorkItem } from '../../../../../shared/workItem';
import { isDesktopSource } from '../threads/model';
export type HandoffSend = <T>(route: string, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) => Promise<T>;
export const handoffLabels = { sending: '正在发送', submitted: '已提交，等待接收确认', queued: '排队中', delivered: '已送达', unknown: '结果不明', rejected: '未发送 / 已拒绝' };
export const agentLabels: Record<HandoffAgent, string> = { codex: 'Codex 桌面端', claude: 'Claude', deepseek: 'DeepSeek', opencode: 'OpenCode' };
export function handoffClient(send: HandoffSend) {
  const attempted = new Set<string>();
  return {
    async agents() {
      const { agents } = await send<{ agents: { id: string; sessionApi?: number }[] }>('/api/agents');
      return ['codex', ...agents.filter(a => ['claude', 'deepseek', 'opencode'].includes(a.id) && a.sessionApi === 1).map(a => a.id)] as HandoffAgent[];
    },
    async sessions(agentId: HandoffAgent, search = '', cursor: string | null = null): Promise<{ sessions: HandoffTarget[]; cursor: string | null }> {
      if (agentId === 'codex') {
        const data = await send<{ threads: ThreadSummary[]; hasMore: boolean; nextOffset: number }>(`/api/threads?limit=100&range=all&offset=${Number(cursor) || 0}&query=${encodeURIComponent(search)}`);
        return { sessions: data.threads.filter(isDesktopSource).filter(t => t.cwd).map(t => ({ agentId, sessionId: t.id, title: t.threadName, cwd: t.cwd! })), cursor: data.hasMore ? String(data.nextOffset) : null };
      }
      const params = new URLSearchParams({ search, ...(cursor ? { cursor } : {}), ...(agentId === 'deepseek' ? { range: 'all' } : {}) });
      const data = await send<{ sessions: { id: string; title: string; directory: string }[]; cursor: string | null }>(`/api/agents/${agentId}/sessions?${params}`);
      return { sessions: data.sessions.map(s => ({ agentId, sessionId: s.id, title: s.title, cwd: s.directory })), cursor: data.cursor };
    },
    preview(uid: string, input: HandoffRequest) { return send<HandoffPreview>(`/api/work-items/${uid}/handoffs/preview`, 'POST', input); },
    async confirm(uid: string, input: HandoffRequest, preview: HandoffPreview, confirmed: boolean): Promise<HandoffReceipt | null> {
      if (!confirmed) return null;
      if (attempted.has(input.handoffId)) throw new Error('本次交接已尝试，请查询结果，不会再次发送');
      // This client is scoped to one card. A new attempt must have a fresh server preview.
      if (attempted.size >= 32) throw new Error('交接次数已达上限');
      attempted.add(input.handoffId);
      return send<HandoffReceipt>(`/api/work-items/${uid}/handoffs`, 'POST', { ...input, previewHash: preview.previewHash, confirmed: true });
    },
    read(uid: string, id: string) { return send<{ handoff: HandoffRecord }>(`/api/work-items/${uid}/handoffs/${id}`); },
    resolve(uid: string, id: string, outcome: HandoffResolution['outcome']) { return send<{ handoff: HandoffRecord }>(`/api/work-items/${uid}/handoffs/${id}/resolve`, 'POST', { outcome }); },
  };
}
/** W1 user transitions reachable from a card once W4 writes progress back. Reasons are required for returns. */
export type StateAction = { label: string; route: 'actions' | 'verify'; body: { action: 'review' | 'return' | 'reopen' } | { decision: 'accept' | 'return' }; confirm?: string; reasonPrompt?: string };
export function stateActions(state: WorkItem['state']): StateAction[] {
  if (state === 'to_verify') return [
    { label: '验收通过', route: 'verify', body: { decision: 'accept' }, confirm: '确认 Agent 已经把这件事做完了？' },
    { label: '没做好，退回', route: 'verify', body: { decision: 'return' }, reasonPrompt: '退回原因（会记在事项上）' }];
  if (state === 'in_progress') return [
    { label: '标记为待验证', route: 'actions', body: { action: 'review' } },
    { label: '退回', route: 'actions', body: { action: 'return' }, reasonPrompt: '退回原因（会记在事项上）' }];
  if (state === 'returned' || state === 'done') return [{ label: '重新打开', route: 'actions', body: { action: 'reopen' } }];
  return [];
}
export function stateActionRequest(item: Pick<WorkItem, 'uid' | 'revision'>, action: StateAction, reason: string | null, mutationId: string) {
  return { route: `/api/work-items/${item.uid}/${action.route}`, body: { mutationId, expectedRevision: item.revision, ...action.body, ...(reason ? { reason } : {}) } };
}

