type Message = { id: string; text: string };
type Snapshot = { messages: Message[]; [key: string]: unknown };

export function snapshotSender(send: (event: string, data: unknown) => void, event: string, incremental: boolean) {
  let sequence = 0;
  let previous = new Map<string, { text: string; metadata: string }>();
  return (snapshot: Snapshot) => {
    if (!incremental) { send(event, snapshot); return; }
    const { messages, events: _events, ...metadata } = snapshot;
    const changed: Message[] = [];
    const textDeltas: { id: string; append: string }[] = [];
    const next = new Map<string, { text: string; metadata: string }>();
    for (const message of messages) {
      const { text, ...fields } = message;
      const serialized = JSON.stringify(fields);
      const old = previous.get(message.id);
      if (!old || old.metadata !== serialized || !text.startsWith(old.text)) changed.push(message);
      else if (old.text !== text) textDeltas.push({ id: message.id, append: text.slice(old.text.length) });
      next.set(message.id, { text, metadata: serialized });
    }
    const removedIds = [...previous.keys()].filter(id => !next.has(id));
    const baseSeq = sequence++;
    send(event, baseSeq === 0
      ? { ...metadata, messages, seq: sequence, partial: false, protocolVersion: 1 }
      : { ...metadata, messages: changed, textDeltas, ...(removedIds.length ? { removedIds } : {}), seq: sequence, baseSeq, partial: true, protocolVersion: 1 });
    previous = next;
  };
}
