const keyFor = (scope: string) => `mobileCodexReadingPositionsV1:${scope}`;
export function loadReadingPositions(scope: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (!raw || raw.length > 65536) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, top]) => id.length <= 1024 && typeof top === "number" && Number.isFinite(top) && top >= 0).slice(-64));
  } catch { return {}; }
}
export function saveReadingPositions(scope: string, positions: Record<string, number>) {
  try { localStorage.setItem(keyFor(scope), JSON.stringify(Object.fromEntries(Object.entries(positions).slice(-64)))); }
  catch { /* Reading position is expendable; the independent input cache is not. */ }
}
