type CollapsedProjects = Record<string, true>;
const key = (scope: string, agentId: string) => `mobile-codex:project-groups:${scope}:${agentId}`;

function bounded(value: unknown): CollapsedProjects {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([path, collapsed]) => collapsed === true && path.length > 0 && path.length <= 4096).slice(-256));
}

export function loadProjectGroups(scope: string, agentId: string, storage?: Pick<Storage, "getItem">): CollapsedProjects {
  try {
    const raw = (storage ?? localStorage).getItem(key(scope, agentId));
    return raw && raw.length <= 1_100_000 ? bounded(JSON.parse(raw)) : {};
  } catch { return {}; }
}

export function saveProjectGroups(scope: string, agentId: string, value: unknown, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? localStorage).setItem(key(scope, agentId), JSON.stringify(bounded(value))); }
  catch { /* Folding must remain usable when local storage is unavailable. */ }
}
