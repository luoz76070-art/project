const turnId = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
const text = content => (Array.isArray(content) ? content : []).filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').slice(0, 32768);

// Provider errors may contain credentials or request details. Publish only fixed summaries.
function failureSummary(error) {
  switch (error?.code) {
    case 'INVALID_REQUEST': {
      const detail = typeof error.message === 'string' ? error.message.slice(0, 8192) : '';
      return detail.includes('model is unavailable on every account') && detail.includes('per-model cooldown')
        ? '当前模型服务暂不可用（上游账号冷却）。请在电脑端切换可用模型，或等待服务恢复后再发送。'
        : '模型服务拒绝了本次请求。请在电脑端检查模型配置与错误详情。';
    }
    case 'TRANSPORT': return '模型服务连接失败。请在电脑端检查网络与模型服务后再发送。';
    case 'TIMEOUT': return '模型服务响应超时。请确认服务恢复后再发送。';
    case 'RATE_LIMIT': return '模型服务请求受限。请稍后再发送。';
    case 'SERVER': return '模型服务发生错误。请确认服务恢复后再发送。';
    default: return '请在电脑端查看本轮错误详情，确认原因后再发送。';
  }
}

export function messageOf(event) {
  const data = event.data;
  const time = Number.isSafeInteger(event.time) && event.time >= 0 && event.time <= 8.64e15 ? event.time : Date.now();
  if (event.type === 'turn/end' && data?.reason?.kind === 'error' && turnId(data.turn) !== undefined && Number.isSafeInteger(event.seq) && event.seq >= 0) {
    return { id: `turn-error-${event.seq}`, timestamp: new Date(time).toISOString(), role: 'assistant', kind: 'agent_message', turnId: turnId(data.turn),
      text: `DeepSeek Harness 运行提示：本轮执行失败，未正常完成。\n\n${failureSummary(data.reason.error)}` };
  }
  const message = event.type === 'user/message' && data?.source?.kind === 'user' ? data : event.type === 'assistant/message' ? data?.message : null;
  if (!message || !['user', 'assistant'].includes(message.role)) return null;
  const visible = text(message.content), turn = turnId(data.turn);
  return visible ? { id: `message-${message.id}`, timestamp: new Date(time).toISOString(), role: message.role, text: visible, kind: message.role === 'user' ? 'user_message' : 'agent_message',
    ...(message.role === 'assistant' && turn !== undefined ? { turnId: turn, phase: 'commentary' } : {}),
  } : null;
}

// A tool-free last step becomes a result only at the original successful turn boundary.
// Idle, stream/end, cancellation, max-tokens and failed attempts are not completion evidence.
export function finalMessageId(state, event) {
  const data = event.data;
  if (event.type === 'turn/start' || event.type === 'step/start') state.finalCandidate = null;
  if (event.type === 'assistant/message') {
    const visible = messageOf(event);
    state.finalCandidate = visible?.turnId !== undefined && !data.interrupted && Number.isSafeInteger(data.step)
      && !data.message.content.some(block => block?.type === 'tool-call') ? { id: visible.id, turn: data.turn } : null;
  }
  if (event.type !== 'turn/end') return null;
  const id = data.reason?.kind === 'completed' && state.finalCandidate?.turn === data.turn ? state.finalCandidate.id : null;
  state.finalCandidate = null;
  return id;
}
