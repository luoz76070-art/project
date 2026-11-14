# MobiCodex 0.1.10 整合预览

2026-11-14，Android **0.1.10-native-preview / code12**，Android 7.0+/API24、arm64 AOT。

| 文件 | 内容 |
| --- | --- |
| [GitHub Release APK](https://github.com/luoz76070-art/MobiCodex/releases/download/mobicodex-kelivo-v0.1.10-native-preview/mobicodex-0.1.10-preview-arm64.apk) | GitHub Actions 构建与签名 |
| [对应源码](https://github.com/luoz76070-art/MobiCodex/releases/download/mobicodex-kelivo-v0.1.10-native-preview/mobicodex-0.1.10-preview-source.tar.gz) | 与 APK 对应的源码、依赖锁、构建入口和逐文件 SHA256 |
| APK 元数据 / `source-package.json` / `SHA256SUMS` | 同一 Release 页面下载 |

## 签名与更新方式

GitHub Release 里的 APK 由 GitHub Actions 构建，使用构建机临时生成的调试证书签名，**与已安装的预览版证书不同，不能覆盖安装**，适合全新安装或核对构建。

已安装 MobiCodex 的手机请用「设置 → 应用更新 → 检查更新」。更新通道提供的是同一次构建，用原预览证书（SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`）重新签名，包名不变，覆盖升级，数据保留。

## 本版内容（相对 0.1.9）

- **语音闪退修复**：0.1.9 点「开始录音」会让 App 崩溃，系统随即把主界面拉起来，看起来像跳到了设置。原因是发布版 R8 优化掉了 Capacitor 读取插件注解的字段，权限检查变成空指针。现保留 Capacitor 运行时；构建验收新增检查，APK 里缺这些反射元数据时直接失败。Kelivo 设置里的「语音识别」服务于 AI 页，与电脑页语音互不相关。
- **用户消息气泡**：电脑页改用与 Kelivo AI 页一致的淡色底，不再是动态取色下明显的蓝色块。
- **DeepSeek 事项进度**：交接给 DeepSeek 的事项，在消费该消息的那一轮完成后自动转到「待验证」，失败或中断时退回。需要电脑端 DeepSeek 桥接 0.2.8 与新版网关（本机已更新）。

## 电脑端

- DeepSeek Harness 桌面版 2026-11-14 自动升级到 0.2.2-rc.3 后，旧桥接 0.2.7 被版本门拒绝，DeepSeek 通道中断。桥接 0.2.8 兼容 rc.3，三项官方隔离检查共 30 项通过（[记录](../../../../docs/audits/2026-11-14/deepseek-rc3-isolated-checks.json)），已用官方 CLI 装回原 desktop profile 并热加载，`/info` 报告 rc.3。
- 电脑网关已切到 `2026-11-14-deepseek-w4b-4179f637ccfc`（握手白名单加入 rc.3，解析回合对应）；旧版与配置备份保留可回退。

## 验证

发布提交上：类型检查、lint、构建、插件构建通过；后端 538 项、手机网页 424 项、语音 140 项通过。语音闪退在 API 36 模拟器上复现并从 APK 字节码确认根因；修复后的 APK 在发布前先在模拟器上验证录音权限流程不再崩溃。Dart 分析、Flutter 测试、Android lint/单元测试与构建由发布工作流执行。

整合发行按随附 GNU AGPL v3 提供，Kelivo 固定 v1.3.4（4a7da9b6）及原 MIT/第三方声明随源码保留；许可证及内部兼容标识不做品牌替换。
