# MobiCodex 品牌与 code10 更新

日期：2026-11-07。用户要求采用指定黑白电脑/手机图标，应用内 Kelivo 产品品牌改为 MobiCodex，并更新手机，优先热更新。需求与边界见[本轮计划](../../plans/2026-11-07-mobicodex-branding.md)。

## 产品改动

用户原图保存为 `apps/kelivo/assets/app_icon.png`；生成普通、自适应、monochrome 图标及浅深启动图，Flutter 内置品牌图同步。应用名、关于/设置、通知、文件入口、聊天工具展示、内置技能文案与新导出文件统一为 MobiCodex。关于页项目链接指向本仓库，原社区/赞助明确标为上游，原始许可与来源保留。

包名继续 `com.mobilecodex.kelivo.preview`，OAuth、数据库/偏好、备份格式、工具及模型配置身份不变；用户自定义名称和技能不被覆盖。内置服务只改展示，bundled 技能仅刷新精确匹配三份旧 SHA 的文件，保留编辑、删除、启用状态、使用次数和 receipt。恢复扫描同时接受两种品牌的备份/快照名。

预Android12启动背景改为宿主独有的 `android12splash` 引用，避免远控模块的同名 splash 横竖屏资源覆盖。资源再生成需最后执行 `prepare_mobicodex_branding.dart --finalize-android`，步骤见[构建说明](../../../integrations/kelivo/README.md)。

当前整合热更新源为空，Flutter AOT 和 Android 图标/启动资源不能由现有 Web 热更新替换。本轮使用已存在的「设置 → 应用更新」APK 覆盖安装；不切换电脑网关，不执行真实模型或电脑任务。

## 检查证据

| 检查 | 最终结果 |
| --- | --- |
| 根 `corepack pnpm verify` | 通过；手机169/后端422，消息、类型、lint、构建、插件和更新路径通过 |
| 完整 Dart 分析 | lib/test/integration_test 与品牌工具无问题 |
| Flutter 定向回归 | 品牌、内置配置/MCP、技能升级、备份/恢复、通知、请求头、OAuth、交互UI等通过；最终追加70、61、18项分组通过，恢复页18项通过 |
| 原生正式构建 | `verify-kelivo --preview --repeat-tests` 最终成功，340测试/39 suites，0失败/错误/跳过 |
| 完整 Android lint | 宿主/远控0 Error/Fatal，66/1 Warning；包含生成图标重复/形状及保留的旧 splash 未使用提示，未关闭检查 |
| APK实际核验 | code10、minSdk24、arm64 AOT；同code9预览证书；5份Web文件字节一致、37份图标/启动资源像素一致，预31启动引用隔离；测试runner/fixture不入包 |
| 浏览器 | 独立合成夹具实际显示 MobiCodex / v0.1.8-native-preview；不代表系统安装已完成 |
| 匹配源码 | 5934文件/5939归档项；5052固定来源完整，全部字节回读一致，无未审核高可信凭证模式；13处原上游合成Key按精确旧SHA放行 |

首次原生运行发现两个旧名称断言及应用名不可翻译标记缺失，已修正后完整复跑通过。只读复核发现恢复扫描和聊天工具展示遗漏，修正并验证；包核验同时检查了资源缩名映射与同名启动图冲突。追加Flutter检查曾因本机磁盘不足中断；仅回收本轮可再生缓存、退出本轮构建进程并串行复跑后通过，没有清理用户数据。一次测试路径写错仅影响该文件装载，正确路径复跑18项通过；恢复页同组18项通过。最终构建使用单次Gradle daemon、3GiB堆和1GiB metaspace，正式检查保持。

原始日志与回执：`output/audit/2026-11-07/mobicodex-branding/`。本轮复用既有图标/启动生成依赖、原生检查、对应源码扫描/打包和原子发布流程；没有新增通用技能或自动化。

## 交付与手机状态

0.1.8-native-preview / versionCode10；[版本目录](../../../releases/android/kelivo-preview/0.1.8/)包含APK、对应源码、元数据及SHA256。APK 60,752,427字节，SHA256 `55cd1ba56009fde374f2964c560a6f6a0224aba8e0555c79096b3583f7b3c049`；源码21,287,624字节，SHA256 `ce234665805b9d8502f467542d7ca0d2e7cb18a70a4b1a65dbfad9f1e4de8619`。证书SHA256仍为 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`。

源码提交 `76da5fbbbcad55d90ddbfd25e783a80346d527b5` 已推送现有 main。5934份归档源码的Git blob与权限全部匹配；GitHub版本目录6份文件均完整回下载、大小/SHA/全部字节一致，大文件以HTTP206分段拼合验证。

独立App源先发布源码，再APK/清单及MobiCodex下载页；latest10/previous9，previous源码逐字节保留code9。APK 60,752,427字节及源码21,287,624字节均从公网完整HTTPS下载，与本地全部字节/SHA一致；Range206、CORS、安装页字节及原四通道清单内容/SHA保持均通过。当前App实际清单读取/解析函数识别code10，code9可升级。公开下载页已通过浏览器核验，新图标、MobiCodex和code10可见；临时夹具与浏览器页已关闭。

最终交付回执见[mobicodex-branding-verification.json](mobicodex-branding-verification.json)。沿用main与新annotated preview标签 `codex-to-phone-v0.1.8-native-preview`，远端标签展开值单独核对；不新建仓库/分支/Release，不改变在线网关。

## code10 用户真机验收

2026-11-07，用户对「通过设置 → 应用更新升级到0.1.8/code10，检查桌面新图标、MobiCodex名称、关于页、原电脑连接与AI配置」的验收问题回复：「已升级，图标名称与原配置都正常」。问答来源：`call_R3dQZxDafEUVUFsFshKMuBvS`，第0项。手机覆盖升级、品牌显示及原配置保持按用户反馈记为通过，本轮品牌与更新需求闭环。

验收来源为用户自报，未通过ADB回拉已安装APK或独立核验其SHA256。完整59组功能验收继续由原整合任务管理，不扩大本次品牌交付的结论。
