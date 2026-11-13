package com.mobilecodex.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdatePlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String phase = "idle", error = "", versionName = "", sha256 = "";
    private long revision = 0, received = 0, size = 0, versionCode = 0, lastProgressAt = 0;
    private boolean working = false, foreground = true, autoInstall = false, externalPaused = false;
    private String externalFlow = "";

    private File root() { return new File(getContext().getCacheDir(), "apk-updates"); }
    private File staging() { return new File(root(), "download.part"); }
    private File ready() { return new File(root(), "update.apk"); }
    private SharedPreferences preferences() { return getContext().getSharedPreferences("apk-update", 0); }

    @Override
    public synchronized void load() {
        SharedPreferences saved = preferences();
        versionCode = saved.getLong("versionCode", 0);
        size = saved.getLong("size", 0);
        sha256 = saved.getString("sha256", "");
        versionName = saved.getString("versionName", "");
        if (versionCode > currentVersion() && ready().isFile() && ready().length() == size && sha256.matches("(?i)[a-f0-9]{64}")) {
            received = size;
            phase = "ready";
        } else {
            clearReady();
        }
        if (staging().exists()) {
            staging().delete();
            if ("idle".equals(phase)) { phase = "error"; error = "上次下载已中断，请重试"; }
        }
    }

    @PluginMethod
    public synchronized void getStatus(PluginCall call) { call.resolve(snapshot()); }

    @PluginMethod
    public synchronized void downloadAndInstall(PluginCall call) {
        if (working || !externalFlow.isEmpty()) { call.resolve(snapshot()); return; }
        String url = call.getString("url");
        String expectedSha = call.getString("sha256");
        // Capacitor's getLong does not coerce JSON Integer values. Both fields fit in an int.
        long expectedSize = call.getInt("size", 0);
        long expectedVersion = call.getInt("versionCode", 0);
        try {
            ApkUpdateDownload.validate(url, expectedSha, expectedSize);
            if (expectedVersion <= currentVersion() || expectedVersion > Integer.MAX_VALUE) throw new IOException("目标版本必须高于当前版本");
        } catch (Exception failure) {
            call.reject(failure.getMessage());
            return;
        }
        boolean cached = expectedVersion == versionCode && expectedSize == size && expectedSha.equalsIgnoreCase(sha256) && ready().isFile();
        working = true;
        autoInstall = true;
        versionCode = expectedVersion;
        size = expectedSize;
        sha256 = expectedSha;
        versionName = "";
        received = cached ? size : 0;
        change(cached ? "verifying" : "downloading", "");
        call.resolve(snapshot());
        executor.execute(() -> {
            try {
                if (!root().isDirectory() && !root().mkdirs()) throw new IOException("无法创建更新缓存目录");
                if (!cached) {
                    preferences().edit().clear().apply();
                    ready().delete();
                    ApkUpdateDownload.download(url, expectedSha, expectedSize, staging(), (bytes, total) -> {
                        synchronized (this) {
                            received = bytes;
                            long now = System.currentTimeMillis();
                            if (bytes == total || now - lastProgressAt >= 200) { lastProgressAt = now; change("downloading", ""); }
                        }
                    });
                    synchronized (this) { change("verifying", ""); }
                    verifyPackage(staging());
                    if (!staging().renameTo(ready())) throw new IOException("无法保存已下载的更新包");
                } else {
                    verifyPackage(ready());
                }
                if (!preferences().edit().putLong("versionCode", versionCode).putLong("size", size)
                    .putString("sha256", sha256).putString("versionName", versionName).commit()) {
                    throw new IOException("无法保存更新状态，请重试");
                }
                getBridge().executeOnMainThread(() -> {
                    synchronized (this) {
                        working = false;
                        change("ready", "");
                        if (foreground && autoInstall) openInstallFlow();
                    }
                });
            } catch (Exception failure) { fail(failure); }
        });
    }

    @PluginMethod
    public synchronized void install(PluginCall call) {
        if (!working && externalFlow.isEmpty()) continueInstall();
        call.resolve(snapshot());
    }

    private synchronized void continueInstall() {
        if (working) return;
        if (!ready().isFile() || versionCode <= currentVersion()) {
            clearReady();
            change("error", "更新包已失效，请重新检查更新");
            return;
        }
        working = true;
        autoInstall = true;
        change("verifying", "");
        executor.execute(() -> {
            try {
                verifyPackage(ready());
                getBridge().executeOnMainThread(() -> {
                    synchronized (this) {
                        working = false;
                        change("ready", "");
                        if (foreground && autoInstall) openInstallFlow();
                    }
                });
            } catch (Exception failure) { fail(failure); }
        });
    }

    private synchronized void openInstallFlow() {
        autoInstall = false;
        externalPaused = false;
        try {
            if (!canInstall()) {
                change("permission_required", "");
                externalFlow = "permission";
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())));
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", ready());
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            externalFlow = "installer";
            change("awaiting_install", "");
            getActivity().startActivity(intent);
        } catch (Exception failure) {
            externalFlow = "";
            change("ready", "无法打开系统安装页面，请重试");
        }
    }

    @Override
    protected synchronized void handleOnPause() {
        foreground = false;
        if (!externalFlow.isEmpty()) externalPaused = true;
    }

    @Override
    protected synchronized void handleOnResume() {
        foreground = true;
        if (externalPaused) {
            String returnedFrom = externalFlow;
            externalFlow = "";
            externalPaused = false;
            if (versionCode <= currentVersion()) { clearReady(); change("idle", ""); return; }
            if ("permission".equals(returnedFrom)) {
                if (canInstall()) continueInstall();
                else change("permission_required", "尚未允许安装，点击下方按钮可继续");
                return;
            }
            change("ready", "安装尚未完成，可再次打开系统安装器");
        } else if (!working && autoInstall && "ready".equals(phase)) {
            continueInstall();
        }
    }

    @Override
    protected void handleOnDestroy() { executor.shutdownNow(); }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(File file) throws Exception {
        ApkUpdateDownload.verify(file, sha256, size);
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), flags);
        if (candidate == null) throw new IOException("无法解析更新包，请重新下载");
        ApkUpdateIdentity.verify(installed.packageName, code(installed), signers(installed),
            candidate.packageName, code(candidate), signers(candidate), versionCode);
        synchronized (this) { versionName = candidate.versionName == null ? "" : candidate.versionName; }
    }

    @SuppressWarnings("deprecation")
    private String[] signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null || signatures.length == 0) throw new IOException("无法核验更新包签名");
        String[] values = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) values[i] = ApkUpdateDownload.hex(MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray()));
        return values;
    }

    @SuppressWarnings("deprecation")
    private static long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }

    private long currentVersion() {
        try { return code(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0)); }
        catch (PackageManager.NameNotFoundException failure) { return Long.MAX_VALUE; }
    }

    private synchronized void clearReady() {
        preferences().edit().clear().apply();
        ready().delete();
        versionCode = 0; size = 0; received = 0; sha256 = ""; versionName = "";
    }

    private synchronized void fail(Exception failure) {
        working = false;
        autoInstall = false;
        clearReady(); staging().delete();
        String detail = failure instanceof IOException ? failure.getMessage() : "更新包处理失败，请重新下载";
        change("error", detail == null ? "更新失败，请重试" : detail);
    }

    private synchronized JSObject snapshot() {
        JSObject result = new JSObject();
        result.put("supported", true); result.put("revision", revision); result.put("phase", phase);
        result.put("receivedBytes", received); result.put("totalBytes", size);
        result.put("versionCode", versionCode); result.put("versionName", versionName);
        result.put("nativeVersionCode", currentVersion()); result.put("canInstall", canInstall()); result.put("error", error);
        return result;
    }

    private synchronized void change(String next, String detail) {
        phase = next; error = detail; revision++;
        notifyListeners("progress", snapshot());
    }
}
