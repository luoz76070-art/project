// This plugin runs in the Harness, independently of the Relay runtime.
const reasons = {
  ok: '本轮已完成。', cancelled: '本轮已中断。',
  provider_error: '本轮执行失败，请在电脑端查看详情。',
  model_unavailable: '模型暂不可用，请稍后重试或在电脑端切换模型。',
  invalid_request: '模型服务拒绝了本次请求，请检查模型配置。',
  transport_error: '模型服务连接失败，请检查网络与服务。', timeout: '模型服务响应超时。',
  rate_limited: '模型服务请求受限，请稍后重试。',
  token_limit: '本轮已达到上下文或输出限制，未正常完成。', blocked: '本轮被阻止，未正常完成。',
};

/** @returns {import('../../shared/lastTurn.js').LastTurn | null} */
export function turnResult(event, previous = null) {
  if (event?.type !== 'turn/end' || !Number.isSafeInteger(event.seq) || event.seq < 0
    || !Number.isSafeInteger(event.data?.turn) || event.data.turn < 0) return null;
  const kind = event.data.reason?.kind;
  let status, code;
  if (kind === 'completed') { status = 'completed'; code = 'ok'; }
  else if (kind === 'aborted') { status = 'interrupted'; code = 'cancelled'; }
  else if (kind === 'max-tokens' || kind === 'blocked') { status = 'failed'; code = kind === 'max-tokens' ? 'token_limit' : 'blocked'; }
  else if (kind === 'error') {
    status = 'failed';
    const error = event.data.reason.error;
    code = { INVALID_REQUEST: 'invalid_request', TRANSPORT: 'transport_error', TIMEOUT: 'timeout', RATE_LIMIT: 'rate_limited', SERVER: 'provider_error' }[error?.code] ?? 'provider_error';
    const detail = typeof error?.message === 'string' ? error.message.slice(0, 8192) : '';
    if (error?.code === 'INVALID_REQUEST' && detail.includes('model is unavailable on every account') && detail.includes('per-model cooldown')) code = 'model_unavailable';
  } else return null;
  const turnId = String(event.data.turn);
  const provided = Number.isSafeInteger(event.time) && event.time >= 0 && event.time <= 8.64e15;
  if (previous?.turnId === turnId && previous.status === status && previous.reason.code === code
    && (previous.timeSource === 'provider' || !provided)) return previous;
  return { turnId, status, reason: { code, message: reasons[code] },
    endedAt: new Date(provided ? event.time : Date.now()).toISOString(), timeSource: provided ? 'provider' : 'observed' };
}
