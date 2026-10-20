import { type ThreadSummary } from "../../app/types";

export function mergeThreads(...groups: ThreadSummary[][]) {
  const seen = new Set<string>();
  const result: ThreadSummary[] = [];
  for (const thread of groups.flat()) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    result.push(thread);
  }
  return result;
}

export function shortPath(value: string) {
  if (value.length <= 44) return value;
  return `...${value.slice(-41)}`;
}

export function cleanTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  return title || "Untitled";
}

export function threadListDetail(thread: ThreadSummary) {
  const detail = pathTail(thread.cwd) || cleanThreadOriginator(thread.originator);
  return isUsefulThreadDetail(detail) ? detail : "";
}

export function groupThreadsByProject(threads: ThreadSummary[]) {
  const groups = new Map<string, { key: string; label: string; threads: ThreadSummary[] }>();
  for (const thread of threads) {
    const key = projectGroupKey(thread.cwd);
    const group = groups.get(key) ?? { key, label: projectGroupLabel(thread.cwd), threads: [] };
    group.threads.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function projectGroupKey(cwd: string | null | undefined) {
  const normalized = normalizePathText(cwd);
  return normalized || "__uncategorized__";
}

export function projectGroupLabel(cwd: string | null | undefined) {
  const normalized = normalizePathText(cwd);
  if (!normalized) return "未分类项目";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || normalized;
}

export function cleanThreadOriginator(value: string | null | undefined) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (/^codex\s+desktop$/i.test(text)) return "";
  return isUsefulThreadDetail(text) ? text : "";
}

export function firstLine(value: string) {
  return value.split(/\r?\n/).find(Boolean)?.trim().slice(0, 80) ?? "";
}

export function pathTail(value: string | null | undefined) {
  const normalized = normalizePathText(value);
  if (!isUsefulThreadDetail(normalized) || normalized === "." || normalized === "~") return "";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const tail = parts.slice(-2).join("\\");
  return isUsefulThreadDetail(tail) ? tail : "";
}

export function normalizePathText(value: string | null | undefined) {
  return String(value || "").replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function isUsefulThreadDetail(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return false;
  return text.replace(/[`'".,，。·•_\-\s\\/]/g, "").length > 1;
}

export function sourceLabel(source: string | null | undefined) {
  if (source === "vscode") return "桌面";
  if (source === "appServer") return "手机";
  if (source === "cli") return "CLI";
  if (source === "exec") return "Exec";
  return "未知";
}

export function sourceClass(source: string | null | undefined) {
  if (source === "vscode") return "desktop";
  if (source === "appServer") return "mobile";
  if (source === "cli" || source === "exec") return "cli";
  return "unknown";
}

export function isDesktopSource(thread: ThreadSummary | null | undefined) {
  return thread?.source === "vscode" || thread?.originator?.toLowerCase().includes("desktop") === true;
}
