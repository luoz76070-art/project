import { apkProgress, apkStatusText, type ApkUpdateStatus } from "./apk";

export function ApkUpdateProgress({ status, error }: { status: ApkUpdateStatus | null; error: string }) {
  const label = apkStatusText(status);
  const detail = error || status?.error;
  if (!label && !detail) return null;
  return <div className="apk-update-progress" role="status" aria-live="polite">
    {label && <p>{label}</p>}
    {status?.phase === "downloading" && <>
      <progress aria-label="更新包下载进度" value={status.receivedBytes} max={status.totalBytes || 1} />
      <span>{(status.receivedBytes / 1048576).toFixed(1)} / {(status.totalBytes / 1048576).toFixed(1)} MiB · {apkProgress(status)}%</span>
    </>}
    {status?.phase === "permission_required" && <p>在系统设置中允许“安装未知应用”，返回后会继续安装。</p>}
    {status?.phase === "awaiting_install" && <p>安装由 Android 系统确认；取消后可返回此处继续。</p>}
    {detail && <p className="apk-update-error">{detail}</p>}
  </div>;
}
