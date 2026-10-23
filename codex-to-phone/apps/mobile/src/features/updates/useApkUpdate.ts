import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { NativeApkUpdate } from "./native";
import { apkCanContinue, newerApkStatus, watchApkUpdate, type ApkUpdateStatus } from "./apk";
import { type AndroidUpdateManifest } from "../../app/types";

export function useApkUpdate() {
  const supported = Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ApkUpdate");
  const [status, setStatus] = useState<ApkUpdateStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const receive = (next: ApkUpdateStatus) => { if (mounted.current) setStatus(current => newerApkStatus(current, next)); };

  useEffect(() => {
    mounted.current = true;
    if (!supported) return () => { mounted.current = false; };
    let stop: (() => Promise<void>) | undefined;
    let disposed = false;
    void watchApkUpdate(NativeApkUpdate, next => { if (!disposed) receive(next); }).then(remove => {
      if (disposed) void remove(); else stop = remove;
    }).catch(() => { if (!disposed) setError("无法读取下载状态，请重新打开设置"); });
    const refresh = () => {
      if (document.visibilityState === "visible") void NativeApkUpdate.getStatus().then(receive).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true; mounted.current = false;
      void stop?.();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [supported]);

  async function start(manifest: AndroidUpdateManifest | null) {
    if (!supported || lock.current) return;
    lock.current = true; setPending(true); setError("");
    try {
      if (apkCanContinue(status)) receive(await NativeApkUpdate.install());
      else if (manifest) receive(await NativeApkUpdate.downloadAndInstall({ url: manifest.apkUrl, sha256: manifest.sha256, size: manifest.size, versionCode: manifest.versionCode }));
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "无法启动更新，请重试");
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { supported, status, pending, error, start };
}
