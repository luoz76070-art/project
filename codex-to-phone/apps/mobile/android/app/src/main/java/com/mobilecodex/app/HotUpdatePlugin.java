package com.mobilecodex.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URI;
import java.net.URISyntaxException;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "HotUpdate")
public class HotUpdatePlugin extends Plugin {
    private static final int MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("activeVersion", HotUpdateStore.activeVersion(context));
        result.put("pendingVersion", HotUpdateStore.pendingVersion(context));
        result.put("previousVersion", HotUpdateStore.previousVersion(context));
        result.put("nativeVersionCode", HotUpdateStore.currentNativeVersionCode(context));
        call.resolve(result);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        String version = call.getString("version");
        int minNativeVersionCode = call.getInt("minNativeVersionCode", 0);
        int maxNativeVersionCode = call.getInt("maxNativeVersionCode", Integer.MAX_VALUE);

        if (url == null || url.trim().isEmpty()) {
            call.reject("Hot update URL is required");
            return;
        }
        if (expectedSha256 == null || expectedSha256.trim().isEmpty()) {
            call.reject("Hot update SHA-256 is required");
            return;
        }
        if (!isSha256(expectedSha256)) {
            call.reject("Hot update SHA-256 is invalid");
            return;
        }
        if (!HotUpdatePaths.isSafeVersion(version)) {
            call.reject("Hot update version is invalid");
            return;
        }
        if (minNativeVersionCode > maxNativeVersionCode) {
            call.reject("Hot update native version range is invalid");
            return;
        }
        if (!isAllowedUpdateUrl(url)) {
            call.reject("Hot update URL must use HTTPS (localhost HTTP is allowed for development)");
            return;
        }

        executor.execute(() -> {
            try {
                File bundle = downloadAndVerify(url, expectedSha256.trim(), version);
                String path = HotUpdateStore.activate(getContext(), version, minNativeVersionCode, maxNativeVersionCode);
                getBridge().executeOnMainThread(() -> {
                    getBridge().setServerBasePath(path);
                    JSObject result = new JSObject();
                    result.put("version", version);
                    result.put("path", bundle.getParentFile().getAbsolutePath());
                    result.put("reloading", true);
                    call.resolve(result);
                });
            } catch (Exception error) {
                call.reject("Hot update failed: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void markReady(PluginCall call) {
        HotUpdateStore.markReady(getContext());
        call.resolve();
    }

    @PluginMethod
    public void rollback(PluginCall call) {
        String path = HotUpdateStore.rollback(getContext());
        getBridge().executeOnMainThread(() -> {
            if (path == null) {
                getBridge().setServerAssetPath("public");
            } else {
                getBridge().setServerBasePath(path);
            }
            JSObject result = new JSObject();
            result.put("activeVersion", HotUpdateStore.activeVersion(getContext()));
            result.put("reloading", true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        HotUpdateStore.clear(getContext());
        getBridge().executeOnMainThread(() -> {
            getBridge().setServerAssetPath("public");
            call.resolve();
        });
    }

    private File downloadAndVerify(String rawUrl, String expectedSha256, String version) throws Exception {
        URL url = new URL(rawUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("GET");

        if (version.equals(HotUpdateStore.activeVersion(getContext())) || version.equals(HotUpdateStore.previousVersion(getContext()))) {
            throw new IOException("cannot overwrite active or rollback bundle");
        }
        File root = HotUpdateStore.root(getContext());
        if (!root.exists() && !root.mkdirs()) {
            throw new IOException("cannot create hot update directory");
        }
        File staging = HotUpdatePaths.child(root, "." + version + ".staging");
        HotUpdatePaths.deleteTree(root, staging);
        if (!staging.mkdirs()) {
            throw new IOException("cannot create hot update staging directory");
        }
        File stagingIndex = new File(staging, "index.html");

        try {
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                throw new IOException("redirects are not allowed for hot updates");
            }
            if (status < 200 || status >= 300) {
                throw new IOException("download returned HTTP " + status);
            }
            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_BUNDLE_BYTES) {
                throw new IOException("bundle is too large");
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(stagingIndex))) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_BUNDLE_BYTES) throw new IOException("bundle is too large");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
            }

            String actualSha256 = toHex(digest.digest());
            if (!actualSha256.equalsIgnoreCase(expectedSha256)) {
                throw new IOException("SHA-256 mismatch");
            }
            if (!looksLikeBundle(stagingIndex)) {
                throw new IOException("bundle is not a valid HTML app");
            }

            File target = HotUpdateStore.bundleDir(getContext(), version);
            HotUpdatePaths.deleteTree(root, target);
            if (!staging.renameTo(target)) {
                throw new IOException("cannot activate downloaded bundle");
            }
            return HotUpdateStore.bundleIndex(getContext(), version);
        } finally {
            connection.disconnect();
            HotUpdatePaths.deleteTree(root, staging);
        }
    }

    private boolean looksLikeBundle(File file) {
        byte[] bytes = new byte[4096];
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            int count = input.read(bytes);
            if (count <= 0) return false;
            String prefix = new String(bytes, 0, count);
            return prefix.toLowerCase(Locale.ROOT).contains("<html")
                && prefix.contains("mobile-codex-hot-bundle");
        } catch (IOException error) {
            return false;
        }
    }

    private static boolean isSha256(String value) {
        return value != null && value.trim().matches("(?i)[a-f0-9]{64}");
    }

    private static boolean isAllowedUpdateUrl(String rawUrl) {
        try {
            URI uri = new URI(rawUrl.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if ("https".equals(scheme)) return true;
            if (!"http".equals(scheme)) return false;

            String host = uri.getHost();
            if (host == null) return false;
            String normalizedHost = host.toLowerCase(Locale.ROOT);
            return "localhost".equals(normalizedHost)
                || "127.0.0.1".equals(normalizedHost)
                || "::1".equals(normalizedHost);
        } catch (URISyntaxException error) {
            return false;
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

}
