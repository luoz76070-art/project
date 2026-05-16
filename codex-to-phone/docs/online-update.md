# Android 在线升级

当前项目采用自托管 APK 更新：

```text
Android App
  -> https://zyzlz.xin/mobile-codex/releases/android/latest.json
  -> 打开 latest.json 里的 apkUrl 下载新版 APK
```

这不是 Google Play 内购式静默升级。Android 侧载应用必须经过系统安装器确认；第一次安装同来源 APK 时，用户可能需要允许浏览器或系统文件管理器“安装未知应用”。

## 发布新版

1. 更新版本号。

   需要同步修改：

   - `apps/mobile/android/app/build.gradle` 的 `versionCode`
   - `apps/mobile/android/app/build.gradle` 的 `versionName`
   - `apps/mobile/src/main.tsx` 的 `appVersionCode`
   - `apps/mobile/src/main.tsx` 的 `appVersionName`

2. 构建 APK。

   ```bash
   corepack pnpm android:apk:mac -- mac-remote
   ```

3. 发布 APK 和 manifest。

   ```bash
   scripts/publish-android-update.sh \
     dist-apk/mobile-codex-mac-remote-debug.apk \
     1.1.5 \
     6 \
     "修复远程连接和手机端显示"
   ```

4. 验证公网 manifest。

   ```bash
   curl https://zyzlz.xin/mobile-codex/releases/android/latest.json
   ```

## 手机端行为

- App 启动后会自动检查一次更新。
- 设置页显示当前版本和更新状态。
- 有新版本时点击“下载新版”，系统会打开 APK 下载地址。
- 下载完成后按 Android 系统提示安装。

## 后续增强

更完整的一键升级可以继续增加 Android 原生插件：

- App 内下载 APK 到私有缓存目录；
- 通过 `FileProvider` 生成 `content://` URI；
- 使用 `Intent.ACTION_VIEW` + `application/vnd.android.package-archive` 唤起系统安装器；
- 增加 `REQUEST_INSTALL_PACKAGES` 权限。

这个增强仍然不能绕过系统安装确认，但能减少用户手动寻找下载文件的步骤。
