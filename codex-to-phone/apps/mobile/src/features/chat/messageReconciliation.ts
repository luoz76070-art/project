export type ReconciliationMessage = {
  id: string;
  timestamp: string;
  role: string;
  text: string;
  kind: string;
  clientMessageId?: string;
  sourceItemId?: string;
  nativeMessageId?: string;
  turnId?: string;
  phase?: "commentary" | "final_answer";
  attachments?: unknown;
};

const mirrorWindowMs = 1_500;
const optimisticMatchWindowMs = 120_000;

export function reconcileMessages<T extends ReconciliationMessage>(current: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const message of [...current, ...incoming]) {
    const existing = byId.get(message.id);
    byId.set(message.id, existing ? mergeSameMessage(existing, message) : message);
  }

  return collapseMirroredMessages(reconcileOptimisticMessages(sortMessages([...byId.values()])));
}

export function collapseMirroredMessages<T extends ReconciliationMessage>(messages: T[]): T[] {
  const rendered: T[] = [];
  const submissions = new Map<string, number>();
  const sourceItems = new Map<string, number>();
  const nativeItems = new Map<string, number>();
  for (const message of sortMessages(messages)) {
    const submission = clientMessageIdentity(message);
    const sourceItem = sourceItemIdentity(message);
    const nativeItem = nativeMessageIdentity(message);
    const duplicateIndex = (submission ? submissions.get(submission) : undefined) ?? (sourceItem ? sourceItems.get(sourceItem) : undefined) ?? (nativeItem ? nativeItems.get(nativeItem) : undefined) ?? findMirroredMessage(rendered, message);
    if (duplicateIndex < 0) {
      if (submission) submissions.set(submission, rendered.length);
      if (sourceItem) sourceItems.set(sourceItem, rendered.length);
      if (nativeItem) nativeItems.set(nativeItem, rendered.length);
      rendered.push(message);
      continue;
    }
    rendered[duplicateIndex] = mergeSameMessage(rendered[duplicateIndex], message);
    if (submission) submissions.set(submission, duplicateIndex);
    if (sourceItem) sourceItems.set(sourceItem, duplicateIndex);
    if (nativeItem) nativeItems.set(nativeItem, duplicateIndex);
  }
  return sortMessages(reconcileDesktopUserSources(rendered));
}

function isDesktopUserItem(message: ReconciliationMessage): boolean {
  return message.role === "user" && message.kind === "userMessage" && Boolean(message.turnId)
    && (message.id.startsWith("desktop-") || message.id === `${message.turnId}-input`);
}

function reconcileDesktopUserSources<T extends ReconciliationMessage>(messages: T[]): T[] {
  const groups = new Map<string, { native: number[]; history: number[] }>();
  messages.forEach((message, index) => {
    if (message.role !== "user" || !message.turnId || isOptimisticUserMessage(message)) return;
    const native = isDesktopUserItem(message) && !message.sourceItemId;
    const history = ["message", "user_message"].includes(message.kind) && message.sourceItemId && !clientMessageIdentity(message) && !message.nativeMessageId;
    if (!native && !history) return;
    const key = JSON.stringify([message.turnId, message.text.trim()]);
    const group = groups.get(key) ?? { native: [], history: [] };
    group[native ? "native" : "history"].push(index);
    groups.set(key, group);
  });
  const removed = new Set<number>();
  const replacements = new Map<number, T>();
  for (const group of groups.values()) {
    // Both ordered sources must cover the same occurrences. A partial page is
    // ambiguous; keeping it is safer than assigning another input's identity.
    if (!group.native.length || group.native.length !== group.history.length) continue;
    group.native.forEach((nativeIndex, occurrence) => {
      const historyIndex = group.history[occurrence];
      removed.add(nativeIndex);
      replacements.set(historyIndex, mergeSameMessage(messages[nativeIndex], messages[historyIndex]));
    });
  }
  return messages.map((message, index) => replacements.get(index) ?? message).filter((_, index) => !removed.has(index));
}

export function stripCodexAppDirectives(text: string): string {
  const lines = text.split(/\r?\n/u);
  const visible: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      visible.push(line);
      continue;
    }
    if (!inFence && /^\s*::[a-z][a-z0-9-]*\{.*\}\s*$/iu.test(line)) continue;
    visible.push(line);
  }

  return visible.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function reconcileOptimisticMessages<T extends ReconciliationMessage>(messages: T[]): T[] {
  const removed = new Set<number>();
  const usedPersisted = new Set<number>();
  const replacements = new Map<number, T>();

  for (let optimisticIndex = 0; optimisticIndex < messages.length; optimisticIndex += 1) {
    const optimistic = messages[optimisticIndex];
    if (!isOptimisticUserMessage(optimistic)) continue;

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let persistedIndex = 0; persistedIndex < messages.length; persistedIndex += 1) {
      if (persistedIndex === optimisticIndex || usedPersisted.has(persistedIndex)) continue;
      const persisted = messages[persistedIndex];
      if (!isPersistedUserMessage(persisted)) continue;
      const optimisticIdentity = clientMessageIdentity(optimistic);
      const persistedIdentity = clientMessageIdentity(persisted);
      if (optimisticIdentity && persistedIdentity) {
        if (optimisticIdentity !== persistedIdentity) continue;
        bestIndex = persistedIndex;
        break;
      }
      if (normalizedText(persisted.text) !== normalizedText(optimistic.text)) continue;

      const distance = timestampDistance(optimistic, persisted);
      if (distance > optimisticMatchWindowMs) continue;
      if (hasAssistantBetween(messages, optimisticIndex, persistedIndex)) continue;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      bestIndex = persistedIndex;
    }

    if (bestIndex < 0) continue;
    removed.add(optimisticIndex);
    usedPersisted.add(bestIndex);
    replacements.set(bestIndex, mergeSameMessage(optimistic, messages[bestIndex]));
  }

  return messages
    .map((message, index) => replacements.get(index) ?? message)
    .filter((_, index) => !removed.has(index));
}

function findMirroredMessage<T extends ReconciliationMessage>(rendered: T[], incoming: T): number {
  const start = Math.max(0, rendered.length - 4);
  for (let index = rendered.length - 1; index >= start; index -= 1) {
    const current = rendered[index];
    if (current.id === incoming.id) return index;
    const currentItem = sourceItemIdentity(current), incomingItem = sourceItemIdentity(incoming);
    if (currentItem && incomingItem && currentItem !== incomingItem) continue;
    const currentIdentity = clientMessageIdentity(current), incomingIdentity = clientMessageIdentity(incoming);
    if (currentIdentity && incomingIdentity && currentIdentity !== incomingIdentity) continue;
    if (isExactEventCopy(current, incoming)) return index;
    if (!isKnownMirrorPair(current, incoming)) continue;
    if (timestampDistance(current, incoming) > mirrorWindowMs) continue;
    if (!sameOrIncrementalText(current, incoming)) continue;
    return index;
  }
  return -1;
}

function isExactEventCopy(current: ReconciliationMessage, incoming: ReconciliationMessage): boolean {
  return (
    current.role === incoming.role &&
    current.kind === incoming.kind &&
    current.timestamp === incoming.timestamp &&
    normalizedText(current.text) === normalizedText(incoming.text)
  );
}

function isKnownMirrorPair(current: ReconciliationMessage, incoming: ReconciliationMessage): boolean {
  if (current.role !== incoming.role || isOptimisticUserMessage(current) || isOptimisticUserMessage(incoming)) return false;
  const pair = new Set([current.kind, incoming.kind]);
  if (current.role === "user") {
    return pair.has("message") && (pair.has("user_message") || pair.has("userMessage"));
  }
  if (current.role === "assistant") {
    return pair.has("message") && (pair.has("agent_message") || pair.has("agentMessage"));
  }
  return false;
}

function sameOrIncrementalText(current: ReconciliationMessage, incoming: ReconciliationMessage): boolean {
  const currentText = normalizedText(current.text);
  const incomingText = normalizedText(incoming.text);
  if (!currentText || !incomingText) return false;
  if (currentText === incomingText) return true;
  if (current.role !== "assistant") return false;
  const shorter = currentText.length <= incomingText.length ? currentText : incomingText;
  const longer = currentText.length > incomingText.length ? currentText : incomingText;
  return shorter.length >= 24 && longer.startsWith(shorter);
}

function mergeSameMessage<T extends ReconciliationMessage>(current: T, incoming: T): T {
  const preferred = preferredMessage(current, incoming);
  const attachments = incoming.attachments ?? current.attachments;
  const clientMessageId = preferred.clientMessageId ?? incoming.clientMessageId ?? current.clientMessageId;
  const sourceItemId = preferred.sourceItemId ?? assistantItemIdentity(preferred) ?? incoming.sourceItemId ?? assistantItemIdentity(incoming) ?? current.sourceItemId ?? assistantItemIdentity(current);
  const turnId = preferred.turnId ?? incoming.turnId ?? current.turnId;
  const nativeMessageId = nativeMessageIdentity(preferred) ?? nativeMessageIdentity(current) ?? nativeMessageIdentity(incoming);
  const phase = preferred.phase ?? incoming.phase ?? current.phase;
  return {
    ...preferred,
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(sourceItemId ? { sourceItemId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(nativeMessageId ? { nativeMessageId } : {}),
    ...(phase ? { phase } : {}),
    ...(attachments === undefined ? {} : { attachments }),
  } as T;
}

function preferredMessage<T extends ReconciliationMessage>(current: T, incoming: T): T {
  if (isOptimisticUserMessage(current) && !isOptimisticUserMessage(incoming)) return incoming;
  if (isOptimisticUserMessage(incoming) && !isOptimisticUserMessage(current)) return current;
  if (current.role === "user" && current.turnId && current.turnId === incoming.turnId) {
    if (isDesktopUserItem(current) && incoming.sourceItemId) return incoming;
    if (isDesktopUserItem(incoming) && current.sourceItemId) return current;
  }
  if (incoming.text.length > current.text.length) return incoming;
  if (incoming.text === current.text && assistantItemIdentity(current) && assistantItemIdentity(current) === assistantItemIdentity(incoming) && incoming.kind === "message") return incoming;
  return current;
}

function assistantItemIdentity(message: ReconciliationMessage): string | null {
  if (message.role !== "assistant") return null;
  if (message.sourceItemId) return message.sourceItemId;
  // APK26 and earlier native snapshots already embedded the original item ID.
  return /^desktop-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/iu.exec(message.id)?.[1] ?? null;
}

function sourceItemIdentity(message: ReconciliationMessage): string | null {
  if (message.role === "user") return message.sourceItemId ? `user:${message.sourceItemId}` : isDesktopUserItem(message) ? `native-user:${message.id}` : null;
  const identity = assistantItemIdentity(message);
  return identity ? `assistant:${identity}` : null;
}

function nativeMessageIdentity(message: ReconciliationMessage): string | null {
  if (message.role !== "user") return null;
  return message.nativeMessageId ?? (isDesktopUserItem(message) ? message.id : null);
}

function isPersistedUserMessage(message: ReconciliationMessage): boolean {
  return message.role === "user" && !isOptimisticUserMessage(message);
}

function clientMessageIdentity(message: ReconciliationMessage): string | null {
  if (message.role !== "user") return null;
  if (message.clientMessageId) return message.clientMessageId;
  // Recover identities from already cached native placeholders made by earlier APKs.
  return message.id.startsWith("desktop-local-") ? message.id.slice("desktop-local-".length) || null : null;
}

function isOptimisticUserMessage(message: ReconciliationMessage): boolean {
  return (
    message.role === "user" &&
    (message.kind === "local" ||
      message.kind === "steeringUserMessage" ||
      message.id.startsWith("local-") ||
      message.id.startsWith("desktop-local-") ||
      message.id.startsWith("steer-local-"))
  );
}

function hasAssistantBetween(messages: ReconciliationMessage[], leftIndex: number, rightIndex: number): boolean {
  const start = Math.min(leftIndex, rightIndex) + 1;
  const end = Math.max(leftIndex, rightIndex);
  for (let index = start; index < end; index += 1) {
    if (messages[index].role === "assistant" && messages[index].text.trim()) return true;
  }
  return false;
}

function timestampDistance(current: ReconciliationMessage, incoming: ReconciliationMessage): number {
  const currentTime = Date.parse(current.timestamp);
  const incomingTime = Date.parse(incoming.timestamp);
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(incomingTime - currentTime);
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sortMessages<T extends ReconciliationMessage>(messages: T[]): T[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.message.timestamp);
      const rightTime = Date.parse(right.message.timestamp);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.index - right.index;
    })
    .map((item) => item.message);
}
