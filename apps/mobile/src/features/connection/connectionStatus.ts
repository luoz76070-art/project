export type ConnectionCardState = 'none' | 'testing' | 'error' | 'ok';
/** A name people recognise: the tunnel relay ID (…/r/<id>) or the host, never the full URL. */
export function friendlyComputerName(endpoint: string) {
  try { const url = new URL(endpoint); const relay = url.pathname.match(/\/r\/([^/]+)/)?.[1]; return decodeURIComponent(relay ?? url.host); }
  catch { return ''; }
}
export function connectionCardState(input: { endpoint: string; token: string; checking: boolean; failed: boolean; latency: number | null; connectionState: string }): ConnectionCardState {
  if (!input.endpoint || !input.token) return 'none';
  if (input.checking && input.latency === null) return 'testing';
  return input.failed || input.connectionState === 'error' ? 'error' : 'ok';
}
export const connectionCardTitles: Record<ConnectionCardState, string> = { none: '还没有连接电脑', testing: '正在连接…', error: '连接不上电脑', ok: '已连接电脑' };
