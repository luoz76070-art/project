package com.mobilecodex.app;

/** What the page told the notification service; memory only, so a killed process forgets the device token. */
final class AttentionConfig {
    static volatile String endpoint;
    static volatile String token;
    static volatile boolean finished = true;
    static volatile boolean approvals = true;
    static volatile String viewingKey;
    static volatile boolean appVisible;

    private AttentionConfig() {}

    static boolean ready() {
        return endpoint != null && !endpoint.isEmpty() && token != null && !token.isEmpty();
    }

    static boolean watching(String key) {
        return appVisible && key != null && key.equals(viewingKey);
    }

    static String url(String path) {
        String base = endpoint == null ? "" : endpoint.replaceAll("/+$", "");
        return base + path;
    }
}
