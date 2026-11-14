# B2 扫描前后对照（基线 ce877ba）

扫描范围：`apps/kelivo` 全树，重点人工分类 Dart、四份 ARB、Android manifest/资源/通知、iOS/macOS 系统/分享文案、Windows/Linux 窗口、Web manifest/index、assets；另扫描 `apps/mobile` 和 `.github/workflows`。源码注释、依赖、开发工具/测试夹具、协议/标识、持久化路径与用户内容不按产品文案替换。

## 本轮修改

43 个源文案/标题位置（按源文件行计，一行中英双语算一处，不重复计生成 Dart），另有 1 个桌面 MCP 品牌展示入口，共 44 处。以下行号为基线扫描位置；除最后单列展示映射，原文中的 `Kelivo`/`kelivo` 替换为 `MobiCodex`，`KelivoIN` 展示为 `MobiCodex IN`，其余句子含义不变。

| 基线文件:行 | 修改前（长文仅摘录） | 修改后 |
| --- | --- | --- |
| `apps/kelivo/ios/GenerationActivityExtension/Info.plist:8` | CFBundleDisplayName: Kelivo | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:10` | CFBundleDisplayName: Kelivo | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:24` | CFBundleName: kelivo | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:59` | NSHealthShareUsageDescription: Kelivo 需要读取您选择的健康数据，以便生成健康活动摘要。摘要可能会发送给您选择的 AI 服务以生成回答。 / Kelivo need… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:61` | NSHealthUpdateUsageDescription: Kelivo 不会写入健康数据。此说明仅用于满足系统对 HealthKit 的要求。 / Kelivo does not write h… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:63` | NSLocationWhenInUseUsageDescription: Kelivo 可按您的选择使用定位提供天气或位置工具（工具定位可能发送给您选择的 AI 服务），也可在您开启辅助保活后，用低精… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:65` | NSLocationAlwaysAndWhenInUseUsageDescription: 仅当您开启定位辅助保活且有后台任务时，Kelivo 使用低精度定位辅助执行，不保存或发送坐标。 / When… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:67` | NSRemindersFullAccessUsageDescription: Kelivo 需要访问提醒事项，以便在您确认后查询、创建和完成提醒。提醒内容可能会发送给您选择的 AI 服务以生成回答。 … | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:69` | NSRemindersUsageDescription: Kelivo 需要访问提醒事项，以便在您确认后查询、创建和完成提醒。提醒内容可能会发送给您选择的 AI 服务以生成回答。 / Kelivo n… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:71` | NSCalendarsFullAccessUsageDescription: Kelivo 需要访问日历，以便 AI 助手在您授权后查询和创建日程；数据仅在设备上处理，我们不会收集这些信息。 / Ke… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:73` | NSCalendarsUsageDescription: Kelivo 需要访问日历，以便 AI 助手在您授权后查询和创建日程；数据仅在设备上处理，我们不会收集这些信息。 / Kelivo needs… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:75` | NSCameraUsageDescription: Kelivo 需要使用相机拍摄照片，以便您将图片发送给 AI 助手进行分析。您可以选择是否上传照片。 / Kelivo uses the camer… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:77` | NSMicrophoneUsageDescription: Kelivo 使用麦克风录制您主动提交的语音并转换为文字；我们不会收集这些信息。 / Kelivo uses the microphone … | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/Info.plist:79` | NSSpeechRecognitionUsageDescription: Kelivo 使用系统语音识别将您主动录制的语音转换为文字。您的数据由系统处理；我们不会收集这些信息。 / Kelivo us… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/MobileBackgroundHandler.swift:21` | title = String((map["title"] as? String ?? "Kelivo").prefix(120)) | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/MobileBackgroundHandler.swift:239` | result(FlutterError(code: "foreground_required", message: "Open Kelivo to request permission.", deta… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/Runner/MobileBackgroundHandler.swift:502` | staleMessage: labels["stale"] ?? "Open Kelivo to check the task.") | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/Info.plist:8` | CFBundleDisplayName: Kelivo | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/en.lproj/Localizable.strings:1` | "saved" = "Saved to Kelivo"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/en.lproj/Localizable.strings:2` | "savedMessage" = "Open Kelivo to review and send this draft."; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/en.lproj/Localizable.strings:3` | "partialMessage" = "Some files could not be saved. Open Kelivo to review the content that was received."; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/en.lproj/Localizable.strings:9` | "opening" = "Opening Kelivo…"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hans.lproj/Localizable.strings:1` | "saved" = "已保存到 Kelivo"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hans.lproj/Localizable.strings:2` | "savedMessage" = "打开 Kelivo 即可继续编辑并发送。"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hans.lproj/Localizable.strings:3` | "partialMessage" = "部分文件未能保存。打开 Kelivo 可查看已接收的内容。"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hans.lproj/Localizable.strings:9` | "opening" = "正在打开 Kelivo…"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hant.lproj/Localizable.strings:1` | "saved" = "已儲存到 Kelivo"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hant.lproj/Localizable.strings:2` | "savedMessage" = "開啟 Kelivo 即可繼續編輯並傳送。"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hant.lproj/Localizable.strings:3` | "partialMessage" = "部分檔案未能儲存。開啟 Kelivo 可查看已接收的內容。"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/ios/ShareExtension/zh-Hant.lproj/Localizable.strings:9` | "opening" = "正在開啟 Kelivo…"; | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/lib/desktop/setting/providers_pane.dart:322` | (name: 'KelivoIN', key: 'KelivoIN'), | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/lib/features/settings/pages/legacy_memory_page.dart:144` | '${dir.path}/kelivo-legacy-memory-${DateTime.now().millisecondsSinceEpoch}.txt', | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/linux/runner/my_application.cc:86` | gtk_header_bar_set_title(header_bar, "kelivo"); | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/linux/runner/my_application.cc:90` | gtk_window_set_title(window, "kelivo"); | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/macos/Runner/Info.plist:37` | NSMicrophoneUsageDescription: Kelivo 使用麦克风录制您主动提交的语音并转换为文字；我们不会收集这些信息。 / Kelivo uses the microphone … | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/macos/Runner/Info.plist:39` | NSSpeechRecognitionUsageDescription: Kelivo 使用系统语音识别将您主动录制的语音转换为文字。您的数据由系统处理；我们不会收集这些信息。 / Kelivo us… | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/web/index.html:24` | <meta name="apple-mobile-web-app-title" content="kelivo"> | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/web/index.html:30` | <title>kelivo</title> | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/web/manifest.json:2` | "name": "kelivo", | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/web/manifest.json:3` | "short_name": "kelivo", | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/windows/runner/Runner.rc:93` | VALUE "FileDescription", "kelivo" "\0" | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/windows/runner/main.cpp:22` | Win32Window::SendAppLinkToInstance(L"kelivo"); | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/windows/runner/main.cpp:43` | if (!window.Create(L"kelivo", origin, size)) { | 同位置品牌显示为 MobiCodex |
| `apps/kelivo/lib/desktop/setting/mcp_edit_dialog.dart:88` | `server.name` 显示 `@kelivo/fetch` | `server.displayName` 显示 `@MobiCodex/fetch`；内置服务保存仍只更新 enabled，原 name/id 不变 |

另行补齐：

| 位置 | 修改前 | 修改后 |
| --- | --- | --- |
| 四份 ARB 的 `aboutPageUpstreamSource` | 上游开源项目 / Upstream open source | 基于开源项目 Kelivo（AGPL-3.0）；繁体、英文对应文案 |
| 四份 ARB 的 `aboutPageAppDescription` | 开源 AI 助手 | MobiCodex · AI 助手与电脑工作台；繁体、英文对应文案 |
| 手机/桌面关于页产品网站、GitHub（共 4 处） | `https://github.com/luoz76070-art/project` | `https://github.com/luoz76070-art/MobiCodex` |
| 手机关于页上游致谢行 | 一行省略 | 允许换行，完整显示项目名和 AGPL-3.0，点击打开原项目 |
| macOS Info.plist | CFBundleName 使用 PRODUCT_NAME、无 CFBundleDisplayName | 两个显示字段均为 MobiCodex；PRODUCT_NAME、可执行文件名和 bundle ID 保留 |
| zh_Hans / zh_Hant ARB | 4,607 / 4,631 个消息键 | 均为 4,653 个；分别补 46 / 22 个缺键，与 en/zh 一致 |
| tracked 本地化 Dart | 旧简介/泛化的上游行，缺项依赖继承 | 同步新文案及补齐的 ARB；简体沿用 zh，繁体补译图片上下文；无新增本地化 API |

## 基线已完成，核对后保持

| 页面或资源 | 扫描前 | 扫描后 |
| --- | --- | --- |
| Android `values/strings.xml` app_name / Manifest label | MobiCodex / 引用 app_name | 不变 |
| Android 通知/后台悬浮窗/文件提供器/辅助服务 | MobiCodex | 不变 |
| Dart main 的启动/MaterialApp/窗口标题、托盘提示 | MobiCodex | 不变 |
| Flutter 手机和桌面关于页产品名称 | 四语言 aboutPageAppName = MobiCodex | 不变 |
| ARB 的重启、分享、通知、后台、备份等产品文案 | 无 Kelivo 值，已是 MobiCodex | 保持；仅致谢值新增 Kelivo |
| brand_assets 显示名、手机供应商名、搜索服务显示名 | MobiCodex / MobiCodex IN | 不变，内部 id 仍为 kelivo / KelivoIN |
| MCP 列表/手机编辑页 | 使用已有 displayName 展示 MobiCodex | 不变；桌面编辑页本轮补齐 |
| apps/mobile | 未发现用户可见 Kelivo 文案；命中仅 isKelivoHost、VITE_KELIVO_HOST、注释等 | 不变，无需安装依赖或跑条件性的 test:mobile/typecheck |

## 保留项与扫描边界

- **产品文案的 Kelivo 仅保留在关于页上游致谢**：`aboutPageUpstreamSource` 四语 ARB 和同步 Dart；手机 `about_page.dart`、桌面 `about_pane.dart` 复用该字段。原项目链接 https://github.com/Chevey339/kelivo 和原许可链接 https://github.com/Chevey339/kelivo/blob/master/LICENSE 保留。
- LICENSE、NOTICE、版权声明/头、AGPL 文本与第三方归属不改；赞助/上游转换工具/服务 URL 保持真实目标，不将上游服务冒充自有服务。
- applicationId/namespace/包名、Dart package、类名、channel/通知 ID、OAuth scheme、app group、`brand_assets` id、`KelivoIN`、MCP 函数/服务 ID 不改。
- `kelivo_backups` 是现有 WebDAV/S3 路径，`kelivo.db`/`kelivo-data`/恢复快照名、备份格式和内部临时路径属于数据契约；不改路径、不迁移用户设置。设置中的实际路径、用户自定义名称、源代码/调试视图中的 `kelivo-ui`/`kelivo://` 等技术标识仍按真实值显示，不能声称原始全文搜索零命中。
- Windows `ProductName` 保留 `kelivo`，用于 path_provider 的原数据目录身份；仅 FileDescription/窗口标题改名。InternalName/OriginalFilename、mutex 不改；macOS PRODUCT_NAME/构建产物名、Linux BINARY_NAME/图标 ID 亦保留。系统文件属性中的内部元数据并非 App 品牌文案，B3 若改需另做数据兼容验证。

## 交给 Claude 的工作流/产物命名项（本轮未修改）

- `.github/workflows/release-kelivo.yml:6,10,12,116`：tag 触发模式、dispatch 示例/默认值、expected_tag 从 `mobicodex-kelivo-v*` 统一到批准的新 MobiCodex tag 规则（例如 `mobicodex-v*`，与其他发布线避免重名，保留 preview 标识）。旧 tag 不重写。
- 同文件 `:1,33,276,278,297,300`：工作流/job、Release 标题及说明中的 “MobiCodex Kelivo / Kelivo AI chat” 改为 MobiCodex 品牌；原项目归属仍在许可说明保留。`:256,393` 的 CI artifact 显示名称也可统一。
- APK 真实导出名**不在 Gradle**：`scripts/verify-kelivo.mjs:106` 当前为 `mobile-codex-kelivo-${releaseVersion}-arm64.apk`，建议改 `MobiCodex-${releaseVersion}-arm64.apk`；同步核对源码归档命名、下载清单、发布脚本及引用，工作流当前通过 glob 收集 APK。本轮未擅改发布链。
- `apps/kelivo` 路径、独立 `kelivo-preview` 更新通道、applicationId 和签名不随显示命名改变；这些属于内部契约/B3 范围。

## 验证结果与限制

- Python 标准库审计：4 份 ARB 合法 JSON、无重复键、均 4,653 个消息键；本轮变更/新增项占位符一致，与 tracked Dart 的值/签名一致；各生成类无重复 String 方法。简繁基线原有 ICU 写法差异未按字符串正则全量改写。
- 9 份 plist 可解析，4 份修改 plist 的非显示身份字段逐项与基线相同；3 份 Localizable.strings 通过 `plutil -lint`。
- 25 份宿主 Android XML 通过 `xmllint --nonet --noout`；Android app/build.gradle.kts、Manifest、pubspec、brand_assets、backup 模型、MCP 持久化模型、product_identity 与基线逐字一致；改动文件版权行逐行保持。
- `lgit diff --check` 通过；未改 .github/workflows、LICENSE、NOTICE、apps/mobile。
- 本机没有 Flutter/Dart：未执行 Flutter 测试、gen-l10n、dart format/analyze、APK 构建或各平台 UI/覆盖升级。tracked 本地化按既有生成格式同步；Claude 发布前须用 Flutter 重生成本地化并检查分析/格式及关于页窄屏换行。静态验证不等于真机验收。
