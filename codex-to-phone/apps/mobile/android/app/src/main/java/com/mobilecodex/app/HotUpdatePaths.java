package com.mobilecodex.app;

import java.io.File;
import java.io.IOException;

/** Filesystem boundary shared by installation, rollback and cleanup. */
final class HotUpdatePaths {
    private HotUpdatePaths() {}

    static boolean isSafeVersion(String version) {
        return version != null && version.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,99}");
    }

    static File bundle(File root, String version) {
        if (!isSafeVersion(version)) throw new IllegalArgumentException("Invalid hot update version");
        return child(root, version);
    }

    static File child(File root, String name) {
        if (name == null || name.isEmpty() || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\")) {
            throw new IllegalArgumentException("Invalid hot update directory");
        }
        try {
            File canonicalRoot = root.getCanonicalFile();
            File file = new File(canonicalRoot, name);
            if (!canonicalRoot.equals(file.getCanonicalFile().getParentFile())) {
                throw new IllegalArgumentException("Hot update directory escapes root");
            }
            return file;
        } catch (IOException error) {
            throw new IllegalArgumentException("Cannot resolve hot update directory", error);
        }
    }

    static void deleteTree(File root, File file) {
        try {
            File canonicalRoot = root.getCanonicalFile();
            File canonicalFile = file.getCanonicalFile();
            if (!canonicalFile.toPath().startsWith(canonicalRoot.toPath()) || canonicalFile.equals(canonicalRoot)) {
                throw new IllegalArgumentException("Refusing to remove outside hot update root");
            }
            // Delete symlinks themselves without following their children.
            if (!file.getAbsoluteFile().equals(canonicalFile)) {
                if (file.exists() && !file.delete()) throw new IOException("Cannot delete bundle link");
                return;
            }
            if (!file.exists()) return;
            if (file.isDirectory()) {
                File[] children = file.listFiles();
                if (children == null) throw new IOException("Cannot read bundle directory");
                for (File child : children) deleteTree(root, child);
            }
            if (!file.delete()) throw new IOException("Cannot delete bundle file");
        } catch (IOException error) {
            throw new IllegalStateException("Cannot clean hot update directory", error);
        }
    }
}
