const contextKey = "mobileCodexVoiceContextV1";
let current: boolean | undefined;

export function voiceContextEnabled(): boolean {
  if (current !== undefined) return current;
  try { return localStorage.getItem(contextKey) !== "false"; }
  catch { return false; }
}

export function setVoiceContextEnabled(enabled: boolean) {
  current = enabled;
  try { localStorage.setItem(contextKey, String(enabled)); }
  catch { /* Keep the privacy choice for this process even if storage is unavailable. */ }
}
