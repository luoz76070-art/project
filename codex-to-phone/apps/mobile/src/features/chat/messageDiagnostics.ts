import { type CodexMessage } from "../../app/types";
import { parseMessageAttachments } from "./attachments";
import { type ThreadMessageCacheSnapshot } from "./runtime";

const limits = { messagesPerStage: 240, groups: 8, records: 40, recentRendered: 8 };
const knownKinds = new Set(["message", "user_message", "userMessage", "local", "steeringUserMessage"]);
type Stage = "runtime" | "rendered" | "cache";
export type DiagnosticDomNode = { id: string | null; text: string; laidOut: boolean; inViewport: boolean };

export function readDiagnosticDom(root: Element | null): DiagnosticDomNode[] {
  return Array.from(root?.querySelectorAll('article[data-message-role="user"]') ?? [], element => {
    const rect = element.getBoundingClientRect();
    return { id: element.getAttribute("data-message-id"), text: element.querySelector(".user-message-text")?.textContent ?? "",
      laidOut: element.getClientRects().length > 0,
      inViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth };
  });
}

function origin(message: CodexMessage) {
  if (message.id === `${message.turnId}-input`) return "native-input";
  if (message.id.startsWith("desktop-local-") || message.id.startsWith("steer-local-") || message.id.startsWith("local-")) return "local";
  if (message.id.startsWith("desktop-")) return "native";
  if (message.id.startsWith("log-")) return "history";
  return "other";
}

// Called only on explicit export. Project only allowlisted metadata; never spread
// a message/runtime into the report, including in failure paths.
export async function makeMessageDiagnostics(input: {
  threadId: string;
  appVersionCode: number;
  runtime: CodexMessage[];
  rendered: CodexMessage[];
  domUserTexts?: string[];
  domNodes?: DiagnosticDomNode[];
  cache: ThreadMessageCacheSnapshot;
}) {
  const capturedAt = new Date().toISOString();
  const threadId = input.threadId, appVersionCode = input.appVersionCode;
  const hashes = new Map<string, Promise<string>>();
  function hash(value: string) {
    let result = hashes.get(value);
    if (!result) {
      result = crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
        .then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join(""));
      hashes.set(value, result);
    }
    return result;
  }
  const identity = (value: unknown) => typeof value === "string" && value ? hash(value) : null;
  function describe(message: CodexMessage, index: number) {
    const display = parseMessageAttachments({ ...message, attachments: Array.isArray(message.attachments)
      ? message.attachments.filter(attachment => attachment && typeof attachment.path === "string" && typeof attachment.fileName === "string") : [] });
    const time = Date.parse(message.timestamp);
    // Capture primitives synchronously, before hashing yields to another frame.
    return {
      index, origin: origin(message), kind: knownKinds.has(message.kind) ? message.kind : "other",
      timestamp: Number.isFinite(time) ? new Date(time).toISOString() : null,
      ids: { id: identity(message.id), client: identity(message.clientMessageId), source: identity(message.sourceItemId), native: identity(message.nativeMessageId), turn: identity(message.turnId) },
      rawText: { sha256: hash(message.text), trimmedSha256: hash(message.text.trim()), length: message.text.length },
      display: { sha256: hash(display.text), length: display.text.length, attachments: display.attachments.length },
    };
  }
  const snapshots = (["runtime", "rendered", "cache"] as const).map(stage => {
    const messages = stage === "cache" ? input.cache.messages : input[stage];
    const start = Math.max(0, messages.length - limits.messagesPerStage);
    return {
      stage, totalMessages: messages.length, totalUserMessages: messages.filter(message => message.role === "user").length,
      omittedMessages: start,
      records: messages.slice(start).flatMap((message, index) => message.role === "user" ? [describe(message, start + index)] : []),
    };
  });
  const domNodes = input.domNodes ?? (input.domUserTexts ?? []).map(text => ({ text, id: null, laidOut: false, inViewport: false }));
  const domStart = Math.max(0, domNodes.length - limits.messagesPerStage);
  const domTotal = domNodes.length, domIdentityAvailable = Boolean(input.domNodes);
  const domSnapshot = domNodes.slice(domStart).map((node, index) => ({ index: domStart + index, sha256: hash(node.text.trim()), length: node.text.trim().length,
    messageId: identity(node.id), laidOut: node.laidOut, inViewport: node.inViewport }));
  const stages = await Promise.all(snapshots.map(async snapshot => ({
    ...snapshot,
    records: await Promise.all(snapshot.records.map(async record => ({
      ...record,
      ids: Object.fromEntries(await Promise.all(Object.entries(record.ids).map(async ([key, value]) => [key, await value]))),
      rawText: { ...record.rawText, sha256: await record.rawText.sha256, trimmedSha256: await record.rawText.trimmedSha256 },
      display: { ...record.display, sha256: await record.display.sha256 },
    }))),
  })));
  type RecordInfo = (typeof stages)[number]["records"][number];
  const groups = new Map<string, { counts: Record<Stage | "dom", number>; records: { stage: Stage; message: RecordInfo }[] }>();
  const emptyGroup = () => ({ counts: { runtime: 0, rendered: 0, cache: 0, dom: 0 }, records: [] as { stage: Stage; message: RecordInfo }[] });
  for (const stage of stages) {
    for (const record of stage.records) {
      if (!record.display.length) continue;
      const group = groups.get(record.display.sha256) ?? emptyGroup();
      group.counts[stage.stage]++;
      group.records.push({ stage: stage.stage, message: record });
      groups.set(record.display.sha256, group);
    }
  }
  const dom = await Promise.all(domSnapshot.map(async record => ({ ...record, sha256: await record.sha256, messageId: await record.messageId })));
  for (const record of dom) {
    if (!record.length) continue;
    const group = groups.get(record.sha256) ?? emptyGroup();
    group.counts.dom++;
    groups.set(record.sha256, group);
  }
  const repeated = [...groups].filter(([, group]) => Object.values(group.counts).some(count => count > 1)).reverse();
  let remaining = limits.records;
  const sameTextGroups = repeated.slice(0, limits.groups).map(([displaySha256, group]) => {
    const records = group.records.slice(0, remaining);
    remaining -= records.length;
    return { displaySha256, counts: group.counts, records, omittedRecords: group.records.length - records.length };
  });
  const rendered = stages.find(stage => stage.stage === "rendered")!;
  const byIdentity = new Map<string, typeof dom>();
  for (const node of dom) if (node.messageId) byIdentity.set(node.messageId, [...(byIdentity.get(node.messageId) ?? []), node]);
  const duplicateNodes = [...byIdentity].filter(([, nodes]) => nodes.length > 1);
  return {
    schema: "mobile-codex-message-diagnostics-v2", capturedAt, appVersionCode,
    threadSha256: await hash(threadId),
    cache: { status: input.cache.status, bodyStorageVersion: 2, inputStorageVersion: 1, messageIdentityVersion: input.cache.messageIdentityVersion, invalidMessageCount: input.cache.invalidMessageCount },
    stages: stages.map(({ stage, totalMessages, totalUserMessages, omittedMessages, records }) => ({ stage, totalMessages, totalUserMessages, analyzedUserMessages: records.length, omittedMessages })),
    sameTextGroups, omittedGroups: Math.max(0, repeated.length - limits.groups),
    recentRendered: rendered.records.slice(-limits.recentRendered), limits,
    dom: { totalUserTextElements: domTotal, omittedElements: domStart, identityAvailable: domIdentityAvailable,
      matchedNodes: dom.filter(node => rendered.records.some(message => message.ids.id === node.messageId)).length,
      distinctIds: byIdentity.size, duplicateIds: duplicateNodes.length,
      duplicates: duplicateNodes.slice(-limits.groups).map(([messageId, nodes]) => ({ messageId, nodes: nodes.length,
        runtime: stages[0].records.filter(message => message.ids.id === messageId).length,
        rendered: rendered.records.filter(message => message.ids.id === messageId).length,
        indexes: nodes.slice(-8).map(node => node.index) })),
      recent: dom.slice(-limits.recentRendered) },
  };
}

export type MessageDiagnosticReport = Awaited<ReturnType<typeof makeMessageDiagnostics>>;
