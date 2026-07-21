# Android 在线更新

项目支持自托管 APK 更新：

```text
Android App
  -> latest.json
  -> 读取 apkUrl
  -> 下载 APK
  -> Android 系统安装器确认安装
```

在线更新不是静默升级。侧载应用仍需要用户确认安装，新来源第一次安装时还需要允许“安装未知应用”。

## 构建时配置更新源

更新地址通过 Vite 环境变量写入 APK：

```bash
export VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL=https://downloads.example.com/mobile-codex/android/latest.json
corepack pnpm android:apk:mac -- 1.1.13-self-hosted
```

不配置 `VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL` 时，App 会显示“未配置更新源”，聊天、连接和控制功能仍可正常使用。

## 发布新版

1. 同步更新版本号：

   - `apps/mobile/android/app/build.gradle`
   - `apps/mobile/src/main.tsx`

2. 构建 APK：

   ```bash
   export VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL=https://downloads.example.com/mobile-codex/android/latest.json
   corepack pnpm android:apk:mac -- 1.1.13-self-hosted
   ```

3. 配置发布目标：

   ```bash
   export MOBILE_CODEX_RELEASE_HOST=deploy@example.com
   export MOBILE_CODEX_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
   export MOBILE_CODEX_RELEASE_DIR=/var/www/mobile-codex/releases/android
   export MOBILE_CODEX_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/android
   ```

4. 发布 APK 和 manifest：

   ```bash
   scripts/publish-android-update.sh \
     dist-apk/mobile-codex-1.1.13-self-hosted-debug.apk \
     1.1.13-self-hosted \
     14 \
     "Release notes"
   ```

5. 验证：

   ```bash
   curl https://downloads.example.com/mobile-codex/android/latest.json
   ```

## Manifest 格式

```json
{
  "platform": "android",
  "versionName": "1.1.13-self-hosted",
  "versionCode": 14,
  "apkUrl": "https://downloads.example.com/mobile-codex/android/mobile-codex-1.1.13-self-hosted.apk",
  "size": 4000000,
  "sha256": "replace-with-generated-sha256",
  "mandatory": false,
  "notes": "Release notes",
  "publishedAt": "2026-01-01T00:00:00Z"
}
```

发布脚本会自动计算 `size` 和 `sha256`，并使用 Node.js 生成合法 JSON。
