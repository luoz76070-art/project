import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import { apiGet, buildUrl } from "../connection/http";

/** F1: system notifications for work the phone sent to the computer (finished / needs approval). */
export type NotifySettings = { finished: boolean; approvals: boolean };
export type NotifyPermission = "granted" | "denied" | "prompt";
type NativeState = { permission: NotifyPermission; running: boolean };
type AttentionNative = {
  configure(options: { endpoint: string; token: string } & NotifySettings): Promise<NativeState>;
  start(): Promise<NativeState & { started: boolean }>;
  stop(): Promise<void>;
  setViewing(options: { key: string | null }): Promise<void>;
  permission(): Promise<NativeState>;
  requestPermission(): Promise<NativeState>;
  openSettings(): Promise<void>;
  addListener(event: "open", listener: (value: { key: string; title?: string | null }) => void): Promise<PluginListenerHandle>;
};
type AttentionItem = { key: string; running: boolean; requests: unknown[] };

export const Attention = registerPlugin<AttentionNative>("Attention");
export const notifySettingsKey = "mobicodexNotifyV1";
const askedKey = "mobicodexNotifyAsked", changedEvent = "mobicodex-notify-settings";
export const defaultNotifySettings: NotifySettings = { finished: true, approvals: true };

export function attentionAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Attention");
}
export function loadNotifySettings(): NotifySettings {
  try {
    const value = JSON.parse(localStorage.getItem(notifySettingsKey) ?? "null") as Partial<NotifySettings> | null;
    return { finished: value?.finished !== false, approvals: value?.approvals !== false };
  } catch { return { ...defaultNotifySettings }; }
}
export function saveNotifySettings(value: NotifySettings) {
  try { localStorage.setItem(notifySettingsKey, JSON.stringify(value)); } catch { /* In-memory value still applies this session. */ }
  window.dispatchEvent(new Event(changedEvent));
}

/** Same keys as the gateway's attentionKey(). */
export function codexAttentionKey(threadId: string, desktop: boolean) { return `${desktop ? "desktop" : "live"}:${threadId}`; }
export function agentAttentionKey(agentId: string, sessionId: string) { return `agent:${agentId}:${sessionId}`; }
export function parseAttentionKey(key: string): { agentId: string; sessionId: string } | null {
  const [source, ...rest] = key.split(":");
  if ((source === "desktop" || source === "live") && rest.join(":")) return { agentId: "codex", sessionId: rest.join(":") };
  if (source === "agent" && rest.length >= 2 && rest[0] && rest.slice(1).join(":")) return { agentId: rest[0], sessionId: rest.slice(1).join(":") };
  return null;
}
export function setAttentionViewing(key: string | null) {
  if (attentionAvailable()) void Attention.setViewing({ key }).catch(() => undefined);
}

/** After the phone sends work: ask for permission once, then keep the stream open while it runs. */
export async function attentionAfterSend() {
  if (!attentionAvailable()) return;
  const settings = loadNotifySettings();
  if (!settings.finished && !settings.approvals) return;
  try {
    let state = await Attention.permission();
    if (state.permission === "prompt" && !localStorage.getItem(askedKey)) {
      localStorage.setItem(askedKey, "1");
      state = await Attention.requestPermission();
    }
    if (state.permission === "granted") await Attention.start();
  } catch { /* Notifications are a convenience; sending already succeeded. */ }
}

/**
 * Outer app: keep the native service configured for the current connection, restart it on resume
 * when the computer still has work for this phone, and open the thread a notification was tapped for.
 */
export function useAttention(endpoint: string, token: string, open: (target: { agentId: string; sessionId: string; title: string }) => void) {
  useEffect(() => {
    if (!attentionAvailable()) return;
    let cancelled = false;
    const configure = () => { void Attention.configure({ endpoint, token, ...loadNotifySettings() }).catch(() => undefined); };
    const resume = async () => {
      if (document.visibilityState !== "visible" || !endpoint || !token) return;
      try {
        const { items } = await apiGet<{ items: AttentionItem[] }>(buildUrl(endpoint, "/api/attention"), token);
        const settings = loadNotifySettings();
        if (!cancelled && (settings.finished || settings.approvals) && items.some(item => item.running || item.requests.length)) {
          if ((await Attention.permission()).permission === "granted") await Attention.start();
        }
      } catch { /* Older gateways have no /api/attention; nothing to resume. */ }
    };
    configure(); void resume();
    window.addEventListener(changedEvent, configure);
    document.addEventListener("visibilitychange", resume);
    return () => { cancelled = true; window.removeEventListener(changedEvent, configure); document.removeEventListener("visibilitychange", resume); };
  }, [endpoint, token]);
  useEffect(() => {
    if (!attentionAvailable()) return;
    let handle: PluginListenerHandle | undefined, active = true;
    Attention.addListener("open", value => {
      const target = parseAttentionKey(value.key);
      if (target) open({ ...target, title: value.title || "" });
    }).then(value => { if (active) handle = value; else void value.remove(); }).catch(() => undefined);
    return () => { active = false; void handle?.remove(); };
  }, [open]);
}

/** Settings page: the two switches and the system permission state. */
export function useNotifySettings() {
  const [settings, setSettings] = useState(loadNotifySettings);
  const [permission, setPermission] = useState<NotifyPermission | null>(null);
  const refresh = useCallback(() => {
    if (attentionAvailable()) void Attention.permission().then(state => setPermission(state.permission)).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh]);
  const change = useCallback((patch: Partial<NotifySettings>) => {
    setSettings(current => { const next = { ...current, ...patch }; saveNotifySettings(next); return next; });
  }, []);
  const allow = useCallback(async () => {
    if (!attentionAvailable()) return;
    try {
      if (permission === "denied") { await Attention.openSettings(); return; }
      localStorage.setItem(askedKey, "1");
      setPermission((await Attention.requestPermission()).permission);
    } catch { refresh(); }
  }, [permission, refresh]);
  return { available: attentionAvailable(), settings, change, permission, allow };
}
