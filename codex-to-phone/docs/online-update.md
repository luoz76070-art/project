# Android 双通道更新

项目从 `1.1.14-update-channels` 开始支持两种自托管更新方式。当前 `1.2.2-update-restore` / versionCode 18 恢复了 APK 16/17 构建遗漏的更新源，包含 Keystore 插件、连接优化与实时工作状态。以下热更新示例仅兼容原生版本 18。手机入口为“设置 → 版本与更新”；原 APK 16/17 需用手机浏览器覆盖安装一次修复 APK，保留原连接与会话，不要先卸载。详见 [恢复记录](audits/2026-10-20/update-restore.md)。

| 通道 | 适用改动 | 用户动作 | 回滚 |
| --- | --- | --- | --- |
| 热更新 | React UI、样式、文案、前端状态逻辑 | App 内点击“应用热更新” | App 内回退；启动失败时下次启动自动回滚 |
| APK 更新 | Android 原生代码、Capacitor 插件、权限、协议或不兼容数据结构 | 下载 APK，并由 Android 系统安装器确认 | 以更高 versionCode 重新发布旧版功能；系统通常拒绝低版本覆盖安装 |

热更新不能绕过原生版本边界。Manifest 必须声明可兼容的 `minNativeVersionCode` 和 `maxNativeVersionCode`，App 会拒绝加载不兼容 bundle。
生产热更新地址必须使用 HTTPS；仅本机开发地址允许使用 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`。热更新下载不跟随重定向，发布服务器应直接返回最终文件。

## 构建时配置

将两个地址写入 `apps/mobile/.env.production.local`（被 Git 忽略），也支持同名环境变量覆盖。请替换示例域名；不要只复制根目录 `.env.example`，Vite 从 `apps/mobile` 加载生产配置。

```bash
cat > apps/mobile/.env.production.local <<'EOF'
VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL=https://downloads.example.com/mobile-codex/android/latest.json
VITE_MOBILE_CODEX_HOT_MANIFEST_URL=https://downloads.example.com/mobile-codex/hot/latest.json
EOF
corepack pnpm android:apk:mac -- 1.2.2-update-restore
```

具名 APK 构建前会检查双通道地址是否齐全、URL 是否有效以及是否使用 HTTPS；缺少任一地址即失败。仅 `corepack pnpm android:apk:mac -- mac-local` 允许两个地址都空，供离线开发使用。配置在构建时写入包内，不能通过服务器补回已安装旧包中缺失的地址。

## 小改动：发布热更新

热更新是包含全部 JS/CSS 的单文件 HTML。Android 会先下载到应用私有目录，校验 SHA-256 后再原子切换；关键界面挂载后稳定 5 秒且未捕获 error/unhandledrejection 才调用 `markReady`，无需等待外网在线；它不能证明所有交互可用。如果切换后崩溃且未确认成功，下次启动自动回退。

```bash
corepack pnpm android:hot-bundle -- 1.2.2-web.1
```

输出：

```text
dist-hot/mobile-codex-1.2.2-web.1.html
```

发布：

```bash
export MOBILE_CODEX_HOT_RELEASE_HOST=deploy@example.com
export MOBILE_CODEX_HOT_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
export MOBILE_CODEX_HOT_RELEASE_DIR=/var/www/mobile-codex/releases/hot
export MOBILE_CODEX_HOT_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/hot

scripts/publish-hot-update.sh \
  dist-hot/mobile-codex-1.2.2-web.1.html \
  1.2.2-web.1 \
  18 \
  "UI and frontend behavior update"
```

默认只允许 `versionCode=18` 使用该热更新。当前前端还要求 bundle 的 `appVersionCode` 与原生版本相等，因此本次不要扩大范围或向 16/17 推送此 HTML。只有确认未来 bundle 对多个原生版本兼容时，才可设置范围，例如：

```bash
export MOBILE_CODEX_HOT_MAX_NATIVE_VERSION_CODE=19
```

## 大改动：发布 APK

1. 同步修改：

   - `apps/mobile/android/app/build.gradle`
   - `apps/mobile/src/app/config.ts`

2. 构建和发布：

   ```bash
   corepack pnpm android:apk:mac -- 1.2.2-update-restore

   export MOBILE_CODEX_RELEASE_HOST=deploy@example.com
   export MOBILE_CODEX_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
   export MOBILE_CODEX_RELEASE_DIR=/var/www/mobile-codex/releases/android
   export MOBILE_CODEX_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/android

   scripts/publish-android-update.sh \
     dist-apk/mobile-codex-1.2.2-update-restore-debug.apk \
     1.2.2-update-restore \
     18 \
     "Native update channels and Codex executable resolution"
   ```

APK 更新仍需要用户确认安装；侧载来源第一次更新时还需要允许“安装未知应用”。

## 热更新 Manifest

```json
{
  "platform": "android",
  "channel": "hot",
  "version": "1.2.2-web.1",
  "htmlUrl": "https://downloads.example.com/mobile-codex/hot/mobile-codex-1.2.2-web.1.html",
  "sha256": "generated-sha256",
  "size": 1000000,
  "minNativeVersionCode": 18,
  "maxNativeVersionCode": 18,
  "notes": "UI update",
  "publishedAt": "2026-10-20T00:00:00Z"
}
```

`sha256` 必须是下载文件的 64 位十六进制 SHA-256。App 会在切换前完成完整下载、大小限制、HTML 标记和 SHA-256 校验。

## APK Manifest

```json
{
  "platform": "android",
  "versionName": "1.2.2-update-restore",
  "versionCode": 18,
  "apkUrl": "https://downloads.example.com/mobile-codex/android/mobile-codex-1.2.2-update-restore.apk",
  "sha256": "generated-sha256",
  "mandatory": false,
  "notes": "Native update",
  "publishedAt": "2026-10-20T00:00:00Z"
}
```

## 发布原子性与回退

两个发布入口共用 `scripts/upload-release-atomically.sh`，先上传临时文件，远端校验 SHA-256/大小、取得发布锁后再原子切换 `latest.json`，保留 `previous.json`。产物名带 hash，已存在的同名产物必须匹配 hash。发布端指针回退和已安装版本回滚是两种操作，步骤与限制见 [优化交付](audits/2026-10-20/delivery.md#发布与回滚)。2026-10-20 更新恢复已通过原通道发布 APK 18 与仅兼容原生 18 的 HTML；下载 SHA、大小和 CORS 验证见 [恢复记录](audits/2026-10-20/update-restore.md)。生产回滚演练与真机安装仍待验收。
