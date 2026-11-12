# MobiCodex Kelivo GitHub Release 对齐计划

日期：2026-11-12（Asia/Shanghai）

## 当前证据

- 本地 `apps/kelivo/pubspec.yaml` 为 `0.1.8-native-preview+10`。
- 本地 `HEAD` 与 `origin/main` 均为 `5147394de62b393d03d305921ac4b1a343c1697e`。
- GitHub 主分支已包含 `apps/kelivo`、`releases/android/kelivo-preview/0.1.8/`、APK、源码归档、元数据和 SHA256。
- Kelivo APK 为 `60,752,427` 字节，SHA256 为 `55cd1ba56009fde374f2964c560a6f6a0224aba8e0555c79096b3583f7b3c049`。
- GitHub Release 当前发布的是 `mobicodex-v1.3.18-update-source-preview`，其 APK 属于 `apps/mobile` 旧 React/Capacitor 链路；Kelivo `0.1.8-native-preview` 没有对应 GitHub Release。
- App 内更新清单已经指向自托管 Kelivo `latest.json`，当前版本为 `0.1.8-native-preview / code10`。

## 下一轮目标

1. 为 `apps/kelivo` 增加独立的 Android Flutter 构建与产物校验任务。
2. 创建与 `0.1.8-native-preview` 对应的 GitHub Release，上传 Kelivo APK、源码归档、元数据和 SHA256。
3. 让 README、GitHub Release、版本目录和 App 内更新清单明确指向同一版本与同一 SHA256。
4. 在发布前后分别核对 APK 包名、versionCode、签名、大小、SHA256 和源码归档对应关系。
5. 保留现有 `apps/mobile` 发布链路，不让两个 APK 通道互相覆盖。

## 验收标准

- GitHub Release 页面能直接下载 `0.1.8-native-preview / code10` Kelivo APK。
- 下载 APK 与当前本地 APK 逐字节一致。
- GitHub Release 资产中的 SHA256 与 APK 元数据、版本目录和 App 更新清单一致。
- App 内检查更新、GitHub Release 下载和版本目录下载显示同一个产品版本。
- 现有 React/Capacitor 发布链路和 App 内原有更新通道保持可用。
