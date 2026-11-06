# Kelivo 原生产品接线与独立预览

日期：2026-11-05。用户“进行下一轮”启动[上一轮计划](../../plans/2026-11-05-kelivo-native-next.md)。本轮完成原生阻断处理、正式来源引入、独立产品身份和 AI／电脑／设置入口，生成本机签名预览。最终 Flutter 全量11,437项通过、3项跳过、0失败；原生交互和完整59组功能仍未验收，不称全功能整合或稳定版。

## 交付物

- [独立 Android 预览 APK](../../../output/kelivo/mobile-codex-kelivo-0.1.0-preview-arm64.apk)，60,964,391字节；[实际元数据](../../../output/kelivo/mobile-codex-kelivo-0.1.0-preview-arm64.apk.json)。SHA256：`0283ceac8a2029087035cd14fb47a9e6814e8535d5d8d75ce44d7d47cc5b4d0c`。
- 身份：`com.mobilecodex.kelivo.preview`，`Mobile Codex Preview`，`0.1.0-native-preview` / code2，minSdk24，Flutter AOT 为 arm64。包中其他 ABI 的 PRoot 库不代表其他 ABI 可启动。
- 显式启用本机 Android Debug 签名，证书 SHA256：`3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`。这是预览签名，不是生产发布签名。
- 当前只生成本地文件，没有手机公网下载地址；未发布、部署、覆盖用户手机或迁移原两App私有数据。

## 产品行为

Android 主程序沿用 Kelivo Flutter AI 业务，底部提供 AI、电脑、设置三个同级入口；电脑直接进入原远控，不要求配置手机模型。AI不依赖Mac，导航不参与模型判断或自动任务提交。全局主题由 Kelivo SettingsProvider 拥有，实际配色经宿主传给远控；设置新增“电脑连接与控制”，直达原连接/设备/运行策略设置，即使上次停在Agent也能打开。

AI/设置通过 IndexedStack 保持挂载。电脑使用内部 RemoteControlActivity，返回复用 MainActivity；远控 WebView 可销毁，通过各自持久状态恢复草稿、已上传附件元数据、会话选择与有界阅读位置。保存关键输入失败或上传中阻止跨入口导航。Agent发送前保存clientMessageId/原文，结果未知时重开继续锁定且不自动重发；仅匹配权威确认清理原待确认项。任意深历史分页内容与像素位置不因此宣称完整恢复。

Android OAuth scheme 更改为 `mobilecodex.kelivo.preview`，Manifest/Kotlin/Dart/测试一致；新包备份URI采用精确白名单，邻近包名仍拒绝。iOS保留原路径，本轮不交付其他平台。预览关闭上游Kelivo更新请求，远控两更新源显式为空，显示实际code2及尚未开通说明；原项目帮助/归属链接保留。

可选“交给电脑”、原Desktop新建能力和59组完整功能对照本轮未实施/未验收，接续见[下一轮计划](../../plans/2026-11-05-kelivo-product-acceptance.md)。

## 固定来源与原生修复

`apps/kelivo/` 引入固定 v1.3.4 / `4a7da9b6f5d77caccb9f8aaf656232a93ab14708`；保留LICENSE、业务、测试、本地依赖及平台目录。上游归档SHA和5052个来源文件SHA分别在[版本元数据](../../../integrations/kelivo/upstream.json)与[原始清单](../../../integrations/kelivo/source-files.json)。原版5059文件对照仍在output，未修改。

[逐文件差异](../../../output/audit/2026-11-05/kelivo-product/source-changes-final.json)：5052个来源文件无缺失，26个文件有差异，新增10个宿主/兼容/测试文件；另排除上游归档7个生成文件。两份pub锁仅下载域名不同，归一化后SHA均等于原始锁，依赖版本与包SHA保持。没有从零重写Kelivo业务。

原仓库`logs/`/`config.json`规则及上游自身ignore会在首次引入时隐藏12个原已跟踪文件，包括日志解析器/测试和固定平台注册表。两份局部`.gitignore`仅为这12个确切路径补例外；5052个来源文件加10个新增文件均可被Git识别，build、私有工具缓存与本机产物继续忽略。没有执行暂存或提交。

- 文件API：使用 `desugar_jdk_libs_nio:2.0.4`，清理器保留NOFOLLOW_LINKS，只有确认路径不存在才忽略IO异常；API24/25使用File权限接口。PRoot进程消失检查保留异常分支。
- 进程API：API26+使用原isAlive/waitFor，24/25使用exitValue与有界nanoTime轮询，保留中断。
- 输入连接：排空已接受编辑后调用framework关闭；增加关闭顺序测试。
- 目录授权：明确READ／READ|WRITE分支。
- 资源：启动主题在v28/v29分层声明系统属性；不提高minSdk。
- UCrop：显式同版本2.2.11依赖，修正完整lint依赖模型；DEX类定义中确认其Activity实际存在。
- 返回：保留原AndroidSelectionMenu选择期间API33+ overlay callback，删除旧onBackPressed覆盖，旧按键仅在菜单处理时消费；没有新增全局overlay回调干扰IME。
- FileObserver：自定义Shadow移到测试类级配置，去掉方法级混用；新增兼容与导航等测试后原生318项，两次完整复跑通过。此前4项Shadow异常日志保留；不能据两次通过承诺永久无偶发。

完整检查没有关闭lint、增加blanket baseline、删除功能或提高minSdk。早期失败修复过程见下方原始日志。

## 正式构建与包内核对

入口为[verify-kelivo.mjs](../../../scripts/verify-kelivo.mjs)，操作说明见[integrations/kelivo](../../../integrations/kelivo/README.md)。固定Flutter3.47.6 / Dart3.13.5；Gradle/lint使用JDK17，编译/测试使用JDK25，Android36/NDK28.2。镜像及代理只作为本机构建参数。

```sh
node scripts/verify-kelivo.mjs --preview --repeat-tests
```

完整lint、原生测试与签名预览最后一次强制全量复跑6分05秒成功（[日志](../../../output/audit/2026-11-05/kelivo-product/native-preview-final.log)）。随后补Dart两处大括号，同入口增量1分57秒成功（[中间包日志](../../../output/audit/2026-11-05/kelivo-product/native-preview-closeout.log)）。最终在Flutter全量结束后，以`--preview`重打包含Agent退出前草稿保护的成品，Gradle阶段1分05秒成功（[交付构建日志](../../../output/audit/2026-11-05/kelivo-product/native-preview-delivery.log)）。最后一轮原生测试按增量入口执行，未改原生源码，不重复计为第三次强制全量复跑。

[最终包内核对](../../../output/audit/2026-11-05/kelivo-product/apk-inspection-final.json)针对SHA `0283ceac…`重新执行，确认签名证书、包名/version/minSdk、唯一KelivoApplication与主launcher、内部远控Activity、新OAuth scheme与全部新包Provider authority、六原远控插件加ProductHost及UCrop的DEX类定义、原生CapacitorHttp启用、arm64引擎/AOT。5个远控Web文件与最终独立bundle逐字节一致，无多余旧文件。复现脚本为`output/audit/2026-11-05/kelivo-product/inspect-final-apk.py`，使用构建环境的JDK运行；原始Manifest、badging及签名输出另存同目录。唯一运行时引擎所有权由原Application源码核查，包内库数量不作为运行实例数量证据。

## 检查结果

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| 宿主完整lintRelease | 0 Error/Fatal，56 Warning | native-preview-delivery.log及宿主XML |
| 远控完整lintRelease | 0 Error/Fatal，1 Warning | 同上及远控XML |
| Android原生全量 | 318/318，无跳过；两次强制复跑通过 | native-tests-final.json及testReleaseUnitTest XML |
| 原远控正式 `corepack pnpm verify` | 全部通过；草稿保护修补后手机132、后端403及其他检查 | remote-verify-closeout.log |
| Agent退出前保存回归 | 7/7；读取真实组件effect验证保存/失败阻断，浏览器存储失败留在原页 | agent-save-lifecycle-final2.log及下方截图 |
| 正式验证入口回归 | 8/8；包含两份固定锁与未知参数检查 | verification-entry-final.log |
| `dart analyze --fatal-infos lib test integration_test` | No issues found | dart-analyze-final3.log |
| Flutter最新定向及全量失败文件复核 | 51/51通过 | flutter-targeted-final2.log |
| Flutter全量最终复核 | 35分17秒，11,437通过、3跳过、0失败，退出0 | flutter-full-final.log及flutter-tests-final.json |
| markstream锁、分析、全量 | 固定锁通过、No issues found、351/351 | markstream-pub-get/analyze/tests.log |
| 浏览器12组尺寸/主题/字号 | 主入口可见，无横向溢出，底栏在viewport | browser-layout-matrix.json |
| 浏览器草稿/设置接线 | Codex及Agent各自重开草稿保持；设置直达电脑 | 下方截图及fixture |

此表日志和JSON均位于 `output/audit/2026-11-05/kelivo-product/`，构建产生的原生完整XML位于 `apps/kelivo/build/{app,mobile-codex-remote}/reports/`。本轮未提交真实模型/电脑任务。

首次Flutter全量41分49秒结束：11,432通过、3跳过、5失败。失败为工作区iOS导入等待、三项头像解码等待，以及启动恢复导航测试。该长进程在最终导航恢复保护修改前启动，不能作为最终源码完整通过的证据；全部相关文件在当前源码、concurrency2下51项复核通过。保留首轮全量，不将定向通过写成首轮全量通过。最终又在停止模拟器/Gradle后以concurrency4完整复核，35分17秒结束、退出0；前段另运行过远控Node检查，未并行运行另一套同根Flutter测试或Gradle构建。最终通过不代表永久消除测试偶发，3项跳过也不计为通过。

最后自审发现Agent草稿原先只靠700ms/pagehide保存，新增跨Activity退出事件遗漏同步保存。补上退出前flush，保存失败取消导航；当前编辑项提升到有界缓存末端。`agent-save-regression-before.log`先验证失败，修补后`agent-save-regression-after.log`6项通过；增加真实组件effect提取回归后最终7项通过。首次effect测试打包漏设TS loader，`agent-save-lifecycle-final.log`保留失败，修正测试入口后`agent-save-lifecycle-final2.log`通过。浏览器`agentStorage=fail`注入仅影响合成环境，点击AI显示保护提示且保留当前草稿，见[截图](../../../output/audit/2026-11-05/kelivo-product/agent-storage-failure-blocked.png)。原远控完整verify随后通过（132/403），新增第7项与最终lint另验；未改Dart或原生逻辑。

保留的其他失败：`native-compatibility-checks.log`（58降至3错误及堆内存异常）、`native-product-checks-2.log`（Os API编译尝试）、`native-product-checks-3.log`（Os shadow文件操作测试4失败）、`flutter-targeted.log`（旧OAuth断言1失败）及 `dart-analyze-final2.log`（大括号2项）。这些均由后续实际修改及对应复核收尾，不删除日志。

### 浏览器与原生边界

浏览器使用 `UI_FIXTURE_DIST=output/kelivo/remote-web node scripts/serve-ui-fixture.mjs`，仅合成数据。360/390/430px × 浅深 × 100/150%共12组；Agent懒加载/会话与电脑设置保持相同主导航。截图：[电脑深色大字号](../../../output/audit/2026-11-05/kelivo-product/remote-dark-large.png)、[Agent独立草稿恢复](../../../output/audit/2026-11-05/kelivo-product/agent-draft-restored.png)、[电脑设置直达](../../../output/audit/2026-11-05/kelivo-product/computer-settings-direct.png)。fixture的AI/设置跳转只记录宿主请求，不计真实Flutter切换。

Android36 arm64独立模拟器安装并启动大括号修正前的签名包（SHA `a9919c61e362755a80b49d41b8245ae44aa3b82ce4b32f94d26fedc8d894bd13`），ADB安装成功。`am start -W`先超时，后续ActivityTaskManager明确记录56.233秒首帧及Fully drawn，主Activity为RESUMED，采集时crash buffer为空。证据：`emulator-launch-final.log`、`emulator-activity-final.txt`、`emulator-logcat-final.txt`、`emulator-crash-final.txt`。这是繁忙主机模拟器启动记录，不能推定手机启动性能；最终包另包含Dart大括号和Agent退出前草稿保护修补，SHA不同，未安装最终成品做模拟器验收。

当前Computer Use无法识别裸Qt模拟器窗口，未完成原生点击、跨Activity主题/键盘/返回、系统回收或真实插件测试；没有用浏览器/Robolectric替代这些结论。模拟器已关闭，浏览器viewport已复原，本轮浏览器测试页和56766 fixture已关闭，最终打包启动的空闲Gradle也已停止（`gradle-stop-delivery.log`）。未操作用户原56405预览服务。

## 本轮与后续状态

正式源码、身份、统一入口和签名包已形成可审查结果；产品的原生完整验收、可选交接及59组矩阵仍为待完成。总Trellis任务保持 `in_progress`，不归档为完整交付。下一轮按[原生验收与完整功能计划](../../plans/2026-11-05-kelivo-product-acceptance.md)继续；文稿清理独立搁置。

本轮复用了原远控构建/通信/插件及Kelivo业务，新增正式验证脚本和[宿主契约](../../../.trellis/spec/mobile/frontend/kelivo-host-contract.md)，供后续稳定复现。没有Git暂存、提交、推送、部署或修改运行中的云端/电脑网关。

收尾核对：6份本轮核心文档的31个本地链接均存在（`document-links-final.json`）；`git diff --check -- .`通过。最后资源记录`resource-delivery-final.json`显示可用13.29GiB、无运行中的Gradle/Flutter测试/模拟器；本轮未追加清理用户文件或缓存。
