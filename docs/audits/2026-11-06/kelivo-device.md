# Kelivo 整合：设备与本地能力验收

日期：2026-11-06。用户“继续下一步”已启动[设备与全功能接续](../../plans/2026-11-06-kelivo-device-parity.md)。固定上游v1.3.4/4a7da9b6不变；统一Kelivo风格、AI与电脑独立入口、用户主动交接及59组完整目标继续保留。本轮已取得构建与模拟器局部设备证据；真机及完整功能对照仍继续进行，不将构建成功计作一比一完成。

## 本轮改动

上轮电脑正文配色已采用Flutter，但原生窗口仍使用旧远控主题；浅色下状态栏深底深字。`ProductWindowAppearance`让窗口底色和系统栏图标使用同一份Flutter外观，启动和偏好变化均应用。Android35+透明系统栏由窗口背景承托，IME避让仍由原`ProductWindowInsets`拥有。Android24/25没有深色导航图标，保持黑色导航底与可见图标；最低版本设备效果未验，不宣称逐像素相同。

电脑前台实际切换系统明暗另复现Flutter停止绘制、原外观快照滞后。现由Flutter在已有主题生成处提供实际浅深配色，ProductNavigation仅在system模式按当前Android配置选择；ProductHost在configuration/resume和偏好变化时同步窗口及Web。固定浅/深优先，不在原生重建动态/自定义颜色算法。

150%系统字体横屏复核发现，空白聊天页的flex子项仍允许收缩，居中内容溢出自身盒子，末行说明被输入框裁切。`.empty-chat`增加`flex: 0 0 auto`，短屏保留内容高度并交由既有消息区滚动；验收runner同时检查滚动前首元素和滚动后说明末行均可达。旋转保留草稿与布局可读性分别记录。

改动限远控宿主窗口、必要的Flutter配色元数据、空白聊天页滚动布局、独立测试runner、预览版本与验收文档。原模型/发送路径、在线网关与用户原App保持；没有Git写入、发布、部署或真实模型/电脑任务。

## 构建与检查

- 配色修复后`node scripts/verify-kelivo.mjs --preview --repeat-tests`通过，原生338项，0失败/跳过；横屏修补后正式`--preview`与最新runner完整宿主lint再次通过，宿主/远控0 Error/Fatal、56/1 Warning。日志`native-preview-palette.log`、`native-preview-layout.log`、`runner-build-layout-stable.log`，结果`native-tests-layout.json`。
- Flutter产品/消息更多菜单最终18项通过（含新增配色契约）；完整`dart analyze --fatal-infos lib test integration_test`无问题。首次指定了不存在的菜单测试路径，9项执行后整体失败；正确路径复跑17项通过，配色修改后18项通过，旧日志保留。本轮未重跑Flutter或markstream全量，上轮全量只作历史证据。
- 本地备份定向184项通过：`data_sync_backup_file_test`、`data_sync_business_database_test`、`backup_encryption_test`、`local_snapshot_service_test`与`kelivo_file_uri_test`。覆盖本地导出/覆盖与合并分支、加密往返/损坏、快照和路径等隔离行为；不能替代新包系统文件选择、外部Provider或真实设备备份往返。
- 原远控完整verify首轮手机152通过、后端402/403；`threadList.test.mjs`的文件变化通知用例在3秒期限内未观察到更新。未改产品或延长期限，单独复跑35.8ms通过。关闭本轮模拟器和空闲构建进程后顺序复跑完整`corepack pnpm verify`，手机152/后端403及入口8全部通过，lint/类型/构建/插件、消息/可执行文件、热更新/APK更新/发布隔离检查均通过（`verify-final.log`、`verify-summary.json`）。没有改后端源码或超时，文件通知首次超时的根因仍未定位，不能据复跑通过宣称稳定性已修复。
- 包内核对通过：独立包/版本/minSdk24、签名、唯一Application/launcher、内部电脑Activity、Provider与OAuth、原六插件/ProductHost/UCrop、arm64引擎/AOT及5个Web文件一致。内部窗口helper可被R8内联，不能要求其原类名留在DEX；其行为由测试另验。首次缺JAVA_HOME及新增内部类名断言失败均保留。

## 本地预览包

`output/kelivo/mobile-codex-kelivo-0.1.2-preview-arm64.apk`，`com.mobilecodex.kelivo.preview`，`0.1.2-native-preview`/code4，60,973,251字节，SHA256 `e3fa92e2e0d0ef3ec29a5af1996f390ffa7683e0999734dcb211431cdbf92a06`。本地Android Debug预览签名，证书SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`。旧code3保留；本轮首个code4（SHA前缀abb6762f）另存`code4-initial.apk`，配色修复包（SHA前缀3dc6c201）另存`code4-palette.apk`。最终包同时包含电脑前台系统主题及横屏布局修复，包内核对见`apk-inspection-layout.log`、`apk-inspection-final.json`；未发布公网下载或安装真机。

## 设备证据边界

本机adb没有手机，只安装Android36/default/arm64镜像；使用独立`kelivo-preview-audit`模拟器。独立测试APK不进入产品，不点击发送。最终新包安装成功，实际安装SHA与交付SHA一致（`device-installation-final.json`）。

最终SHA的`offline-device`报告passed、`INSTRUMENTATION_CODE: -1`，13项通过，报告及截图/树在`native-layout-final/`，原始输出`instrumentation-layout-stable.log`：

- 无模型或Mac时AI/电脑入口可达，Flutter→Capacitor真实Activity切换、独立编辑；返回保持AI草稿与原MainActivity。
- 全局设置和Android返回、WebView销毁重开后电脑草稿保持。
- 真实系统浅→深→浅、电脑前台直接切换系统主题，以及显式浅/深对抗相反系统主题；窗口底色、状态/导航图标与Flutter外观一致，多次系统栏采样像素等于对应背景色。
- 真实Android150%字体、IME打开/返回关闭后边距恢复、横竖屏旋转、Home→前台及硬件返回，草稿保持。横屏空白页首元素与说明末行分别可滚动到，不能将这一检查扩大为所有页面的横屏布局都完成验收。

最终包同包覆盖配色修复包后强制结束预览进程，`offline-recovery`在新进程中直接恢复既有AI与电脑草稿，未重输文本且未发送，报告passed/`INSTRUMENTATION_CODE: -1`，见`native-recovery-layout/result.json`与`instrumentation-recovery-layout.log`。这只证明同版本开发覆盖与显式进程重启恢复；正式递增版本升级、真实低内存回收及手势导航仍需单列。

横屏修复前，同一新增几何断言在旧SHA上失败：首元素top40.45低于可见上界73.88，空白页盒子高40却有97的内容高度，证据`instrumentation-layout-before.log`、`native-layout-before/`。修复后首元素top117.88可达，滚动后说明末行bottom112.36位于视口下界156.71以内；盒子与内容高度均195。新包首次综合复验在字体切换后等待特定工具栏无障碍节点时失败，截图已显示电脑页及草稿；随后仅将runner就绪条件改为主导航并完整复验13项通过，`native-layout-first/`与原日志保留。该工具栏可访问性瞬态未单独证明根因已修复。

模拟器系统字体恢复1.0、Night恢复no、旋转0/自动旋转1，已读回确认。设备摘要`device-result-summary.json`；此前配色包12项通过的摘要另存`device-result-palette-summary.json`，不能混为最终SHA。

早期runner失败分别保留：菜单为英文但只按中文定位；上次失败停在设置而下次未先返回AI；release R8移除只由测试引用的AndroidX方法导致runner崩溃。已分别修正定位、初始导航及测试使用framework检查接口；测试崩溃不计产品业务通过，也不归因于模型或任务。后续每次证据写独立场景/时间子目录，避免旧`failure.png`混入成功证据。

## 剩余范围

真机与Android24设备、真实低内存回收、全部系统权限/文件Provider/分享/录音/通知与外部回调、OAuth账号、真实模型与电脑接收、原Desktop新建及59组全部适用子项继续待验。已异步请求用户指定真实测试设备、模型、电脑会话及发送内容；答复前只执行隔离检查。整组仍为0/59，局部证据回写[账本](kelivo-parity-evidence.md)。

来源复核：5052来源文件无缺失，28个来源文件有差异、16个非忽略新增；锁文件归一化仍等于固定上游。最终精确清单`source-changes-layout.json`，配色阶段清单仍保留。

完整原始证据在`output/audit/2026-11-06/kelivo-device/`。

## 资源与接续

本轮独立模拟器已关闭；Gradle45918经`--status`确认为IDLE后，连同本轮Kotlin子进程46091按PID/父进程/命令核对后正常结束。未清理源码、依赖缓存或验收证据，未触及在线网关。收尾可用10,336,620,544字节（9.63GiB），见`resource-final.json`。复用既有正式构建入口、原生验收runner和宿主契约，补充短屏滚动约束；没有另建通用skill或定时任务。

下一步仍按已启动计划补真机与Android24、系统插件/备份往返、授权真实联动及原Desktop新建能力，再按59组全部适用子项验收。当前总任务保持`in_progress`，整组完成0/59；文稿清理继续搁置。
