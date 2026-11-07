# MobiCodex 0.1.8 整合预览

2026-11-07，Android **0.1.8-native-preview / code10**，Android7.0+/API24、arm64 AOT。

| 文件 | 内容 |
| --- | --- |
| [APK](mobile-codex-kelivo-0.1.8-preview-arm64.apk?raw=true) | 60,752,427字节，同包名同证书覆盖更新 |
| [对应源码](mobile-codex-kelivo-0.1.8-preview-source.tar.gz?raw=true) | 21,287,624字节，5934源码文件，5052固定上游文件全部包含 |
| [APK元数据](mobile-codex-kelivo-0.1.8-preview-arm64.apk.json) / [源码元数据](source-package.json) | 版本、证书、来源与逐文件核验 |
| [SHA256SUMS](SHA256SUMS) | 本目录文件的完整校验值 |

本版使用用户选定的黑白电脑/手机图标，普通、自适应、主题图标及浅深启动画面统一。应用名称、设置/关于、系统通知、文件入口、内置品牌图、工具展示和新导出文件使用 MobiCodex；原始开源归属保留，上游社区/赞助明确标记归属。

包名继续为 `com.mobilecodex.kelivo.preview`。证书 SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`，与code9相同；OAuth、数据库、备份格式与工具身份保持兼容。恢复扫描同时接受新旧品牌备份/快照，内置技能仅刷新精确匹配旧版的 bundled 文件，保留用户修改、删除和使用设置。

code6/7/8/9 可通过「设置 → 应用更新 → 检查更新」覆盖安装；code4/5先手动覆盖一次。图标与Flutter AOT/原生资源需要APK更新，现有Web热更新不能替换。本轮没有在线网关切换，沿用[图片修复网关](../0.1.7/desktop-image-reference-preview/)与[DeepSeek0.2.7](../0.1.7/desktop-0.2.7-preview/)。

完整JS/TS verify、Dart分析、相关Flutter回归、340项原生测试和完整Android lint通过。宿主/远控66/1条警告继续记录，未关闭检查。APK五份Web文件与构建字节一致、37份品牌资源像素一致，预Android12启动背景隔离远控同名资源；测试runner/fixture不入包。源码扫描无未审核凭证模式，归档全部字节回读一致。

APK SHA256 `55cd1ba56009fde374f2964c560a6f6a0224aba8e0555c79096b3583f7b3c049`。
源码 SHA256 `ce234665805b9d8502f467542d7ca0d2e7cb18a70a4b1a65dbfad9f1e4de8619`。

双源发布、公开回下载与手机升级状态见[本轮审计](../../../../docs/audits/2026-11-07/mobicodex-branding.md)。手机实际安装、桌面名称/图标和原连接数据仍待用户确认；本轮不扩大为完整59组功能验收。

整合发行按随附GNU AGPL v3提供，Kelivo固定v1.3.4（4a7da9b6）及原MIT/第三方声明随源码保留；许可证及内部兼容标识不做品牌替换。
