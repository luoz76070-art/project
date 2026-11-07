# MobiCodex 品牌与手机更新

## 本轮需求与验收

用户选定黑白电脑/手机图标，要求设为当前整合 Android App 图标，应用内 Kelivo 品牌统一为 MobiCodex，并更新手机，优先热更新。

- 桌面图标（普通、自适应、主题图标）、启动画面、关于页及内置品牌图使用同一选定图片；圆形裁切不截断主体。
- 应用名、三语言界面品牌文案、通知和系统手机控制/文件入口显示 MobiCodex；关于页项目链接指向本项目，原社区和赞助入口明确归属上游。
- 保持现有应用 ID、签名、OAuth 回调、数据库/偏好/备份/工具标识，支持 code9 同数据覆盖升级。保留原始开源许可与来源记录。
- 递增为 0.1.8-native-preview / code10；对应源码与 APK 同步 GitHub 版本目录和既有独立更新源。公开完整回下载校验大小/SHA/字节和 previous，手机实际安装单列确认。

## 设计与改动边界

缺口属于 Flutter 用户可见文案和 Android 静态图标资源。当前 Flutter AOT、launcher 图标和 Android 资源不接受 Web HTML 热更新，整合热更新源也保持为空。因此沿用已存在的 App 内 APK 覆盖安装，不为本轮新增另一套热更新基础设施。

图片直接来自用户附件，原图保存为 app_icon.png；复用已有 flutter_launcher_icons 和 flutter_native_splash 依赖生成 Android 资源。新增 Android 专用生成配置，避免顺带重写未交付的平台工程。前景从原图提取透明底，暖白底作为自适应背景，主题图标只取同一图形的 alpha。

Flutter ARB 只修改可显示的值，保留 key 和占位符并重新生成；硬编码标题/通知/分享/错误提示按实际所有者修改。保留 package:Kelivo、应用 ID、数据路径和内置工具身份，避免换名破坏已有内容。上游项目链接与许可继续真实可达，社区/赞助不会冒称本产品社区。

不改电脑网关、会话/模型控制、密钥和用户历史，不执行真实模型任务。按 karpathy-guidelines 做集中品牌替换和小范围版本接线，不进行架构重构。

## 实施与验证

1. 生成图标/启动资源；调整 ARB、Flutter/Android 可见品牌及更新页。
2. Flutter gen-l10n、格式化、完整 Dart 分析与相关已有测试；检查残留和品牌入口。
3. 根 verify；正式 verify-kelivo --preview --repeat-tests（完整原生 lint、原生测试、签名构建）。包内检查图标/文案/版本/更新源与 Web 字节，旧包签名一致。
4. 可用时在隔离 Android 模拟器实际检查普通/圆形图标、启动、关于、设置/电脑/更新入口及 code9 覆盖后状态保留；不以模拟器代替手机安装。
5. 对应源码秘密扫描及归档逐文件核验；本项目提交，GitHub 版本化交付。先源码后 APK 原子发布独立更新源，保留 code9 previous 与原四通道。
6. 记录公开回下载结果和手机升级待验边界。更新工程入口、版本说明与审计，不修改历史证据。

自审：本轮用户已明确授权图标/改名/手机更新；沿用本项目既有源码/APK 双源发布要求，无需为模板流程门重复确认。在线网关没有本轮必要改动。

实施复核补充：恢复扫描同时接受 Kelivo/MobiCodex 的备份及快照前缀；聊天工具展示使用 displayName。预 Android12 启动背景显式使用仅宿主拥有的 android12splash，避免远控同名 splash 横竖屏资源覆盖；资源再生成末尾执行 prepare_mobicodex_branding.dart --finalize-android。
