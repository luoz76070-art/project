# GitHub Actions 增量发布

当前仓库的 `ci.yml` 负责每次代码增量的 lint、类型检查、构建、隔离验证和 Android Debug APK 构建。本流程补充正式的 GitHub Release：从指定提交构建 Android Release APK 和单文件热更新包，校验签名与 SHA-256，然后把 APK、热更新包和两个更新清单上传到 GitHub Release。

## 首次配置

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置以下变量。

Repository variables：

```text
MOBILE_CODEX_UPDATE_MANIFEST_URL=https://github.com/OWNER/REPOSITORY/releases/latest/download/android-latest.json
MOBILE_CODEX_HOT_MANIFEST_URL=https://github.com/OWNER/REPOSITORY/releases/latest/download/hot-latest.json
```

Repository secrets：

```text
ANDROID_KEYSTORE_BASE64=<与现有已安装 APK 相同的签名 keystore，Base64 编码>
ANDROID_KEYSTORE_PASSWORD=<keystore 密码>
ANDROID_KEY_ALIAS=<签名别名>
ANDROID_KEY_PASSWORD=<签名密码>
```

签名材料不能提交到仓库。`ANDROID_KEYSTORE_BASE64` 必须对应现有 MobiCodex 安装包的签名证书，否则 Android 会拒绝覆盖安装。若原签名私钥已经丢失，GitHub Actions 可以继续生成 APK，但不能把它作为现有 App 的覆盖更新包。

现有手机如果内置的更新地址仍是自托管地址，不会因为新增这个 workflow 自动切换到 GitHub。需要先构建并手动覆盖安装一次把更新地址写入 GitHub 的引导版本，之后才可以通过 App 内“设置 → 应用更新”接收 GitHub Release。

## 发布方式

先在提交中同步修改：

- `apps/mobile/android/app/build.gradle` 的 `versionName`
- `apps/mobile/android/app/build.gradle` 的递增 `versionCode`
- `CHANGELOG.md` 或对应审计文档

然后有两种入口：

1. 给目标提交打形如 `mobicodex-v1.3.18` 的 tag 并推送。`release-android.yml` 会自动运行。
2. 在 GitHub Actions 手动运行 **MobiCodex Android Release**，填写 release tag、是否 prerelease 和发布说明。手动运行会以当前选择的提交创建 Release tag。

工作流会先执行 lint、typecheck、build、隔离验证和更新契约测试，然后在 Ubuntu runner 上配置 JDK 17/21、Android SDK 35 与 Gradle 8.11.1，构建并签名 APK，同时构建单文件热更新 HTML。

Release 资产包括：

- 带 SHA-256 短标识的 APK
- 带 SHA-256 短标识的热更新 HTML
- `android-latest.json`
- `hot-latest.json`
- `SHA256SUMS`

GitHub Actions 页面还会保留一个同名 artifact，方便在正式 Release 前下载检查。Release 资产下载位置是仓库的 **Releases** 页面；App 使用上面的 `latest/download` 清单地址。

## 增量更新与回滚边界

后续只需要提交增量代码、递增 `versionCode`、运行 CI，再按 tag 或手动入口发布。工作流不会读取真实 Codex、Claude、DeepSeek 会话，不会读取个人 token，不会连接 Desktop IPC 或真实手机。

热更新适合 React、样式和前端逻辑变化；原生代码、权限、Capacitor 插件和协议变化必须发布 APK。两类清单都声明了 SHA-256，App 下载后会校验文件。

Android 不允许用较低 `versionCode` 覆盖较高版本。回滚应从已验证的旧提交重新构建，并使用更高的 `versionCode` 发布一个回滚版本；不要直接把旧 APK 重新上传成更低版本。

本流程只负责 GitHub Release，不会自动切换在线网关、部署 Relay、提交其他工作区文件或替用户安装手机 APK。
