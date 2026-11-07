import fs from "node:fs/promises";
import { readJsonlWindow } from "./jsonl.js";
import { resolveThreadImagePath } from "./threadImages.js";

type Message = { role: string; text: string };
const maxReferences = 2048;
const scanBudget = 8 * 1024 * 1024;

/** Match the phone's Markdown image rendering, excluding fenced/inline code. */
export function assistantImageReferences(cwd: string, messages: readonly Message[], requested?: string) {
  const references = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    let fenced = false;
    for (const line of message.text.split("\n")) {
      if (line.startsWith("```")) { fenced = !fenced; continue; }
      if (fenced || line.length > 8192) continue;
      const parts = line.split(/(`[^`\n]+`|!\[[^\]\n]*\]\(\s*(?:<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+?)\s*\)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g);
      for (const part of parts) {
        const image = /^!\[([^\]\n]*)\]\(\s*(.*?)\s*\)$/u.exec(part);
        if (!image) continue;
        let source = image[2]!.trim();
        if (source.startsWith("<") && source.endsWith(">")) source = source.slice(1, -1).trim();
        if (!source || source.length > 4096) continue;
        try {
          const reference = resolveThreadImagePath(cwd, source);
          references.delete(reference); references.add(reference);
          if (references.size > maxReferences) {
            const oldest = references.values().next().value!;
            references.delete(oldest);
            if (oldest === requested) { references.add(oldest); references.delete(references.values().next().value!); }
          }
        } catch { /* Remote/invalid paths do not grant local file access. */ }
      }
    }
  }
  return references;
}

type Entry = { signature: string; searches: Map<string, number>; references: Set<string>; misses: Set<string>; pending: Promise<void> };
function busy() { return Object.assign(new Error("image_busy"), { statusCode: 429 }); }
async function signature(file: string) {
  const stat = await fs.stat(file);
  return { size: stat.size, value: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` };
}

/** Bounded, lazy lookup over the original rollout; never materialize full history. */
export class RolloutImageReferences {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly messages: (value: unknown, offset: number) => Message[]) {}

  async has(file: string, cwd: string, target: string) {
    const current = await signature(file), key = `${file}\0${cwd}`;
    let entry = this.entries.get(key);
    if (!entry || entry.signature !== current.value) {
      entry = { signature: current.value, searches: new Map(), references: new Set(), misses: new Set(), pending: Promise.resolve() };
    }
    this.entries.delete(key); this.entries.set(key, entry);
    if (this.entries.size > 16) this.entries.delete(this.entries.keys().next().value!);
    const state = entry;
    const result = state.pending.then(() => this.scan(file, cwd, target, state, current.size));
    state.pending = result.then(() => {}, () => {});
    return result;
  }

  private async scan(file: string, cwd: string, target: string, entry: Entry, size: number) {
    let found = entry.references.has(target);
    let before = entry.searches.get(target) ?? size;
    if (!found && !entry.misses.has(target)) {
      let scanned = 0;
      while (!found && before > 0 && scanned < scanBudget) {
        const page = await readJsonlWindow(file, { before, maxBytes: 512_000 });
        scanned += before - page.windowStart;
        if (page.windowStart >= before) throw busy();
        before = page.windowStart;
        for (const record of page.records) {
          const references = assistantImageReferences(cwd, this.messages(record.value, record.offset), target);
          found ||= references.has(target);
          for (const reference of references) {
            entry.references.delete(reference); entry.references.add(reference);
            if (entry.references.size > maxReferences) entry.references.delete(entry.references.values().next().value!);
          }
        }
      }
      if (!found && before === 0) {
        entry.misses.add(target);
        if (entry.misses.size > 128) entry.misses.delete(entry.misses.values().next().value!);
      }
    }
    // Replacement, truncation or appending during a lookup must retry with fresh evidence.
    if ((await signature(file)).value !== entry.signature) throw busy();
    if (!found && before > 0 && !entry.misses.has(target)) {
      entry.searches.set(target, before);
      if (entry.searches.size > 128) entry.searches.delete(entry.searches.keys().next().value!);
      throw busy();
    }
    entry.searches.delete(target);
    if (found) {
      entry.references.delete(target); entry.references.add(target);
      if (entry.references.size > maxReferences) entry.references.delete(entry.references.values().next().value!);
    }
    return found;
  }
}
