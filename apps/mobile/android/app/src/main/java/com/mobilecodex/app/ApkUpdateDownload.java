package com.mobilecodex.app;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Locale;

/** Bounded streaming download. No Android dependencies, so failure paths run on the local JVM. */
final class ApkUpdateDownload {
    static final long MAX_BYTES = 128L * 1024 * 1024;
    private static final long MAX_DURATION_NANOS = 10L * 60 * 1_000_000_000;

    interface Progress { void update(long received, long total) throws IOException; }

    static void validate(String url, String sha256, long size) throws IOException {
        if (sha256 == null || !sha256.matches("(?i)[a-f0-9]{64}")) throw new IOException("更新包 SHA-256 无效");
        if (size <= 0 || size > MAX_BYTES) throw new IOException("更新包大小无效或超过 128 MiB");
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            boolean local = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)
                || "[::1]".equals(host) || "::1".equals(host);
            if (host == null || uri.getUserInfo() != null || uri.getFragment() != null
                || !("https".equalsIgnoreCase(uri.getScheme()) || (local && "http".equalsIgnoreCase(uri.getScheme())))) {
                throw new IOException("更新地址必须使用 HTTPS");
            }
        } catch (java.net.URISyntaxException | NullPointerException error) {
            throw new IOException("更新地址无效");
        }
    }

    static void download(String url, String sha256, long size, File staging, Progress progress) throws Exception {
        validate(url, sha256, size);
        HttpURLConnection connection = (HttpURLConnection) new URI(url).toURL().openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        boolean complete = false;
        long started = System.nanoTime();
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IOException("更新包下载失败，HTTP " + status);
            // URLConnection.getContentLengthLong requires API 24; this app also supports API 23.
            String lengthHeader = connection.getHeaderField("Content-Length");
            long declared = -1;
            if (lengthHeader != null) {
                try { declared = Long.parseLong(lengthHeader); }
                catch (NumberFormatException failure) { throw new IOException("更新包大小响应无效"); }
                if (declared < 0) throw new IOException("更新包大小响应无效");
            }
            if (declared >= 0 && declared != size) throw new IOException("更新包大小与清单不一致");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long received = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(staging))) {
                progress.update(0, size);
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("下载已中断，请重试");
                    if (System.nanoTime() - started > MAX_DURATION_NANOS) throw new IOException("下载超时，请重试");
                    received += count;
                    if (received > size || received > MAX_BYTES) throw new IOException("更新包大小超出清单");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                    progress.update(received, size);
                }
            }
            if (received != size) throw new IOException("更新包下载不完整，请重试");
            if (!hex(digest.digest()).equalsIgnoreCase(sha256)) throw new IOException("更新包 SHA-256 校验失败");
            complete = true;
        } finally {
            connection.disconnect();
            if (!complete) staging.delete();
        }
    }

    static void verify(File file, String sha256, long size) throws Exception {
        if (!file.isFile() || file.length() != size || size <= 0 || size > MAX_BYTES) {
            throw new IOException("缓存更新包不完整，请重新下载");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > size) throw new IOException("缓存更新包已变化，请重新下载");
                digest.update(buffer, 0, count);
            }
        }
        if (total != size || !hex(digest.digest()).equalsIgnoreCase(sha256)) {
            throw new IOException("缓存更新包校验失败，请重新下载");
        }
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }
}
