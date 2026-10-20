package com.mobilecodex.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.io.File;

final class HotUpdateStore {
    private static final String PREFS = "MobileCodexHotUpdate";
    private static final String ACTIVE_VERSION = "activeVersion";
    private static final String PREVIOUS_VERSION = "previousVersion";
    private static final String PENDING_VERSION = "pendingVersion";
    private static final String MIN_NATIVE_VERSION_PREFIX = "minNativeVersionCode:";
    private static final String MAX_NATIVE_VERSION_PREFIX = "maxNativeVersionCode:";

    private HotUpdateStore() {}

    static File root(Context context) {
        return new File(context.getFilesDir(), "mobile-codex-hot");
    }

    static File bundleDir(Context context, String version) {
        return HotUpdatePaths.bundle(root(context), version);
    }

    static File bundleIndex(Context context, String version) {
        return new File(bundleDir(context, version), "index.html");
    }

    static String startupBundlePath(Context context) {
        SharedPreferences prefs = prefs(context);
        String pending = prefs.getString(PENDING_VERSION, "");
        if (pending != null && !pending.isEmpty()) {
            String previous = prefs.getString(PREVIOUS_VERSION, "");
            prefs.edit().putString(ACTIVE_VERSION, previous == null ? "" : previous).remove(PENDING_VERSION).apply();
        }

        String active = prefs.getString(ACTIVE_VERSION, "");
        if (!isUsable(context, active, prefs)) {
            if (active != null && !active.isEmpty()) {
                prefs.edit().putString(ACTIVE_VERSION, "").apply();
            }
            return null;
        }
        return bundleDir(context, active).getAbsolutePath();
    }

    static String activeVersion(Context context) {
        return prefs(context).getString(ACTIVE_VERSION, "");
    }

    static String pendingVersion(Context context) {
        return prefs(context).getString(PENDING_VERSION, "");
    }

    static String previousVersion(Context context) {
        return prefs(context).getString(PREVIOUS_VERSION, "");
    }

    static String activate(Context context, String version, int minNativeVersionCode, int maxNativeVersionCode) {
        SharedPreferences prefs = prefs(context);
        String current = prefs.getString(ACTIVE_VERSION, "");
        prefs.edit()
            .putString(PREVIOUS_VERSION, current == null ? "" : current)
            .putString(ACTIVE_VERSION, version)
            .putString(PENDING_VERSION, version)
            .putInt(MIN_NATIVE_VERSION_PREFIX + version, minNativeVersionCode)
            .putInt(MAX_NATIVE_VERSION_PREFIX + version, maxNativeVersionCode)
            .apply();
        return bundleDir(context, version).getAbsolutePath();
    }

    static void markReady(Context context) {
        prefs(context).edit().remove(PENDING_VERSION).apply();
        prune(context);
    }

    static String rollback(Context context) {
        SharedPreferences prefs = prefs(context);
        String active = prefs.getString(ACTIVE_VERSION, "");
        String previous = prefs.getString(PREVIOUS_VERSION, "");
        String next = previous == null ? "" : previous;
        prefs.edit().putString(ACTIVE_VERSION, next).remove(PENDING_VERSION).apply();
        if (!next.isEmpty() && isUsable(context, next, prefs)) {
            return bundleDir(context, next).getAbsolutePath();
        }
        if (active != null && !active.isEmpty()) {
            HotUpdatePaths.deleteTree(root(context), bundleDir(context, active));
        }
        return null;
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
        File[] children = root(context).listFiles();
        if (children != null) {
            for (File child : children) HotUpdatePaths.deleteTree(root(context), child);
        }
    }

    static boolean isUsable(Context context, String version, SharedPreferences prefs) {
        if (!HotUpdatePaths.isSafeVersion(version)) return false;
        File index = bundleIndex(context, version);
        if (!index.isFile()) return false;
        int currentNativeVersion = currentNativeVersionCode(context);
        int min = prefs.getInt(MIN_NATIVE_VERSION_PREFIX + version, 0);
        int max = prefs.getInt(MAX_NATIVE_VERSION_PREFIX + version, Integer.MAX_VALUE);
        return currentNativeVersion >= min && currentNativeVersion <= max;
    }

    static int currentNativeVersionCode(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode();
            }
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionCode;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void prune(Context context) {
        String active = activeVersion(context);
        String previous = previousVersion(context);
        File[] bundles = root(context).listFiles();
        if (bundles == null) return;
        for (File bundle : bundles) {
            String name = bundle.getName();
            if (name.equals(active) || name.equals(previous)) continue;
            try { HotUpdatePaths.deleteTree(root(context), bundle); } catch (RuntimeException ignored) { /* retry on next launch */ }
        }
    }
}
