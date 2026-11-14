import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Loader2, RefreshCcw, Undo2 } from "lucide-react";
import { appVersionCode, appVersionLabel, updateManifestUrl } from "../../app/config";
import type { AndroidUpdateManifest } from "../../app/types";
import { apiGet, toFriendlyFetchError } from "../connection/http";
import { apkBusy, apkCanContinue, readAndroidUpdateManifest } from "../updates/apk";
import { ApkUpdateProgress } from "../updates/ApkUpdateProgress";
import { useApkUpdate } from "../updates/useApkUpdate";
import { useHotUpdate } from "../updates/hotUpdate";
import { isKelivoHost, productBeforeNavigate } from "./host";
import { productDisplayName, productVersionCode as kelivoVersionCode, productVersionLabel as kelivoVersionLabel } from "./identity";

const productVersionCode = isKelivoHost ? kelivoVersionCode : appVersionCode;
const productVersionLabel = isKelivoHost ? kelivoVersionLabel : appVersionLabel;

export function ProductUpdatesPage({ onBack }: { onBack: () => void }) {
  const apk = useApkUpdate();
  const [manifest, setManifest] = useState<AndroidUpdateManifest | null>(null);
  const [checking, setChecking] = useState(false), [checked, setChecked] = useState(false), [error, setError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const request = useRef<AbortController | null>(null);
  const busy = apk.pending || apkBusy(apk.status);
  const ready = apkCanContinue(apk.status);
  const available = Boolean(manifest && manifest.versionCode > (apk.status?.nativeVersionCode ?? productVersionCode));

  const check = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true); setError("");
    try {
      const next = await readAndroidUpdateManifest(updateManifestUrl, url => apiGet(url, undefined, controller.signal));
      if (!controller.signal.aborted) { setManifest(next); setChecked(true); }
    } catch (failure) {
      if (!controller.signal.aborted) { setManifest(null); setError(toFriendlyFetchError(failure)); }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setChecking(false); }
    }
  }, []);

  useEffect(() => {
    void check();
    return () => { request.current?.abort(); request.current = null; };
  }, [check]);
  useEffect(() => {
    const beforeNavigate = (event: Event) => {
      if (busy) {
        event.preventDefault();
        setNavigationError("请等待更新包下载、校验或系统安装确认完成后再切换。");
      }
    };
    window.addEventListener(productBeforeNavigate, beforeNavigate);
    if (!busy) setNavigationError("");
    return () => window.removeEventListener(productBeforeNavigate, beforeNavigate);
  }, [busy]);

  return <main className="product-updates-page">
    <header className="product-updates-header">
      <button className="icon-button" aria-label="返回设置" onClick={onBack}><ArrowLeft size={24} /></button>
      <h1>应用更新</h1>
    </header>
    <div className="product-updates-body">
      <section className="product-update-card" aria-label="应用版本">
        <span className="product-update-icon"><Download size={28} /></span>
        <h2>{productDisplayName}</h2>
        <p>当前版本 {productVersionLabel}</p>
        <p className="product-update-summary" role="status">{checking ? "正在检查新版本…" : error ? "暂时无法检查更新" : available ? `发现新版本 v${manifest?.versionName}` : checked ? "当前已是最新版本" : "尚未检查更新"}</p>
      </section>
      {manifest?.notes && <section className="product-update-card"><h2>版本说明</h2><p className="product-update-notes">{manifest.notes}</p></section>}
      {error && <p className="update-note" role="alert">检查更新失败：{error}</p>}
      <ApkUpdateProgress status={apk.status} error={apk.error} />
      {navigationError && <p className="update-note" role="alert">{navigationError}</p>}
      <div className="product-update-actions">
        <button className="action-button" onClick={() => void check()} disabled={checking || busy}>
          {checking ? <Loader2 size={18} className="spin" /> : <RefreshCcw size={18} />}<span>{checking ? "检查中…" : "检查更新"}</span>
        </button>
        <button className="action-button primary" disabled={!apk.supported || checking || busy || (!available && !ready)} onClick={() => void apk.start(manifest)}>
          {busy ? <Loader2 size={18} className="spin" /> : <Download size={18} />}<span>{apk.status?.phase === "permission_required" ? "允许安装并继续" : ready ? "继续安装" : "下载并安装"}</span>
        </button>
      </div>
      {!isKelivoHost && <HotUpdateCard nativeVersionCode={apk.status?.nativeVersionCode ?? productVersionCode} />}
      <p className="product-update-help">更新会保留应用内的设置和数据。下载完成后，由 Android 系统确认安装；首次更新可能需要允许安装此应用的更新。</p>
      {!apk.supported && <p className="update-note" role="alert">请在 Android App 内使用下载与安装功能。</p>}
    </div>
  </main>;
}

/** Web-only changes arrive without reinstalling; they start on the next launch. */
function HotUpdateCard({ nativeVersionCode }: { nativeVersionCode: number }) {
  const hot = useHotUpdate(nativeVersionCode);
  if (!hot.enabled) return null;
  const active = hot.status?.activeVersion;
  const summary = hot.checking ? "正在检查界面更新…"
    : hot.error ? "暂时无法检查界面更新"
    : hot.staged ? `界面更新 ${hot.manifest?.version} 已下载，下次打开应用时生效`
    : hot.current ? "界面已是最新"
    : hot.available ? `发现界面更新 ${hot.manifest?.version}`
    : hot.manifest && hot.manifest.minNativeVersionCode > nativeVersionCode ? "有新的界面更新，需要先安装上面的新版应用"
    : "界面已是最新";
  return <section className="product-update-card" aria-label="界面更新">
    <h2>界面更新</h2>
    <p>当前界面 {active || "安装包内置"}</p>
    <p className="product-update-summary" role="status">{summary}</p>
    {hot.manifest?.notes && (hot.available || hot.staged) && <p className="product-update-notes">{hot.manifest.notes}</p>}
    {hot.error && <p className="update-note" role="alert">{hot.error}</p>}
    <div className="product-update-actions">
      {hot.staged ? <button className="action-button primary" disabled={hot.busy} onClick={() => void hot.applyNow()}>{hot.busy ? <Loader2 size={18} className="spin" /> : <RefreshCcw size={18} />}<span>立即生效</span></button>
        : hot.available ? <button className="action-button primary" disabled={hot.busy || hot.checking} onClick={() => void hot.download()}>{hot.busy ? <Loader2 size={18} className="spin" /> : <Download size={18} />}<span>下载界面更新</span></button>
        : <button className="action-button" disabled={hot.busy || hot.checking} onClick={() => void hot.check()}>{hot.checking ? <Loader2 size={18} className="spin" /> : <RefreshCcw size={18} />}<span>重新检查</span></button>}
      {active && <button className="action-button" disabled={hot.busy} onClick={() => void hot.rollback()}><Undo2 size={18} /><span>退回上一版界面</span></button>}
    </div>
  </section>;
}
