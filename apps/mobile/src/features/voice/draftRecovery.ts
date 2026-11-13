import { loadThreadRuntimeCache, saveThreadRuntimeCache, getRuntime } from "../chat/runtime";
import { loadAgentDrafts, saveAgentDrafts } from "../agents/runtime";
import { agentDraftParts, composeAgentDraft } from "../agents/drafts";

type Drafts = Record<string, string>;
type Adapter = { read: () => Drafts; write: (value: Drafts) => boolean };
const adapters = new Map<string, Adapter>();
export function registerVoiceAgentDrafts(scope: string, adapter: Adapter) {
  adapters.set(scope, adapter);
  return () => { if (adapters.get(scope) === adapter) adapters.delete(scope); };
}
export function readVoiceAgentDraft(scope: string, thread: string) {
  return agentDraftParts((adapters.get(scope)?.read() ?? loadAgentDrafts(scope))[thread] ?? "").text;
}
export function writeVoiceAgentDraft(scope: string, thread: string, expected: string, text: string) {
  const adapter = adapters.get(scope), drafts = adapter?.read() ?? loadAgentDrafts(scope);
  const input = agentDraftParts(drafts[thread] ?? "");
  if (input.text !== expected) return false;
  const next = composeAgentDraft(text, input.attachments);
  if (next.length > 20_000) return false;
  const updated = { ...drafts, [thread]: next };
  return adapter ? adapter.write(updated) : saveAgentDrafts(scope, updated) && loadAgentDrafts(scope)[thread] === next;
}

type CodexAdapter = { read: (thread: string) => string; write: (thread: string, expected: string, next: string) => boolean };
const codexAdapters = new Map<string, CodexAdapter>();
export function registerVoiceCodexDrafts(scope: string, adapter: CodexAdapter) {
  codexAdapters.set(scope, adapter);
  return () => { if (codexAdapters.get(scope) === adapter) codexAdapters.delete(scope); };
}
export function readVoiceCodexDraft(scope: string, thread: string) {
  return codexAdapters.get(scope)?.read(thread) ?? getRuntime(loadThreadRuntimeCache(scope), thread).draft;
}
export function writeVoiceCodexDraft(scope: string, thread: string, expected: string, next: string) {
  const adapter = codexAdapters.get(scope);
  if (adapter) return adapter.write(thread, expected, next);
  const runtimes = loadThreadRuntimeCache(scope), runtime = getRuntime(runtimes, thread);
  if (runtime.draft !== expected) return false;
  return saveThreadRuntimeCache({ ...runtimes, [thread]: { ...runtime, draft: next } }, scope).status !== "input-failed";
}
