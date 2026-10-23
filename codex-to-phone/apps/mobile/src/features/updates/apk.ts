import { type AndroidUpdateManifest } from "../../app/types";

export const maxApkBytes = 128 * 1024 * 1024;

export type ApkPhase = "idle" | "downloading" | "verifying" | "ready" | "permission_required" | "awaiting_install" | "error";
export type ApkUpdateStatus = {
  supported: boolean;
  revision: number;
  phase: ApkPhase;
  receivedBytes: number;
  totalBytes: number;
  versionCode: number;
  versionName: string;
  nativeVersionCode: number;
  canInstall: boolean;
  error: string;
};

export type ApkUpdatePlugin = {
  getStatus(): Promise<ApkUpdateStatus>;
  downloadAndInstall(options: { url: string; sha256: string; size: number; versionCode: number }): Promise<ApkUpdateStatus>;
  install(): Promise<ApkUpdateStatus>;
  addListener(event: "progress", callback: (status: ApkUpdateStatus) => void): Promise<{ remove(): Promise<void> }>;
};

export function parseAndroidUpdateManifest(value: unknown): AndroidUpdateManifest {
  const data = value as Partial<AndroidUpdateManifest> | null;
  if (!data || data.platform !== "android" || typeof data.versionName !== "string" || !data.versionName.trim()
    || !Number.isSafeInteger(data.versionCode) || data.versionCode! <= 0 || data.versionCode! > 2_147_483_647
    || !Number.isSafeInteger(data.size) || data.size! <= 0 || data.size! > maxApkBytes
    || typeof data.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(data.sha256)
    || typeof data.apkUrl !== "string") throw new Error("更新清单不完整或无效，请稍后重试");
  let url: URL;
  try { url = new URL(data.apkUrl); } catch { throw new Error("更新包下载地址无效"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("更新包下载地址必须使用 HTTPS");
  }
  return { platform: "android", versionCode: data.versionCode!, versionName: data.versionName.trim(), apkUrl: url.href,
    size: data.size!, sha256: data.sha256.toLowerCase(), notes: typeof data.notes === "string" ? data.notes : undefined,
    mandatory: data.mandatory === true, publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : undefined };
}

export function newerApkStatus(current: ApkUpdateStatus | null, incoming: ApkUpdateStatus): ApkUpdateStatus {
  return current && current.revision > incoming.revision ? current : incoming;
}

export function apkBusy(status: ApkUpdateStatus | null): boolean {
  return status?.phase === "downloading" || status?.phase === "verifying" || status?.phase === "awaiting_install";
}

export function apkCanContinue(status: ApkUpdateStatus | null): boolean {
  return status?.phase === "ready" || status?.phase === "permission_required" || status?.phase === "awaiting_install";
}

export function apkProgress(status: ApkUpdateStatus): number {
  return status.totalBytes > 0 ? Math.min(100, Math.max(0, Math.floor(status.receivedBytes / status.totalBytes * 100))) : 0;
}

export function apkStatusText(status: ApkUpdateStatus | null): string {
  if (!status) return "";
  switch (status.phase) {
    case "downloading": return `正在下载 ${apkProgress(status)}%`;
    case "verifying": return "正在校验更新包";
    case "permission_required": return "需要允许安装此应用的更新";
    case "awaiting_install": return "请在系统页面确认安装";
    case "ready": return "更新包已下载，可继续安装";
    case "error": return "更新失败，可重试";
    default: return "";
  }
}

// Subscribe first, then read the snapshot. A delayed snapshot must not undo newer progress.
export async function watchApkUpdate(plugin: ApkUpdatePlugin, receive: (status: ApkUpdateStatus) => void): Promise<() => Promise<void>> {
  const listener = await plugin.addListener("progress", receive);
  try { receive(await plugin.getStatus()); }
  catch (error) { await listener.remove(); throw error; }
  return () => listener.remove();
}
