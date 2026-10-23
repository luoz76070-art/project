package com.mobilecodex.app;

import java.io.IOException;
import java.util.Arrays;

final class ApkUpdateIdentity {
    static void verify(String installedPackage, long installedVersion, String[] installedSigners,
                       String candidatePackage, long candidateVersion, String[] candidateSigners, long expectedVersion) throws IOException {
        if (!installedPackage.equals(candidatePackage)) throw new IOException("更新包不属于此应用");
        if (candidateVersion != expectedVersion || candidateVersion <= installedVersion) throw new IOException("更新包版本不匹配或已过期");
        if (installedSigners == null || installedSigners.length == 0 || candidateSigners == null || candidateSigners.length == 0) {
            throw new IOException("无法核验更新包签名");
        }
        String[] installed = installedSigners.clone(), candidate = candidateSigners.clone();
        Arrays.sort(installed); Arrays.sort(candidate);
        if (!Arrays.equals(installed, candidate)) throw new IOException("更新包签名与当前应用不一致");
    }
}
