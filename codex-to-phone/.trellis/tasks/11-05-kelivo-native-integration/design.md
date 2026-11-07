# 设计与边界自审

## 2026-11-07 共享 Agent 体验边界

当前Codex/Agent已复用MessageTimeline，但DeepSeek仅输出文本、Agent没有本地图片上下文且输入布局不同。本轮在原数据所有者修正这些差异：chat提供共用输入/媒体与上传，AgentWorkspace保留各通道原控制和scope隔离；设备当前订阅绑定的权威session.directory提供图片根；DeepSeek显示投影由messages统一供bridge/catalog使用，其他通道按实际原协议适配。未来SessionAdapter显式能力随网关清单下发，前端复用统一工作区。操作不自动重发，历史读取不激活原任务；审批参数索引不与可截断显示投影混用。实施/文件边界和验收见`docs/plans/2026-11-07-agent-experience-parity.md`。自审：不改无关控制、凭证或生命周期所有权，兼容现有插件与code8，新增能力用合成/官方隔离回归验证。

## 2026-11-07 执行说明常显

缺口归属 MessageProcess：现有逻辑分组正确保存同 turn 的说明和工具，却将两者全部延迟挂载。保留分组/完成判定，在展示层按原顺序将说明直接交给原 MessageBubble，将连续工具拆成独立的 ToolProcess 折叠区。工具区稳定绑定首工具 ID，后续增量保持手动选择、终稿到达默认收起。仅工具区使用 message-process 类，显示偏好不再连带隐藏说明。

MessageTimeline 的 renderMessage 增加可选的展开工具详情参数，App/Agent 两处传给原工具组件，打开工具区时直接显示原命令/输出，避免重复点击内层折叠。失败在摘要中保留数量，原字号/图像/控制路径保持。预期改动限 components、两处渲染接线、样式注释、真实展示回归、版本与交付记录；不改消息数据、缓存、通信或在线网关。

## 当前缺口与所有者

现有React远控已统一视觉；缺少Kelivo Dart/Flutter运行时和两个同级入口。Kelivo Application持有唯一FlutterEngine、后台/定时/工作区服务和数据库，原Capacitor BridgeActivity持有远控六个插件。优先保留Kelivo主运行时，按Android Activity/模块组合复用原远控源码；避免将两种运行时代码混成共享包。

## 实施位置

- 先在output/.tools中验证固定上游及工具链，原产品无变更。
- 构建通过后再引入固定来源的独立Flutter app目录及追溯清单，维持原React/Relay的启动、构建、打包入口。
- Android宿主增加远控library/Activity集成入口；复用原Java插件与Web资源，不复制业务算法。具体Gradle路径由上游基线编译结果确定。
- Flutter导航与React嵌入模式共同遵守Kelivo设计；只有统一导航所有者，避免两个顶栏。设置按全局、AI、电脑分组。
- 交接层使用版本化有界数据契约与唯一ID，只存待确认草稿/已确认身份，不透传远控凭证或控制令牌；确认提交仍由原远控控制路径拥有。

## 数据/状态与兼容

选择独立preview applicationId，保留原包、签名和存储；不宣称Keystore/缓存自动迁移。全局主题通过显式宿主契约同步，进入远控恢复其各自会话，离开不代表停止电脑任务。进程重建后只恢复交接草稿/接收状态，不自动提交。新建原Desktop会话先核查官方能力；能力缺失则保持最终需求未完成。

Flutter与Capacitor的AGP/Kotlin/JDK/NDK版本、资源/Manifest、文件提供者、后台/无障碍和更新入口必须逐一核验。原远控APK下载128MiB上限与完整Kelivo体积需按实包复核。固定源码许可及第三方归属沿现有方案，不以目录分离规避。

## 源码检查补充（仍须组合构建/运行证明）

- 固定元数据保存在 `integrations/kelivo/upstream.json`。采用 3.47.6 能保持上游锁文件并通过完整 Dart 分析；3.44.9 仅是声明的最低版本，不能作为已验证兼容版本。
- Capacitor 7.6.9 的 `BridgeActivity.onCreate` 会调用 `getApplication().setTheme`。远控 Activity 需恢复宿主 Application 的原主题，同时保留自己的 AppCompat 主题，避免主题所有权跨运行时泄漏。
- Capacitor 自身 Java 源码以 Java 21 编译，Kelivo Android 源码目标为 Java/Kotlin 11。保留 JDK17 构建/分析运行器，组合构建复用现有编译器选择与 JavaCompile fork 方式；不能把原远控目标静默降为 11。
- 上游主 Activity 是 singleTask，且保留分享、OAuth、通知/定时任务和文件选择回调。导航需复用这一主实例，回到 AI 时不能创建第二个 Flutter 引擎；远控销毁前保存独立草稿及阅读位置，不借 Activity 重建重放提交。
- 更新所有权须单独适配：Kelivo UpdateProvider 默认请求上游运营域名，原远控默认请求自身 APK/热更新源。独立整合预览不能沿用任一现有包的更新源，不能向上游安装器误报本产品更新已就绪。
- 独立包身份还须覆盖OAuth与备份URI：AndroidManifest、OAuthHandler和Dart的oauth_callback_io均固定使用psyche.kelivo回调；kelivo_file_uri的旧沙箱识别仅白名单原包名。正式接入前需对新包回调及备份往返做一致适配和验证，不能仅更改applicationId就推定完整功能保持。

## 自审

不从零重写Kelivo业务；不为先看到按钮伪造独立AI；不通过删插件/主题/系统功能来通过构建。隔离检查只用合成数据，不访问真实Codex/模型/账号；真实设备、供应商与全量59组验收分开记。磁盘约15GiB，工具和构建产物按阶段测量，只清理本轮可重建产物。

## 2026-11-05 接线后的契约

正式宿主在`apps/kelivo`，原始文件SHA和锁来源在integrations；旧output基线只作对照。Android专用ProductShell保留AI/设置根挂载，电脑Activity离开前通过可取消事件保存自身状态，复用原MainActivity/Application持有的FlutterEngine。分享/文件/OAuth等交还原上游渠道，不由电脑模块处理。

Flutter拥有主题，原生只保存tab/appearance/一次性电脑设置启动标识；ProductHost revision1将其传给Web，Web先初始化再挂载业务。设置启动强制进入Codex连接面板，原Agent选择不阻挡。Agent和Codex关键草稿在离开前同步保存；失败阻止跨入口。Agent当前编辑项提升到有界缓存末端，待确认clientMessageId/原文在发送前落盘，未知结果不自动重发。

## 用户继续下一轮：交接与设备验证边界

AI消息更多菜单仅准备所选单条正文，不读取或转发其他历史；电脑侧同一张卡编辑任务说明、按需选文件上传、选择项目与已有Desktop会话并确认。固定原Desktop适配器只有已有conversation的start/steer/interrupt/queue，没有新建原Desktop会话接口；保留新建缺口，不调用app-server创建替代会话。

新增原生ProductHandoffStore只拥有初始草稿ID和提交锁；Web独立有界缓存拥有编辑中任务卡，不覆盖普通远控草稿。确认前由原生同步commit冻结scope/thread/message/clientMessageId，随后复用原sendDesktopMessage路径，禁止降级到legacy或app-server；未知结果始终锁定，同ID权威确认才完成。取消仅允许尚未提交的草稿。附件从确认卡通过原文件上传路径发送，目标连接改变必须重新选择，上传中不可确认或离开。原生锁和Web缓存均不得持久化控制token。

改动限定：原生宿主交接存储/桥、Flutter消息菜单与准备入口、React交接卡/状态与原发送函数的结果反馈、相应隔离回归及版本/审计。保留所有既有业务与两独立入口。本机无连接手机，隔离模拟器和真机证据分别记录；59组矩阵只根据真实证据逐项更新。

Android身份使用新preview包与OAuth scheme，原iOS保留；所有Provider authority实际产物核验。上游和远控更新请求在整合预览中隔离；Web显示code3，原独立远控仍保持原版本。兼容补丁不改变minSdk24，完整检查不关闭规则。交接已接已有Desktop，原Desktop新建、深历史恢复、完整原生行为和真实联动继续待验。

## 2026-11-06 用户启动设备与完整对照接续

首轮系统栏修复已在Android36取得浅/深底色及图标像素证据；电脑前台实际切换系统明暗又复现Flutter停止绘制、偏好快照不更新。缺口仍属全局外观所有权。Flutter在已有主题生成处提供实际light/dark配色（含动态取色与语义表面），不在Java重建颜色算法；ProductNavigation仅在mode=system按当前Android配置选择该配色，原始Flutter设置不改写。ProductHost的真实configuration/resume及偏好变化共同更新窗口/Web；显式浅/深不被系统设置覆盖。revision1保留，增加可选palettes字段，旧快照继续可读。

新增改动仅主题配色快照所需的main.dart/ProductShell、原生外观解析/监听与定向回归。保持双入口、草稿、模型/远控发送和当前网关；code4为未发布开发预览，最终包按最终SHA重新验收。真实模型/电脑任务仍需用户明确指定目标；Android24真机和低内存系统回收不能以隔离测试代替。

最终视觉复核补充：Android150%字体横屏时空白聊天说明被裁切，原因是既有flex滚动区允许空白页收缩。修复只在`.empty-chat`禁止收缩，保留消息区滚动；runner增加真实WebView几何断言，分别核对首元素和说明末行可达。主题修复包另存`code4-palette.apk`，新最终包重新核对SHA、截图与设备结果。

2026-11-06设备修复：Android35+远控窗口合并IME与系统栏insets，避免键盘覆盖输入；Flutter提供实际`appearance.dark`和配色，Web不采纳可能错误的`prefers-color-scheme`。ProductHost监听appearance偏好变化，使用`detail`包络发送窗口事件；Web清理监听且不让迟到启动快照覆盖新值。普通输入缓存新增交接来源白名单，确保同文普通草稿与未知交接身份独立。
## 2026-11-06 电脑页对齐 AI 视觉

最小缺口在Flutter外观到Web语义颜色映射、Web过程容器及消息/输入/导航样式。由productPalette提供与AI默认消息和输入一致的混色及导航颜色；Web保留primaryContainer供强调用途，不再把它用作所有消息底色。新增颜色是可选字段，旧快照使用CSS浅深默认值。过程内容开放式排列，折叠控制和正文仍走原组件。共享消息时间补充日期/秒，消息及控制业务不改。

预期修改为product_shell.dart及其既有主题测试、host.ts及颜色契约测试、共享消息/时间格式与styles.css。预览身份递增后构建新APK，不覆盖code4。使用隔离fixture验证视觉和控制命中，运行定向Flutter、手机回归、类型/lint及原生正式构建；不切换网关或发送真实任务。


## 2026-11-06 App 内更新边界

缺口是更新入口与通道，不重写下载/安装引擎。Flutter SettingsPage 增加本地导航回调；ProductShellHandler、ProductNavigation、ProductHost 传递一次性 openUpdates，独立于电脑设置。React ProductRemoteShell 在挂载业务前分流到应用更新页，避免打开更新页时挂载远控 Workspace 或 Agent。更新页复用 parseAndroidUpdateManifest/useApkUpdate/ApkUpdateProgress 和同一 ApkUpdatePlugin，安装身份按真实宿主包校验。

独立 update-channel.json 为构建与 Gradle 打包校验共同读取的通道事实；构建覆盖原 .env 更新源、保留整合热更新为空。Web 主设置中整合模式只提供通往同一更新页的入口。下载/校验或安装器待确认时阻止退出并显示原因；页面离开清理监听，状态从原生恢复。APK 版本与 Web 显示统一递增，不自动安装或强制升级。

只改 Flutter 设置导航、原生本地启动标识、Web 产品壳/更新页、构建通道守卫及相关隔离回归。原远控发布/启动与业务路径不重构；不启动真实任务，不修改网关。公开交付保持独立静态目录并附对应源码与许可。

## 2026-11-07 执行摘要与图片链路

最小缺口位于 MessageProcess 的运行时默认展开、MessageContent 缺图像语法，以及 Relay 没有鉴权图片读取 API。MessageTimeline 保留原按 turn 分组与最终阶段判定，摘要默认收起、展示最新动作及记录/失败数量；传入权威运行态，避免历史过程永远显示运行。只调整展示，不改变发送、缓存及任务控制。

Kelivo SettingsProvider 继续拥有聊天字号与工具卡片/结果摘要偏好，通过既有 appearance 可选 display 字段传给 Web，旧快照使用安全默认值。日志/代码字号分别比正文紧凑。

图片链路：Markdown → MessageImage → 当前连接/线程作用域 Provider → 原 apiPost/CapacitorHttp → POST /api/threads/:threadId/images → CodexStore.getThreadSummary 得到项目 cwd → 有界本机图片读取 → base64 JSON。请求复用设备鉴权，不在 URL 中放 token；路径 realpath 必须在会话 cwd 内，拒绝目录越界、符号链接逃逸、SVG/非图片及超过 8MiB 内容。只按需读取可见图片，切连接/会话取消并丢弃迟到结果，不持久化图片或凭证。远程 HTTPS 图片不带 Relay 凭证。

修改限定 chat 展示模块/styles、App 的图片上下文、Relay 图片读取模块/路由、ProductShell/host 偏好桥及相关测试、版本与文档；不修改用户在线网关/模型，不重构通信或将 WebView file:// 作为取图捷径。

## 2026-11-07 App 内更新补发

复用现有独立 kelivo-preview 静态目录与原子上传脚本；先发布既有源码归档，再发布既有 APK 和清单，最后切换下载页。只修改静态发布文件，公网完整下载核验大小/SHA/字节、Range/CORS、previous 与原四通道；不重新构建、不移动既有标签。

## 2026-11-07 code7真机与网关联动

复用既有固定版本目录、私有备份、管理stop/start与公网只读复核。部署输入为0.1.5网关归档及gateway-package.json逐文件SHA；不重新构建、不改用户配置、设备、上游宿主或Broker。分别核对旧PID退出/端口释放/新PID身份/Tunnel；停止失败保留证据，不自动强退。图像验证只访问当前会话项目已有公开图片，比较本地/公网鉴权结果并检查越界/缺失拒绝，不代发模型任务。

## 2026-11-07 原宿主0.2.2-rc.1兼容边界

缺口位于插件manifest/bridge与Relay协议的精确版本门，另需复核Cordis4.1.0、原SessionController及内部pending审批方法；以安装包真实源码和隔离官方算法验证，不仅放宽版本号。最小候选为DeepSeek插件0.2.7及配套网关，修改scripts/check-deepseek-*覆盖新运行时与既有工具能力；如发现真实语义变化，只在对应所有者模块修复。手机code9协议与UI无需修改或机械重打APK，旧0.1.7归档保持。新电脑包单独归档。切换保留私有配置，官方profile离线link/HMR恢复；不新建profile、不重启原Agent、不改审批策略。

已实施：plan-review可选callId与普通tool/result缺省isError按新官方契约修正，未知字段/PTC严格性及两个审批方法指纹保留；新approval intent保持不可手机处理。原插件通过官方命令与桥接组件重载恢复，网关正常退出后切换固定SHA目录；实际安装文件单独归档至`0.1.7/desktop-0.2.7-preview`，11文件源码补丁以独立索引校验，code9十份既有产物不覆盖。
