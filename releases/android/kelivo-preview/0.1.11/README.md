# MobiCodex 0.1.11 整合预览

2026-11-14，Android **0.1.11-native-preview / code13**，Android 7.0+/API24、arm64 AOT。

| 文件 | 内容 |
| --- | --- |
| [GitHub Release APK](https://github.com/luoz76070-art/MobiCodex/releases/download/mobicodex-kelivo-v0.1.11-native-preview/mobicodex-0.1.11-preview-arm64.apk) | GitHub Actions 构建与签名 |
| [对应源码](https://github.com/luoz76070-art/MobiCodex/releases/download/mobicodex-kelivo-v0.1.11-native-preview/mobicodex-0.1.11-preview-source.tar.gz) | 与 APK 对应的源码、依赖锁、构建入口和逐文件 SHA256 |
| APK 元数据 / `source-package.json` / `SHA256SUMS` | 同一 Release 页面下载 |

## 签名与更新方式

GitHub Release 里的 APK 由 GitHub Actions 构建，使用构建机临时生成的调试证书签名，**与已安装的预览版证书不同，不能覆盖安装**，适合全新安装或核对构建。

已安装 MobiCodex 的手机请用「设置 → 应用更新 → 检查更新」。更新通道提供的是同一次构建，用原预览证书（SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`）重新签名，包名不变，覆盖升级，数据保留。

## 本版内容（相对 0.1.10）

- **消息排版**：电脑页用户消息字号与助手正文一致（随聊天字号缩放）；助手回复去掉左侧头像缩进，改为全宽，头像与名字同一行。Codex、DeepSeek 等所有 Agent 会话布局保持一致。
- **回复格式**：表格按表格显示，列多时可横向滑动（之前显示成一行行竖线原文）；引用、分隔线、嵌套列表、小标题、斜体与删除线正常显示；有序列表中间隔空行后不再从 1 重新编号。消息里的图片显示与点开预览不变。

## 电脑端

无需更新，沿用 0.1.10 的网关 `2026-11-14-deepseek-w4b-4179f637ccfc` 与 DeepSeek 桥接 0.2.8。

## 验证

发布提交上：类型检查、lint、构建通过；手机网页 427 项、语音 140 项通过（后端自 0.1.10 无改动）。在 Kelivo 宿主模式下截图核对 Codex 与 DeepSeek 会话的表格、引用、嵌套列表、横向滑动、字号，以及图片显示、点开大图、原尺寸切换与关闭。Dart 分析、Flutter 测试、Android lint/单元测试与构建由发布工作流执行。

整合发行按随附 GNU AGPL v3 提供，Kelivo 固定 v1.3.4（4a7da9b6）及原 MIT/第三方声明随源码保留；许可证及内部兼容标识不做品牌替换。
