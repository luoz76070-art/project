import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ThemeMode } from "../../app/types";
import { applyProductAppearance } from "./host";

/**
 * The standalone app paints the same computer page the Kelivo host used to
 * colour. These are the MobiCodex palette roles from Kelivo's
 * `lib/theme/palettes.dart`, blended exactly as its `productPalette` did with
 * the default Android settings (no dynamic colour, pure or layered surfaces).
 */
type Scheme = { surface: string; onSurface: string; onSurfaceVariant: string; primary: string; onPrimary: string; primaryContainer: string; tertiary: string; error: string; outline: [string, number] };
const schemes: Record<"light" | "dark", Scheme> = {
  light: { surface: "#f6f4ef", onSurface: "#16181d", onSurfaceVariant: "#5e6066", primary: "#1f2228", onPrimary: "#f5f1ea", primaryContainer: "#e7e3da", tertiary: "#b45309", error: "#b42318", outline: ["#000000", 0x1a / 255] },
  dark: { surface: "#111317", onSurface: "#f5f1ea", onSurfaceVariant: "#b9b6ae", primary: "#f5f1ea", onPrimary: "#16181d", primaryContainer: "#2a2e37", tertiary: "#f59e0b", error: "#f97066", outline: ["#ffffff", 0x1f / 255] },
};
const channels = (value: string) => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
// Flutter's Color.alphaBlend over an opaque surface, rounded like toARGB32().
function over(color: string, alpha: number, surface: string) {
  const front = channels(color), back = channels(surface);
  // Same order as Flutter: blend unit-range components, then scale and round.
  return `#${front.map((value, index) => Math.round((alpha * (value / 255) + (1 - alpha) * (back[index] / 255)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function standalonePalette(dark: boolean): Record<string, string> {
  const s = schemes[dark ? "dark" : "light"], page = s.surface;
  return {
    background: page,
    panel: over("#ffffff", dark ? 0.10 : 0.96, page),
    fill: over(s.onSurface, dark ? 0.16 : 0.05, page),
    text: s.onSurface, muted: s.onSurfaceVariant, secondaryText: s.onSurfaceVariant,
    primary: s.primary, onPrimary: s.onPrimary, primaryContainer: s.primaryContainer,
    signal: s.tertiary, error: s.error,
    userBubble: over(s.primary, dark ? 0.15 : 0.08, page),
    avatar: over(s.primary, 0.1, page),
    composer: over(dark ? s.onSurface : s.primary, dark ? 0.07 : 0.02, page),
    composerOutline: over(dark ? s.onSurface : s.outline[0], dark ? 0.1 : 0.2, page),
    messageAuthor: over(s.onSurface, 0.7, page),
    navigationText: s.onSurface,
    outline: over(s.outline[0], s.outline[1], page),
  };
}

export type ProductDisplay = { chatFontScale: number; showToolCards: boolean; showToolResultSummary: boolean };
export const chatFontScales = [{ value: 0.9, label: "小" }, { value: 1, label: "标准" }, { value: 1.15, label: "大" }, { value: 1.3, label: "特大" }] as const;
export const standaloneAppearanceChanged = "standalone-appearance-changed";
const displayKey = "mobicodexDisplayV1", themeKey = "themeMode";

export function loadProductDisplay(): ProductDisplay {
  let value: Partial<ProductDisplay> = {};
  try { value = JSON.parse(localStorage.getItem(displayKey) ?? "{}") ?? {}; } catch { /* Defaults below. */ }
  const scale = typeof value.chatFontScale === "number" && Number.isFinite(value.chatFontScale) ? Math.max(0.7, Math.min(2, value.chatFontScale)) : 1;
  return { chatFontScale: scale, showToolCards: value.showToolCards !== false, showToolResultSummary: value.showToolResultSummary === true };
}
export function saveProductDisplay(display: ProductDisplay) {
  try { localStorage.setItem(displayKey, JSON.stringify(display)); } catch { /* Applied for this session only. */ }
  window.dispatchEvent(new CustomEvent(standaloneAppearanceChanged, { detail: display }));
}
export function loadThemeMode(): ThemeMode {
  let value: string | null = null;
  try { value = localStorage.getItem(themeKey); } catch { /* System default. */ }
  return value === "light" || value === "dark" ? value : "system";
}
export function saveThemeMode(theme: ThemeMode) {
  try { localStorage.setItem(themeKey, theme); } catch { /* Applied for this session only. */ }
  window.dispatchEvent(new Event(standaloneAppearanceChanged));
}

type SystemAppearance = { dark: boolean };
export const ProductWindow = registerPlugin<{
  getState(): Promise<SystemAppearance>;
  apply(options: { dark: boolean; background: string }): Promise<void>;
  addListener(event: "systemAppearance", listener: (state: SystemAppearance) => void): Promise<PluginListenerHandle>;
}>("ProductWindow");

/** Applies theme, palette and display preferences; follows system dark mode. */
export function startStandaloneAppearance() {
  const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let systemDark = query?.matches ?? false, nativeSystem = false, active = true;
  let handle: PluginListenerHandle | null = null;
  const apply = () => {
    if (!active) return;
    const mode = loadThemeMode(), dark = mode === "dark" || (mode === "system" && systemDark);
    const colors = standalonePalette(dark);
    applyProductAppearance({ mode, dark, colors, display: loadProductDisplay() });
    if (Capacitor.isNativePlatform()) void ProductWindow.apply({ dark, background: colors.background }).catch(() => undefined);
  };
  const fromQuery = () => { if (!nativeSystem && query) { systemDark = query.matches; apply(); } };
  const fromNative = (state: SystemAppearance) => { nativeSystem = true; systemDark = state.dark === true; apply(); };
  apply();
  query?.addEventListener("change", fromQuery);
  window.addEventListener(standaloneAppearanceChanged, apply);
  // The WebView can report a stale prefers-color-scheme; the Activity knows.
  if (Capacitor.isNativePlatform()) {
    ProductWindow.getState().then(fromNative).catch(() => undefined);
    ProductWindow.addListener("systemAppearance", fromNative).then(value => { if (active) handle = value; else void value.remove(); }).catch(() => undefined);
  }
  return () => {
    active = false;
    query?.removeEventListener("change", fromQuery);
    window.removeEventListener(standaloneAppearanceChanged, apply);
    void handle?.remove();
  };
}
