# Kelivo 整合：交接接线与原生预览验收

日期：2026-11-06。用户“继续下一轮”授权执行[接续计划](../../plans/2026-11-05-kelivo-product-acceptance.md)。本轮完成已有Desktop会话的可选交接、隔离检查、Android36模拟器离线流程及本地签名预览；完整一比一目标仍未完成，见[59组证据账本](kelivo-parity-evidence.md)和[下一轮计划](../../plans/2026-11-06-kelivo-device-parity.md)。

## 可安装产物

- 本地文件：`output/kelivo/mobile-codex-kelivo-0.1.1-preview-arm64.apk`；60,973,771字节。
- SHA256：`ec663ce1dc88776649535faf0e4c482fc00716e7ba7871e383e03e8ad6663e1d`。
- 包名`com.mobilecodex.kelivo.preview`，`0.1.1-native-preview` / code3，minSdk24，arm64 AOT。
- 显式本机Android Debug预览签名，证书SHA256：`3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`。没有发布、公网下载地址或真实手机安装记录。
- 最终包ZIP、签名、唯一Application/launcher、内部远控Activity、全部Provider authority、新OAuth scheme、原六插件/ProductHost/UCrop类定义、Flutter引擎与AOT、原生HTTP及5个Web文件逐字节核对通过。产品DEX不含instrumentation runner，Web不含合成fixture。模拟器已安装文件的SHA与上值完全一致。

包内记录：`output/audit/2026-11-06/kelivo-handoff/apk-inspection-final.json`、`apk-inspection-delivery.log`、`device-installation-final.json`。code2及本轮较早code3的日志保持历史含义，不能作为这个SHA的验收替代。

## 用户可见行为与边界

AI、电脑和设置继续为同级独立入口。AI消息“更多→交给电脑”仅准备用户选中的单条非流式正文；不自动转发完整历史或原消息附件。电脑侧同一张卡编辑任务说明、选择项目与已有Desktop会话、按需添加文件，再确认一次。附件复用原`/api/uploads`路径。

确认前原生SharedPreferences同步commit冻结scope/thread/message/clientMessageId，成功后才复用原`sendDesktopMessage`路径；电脑空闲时start，运行中queue，不自动steer。取消未提交草稿不发送，重复点击只提交一次；未知结果重开仍锁定，不自动重发。队列接收与Desktop接收分别显示，迟到队列回执不降低已知Desktop确认。

交接与普通远控草稿使用独立缓存；`pendingMessageSource: 'handoff'`随输入缓存恢复，匹配确认只清交接pending，不清同文普通草稿或附件。未知交接期间普通发送也不能复用该ID。存储失败/上传中阻止确认或离开；跨连接必须核对scope并清除原附件后重新选择。

当前`apps/relay/src/desktop/desktopNativeControl.ts`接入的是已有conversation的start/steer/interrupt，队列由原`desktopMessageQueue`拥有，没有原Desktop新建conversation接口。新建按钮显式禁用，未调用legacy/app-server替代。该结论只针对本项目当前适配器，不断言上游永久不支持新建；完整目标继续保留。

## 原生修复与设备证据

Android16/SDK36独立模拟器`emulator-5554`，无模型配置及Mac连接。测试APK使用标准Instrumentation/UiAutomation，限制独立preview与模拟器，不进入产品APK，不点击发送；“新线程”只打开本地未发送草稿。

实际测试发现并修复两项宿主问题：

1. Android35+边缘布局只避让系统栏，键盘覆盖电脑输入框。`ProductWindowInsets`合并systemBars/displayCutout/IME，取最大inset，收起恢复系统栏。新增生产路径回归，最终包实际键盘输入可见。
2. WebView报告`prefers-color-scheme: dark`，而Flutter与系统为浅色，造成跨入口明暗不一致。电脑页改以Flutter实际`appearance.dark`与palette为准；原生偏好变化通过明确`detail`包络的窗口事件同步。真实bridge复验覆盖变化和恢复，启动快照不能覆盖已收到的新主题。

最终SHA的`instrumentation-delivery.log`为`report.status=passed`、`INSTRUMENTATION_CODE: -1`，6项通过：离线两入口；电脑主题与Flutter一致及原生主题事件恢复；真实Flutter→Capacitor切换和独立输入；返回保留AI草稿与原MainActivity；设置独立打开及Android按键返回保留AI草稿；电脑WebView销毁重开恢复草稿。截图/可访问树/报告位于`native-delivery-evidence/`，人工复核03电脑输入（键盘可见）与04返回AI草稿截图。设备目录残留的旧failure文件已移入该目录`prior-run-failure/`单独保留，不属于此次通过步骤。原生主题变化采用隔离偏好载荷，不当作真实系统主题切换/全字体与真机验收。

测试脚本早期失败亦保留：同名标题/按钮误选、WebView accessibility点击无效、Ctrl+A不适用原生镜像、窗口/动画未稳定。使用实际键盘、实时可点击节点和窗口焦点/idle等待后，原先“设置返回AI为空”的现象未再出现；没有把它宣称为已定位并修复的产品草稿缺陷。最后主题事件首次真桥失败暴露Capacitor将载荷直接复制到Event，补`detail`包络后上述最终复验通过。

## 自动化与浏览器验证

证据均在`output/audit/2026-11-06/kelivo-handoff/`。

| 检查 | 本轮最终结果 | 证据 |
| --- | --- | --- |
| `corepack pnpm verify` | lint/typecheck/build/插件及隔离检查全通过，手机152/152、后端403/403、验证入口8/8 | `verify-theme-final.log` |
| 交接生产模块/实际发送函数 | 18/18；包含同文草稿、缓存重开、普通按钮身份保护、SSE先到/HTTP失败、队列、目标/scope、附件与保存失败 | `product-theme-handoff.log`、`handoff-regression-delivery.log` |
| Flutter产品/消息更多菜单 | 17/17，完整Dart fatal分析无问题 | `flutter-product-second.log`、`dart-analyze.log` |
| 正式原生入口`--preview --repeat-tests` | 333/333、0失败/错误/跳过；完整宿主/远控lint为0 Error/Fatal、56/1 Warning；签名包成功 | `native-preview-delivery.log`、`native-tests-final.json` |
| 最终包与安装 | 全部包内核对通过，已安装SHA一致 | `apk-inspection-final.json`、`device-installation-final.json` |
| 最终包原生离线流程 | 6项通过，report/code均确认 | `instrumentation-delivery.log`、`native-delivery-evidence/result.json` |

本轮没有重跑约35分钟的Flutter全量；上轮11,437通过、3跳过、0失败只作历史部分证据，不重复记为本轮结果。markstream也沿用明确标注的上轮记录。

浏览器合成验收已覆盖卡片编辑/目标/文件上传、确认与双击、ACK重开不重发、迟到Desktop确认、取消、存储与上传失败，以及360/390/430×浅深×100/150%=12组布局，无横向溢出、操作目标至少44px。`browser-layout.json`与对应截图记录的是该轮构建，后续未改变卡片布局。

最终Web产物额外复核`queue-http-error`：服务端已保存队列且SSE通知后返回502，页面恢复为“已加入待发队列”；同文普通草稿保持，重开状态与草稿保持；前后`nativeRequests=1`、`queueSubmissions=1`、`nativeMode=queue`，没有自动重发。证据`browser-final-queue*.json`、`browser-final-queue.png`、`browser-final-draft.png`、`browser-final-reopen.txt`、`browser-signed-final.png`。这些是隔离服务，不是电脑真实执行证明。

首次最终verify后端402/403失败于测试子进程3秒退出等待（`verify-delivery.log`）；该单项220ms复测通过，随后两轮与源码变更对应的完整verify均403/403通过。保留首次失败，不声称该偶发根因已修复。首次新增键盘回归还经历测试classpath编译错误，随后抽出生产窗口insets边界，最终完整333项通过；未关闭lint或提高minSdk。

## 来源与尚未完成

固定Kelivo v1.3.4 / `4a7da9b6f5d77caccb9f8aaf656232a93ab14708`，5052来源文件无缺失，28来源文件修改、15个非忽略新增文件。生成Kotlin会话文件排除，原始SHA清单与许可保留；根/markstream锁只归一化镜像域名，不升级版本或包SHA。最终清单`source-changes-final.json`。

[59组账本](kelivo-parity-evidence.md)分别列源码、隔离、设备与外部服务，整组完成0/59；46组有确实出现在历史全量日志中的相关文件映射，仅计部分证据。真机/API24设备、系统回收、OAuth/备份往返/权限与系统插件、工作区PRoot/PTY、真实模型与电脑接收、原Desktop新建及其余逐项功能继续待验。电脑与AI系统栏底色的细节一致性留在设备轮核对，不宣称逐像素一致。

本轮未读取真实Codex会话或提交模型/电脑任务，未改在线网关、发布、部署或Git写入；文稿清理继续搁置。复用正式构建入口、宿主契约与本地验收runner，未新增定时任务或通用技能。下一轮按[设备与功能计划](../../plans/2026-11-06-kelivo-device-parity.md)继续。

收尾：10份当前文档的本地链接及diff空白检查通过，Trellis session51以`--no-commit`记录。已关闭本轮临时浏览器/三台fixture服务/独立模拟器，并停止确认空闲且属于本轮的Gradle daemon；用户旧fixture与在线网关保持。未清用户缓存，当前可用9.38GiB，资源记录`resource-closeout.json`。
