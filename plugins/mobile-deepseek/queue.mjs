/** Only the one outstanding mobile submission may be exposed or cancelled. */
export function queuedMobileInput(entry, agent) {
  const submission = entry.submission;
  if (!agent || typeof agent.inbox?.remove !== 'function' || !Array.isArray(agent.inbox.nextTurn)
    || submission?.action !== 'message' || submission.deliveryMode !== 'queue' || submission.delivery === 'confirmed') return null;
  const message = agent.inbox.nextTurn.find(item => item.id === submission.messageId);
  if (!message) return null;
  return { messageId: message.id, clientMessageId: submission.clientMessageId,
    text: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 20000),
    status: entry.uncertainQueueId === message.id ? 'uncertain' : agent.status === 'running' ? 'waiting' : 'paused' };
}

export function mobileQueueSnapshot(entry, agent) {
  const available = Boolean(agent && typeof agent.inbox?.remove === 'function' && Array.isArray(agent.inbox.nextTurn));
  const pending = queuedMobileInput(entry, agent);
  return { available, items: pending ? [{ clientMessageId: pending.clientMessageId, text: pending.text, status: pending.status }] : [] };
}
