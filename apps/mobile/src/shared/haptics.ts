/**
 * U7: a short tap when sending and when deciding an approval. Uses the Vibration API, which the
 * Android host allows (VIBRATE permission); silently does nothing where unsupported or turned off.
 */
const key = "mobile-codex.haptics";
export type HapticKind = "tap" | "confirm" | "warn";
export const hapticPatterns: Record<HapticKind, number | number[]> = { tap: 8, confirm: 14, warn: [12, 48, 12] };

export function hapticsEnabled() {
  try { return localStorage.getItem(key) !== "off"; } catch { return true; }
}

export function setHapticsEnabled(enabled: boolean) {
  try { localStorage.setItem(key, enabled ? "on" : "off"); } catch { /* storage unavailable: keep the default */ }
}

export function haptic(kind: HapticKind = "tap") {
  if (!hapticsEnabled()) return;
  try { (globalThis.navigator as Navigator | undefined)?.vibrate?.(hapticPatterns[kind]); } catch { /* unsupported */ }
}
