package com.mobilecodex.app;

import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class ApkUpdateDownloadTest {
    private static int assertions = 0;
    private static void check(boolean ok, String message) { assertions++; if (!ok) throw new AssertionError(message); }
    interface Run { void run() throws Exception; }
    private static void rejects(Run run, String message) throws Exception {
        boolean rejected = false;
        try { run.run(); } catch (Exception expected) { rejected = true; }
        check(rejected, message);
    }

    public static void main(String[] args) throws Exception {
        byte[] content = new byte[180_003];
        for (int i = 0; i < content.length; i++) content[i] = (byte) (i % 239);
        String sha = ApkUpdateDownload.hex(MessageDigest.getInstance("SHA-256").digest(content));
        File root = Files.createTempDirectory("apk-update-test-").toFile();
        File file = new File(root, "download.part");
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        int[] redirected = {0};
        server.createContext("/ok", exchange -> {
            exchange.sendResponseHeaders(200, content.length);
            exchange.getResponseBody().write(content); exchange.close();
        });
        server.createContext("/chunked", exchange -> {
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write(content); exchange.close();
        });
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().add("Location", "/target");
            exchange.sendResponseHeaders(302, -1); exchange.close();
        });
        server.createContext("/target", exchange -> { redirected[0]++; exchange.sendResponseHeaders(500, -1); exchange.close(); });
        server.createContext("/short", exchange -> {
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write(Arrays.copyOf(content, 100)); exchange.close();
        });
        server.createContext("/status", exchange -> { exchange.sendResponseHeaders(503, -1); exchange.close(); });
        server.createContext("/oversized", exchange -> { exchange.sendResponseHeaders(200, ApkUpdateDownload.MAX_BYTES + 1); exchange.close(); });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        try {
            List<Long> progress = new ArrayList<>();
            ApkUpdateDownload.download(base + "/ok", sha, content.length, file, (bytes, total) -> progress.add(bytes));
            check(Arrays.equals(Files.readAllBytes(file.toPath()), content), "complete download matches");
            check(progress.get(0) == 0 && progress.get(progress.size() - 1) == content.length, "progress covers complete file");
            for (int i = 1; i < progress.size(); i++) check(progress.get(i) >= progress.get(i - 1), "progress monotonic");
            ApkUpdateDownload.verify(file, sha, content.length);
            check(file.length() == content.length, "cache can be reverified before permission return");
            Files.write(file.toPath(), Arrays.copyOf(content, 20));
            rejects(() -> ApkUpdateDownload.verify(file, sha, content.length), "reject truncated cache");
            Files.write(file.toPath(), new byte[content.length]);
            rejects(() -> ApkUpdateDownload.verify(file, sha, content.length), "reject same size modified cache");
            ApkUpdateDownload.download(base + "/chunked", sha.toUpperCase(), content.length, file, (a,b) -> {});
            check(file.length() == content.length, "chunked response verified using manifest size");
            rejects(() -> ApkUpdateDownload.download(base + "/ok", "0".repeat(64), content.length, file, (a,b) -> {}), "reject hash mismatch");
            check(!file.exists(), "hash mismatch removes staging");
            rejects(() -> ApkUpdateDownload.download(base + "/ok", sha, content.length - 1, file, (a,b) -> {}), "reject declared length mismatch");
            check(!file.exists(), "length mismatch removes staging");
            rejects(() -> ApkUpdateDownload.download(base + "/chunked", sha, content.length - 1, file, (a,b) -> {}), "reject overflowing chunked body");
            check(!file.exists(), "overflow removes staging");
            rejects(() -> ApkUpdateDownload.download(base + "/short", sha, content.length, file, (a,b) -> {}), "reject truncated chunked body");
            rejects(() -> ApkUpdateDownload.download(base + "/status", sha, content.length, file, (a,b) -> {}), "reject HTTP error");
            rejects(() -> ApkUpdateDownload.download(base + "/oversized", sha, content.length, file, (a,b) -> {}), "reject oversized declared body before reading");
            rejects(() -> ApkUpdateDownload.download(base + "/redirect", sha, content.length, file, (a,b) -> {}), "reject redirect");
            check(redirected[0] == 0, "redirect target never requested");
            rejects(() -> ApkUpdateDownload.download(base + "/ok", sha, content.length, file, (a,b) -> { throw new java.io.IOException("interrupted"); }), "interruption aborts");
            check(!file.exists(), "interruption removes staging");
            for (String url : new String[]{"http://example.com/file", "file:///tmp/test.apk", "https://user:pass@example.com/a", "https://example.com/a#fragment", "https:///bad"}) {
                rejects(() -> ApkUpdateDownload.validate(url, sha, content.length), "reject unsafe URL: " + url);
            }
            ApkUpdateDownload.validate("https://example.com/app.apk", sha, content.length);
            ApkUpdateDownload.validate("http://[::1]/app.apk", sha, content.length);
            rejects(() -> ApkUpdateDownload.validate(base, "invalid", content.length), "reject invalid digest");
            rejects(() -> ApkUpdateDownload.validate(base, sha, 0), "reject zero size");
            rejects(() -> ApkUpdateDownload.validate(base, sha, ApkUpdateDownload.MAX_BYTES + 1), "reject excessive size");
            ApkUpdateIdentity.verify("com.mobilecodex.app", 24, new String[]{"a", "b"}, "com.mobilecodex.app", 25, new String[]{"b", "a"}, 25);
            rejects(() -> ApkUpdateIdentity.verify("app", 24, new String[]{"a"}, "other", 25, new String[]{"a"}, 25), "reject wrong app ID");
            rejects(() -> ApkUpdateIdentity.verify("app", 24, new String[]{"a"}, "app", 25, new String[]{"b"}, 25), "reject different signer");
            rejects(() -> ApkUpdateIdentity.verify("app", 24, new String[]{"a"}, "app", 25, new String[]{}, 25), "reject unsigned archive");
            rejects(() -> ApkUpdateIdentity.verify("app", 24, new String[]{"a"}, "app", 24, new String[]{"a"}, 24), "reject same version");
            rejects(() -> ApkUpdateIdentity.verify("app", 24, new String[]{"a"}, "app", 23, new String[]{"a"}, 23), "reject downgrade");
            rejects(() -> ApkUpdateIdentity.verify("app", 24, new String[]{"a"}, "app", 25, new String[]{"a"}, 26), "reject target version mismatch");
            System.out.println("ApkUpdateDownload: " + assertions + " assertions passed (synthetic loopback HTTP only)");
        } finally { server.stop(0); file.delete(); root.delete(); }
    }
}
