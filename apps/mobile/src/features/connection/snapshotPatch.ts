type Message = { id: string; text: string };
type Snapshot = { messages: Message[] };

/** A sequence gap reconnects the subscription and obtains a fresh full baseline. */
export function createSnapshotReducer<T extends Snapshot>() {
  let seq = 0;
  let baseline: T | null = null;
  return (input: unknown): T => {
    const data = input as T & { seq?: number; baseSeq?: number; partial?: boolean; removedIds?: string[]; textDeltas?: { id: string; append: string }[] };
    if (!data.partial) { seq = data.seq ?? 0; baseline = data; return data; }
    if (!baseline || data.baseSeq !== seq || data.seq !== seq + 1) throw new Error("stream sequence gap");
    const messages = new Map(baseline.messages.map(message => [message.id, message]));
    for (const id of data.removedIds ?? []) messages.delete(id);
    for (const message of data.messages) messages.set(message.id, message);
    for (const patch of data.textDeltas ?? []) {
      const message = messages.get(patch.id);
      if (!message) throw new Error("stream text baseline missing");
      messages.set(patch.id, { ...message, text: message.text + patch.append });
    }
    seq = data.seq;
    baseline = { ...baseline, ...data, messages: [...messages.values()].slice(-240) };
    return baseline;
  };
}
