# code7 App 内更新补发

日期：2026-11-07。用户反馈“为啥没在app里更新”。上一轮只把 code7 源码和 APK 推送 GitHub，遗漏了用户此前要求的自托管更新源发布。本轮实时读取确认独立源仍为 code6，随后复用同一份已验产物补发，不重新构建或递增版本。

## 手机操作

code6 打开「设置 → 应用更新 → 检查更新」，可下载 **0.1.5-native-preview / code7**，校验后由 Android 系统确认安装，无需配对电脑或卸载。已手动装好 code7 时显示已是最新。code4/5 没有该入口，仍需从[安装页](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/index.html)手动覆盖一次。

本版包含动态折叠执行摘要、紧凑代码/日志字号、Kelivo 显示偏好及 Markdown 图片/大图。项目本地图片需要配套新电脑网关；本轮静态发布没有切换在线网关，手机实际覆盖与真实图片联动继续按[真机计划](../../plans/2026-11-07-remote-rendering-device.md)复测。调起系统安装器不等于安装成功，整体59组功能对照继续未完成。

## 发布与核验

- 固定通道 `https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/latest.json`，latest 为7，previous逐字节对应发布前code6；源码previous也保留code6。
- 先用已有原子上传脚本发布对应源码，再发布 APK/清单，最后按校验值原子切换安装页。原正式/preview/previous/hot四清单SHA及JSON内容前后相同。
- APK **60,977,575字节**，SHA256 `2666d55e30205e60a4b64c23ba36d2fe4b01d9ecd96971fc50267bf1dfd2a316`；对应源码 **21,687,913字节**，SHA256 `d94bd7999e878cb6c2f1e00c0dbf3093263e1b74bd7c3c3b39d47175421b067c`。HTTPS完整回下载，两份均与本地全部字节一致；APK Range206、清单/APK/源码 CORS正确。
- 实际运行 App 原有 `readAndroidUpdateManifest`，从固定通道带缓存规避参数获取公网清单并解析，通过，code6可识别code7。安装页200且内容与发布文件一致。
- `node --test scripts/test-release-publication.mjs scripts/test-apk-update.mjs`：10项通过，包含39个原生下载断言。产品源码未改，复用已核验 code7 签名/构建，不重复运行完整原生构建。

公开回执：[app-update-verification.json](app-update-verification.json)。原始清单、发布日志、实际解析和完整下载比对脚本/报告位于 `output/audit/2026-11-07/app-update/`。对应源码提交仍为 `a71e7f2f09edb5870abab0f2cd7df1808c8bb4d4`，既有 preview 标签保持不动。

README、集成说明、版本目录及工程索引同步当前状态；历史审计保留当时事实。复用现有发布脚本，将“GitHub与App更新源同时交付”的验收要求补入[版本同步流程](../../ops/version-sync.md)，避免再次只上传GitHub；没有新增通用技能或自动化。
