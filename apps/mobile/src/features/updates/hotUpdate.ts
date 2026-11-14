import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { hotUpdateManifestUrl } from "../../app/config";
import type { HotUpdateManifest, HotUpdateStatus } from "../../app/types";
import { apiGet, toFriendlyFetchError } from "../connection/http";
import { NativeHotUpdate } from "./native";

const declinedKey = "mobicodexHotUpdateDeclined";
const safeVersion = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

// Mirrors the native check: HTTPS, or plain HTTP to this device for development.
function allowedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  } catch { return false; }
}

export function parseHotManifest(value: unknown): HotUpdateManifest {
  const manifest = value as Partial<HotUpdateManifest> | null;
  const max = manifest?.maxNativeVersionCode;
  if (!manifest || manifest.platform !== "android" || manifest.channel !== "hot"
    || typeof manifest.version !== "string" || !safeVersion.test(manifest.version) || manifest.version.includes("..")
    || typeof manifest.htmlUrl !== "string" || !allowedUrl(manifest.htmlUrl)
    || typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(manifest.sha256)
    || !Number.isInteger(manifest.minNativeVersionCode) || (max !== undefined && (!Number.isInteger(max) || max < (manifest.minNativeVersionCode as number)))) {
    throw new Error("界面更新信息无效");
  }
  return manifest as HotUpdateManifest;
}

export function hotUpdateCompatible(manifest: HotUpdateManifest, nativeVersionCode: number) {
  return nativeVersionCode >= manifest.minNativeVersionCode && nativeVersionCode <= (manifest.maxNativeVersionCode ?? 2_147_483_647);
}

async function readHotManifest(signal?: AbortSignal) {
  return parseHotManifest(await apiGet<unknown>(`${hotUpdateManifestUrl}?t=${Date.now()}`, undefined, signal));
}

function declined() { try { return localStorage.getItem(declinedKey) ?? ""; } catch { return ""; } }

/** Downloads a compatible web bundle in the background; it starts on the next launch. */
export async function stageHotUpdate(nativeVersionCode: number) {
  if (!Capacitor.isNativePlatform() || !hotUpdateManifestUrl) return null;
  try {
    const [manifest, status] = await Promise.all([readHotManifest(), NativeHotUpdate.getStatus()]);
    if (!status.supported || status.nativeVersionCode !== nativeVersionCode || !hotUpdateCompatible(manifest, nativeVersionCode)) return null;
    if ([status.activeVersion, status.stagedVersion, status.previousVersion, declined()].includes(manifest.version)) return null;
    await NativeHotUpdate.stage({ url: manifest.htmlUrl, sha256: manifest.sha256, version: manifest.version, minNativeVersionCode: manifest.minNativeVersionCode, maxNativeVersionCode: manifest.maxNativeVersionCode ?? 2_147_483_647 });
    return manifest.version;
  } catch {
    return null;
  }
}

type HotState = { checking: boolean; busy: boolean; manifest: HotUpdateManifest | null; status: HotUpdateStatus | null; error: string };

export function useHotUpdate(nativeVersionCode: number) {
  const enabled = Capacitor.isNativePlatform() && Boolean(hotUpdateManifestUrl);
  const [state, setState] = useState<HotState>({ checking: false, busy: false, manifest: null, status: null, error: "" });
  const request = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    if (!enabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState(current => ({ ...current, checking: true, error: "" }));
    try {
      const [manifest, status] = await Promise.all([readHotManifest(controller.signal), NativeHotUpdate.getStatus()]);
      if (!controller.signal.aborted) setState(current => ({ ...current, checking: false, manifest, status }));
    } catch (failure) {
      if (!controller.signal.aborted) setState(current => ({ ...current, checking: false, error: toFriendlyFetchError(failure) }));
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [enabled]);
  useEffect(() => {
    void check();
    return () => { request.current?.abort(); request.current = null; };
  }, [check]);
  async function run(action: () => Promise<unknown>) {
    setState(current => ({ ...current, busy: true, error: "" }));
    try {
      await action();
      const status = await NativeHotUpdate.getStatus();
      setState(current => ({ ...current, busy: false, status }));
    } catch (failure) {
      setState(current => ({ ...current, busy: false, error: toFriendlyFetchError(failure) }));
    }
  }
  const { manifest, status } = state;
  const compatible = Boolean(manifest && hotUpdateCompatible(manifest, nativeVersionCode));
  const staged = Boolean(manifest && status?.stagedVersion === manifest.version);
  const current = Boolean(manifest && status?.activeVersion === manifest.version);
  return {
    ...state, enabled, compatible, staged, current,
    available: compatible && !staged && !current,
    check,
    download: () => manifest && run(async () => {
      try { localStorage.removeItem(declinedKey); } catch { /* Not persisted. */ }
      await NativeHotUpdate.stage({ url: manifest.htmlUrl, sha256: manifest.sha256, version: manifest.version, minNativeVersionCode: manifest.minNativeVersionCode, maxNativeVersionCode: manifest.maxNativeVersionCode ?? 2_147_483_647 });
    }),
    // Both reload the page; drafts are already persisted before navigation.
    applyNow: () => run(() => NativeHotUpdate.applyStaged()),
    rollback: () => run(async () => {
      try { if (status?.activeVersion) localStorage.setItem(declinedKey, status.activeVersion); } catch { /* Not persisted. */ }
      await NativeHotUpdate.rollback();
    }),
  };
}
