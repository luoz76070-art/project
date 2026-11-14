import type { WorkItemState, WorkItemSummary } from '../../../../../shared/workItem';

export const workItemTabs: { state: WorkItemState; label: string }[] = [
  { state: 'todo', label: '待处理' }, { state: 'in_progress', label: '进行中' }, { state: 'to_verify', label: '待验证' },
  { state: 'done', label: '完成' }, { state: 'returned', label: '退回' },
];
export const stateHints: Record<WorkItemState, string> = {
  todo: '还没交给 Agent，或者交接还没送达。',
  in_progress: 'Agent 正在处理。Codex 桌面端和 DeepSeek 做完会自动转到待验证，其他 Agent 需要你手动标记。',
  to_verify: 'Agent 已经做完，等你验收。验收通过才算完成。',
  done: '你已经验收通过的事项。',
  returned: '没做好或不再需要的事项，可以重新打开再交接。',
};
export const emptyText: Record<WorkItemState, string> = {
  todo: '没有待处理的事项。可以用上面的按钮新建一件。',
  in_progress: '没有进行中的事项。',
  to_verify: '没有等你验收的事项。',
  done: '还没有完成的事项。',
  returned: '没有退回的事项。',
};
export type WorkItemGroups = Record<WorkItemState, WorkItemSummary[]>;
export function groupWorkItems(items: WorkItemSummary[]): WorkItemGroups {
  const groups: WorkItemGroups = { todo: [], in_progress: [], to_verify: [], done: [], returned: [] };
  for (const item of items) groups[item.state]?.push(item);
  for (const list of Object.values(groups)) list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.uid.localeCompare(b.uid));
  return groups;
}
/** Open on what needs the user: waiting verification first, then pending work. */
export function defaultTab(groups: WorkItemGroups): WorkItemState {
  return groups.to_verify.length ? 'to_verify' : groups.in_progress.length && !groups.todo.length ? 'in_progress' : 'todo';
}
export const workItemPageLimit = 200;
type Page = { storeId: string; items: WorkItemSummary[]; nextCursor: string | null };
/** Reads up to 200 summaries; a store change between pages restarts once, then reports what it has. */
export async function loadAllWorkItems(fetchPage: (cursor?: string) => Promise<Page>) {
  for (let restart = 0; restart < 2; restart++) {
    const first = await fetchPage(); let items = [...first.items], cursor = first.nextCursor, changed = false;
    while (cursor && items.length < workItemPageLimit) {
      const page = await fetchPage(cursor);
      if (page.storeId !== first.storeId) { changed = true; break; }
      items = [...items, ...page.items.filter(item => !items.some(seen => seen.uid === item.uid))]; cursor = page.nextCursor;
    }
    if (!changed || restart === 1) return { items: items.slice(0, workItemPageLimit), truncated: Boolean(cursor) || items.length > workItemPageLimit };
  }
  return { items: [], truncated: false };
}
