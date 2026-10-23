const turnId = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
const text = content => (Array.isArray(content) ? content : []).filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').slice(0, 32768);

export function messageOf(event) {
  const data = event.data, message = event.type === 'user/message' && data?.source?.kind === 'user' ? data : event.type === 'assistant/message' ? data?.message : null;
  if (!message || !['user', 'assistant'].includes(message.role)) return null;
  const visible = text(message.content), turn = turnId(data.turn);
  const time = Number.isSafeInteger(event.time) && event.time >= 0 && event.time <= 8.64e15 ? event.time : Date.now();
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
