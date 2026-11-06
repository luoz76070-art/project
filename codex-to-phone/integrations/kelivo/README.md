# Kelivo 原生接入

固定 Kelivo v1.3.4 源码位于 `apps/kelivo/`，保留上游业务、测试、本地依赖、平台目录与 AGPL LICENSE。Android 整合预览在同一包内提供 AI、电脑、设置三个同级入口；AI 由原 Flutter 业务拥有，电脑由原 React/Capacitor 远控拥有。两个入口的切换不调用手机模型或提交电脑任务。

这是独立安装的预览，完整59组功能与真实设备验收仍未完成。可选“交给电脑”已接线到已有Desktop会话，原Desktop新建能力仍缺；最新设备结果见[设备验收审计](../../docs/audits/2026-11-06/kelivo-device.md)；交接与未验边界见[交接验收审计](../../docs/audits/2026-11-06/kelivo-handoff.md)与[59组证据账本](../../docs/audits/2026-11-06/kelivo-parity-evidence.md)。早期未签名编译探针的记录保存在[前轮收尾](../../docs/audits/2026-11-05/kelivo-native-closeout.md)，不要当作当前产品状态。

2026-11-06手机安装交付：[独立下载页与对应源码](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/index.html)，最终code4及SHA保持上文设备版本。公网交付证据见[下载审计](../../docs/audits/2026-11-06/kelivo-phone-download.md)；用户真机安装与真实联动继续待验。

2026-11-06视觉修正：以AI对话页为基准调整电脑页，最新本地code5及验证见[视觉审计](../../docs/audits/2026-11-06/kelivo-visual.md)。公开下载仍code4，code5未上传、未真机验收。

## 当前 code7 交付

2026-11-07：动态折叠执行摘要、紧凑代码/日志字号、Kelivo 聊天显示偏好桥，以及 Codex 项目内图片的鉴权读取/Markdown 展示与大图。签名预览为 `0.1.5-native-preview` / code7；[GitHub 版本目录](../../releases/android/kelivo-preview/0.1.5/)包含 APK、匹配源码和配套网关。图片接口需要新版网关；当前Mac已在[后续真机验收轮](../../docs/audits/2026-11-07/device-link.md)完成网关升级和55项本地/公网检查，其他使用者仍需按版本说明升级自己的网关。code7 已补发独立自托管更新源，code6 可在「设置 → 应用更新」升级，见[发布核验](../../docs/audits/2026-11-07/app-update.md)。历史 code4/5/6 状态保留如下，不代表当前 GitHub 版本。

## 来源与目录

- `upstream.json`：上游提交、归档 SHA256 与固定 Flutter/Android 版本。
- `source-files.json`：引入的5052个原始文件 SHA256，以及上游归档中未引入的7个生成文件；修改清单见审计。
- `apps/kelivo/lib/features/product/`：独立产品身份、Flutter 全局导航及主题同步。
- `remote-android/`：直接引用 `apps/mobile/android` 的 Java/资源；保留六个原远控插件，并增加本地导航/交接插件 ProductHost 与 ProductHandoffStore。只声明内部 Activity，不增加 Application、FlutterEngine 或 launcher。
- `android-test-jdk.gradle`：单独选择 JDK21+ 测试 JVM，并限制 fork/堆内存；`--repeat-tests` 只禁用 Test 任务的 up-to-date。
- `android-probe.gradle`：仅用于重现早期隔离基线的编译探针；正式源码已在自己的 settings/build.gradle 中接线，不再叠加此脚本。
- `scripts/build-kelivo-remote.mjs`：构建独立远控资源到 `output/kelivo/remote-web`，绑定 `update-channel.json` 中的整合 APK 通道、保持整合热更新为空并启用宿主模式；原远控入口继续可用。
- `scripts/verify-kelivo.mjs`：正式原生检查和签名预览入口。

## 正式构建与检查

准备 `upstream.json` 指定的 Flutter3.47.6、Android SDK36/NDK28.2/CMake3.22.1；安装根 pnpm 依赖。Flutter 默认路径为 `.tools/flutter/3.47.6/bin/flutter`，可用 `KELIVO_FLUTTER` 指定同一提交的 SDK。设置 `ANDROID_HOME`、`PUB_CACHE` 等本机工具路径；依赖镜像只由构建环境提供。

Gradle/lint 使用 JDK17，Java 编译和 Robolectric 使用 JDK21+，本机验证为 JDK25。脚本自动发现 Homebrew JDK，也可显式设置：

```sh
export MOBILE_CODEX_LINT_JAVA_HOME=/path/to/jdk17
export MOBILE_CODEX_COMPILE_JAVA_HOME=/path/to/jdk21-or-newer
export MOBILE_CODEX_TEST_JAVA_HOME=/path/to/jdk21-or-newer
node scripts/verify-kelivo.mjs
node scripts/verify-kelivo.mjs --preview --repeat-tests
```

首个命令执行完整宿主/远控 lint 和原生测试；第二个另生成并验证签名预览。脚本先构建远控、核对固定 Flutter 提交，执行 `flutter pub get --enforce-lockfile`、release `--config-only`，再运行 Gradle。它会在下载域名归一化后核对上游锁文件，禁止依赖版本或包 SHA 漂移。`--config-only` 保留默认 pub 步骤，确保 dev 测试后的平台注册表与 release 依赖一致。

环境如需 Google Maven 镜像，可通过 `KELIVO_GRADLE_INIT=/absolute/mirror.gradle` 传入；代理 JVM 参数使用 `KELIVO_GRADLE_PROPERTIES` JSON 字符串数组，仅允许 `-D` 属性。无需引用本机 output 目录才能运行正式逻辑，不修改全局 Gradle 配置或关闭 TLS。

签名预览产物：

```text
output/kelivo/mobile-codex-kelivo-0.1.5-preview-arm64.apk
output/kelivo/mobile-codex-kelivo-0.1.5-preview-arm64.apk.json
```

包名 `com.mobilecodex.kelivo.preview`，版本 `0.1.5-native-preview` / code7，minSdk24，Flutter AOT 为 arm64。预览使用显式启用的本机 Android Debug 签名，不是生产发布签名。元数据记录实际大小、SHA256、签名及上游提交。

## 跨运行时契约

全局外观由 Flutter SettingsProvider 拥有，提供实际浅深两套配色；电脑前台按原生系统变化选择，固定浅/深不随系统覆盖。原生窗口与Web使用同一外观，经 `app.product_shell` 和原生 ProductHost 传递实际配色。AI/设置根保持挂载；电脑 Activity 返回 Flutter 时保存自身草稿、上传附件元数据、选择和有界阅读位置。WebView 可能被销毁，恢复依赖持久状态。保存失败或正在上传时取消跨入口导航；发送结果未知时保留原 clientMessageId 锁，恢复不自动重发。完整历史分页窗口与任意深历史的像素位置恢复仍需单独验收。

Android OAuth scheme 为 `mobilecodex.kelivo.preview`；Manifest、Kotlin、Dart 和合成测试保持一致，新包备份 URI 使用精确白名单。原 iOS 路径保持上游行为，本轮不交付 iOS。整合 Android 预览关闭上游自动更新请求，APK 更新绑定独立 `android/kelivo-preview/latest.json`；整合热更新源保持为空。统一设置的“应用更新”独立于电脑连接，使用原远控 ApkUpdatePlugin 完成下载、大小/SHA/包名/版本/签名校验及系统授权/安装确认。code4/5 需先手动覆盖安装 code6 一次，后续可在 App 内更新。帮助和归属链接仍可保留原项目地址。

AI消息“更多→交给电脑”只准备该条正文。电脑侧同张卡可编辑、选项目/已有会话、通过原上传路径添加附件；确认后先同步冻结原生身份，再复用原Desktop发送/排队。原附件不自动携带，取消未提交草稿不发送。未知结果重开仍锁定，队列接收与Desktop接收分别显示；普通草稿与交接缓存独立，同文也不互相清除。不引入额外手机模型调用。

## 隔离原生导航验收

`androidTest`提供独立测试APK，runner只允许运行在preview包的模拟器上，实际触摸/键盘检查离线双入口和草稿。它不会进入产品APK，也不点击发送；不能替代真机、系统回收、OAuth或真实电脑接收。`offline-device`额外检查Android30+的真实系统明暗、150%字体、IME、旋转、横屏空白说明的首尾滚动可达及后台返回；`offline-recovery`只读取上次已保存的合成草稿，可在明确结束预览进程后验证新进程恢复。强制结束进程不能等同真实低内存回收。

在与正式构建相同JDK/init环境下，从`apps/kelivo/android`执行：

```sh
./gradlew -I ../../../scripts/android/lint-jdk.gradle -I ../../../integrations/kelivo/android-test-jdk.gradle -Ptarget-platform=android-arm64 -PkelivoPreviewSigning=true :app:assembleReleaseAndroidTest
adb -s emulator-5554 install -r ../../../output/kelivo/mobile-codex-kelivo-0.1.4-preview-arm64.apk
adb -s emulator-5554 install -r ../build/app/outputs/apk/androidTest/release/app-release-androidTest.apk
adb -s emulator-5554 shell am instrument -w -r -e scenario offline-navigation com.mobilecodex.kelivo.preview.test/com.mobilecodex.acceptance.ProductAcceptanceRunner
```

必须核对report.status与`INSTRUMENTATION_CODE: -1`，不能仅看adb外层退出0。证据位于测试模拟器`/sdcard/Android/data/com.mobilecodex.kelivo.preview/files/product-acceptance/<scenario>-<timestamp>`；保存报告、树和截图，并记录实际安装APK的SHA。

## 其他检查

```sh
corepack pnpm verify
cd apps/kelivo
dart analyze --fatal-infos lib test integration_test
flutter test --no-pub
cd dependencies/markstream
flutter pub get --enforce-lockfile
dart analyze --fatal-infos
flutter test --no-pub
```

同一 Flutter 根目录的多套测试顺序运行，避免共享编译缓存并行。浏览器合成 fixture、Robolectric、模拟器启动和真实手机业务分别记录，不互相代替。真实模型、电脑任务和手机原数据不参与隔离回归。

## App 内更新与对应源码

code6 / 0.1.4-native-preview 继承电脑页视觉调整，并增加统一设置“应用更新”。此页无需配对电脑或模型配置；电脑设置也进入同一更新页。下载/校验和系统安装器待确认期间阻止切换，授权拒绝/安装取消后保留继续入口。启动安装器不代表安装成功。Android 真机系统授权与升级验收单列，不把浏览器替身视为真实安装。

原独立远控的正式、preview、previous 和 hot 通道不变。整合源码按对应成品重新归档：

```sh
python3 scripts/package-kelivo-source.py --apk output/kelivo/mobile-codex-kelivo-0.1.4-preview-arm64.apk --output output/audit/2026-11-06/kelivo-update
```

脚本核对 APK 元数据、完整引入来源与每文件 SHA，限制文件白名单，阻断私钥/配置/缓存和未审核凭证模式；仅精确放行固定上游原始测试中的合成 Key。归档附 AGPL、原 MIT、第三方归属和固定构建说明，逐项回读验证。发布继续复用 `publish-android-update.sh`/`upload-release-atomically.sh`，只指定整合静态目录；发布前后核对原四通道并完整回下载。
