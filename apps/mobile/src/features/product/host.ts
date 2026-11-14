import { registerPlugin } from "@capacitor/core";
import type { ProductHandoff, HandoffHost } from './handoff';
export const isKelivoHost = import.meta.env.VITE_KELIVO_HOST === "android";
export const productBeforeNavigate = "product-before-navigate";
export const productAppearanceChanged = "product-appearance-changed";
export const productOpenUpdates = "product-open-updates";
export const ProductHost = registerPlugin<HandoffHost & {
  getState(): Promise<{ revision: number; openSettings?: boolean; openUpdates?: boolean; appearance: ProductAppearance; handoff?: ProductHandoff | null; handoffMigration?: { version: 1; id: string; digest: string } }>;
  navigate(options: { tab: "ai" | "settings" }): Promise<void>;
}>("ProductHost");
let openSettings = false;
export function setProductSettingsLaunch(value: boolean) { openSettings = value; }
export function takeProductSettingsLaunch() { const value = openSettings; openSettings = false; return value; }
export type ProductAppearance = { mode?: "system" | "light" | "dark"; dark?: boolean; colors?: Record<string, string>; display?: { chatFontScale?: number; showToolCards?: boolean; showToolResultSummary?: boolean } };
const colors: Record<string, string[]> = {
  background: ["--bg-0"], panel: ["--bg-1", "--panel", "--panel-solid", "--panel-strong"],
  fill: ["--bg-2", "--panel-soft"], text: ["--text"], muted: ["--muted", "--subtle"],
  primary: ["--accent", "--accent-strong"], onPrimary: ["--on-accent"],
  signal: ["--signal"], error: ["--danger"],
  primaryContainer: ["--accent-soft"], outline: ["--border", "--hairline"],
  userBubble: ["--user-bubble"], avatar: ["--avatar-surface"],
  composer: ["--composer-surface", "--process-surface"], composerOutline: ["--composer-outline"],
  secondaryText: ["--subtle"], messageAuthor: ["--message-author"],
  navigationIndicator: ["--navigation-indicator"], navigationText: ["--navigation-text"],
};
export function applyProductAppearance(appearance: ProductAppearance) {
  // Flutter owns the actual palette. Android WebView can report a different
  // prefers-color-scheme even when the device and Flutter are both light.
  const dark = typeof appearance.dark === 'boolean' ? appearance.dark : appearance.mode === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const scale = appearance.display?.chatFontScale;
  document.documentElement.style.setProperty("--remote-chat-scale", typeof scale === "number" && Number.isFinite(scale) ? String(Math.max(0.7, Math.min(2, scale))) : "1");
  document.documentElement.dataset.showToolCards = appearance.display?.showToolCards === false ? "false" : "true";
  document.documentElement.dataset.showToolSummary = appearance.display?.showToolResultSummary === true ? "true" : "false";
  for (const [name, properties] of Object.entries(colors)) for (const property of properties) {
    const value = appearance.colors?.[name];
    if (dark === appearance.dark && typeof value === "string" && /^#[\da-f]{6}$/iu.test(value)) document.documentElement.style.setProperty(property, value);
    else document.documentElement.style.removeProperty(property);
  }
}
export async function navigateProduct(tab: "ai" | "settings") {
  if (!window.dispatchEvent(new Event(productBeforeNavigate, { cancelable: true }))) throw new Error("请先等待当前输入保存或操作完成，再切换入口。");
  await ProductHost.navigate({ tab });
}
