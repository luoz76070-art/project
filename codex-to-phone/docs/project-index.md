# MobiCodex 工程档案入口

更新时间：2026-11-08

## 作用

每次继续施工前，先读本文件，再按链接读取对应工程文件。后续不能只靠聊天记忆推进，所有需求变更、技术判断、实测结果、阶段验收都要落到本目录。

## 当前项目定义

项目名：MobiCodex（原 Mobile Codex / Codex To Phone）

Kelivo 整合候选（2026-11-04，现有远控视觉试迁移已实施）：用户已确定全 App 统一为 Kelivo 风格，AI 助手与电脑远控各自独立使用，另加可选“交给电脑”。完整功能目标保留，原保留两套界面的 5–10 个工作日预览目标撤回；详见[整合方案](plans/2026-11-04-kelivo-fast-integration.md)、[产品需求](product-requirements.md)及[UI 规范](ui-interaction-spec.md)。下述当前 APK、网关和验收状态仍记录现有产品。

目标：把 Android 手机变成 Mac 上 Codex Desktop 的移动工作台。电脑继续运行 Codex Desktop 和 Relay，手机不是远程桌面画面，而是通过 Relay/Broker 读取会话、查看最新文本结果、发送输入、上传附件，并在离开局域网后继续远程控制。

当前主入口：

- Android APK：`dist-apk/mobile-codex-1.2.2-update-restore-debug.apk`（versionCode 18，已恢复原手机更新通道并发布，待真机验收）
- Android独立预览：`dist-apk/mobile-codex-1.3.18-update-source-preview-debug.apk`（versionCode39，准备修复 GitHub 共享仓库全局 `latest` 导致 App 内更新读取旧项目的问题；工作流现按 MobiCodex Release tag 编译固定清单地址。1.3.17/versionCode38 的 DeepSeek 待发查看/定向取消、紧凑控制区和禁用引导入口保持，配套插件0.2.5及网关已上线。39待发布及手机覆盖安装验收，见[APK38记录](audits/2026-10-31/deepseek-queue.md)）。
- Mac 原生网关：`~/Library/Application Support/Mobile Codex Gateway/releases/<固定版本>/mobile-codex/lib/gateway.mjs`，当前单Node进程、native IPC；[插件管理入口](../plugins/mobile-codex/README.md)。
- 旧 Mac Relay/Input App：生成App已压缩归档并移除，源码与构建入口保留；[清理及恢复记录](audits/2026-10-21/legacy-mac-app-cleanup.md)。
- Relay/Broker：`apps/relay`
- 手机客户端：`apps/mobile`
- 协议类型：`generated-protocol`

## Trellis 与当前优化

最新[Claude模型列表修正](audits/2026-11-08/claude-model-options.md)：真实菜单14项来自cc1的/v1/models，混有规范与点号ID，列表不等于生成可用。本轮3次最小真实探测为规范Opus200、点号Sonnet/Haiku502；官方配置关闭自动发现，只保留Sonnet5.5默认与规范Opus5.5。正常重启并恢复同一桌面原会话，真实菜单两项及重启前后各36项只读检查通过，凭证/native设置/原网关和其他通道保持，手机code10无需更新。Opus短请求不代替完整Code验收，[后续计划](plans/2026-11-08-claude-opus-acceptance.md)待用户启动。

最新[Claude桌面同会话接入](audits/2026-11-08/claude-integration.md)：完整私有备份后安装官方桌面4.23118.0及其Code2.1.317，SHA/签名、严格validate退出0及官方8项无模型测试通过，原0.1.2桥接由桌面自己的引擎加载。沿用cc1和基础Sonnet；桌面原「你好」/「自媒体」会话与手机真实同步，用户确认「手机和桌面都显示消息与回复」。最终本地/公网36项只读检查通过，Codex/DeepSeek及原固定网关保持，旧独立CLI正常退出，默认启动入口改为桌面。code10无需更新，本轮收发目标闭环；Opus502和旧CLI不同步的失败证据保留，原生问答/审批/停止/图片及整体59组未扩验。

最新[MobiCodex 品牌与更新](audits/2026-11-07/mobicodex-branding.md)：code10 / 0.1.8-native-preview 使用选定电脑/手机图标，用户可见名称统一为 MobiCodex；保留应用 ID、签名与数据协议。通过 App 内 APK 覆盖更新交付，2026-11-07用户已确认「已升级，图标名称与原配置都正常」，本轮闭环；安装APK/SHA未独立回拉，完整59组验收保持原状态，在线网关未改变。

最新[图片引用修复](audits/2026-11-07/image-reference-fix.md)：定位真机403为隔离副本图片超出原会话cwd。共享网关增加助手Markdown精确文件引用授权，Codex原快照/有界历史及Agent同设备订阅/历史均覆盖；后端422、手机169与完整verify通过。用户批准后固定网关已上线，本地/公网69项断言通过，原指定PNG321,193字节三种路径逐字节一致；原宿主/配置与DeepSeek桥接保持。首次stop旧进程未退出，经官方手机桥接组件重载后自然退出，失败与恢复过程均保留。手机保持code9，无需重装，[电脑修复补充](../releases/android/kelivo-preview/0.1.7/desktop-image-reference-preview/)独立交付；用户已确认「图片已显示，大图和返回正常」，本轮修复闭环。其他通道手机交互及59组完整验收按原计划待启动，总整合任务继续in_progress。

本轮[code9运行切换与DeepSeek原桥接恢复](audits/2026-11-07/agent-parity-runtime.md)：按用户授权完成私有备份、官方原desktop插件0.2.7加载和固定网关正常切换，适配实际Harness0.2.2-rc.1，保留原进程/配置/设备及严格版本/审批边界。后端419、新旧官方各30、类型/lint/构建及本地/公网77检查通过；原会话40消息含14工具记录、重连身份和图片接口通过。用户确认手机已升级code9、DeepSeek原会话与正文正常，安装SHA未独立回拉。新[电脑兼容补充目录](../releases/android/kelivo-preview/0.1.7/desktop-0.2.7-preview/)保留原code9十份交付文件及更新源latest9/previous8；GitHub回执见本轮审计。真实发送/工具偏好/手机图片/附件语音/审批停止等列入[下一轮验收计划](plans/2026-11-07-agent-phone-acceptance.md)，等待用户启动；Claude/OpenCode未配置原宿主，总整合任务及59组继续in_progress。下段“旧网关/桥接离线”为此前交付时状态，已由本轮恢复。

本轮[所有电脑Agent统一体验](audits/2026-11-07/agent-parity.md)：code9 `0.1.7-native-preview` 将Codex的输入/工具/图片/附件/语音及偏好共享至DeepSeek、Claude、OpenCode和未来SessionAdapter。DeepSeek0.2.6/Claude0.1.2可见工具投影、Agent项目图片鉴权及草稿保护接线。根verify手机169/后端414/入口8、原生340、完整lint0错误（56/1既有警告）、四通道/未来夹具和官方隔离验证通过；[版本目录](../releases/android/kelivo-preview/0.1.7/)交付新APK/源码/网关/两插件。双源交付已通过：GitHub产品提交`415f419`及preview标签匹配，10份版本文件完整下载一致、5921源码匹配；App源latest9/previous8、APK/源码完整下载及原四通道保持通过。运行网关仍旧版、DeepSeek桥接离线，在线切换和手机code9真实联动待验；整体任务in_progress。

本轮[执行说明常显修正](audits/2026-11-07/execution-notes.md)：用户已真机确认code7图片/大图返回、字号、原连接/草稿/浅深主题正常；code7折叠范围未通过，现已修正。code8 `0.1.6-native-preview` 保留说明正文，仅连续工具命令/输出折叠，点击一次查看详情，隐藏工具偏好不隐藏说明。根verify手机165/后端407/入口8、原生340、完整lint0错误（56/1既有警告）通过；APK同签名且5个Web文件匹配。对应源码和APK同步现有GitHub及独立App更新源，实际交付回执见本轮审计。2026-11-07用户回复「已升级，显示符合预期」，code8升级与新折叠范围真机确认通过，本轮闭环；手机安装SHA未独立回拉，整体59组及原Desktop新建仍未完成，[后续计划](plans/2026-11-06-kelivo-device-parity.md)待用户决定启动。

本轮[code7真机与网关联动](audits/2026-11-07/device-link.md)：已升级配套图片网关，旧PID正常退出、新固定bundle `a96929560c60`及原Tunnel在线；19项隔离、55项本地/公网检查通过，配置/设备/宿主保持。用户确认App内升级code7成功，图片/大图、字号及原连接/草稿/主题正常；折叠范围未通过，由code8修正；升级前DeepSeek桥接即离线，保持并单列搁置。整体任务继续进行中。

本轮[电脑执行摘要与图片修复](audits/2026-11-07/remote-rendering.md)：code7 `0.1.5-native-preview`，默认折叠同轮执行、紧凑字号/偏好桥、Codex 项目图片鉴权加载与大图。README 和版本化 APK/对应源码/配套网关交付到现有 GitHub `project/codex-to-phone`；[版本目录](../releases/android/kelivo-preview/0.1.5/)。随后已[补发 App 内更新](audits/2026-11-07/app-update.md)，独立更新源 latest7 / previous6，code6 可从统一设置升级；在线网关现已在后续轮升级，用户确认 App 内 code7 覆盖成功，真实图片显示反馈待验；旧记录保留其当时状态，整体59组对照继续未完成。


最新[整合 App 内更新](audits/2026-11-06/kelivo-update.md)：code6 `0.1.4-native-preview` 增加统一设置“应用更新”，无需配对电脑，复用原 APK 下载/完整性/签名与安装恢复能力；绑定独立 kelivo-preview 源，整合热更新保持为空。code4/5需先手动覆盖一次，随后可在App内检查并安装后续版本。完整verify手机155/后端403/入口8、Flutter定向19、原生340与完整lint0错误（56/1警告）、浏览器五场景及成品核验通过。Android36实际code4→6覆盖、更新入口/硬件返回及重启后原双草稿恢复通过，手机系统授权/安装继续待验；对应源码与公网最终核验见审计。整体in_progress，59组0/59，原Desktop新建与其余真机联动未完成。

前轮[电脑页对齐AI视觉](audits/2026-11-06/kelivo-visual.md)：按用户最新图2 AI为基准调整图1电脑页，移除过程大蓝底，统一消息/完整时间、轻输入框和导航，Flutter实际浅深语义颜色贯通Web。浏览器六场景及控制交互、手机154/Flutter定向18/原生338通过，完整lint0错误（56/1警告）；根verify后端首次1项退出超时，单独及完整403项复跑通过，其余检查通过。新本地签名code5 `0.1.3-native-preview`为60,965,067字节，SHA256 `7cc14d0461b4b7da1c08a259efc514b844ba460c6f03aa04c04b226e19b779a8`，包内资源/身份/插件核验通过。未上传下载页，未运行本轮真机/模拟器或真实任务；公开code4/旧通道/网关保持，总任务继续。

最新[新App首条真实输入与连接](audits/2026-11-06/kelivo-live-connection.md)：用户确认“测试一下效果”来自整合新App电脑页，当前会话实际收到；手机→电脑输入链路通过。本地/公网鉴权、拒绝无凭证、Android预检/CORS、native网关及connected Tunnel六项只读检查通过，原配置字节保持。手机回复回显/无重复仍待用户确认，未读取其他会话或另发任务；实际手机版本/SHA未独立核对，59组整组0/59保持。

最新[Kelivo手机安装交付](audits/2026-11-06/kelivo-phone-download.md)：最终code4独立预览已上传[手机下载页](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/index.html)，附对应工作区源码、许可和构建/安装说明；APK保持60,973,251字节及SHA256 `e3fa92e2e0d0ef3ec29a5af1996f390ffa7683e0999734dcb211431cdbf92a06`。使用独立`android/kelivo-preview`目录，原正式/preview/previous/hot通道保持；APK/源码公网完整回下载大小/SHA/字节一致、Range206和原四清单不变已验证，详见审计。不切换网关、未执行真实任务或Git写入；用户真机安装、真实联动、原Desktop新建及59组完整对照继续待验，整体in_progress，文稿清理搁置。下文“未发布”为当时历史状态。

最新[Kelivo设备与本地能力验收](audits/2026-11-06/kelivo-device.md)：已修复电脑系统栏及电脑前台实际系统明暗同步，并修复150%系统字体横屏空白页裁切。最终code4本地签名包`output/kelivo/mobile-codex-kelivo-0.1.2-preview-arm64.apk`为60,973,251字节，SHA256 `e3fa92e2e0d0ef3ec29a5af1996f390ffa7683e0999734dcb211431cdbf92a06`；包内身份/插件/5个Web文件、实际安装SHA一致，Android36模拟器13项及覆盖后显式进程重启草稿恢复通过。原生338项、完整lint0错误56/1警告，Flutter产品/菜单18项、完整Dart分析及备份定向184项通过；收尾完整远控verify手机152/后端403、入口8和其余步骤通过，早期超时及失败仍保留。本轮未重跑Flutter/markstream全量。5052来源无缺失、28来源修改/16非忽略新增；[59组账本](audits/2026-11-06/kelivo-parity-evidence.md)仍整组0/59。[设备与全功能计划](plans/2026-11-06-kelivo-device-parity.md)已启动，真机/API24、系统插件/回收、授权真实联动、原Desktop新建与全部对照继续进行；未发布、部署、真实任务或Git写入。模拟器及本轮空闲构建进程已关闭，剩余9.63GiB；文稿清理搁置。以下code3及更早状态为历史。

上轮[Kelivo交接与原生预览验收](audits/2026-11-06/kelivo-handoff.md)：已接线单条AI正文→同张卡编辑/项目/已有Desktop会话/附件→确认一次；原生提交锁、未知不重发、队列/接收区分与同文普通草稿隔离已验证。修复Android16键盘遮挡及WebView错误明暗源，最终原生全量333项和完整lint0错误（56/1警告）通过，远控verify手机152/后端403、Flutter定向17项与分析通过；未重跑上轮Flutter全量。Android36模拟器安装最终SHA并通过6项离线流程；本地签名`output/kelivo/mobile-codex-kelivo-0.1.1-preview-arm64.apk`（code3，60,973,771字节，SHA前缀`ec663ce1`）包内/已安装SHA一致。未发布或真机验收，原Desktop新建、真实联动与完整对照继续待验；[59组账本](audits/2026-11-06/kelivo-parity-evidence.md)整组0/59，[接续计划](plans/2026-11-06-kelivo-device-parity.md)当时待启动（现已启动），总任务保持进行中。文稿清理搁置。以下code2及更早状态为历史。

最新[Kelivo产品接线与签名预览](audits/2026-11-05/kelivo-product.md)：固定上游已正式引入`apps/kelivo`，AI／电脑／设置同级入口、全局主题、独立草稿/选择恢复及新包身份已接线；完整原生lint为0错误（宿主56/远控1警告），318项原生测试复跑通过，原远控verify通过（手机132/后端403），Agent退出前保存保护7项、验证入口8项通过。Flutter最终全量11,437通过、3跳过、0失败。含最后草稿修补的本地签名arm64预览为`output/kelivo/mobile-codex-kelivo-0.1.0-preview-arm64.apk`（code2，SHA前缀`0283ceac`），最终包签名/身份/插件及5个Web文件重新核对通过；尚未发布或真机验收，浏览器结果、旧包模拟器首帧与原生完整行为分别记录。可选交接、原Desktop新建和59组完整验收保留在[接续计划](plans/2026-11-05-kelivo-product-acceptance.md)，总任务仍进行中。以下未签名探针/58错误为前轮历史结果。

最新[Kelivo 原生构建检查收尾](audits/2026-11-05/kelivo-native-closeout.md)：用户选择先完成构建检查、产品接线下一轮做。组合release再次成功，60.9MB APK与清理前完全一致；固定上游约60.6MB也保留。远控library完整lint为0错误/1警告，宿主58错误/56警告与原版逐项相同，质量门仍未通过；已分类核查，UCropActivity实际存在于两包。新增独立测试JDK配置，原版及组合原生测试复核各305/305通过，组合首次4项FileObserver shadow异常保留待查。两包仍未签名未安装；统一双入口、主题/恢复、更新/OAuth身份、可选交接和全59组验收未完成。[下一轮计划](plans/2026-11-05-kelivo-native-next.md)待用户启动，复现见[integrations/kelivo](../integrations/kelivo/README.md)，原始过程见[前次审计](audits/2026-11-05/kelivo-native.md)。

最新[Kelivo 风格试迁移](audits/2026-11-04/kelivo-style.md)：现有远控聊天、侧栏、输入、设置、过程/问答/审批与 Agent 采用固定 v1.3.4 的浅深主题和圆角组件参考；完整隔离 verify 通过（手机126/后端403），浏览器窄屏、大字号及控制交互已验。未构建新 APK、部署或真机验收；AI 完整功能、双独立入口、可选交接和原生组合仍在后续方案中。

最新[Codex未加载会话恢复](audits/2026-11-04/codex-cold-thread-recovery.md)：原会话按需加载修复及真机验收完成，13项新增回归、手机126/后端403及其余检查通过；第二个冷会话约11秒恢复。新版固定网关已上线，配置及宿主保留，本地/公网健康、recent28/all123列表与四会话控制通过。用户确认APK38正文/草稿按钮正常、实际手机发送成功，重开后输入和完整回复各一次。列表活动时间与连接状态表达保留为[下一轮候选](plans/2026-11-03-codex-connection-recovery.md)，尚未启动。

最新[Codex列表与发送置灰排查](audits/2026-11-03/codex-connection.md)：当前本地/公网鉴权、Tunnel及IPC正常，recent28/all123一致，桌面抽样30个ID均在全部列表。两个已加载会话控制就绪，两个未加载会话SSE200但无控制快照，Kelivo样本owner发现超时；已定位未加载会话控制缺口，尚待对应用户实际置灰样本。另有桌面元数据/日志活动时间口径差异，不能直接判新消息丢失。只读检查，无产品改动、部署或模型发送；[修复候选](plans/2026-11-03-codex-connection-recovery.md)已落盘，DeepSeek剩余验收暂停。

最新[DeepSeek待发取消与APK38预览](audits/2026-10-31/deepseek-queue.md)：插件0.2.5、配套网关与preview38已交付。当前手机待发项可查看/定向取消，未知结果不重试；引导/排队/停止集中一行，能力不足时保留禁用入口。完整verify（手机126/后端389）、最终DeepSeek70、三版官方各14项、浏览器小高度/150%字号、Android0错误8警告与公网19项通过。用户已确认APK38升级、原连接及正文正常；第18轮实际手机引导在同轮确认一次并改变终稿，截图变灰发生在发送后等待消费，官方rc.5已隔离复现该状态。引导、排队顺序与取消待发通过，继续权限/停止；用户已授权仅此测试会话临时切换，桌面及原日志确认workspace-write/ask，允许一次真机验收通过；2026-11-03继续，拒绝/原模式恢复/停止待验。等待文案搁置，原APK36入口缺失的具体现场根因仍未取证。

最新[临时轮次重复输入修复](audits/2026-10-30/indexed-turn-input.md)：用户APK36详细报告精确定位turn-N-input吸收正式native别名后未同步提升轮次，两组身份/时间与旧代码回放逐字段一致。手机最小修复及旧缓存恢复通过125/125、消息/类型/lint/构建、浏览器8项；APK37 `1.3.16-turn-identity-preview`已发布preview，previous36，Android0错误8警告、同签名成品与公网19项通过。用户已确认升级37后“现在测试一下是否重复”和“已恢复，切收到回复”各显示一次；网关/原任务保持，DeepSeek剩余控制验收继续保留。

当前[DeepSeek手机真实控制验收](audits/2026-10-30/deepseek-control-acceptance.md)已由用户启动，指定默认工作区“末流211电子信息考研专业课名单”。首项输入已到达并启动原任务，但上游模型全账号冷却导致执行失败，手机漏显该错误。用户保留原模型等待服务恢复；重开后宿主实际升至rc.5，现已加载插件0.2.4并切换配套网关，明确显示原模型失败原因。rc.5官方25项、DeepSeek64/64、后端384/384、手机122/122及lint/typecheck/构建通过；桥接17项、本地/公网35项和Codex重连12项通过。APK36沿用，用户已确认失败提示；随后原模型恢复、手机收发及重开无重复验收通过。本地/公网成功终稿与idle一致，引导首轮实际等待90秒但无追加输入，用户已确认运行期间入口缺失。APK36代码一致，4组窄屏合成与一次引导发送正常、Agent状态回归12/12；真机原因尚未复现，用户后续确认已连接且停止可用；APK38修正布局并补齐取消，其第18轮真实运行中引导现已通过；原APK36现场原因仍未确认，排队顺序与取消待发也已通过，权限/停止待验，见上方最新记录。

最新[DeepSeek rc.3兼容与手机复联](audits/2026-10-30/deepseek-rc3-compat.md)：插件0.2.2精确支持rc.2/rc.3，真实版本上报与网关白名单同步；两版官方各25项、DeepSeek60项及完整verify通过（手机121/后端380）。原插件已在原宿主加载，14会话首帧和重连通过；原网关已安全切换，本地/公网31项及Codex重连12项通过。用户已确认APK36列表、正文与重新打开正常，本轮完成；后续[真实控制验收计划](plans/2026-10-30-deepseek-control-acceptance.md)已启动，进展见上方记录。

最新[阶段五状态模块与统一验证入口](audits/2026-10-30/maintenance-boundaries.md)：五个状态/轮询函数迁入runtimeSync，关键回归直接导入生产模块，真实App effect和浏览器接线保持覆盖。新增verify/verify:android/verify:all与明确JS/TS lint规则；Android兼容脚本正式入库。完整入口通过，手机121/121、后端377/377，最终入口自测6/6，Android编译/lint为0错误、8警告。390px合成临时→历史→正式→结束→重连/重开均单气泡且草稿保持。未发布、未Git写入，原手机双气泡与系统保存仍独立待验。[可靠性计划](plans/2026-10-29-reliability.md)本地五项已完成，[预览与真机验收](plans/2026-10-30-preview-validation.md)已由用户启动，APK36已发布，其余进展见本轮交付；命令见[验证入口](verification.md)。

最新[阶段四短诊断与版本/DOM定位](audits/2026-10-29/compact-diagnostics.md)：设置新增“复制诊断摘要”（2048 UTF-8字节上限）与“保存详细报告”（64KiB），区分原生APK/实际Web/活动与已加载热更新/网关版本，关联DOM身份及有界连接代次。手机121/121、后端377/377、消息/更新/类型/构建通过；Android编译与lint通过（0错误、8警告）。360px浏览器复制、取消/失败/恢复、旧APK/网关兼容、断线恢复及真实文件下载通过。未发布、未Git写入，系统文件保存真机待验，既有双气泡仍未宣称解决。阶段五随后完成，见上方记录。

最新[阶段三正常提示词过滤修复](audits/2026-10-29/prompt-visibility.md)：手机/历史/Desktop/app-server移除“You are …”与“Knowledge cutoff: …”宽泛前缀，会话标题同步修复；保留专用上下文包络和问答回执排除。新增8项回归先失败后通过；手机108/108、后端374/374、消息/类型/构建和390px浏览器发送/完成/在线离线重开通过。未发布、未Git写入、未操作真实模型；Android与双气泡独立待验。阶段四随后完成，见上方记录。

最新[同步与输入可靠性阶段一、二](audits/2026-10-29/reliability-fix.md)：按用户选择完成旧回包取消/写入保护、同generation游标守卫、输入独立缓存和配额反馈/重试；手机105/105、后端369/369（首次1项连接超时，单独与限并发全量复测通过）、消息/类型/构建通过。真实浏览器验证25草稿、大正文配额、保存失败/重试、360px与150%字号、重开恢复。未发布、未Git写入、未操作真实任务；Android另验，APK35双气泡问题不因此宣布解决。阶段三现已完成，见上方记录。

最新[2026-10-29代码复审](audits/2026-10-29/code-review.md)：后端369/369、手机84/84、消息/更新/发布/类型/构建通过；独立复现迟到轮询覆盖新任务与游标、缓存配额失败丢失新草稿、普通“You are …”提示词误过滤。另列有界诊断与模块/验证入口优化，已形成[待选择计划](plans/2026-10-29-reliability.md)。本轮未改产品或发布，APK35真机双气泡仍未解决，新增缺陷不冒充其已确认根因。

最新[重复输入完整过渡测试与方案](audits/2026-10-23/input-transition-test-plan.md)：消息回归、手机75/75及类型检查通过；提取App实际更新函数做48种临时→正式过渡，28种合成序列保留重复，连续3轮一致。确认snapshot reducer已删临时项而App合并仍保留旧别名，缓存/重连未消除；真实React组件复现“用户气泡—task_started—相同气泡”，无警告。该过渡尚未与手机20:43早期状态对应，不宣称根因已全部证明。已给出临时项退役/正式身份继承、同步处理移除/历史别名、现存缓存修复及入口/真机验收方案；本轮未改产品、构建或发布。

20:43[重复气泡新截图](audits/2026-10-23/input-persistent-diagnosis.md)：用户自行做无工具测试，截图确认相同用户气泡在task_started前后各一份，过程块无用户正文。原始输入一次，native/history同turn相差70ms，公网/本地一致，完整字段6种顺序及浏览器仍一份；临时turn-input合成失败尚无手机对应证据，不认定根因。已请求这条新输入的手机诊断，12:32旧输入报告不能代替；本轮未改产品或发布，问题未解决。

最新[APK33真机重复反馈与手机诊断](audits/2026-10-23/input-persistent-diagnosis.md)：用户已装APK33，目标“重复显示还是存在”仍重复；native/指定历史页各一次、同turn、相差168ms，双向/重放一份，手机实际缓存未取得，问题未解决。APK34已发布只读手动指纹诊断，比较runtime/实际渲染/原缓存/DOM；补齐原生Clipboard.write及注册。手机75/75、类型/消息/构建/更新、浏览器复制/失败重试/三种窄屏及150%字号通过，lint0错误/8警告，同签名/资源/原生插件核验及公网19项通过。preview34/previous33，正式18/hot保持，网关与原任务未改；已收到手机报告，三层与DOM各一条用户消息，用户仍看到两处并指出第二处在执行过程；原投影发现进度引用/工具详情含原句，实际第二处尚待对应，不归档，不做Git写入。

最新[输入三路时序及现存缓存补修](audits/2026-10-23/input-source-transition.md)：用户确认18:21重复重开后仍存在；原会话native/rollout各一次，完整字段回放一份，独立复现历史→HTTP确认→缺client的早期native产生两份。合并器改以native别名判断历史是否绑定，显式client冲突保守保留；全部6种顺序及版本3缓存/实际渲染回归通过，草稿/待确认和真实重复保持。APK33已发布preview，previous32，正式18/hot保持；手机70/70、浏览器12项、公网19项及完整lint0错误/7警告。未改或重启网关，未取得截图瞬间手机缓存，真机仍待升级复核；本轮未做Git写入。

最新[APK32预览源码同步](audits/2026-10-23/apk32-version-sync.md)：按用户明确要求，将APK31输入修复及APK32紧凑输入区整理为源码提交0061107，并随交付记录同步现有GitHub main及APK32 preview标签。手机69/69、消息/两端类型/构建重新通过，提交范围仅本项目；真机待验项保持，远端OID以ignored交付核验记录为准。

最新[运行中输入区收紧](audits/2026-10-23/compact-running-composer.md)：APK32已发布preview，previous31，正式18/hot保持。运行状态与普通反馈并入底栏，空草稿仅保留停止，有输入才显示紧凑引导/排队；待发默认按数量/状态收起，全文及取消仍可展开。390px footer从271.5px降至125px；手机69/69、浏览器19项及公网19项通过，lint0错误/8项既有警告。未改或重启在线网关；真机触摸/键盘待升级验收。

最新[手机输入镜像与缓存补修](audits/2026-10-23/input-mirror-cache.md)：原会话实际一次，完整字段样本原先不重复；缺client ID的旧/早期投影可复现，已保留native别名并刷新旧正文缓存（草稿/待确认保持）。APK31已发布preview，previous30，正式18/hot保持；消息/手机69项、类型/构建/浏览器15项、公网19项通过，lint0错误/8警告。网关未改未重启，真机显示待升级核对，不将合成复现冒充截图根因确认。

最新[版本同步约定](ops/version-sync.md)及[源码同步记录](audits/2026-10-23/version-sync.md)：用户已确认独立功能/修复完成后分步本地提交，完整版本验收后集中推送现有GitHub并打版本标签。父仓库为project，仅提交codex-to-phone子目录；保留其他工程和用户暂存项，不自动建分支/PR或部署。APK30预览源码基线1ea28a2已推送并核验origin/main，220文件全部属于本项目；收尾docs与preview标签沿同一流程交付。后端367/367、手机68/68、消息/更新/类型/构建再次通过，产品Web资源等于原APK30；真机验收及语音供应商问题仍独立保留。

最新[执行过程自动折叠完整交付](audits/2026-10-23/process-collapse.md)：APK30已发布preview，previous29、正式18/hot保持，固定网关及DeepSeek插件0.2.1已实际更新。Codex明确commentary及已知工具运行展开，final_answer开始时折叠；DeepSeek只在原生成功turn结束后提升无工具末步为终稿，覆盖实时及冷历史。用户/终稿/权限卡独立，手动重开保持，新任务展开；未知阶段/异常无终稿保持可见。后端367/367、手机68/68、消息/更新/类型/构建和浏览器19/19通过；lint0错误/5警告，成品同签名，85健康/17重连/19公网完整下载核验通过。旧网关2165ms自然退出，原Harness/配置/设备/Key保持。APK30包含此前引导/排队及重复显示源码修正，下列“未发布”为各轮历史状态；Android安装/真实任务另验，综合语音task不归档。

最新[引导输入重复显示修正](audits/2026-10-23/steering-duplicate.md)：只读确认原会话一次输入，native任务开始时间与历史落盘相差33.571秒，缺少跨来源归属。两端保留用户turnId、历史sourceItemId及canonical clientId，手机按来源一一关联并保留多个实际同文输入，重放/旧缓存不复活副本；来源不完整时保守保留。手机61/61、后端相关58/58、消息/类型/构建及浏览器11/11通过。仅源码与本地验证，尚未发布，手机与配套网关均需新版，真实模型/审批/待发未操作。

最新[运行中引导与排队修正](audits/2026-10-23/running-message-actions.md)：用户截图对应消息仍在网关waiting，原选择器没有转换既有待发项。手机改为“引导发送/排队发送”直接提交，箭头/快捷键默认queue；捕获mode/guard，确认前保留输入，匹配确认才清空，迟到回执与新草稿隔离。手机60/60、原生控制/队列39/39、消息/类型/构建及窄屏合成通过。仅源码与本地构建，尚未发布新APK/热更新，未操作真实待发或模型；手机与原任务验收仍待新版发布后进行。

最新[语音真机与质量实测](audits/2026-10-23/voice-live.md)：用户确认APK29识别/整理及仅回填成功。真实长句出现会话→绘画，31新增手机会话/聊天会话及两Agent名低权重提示，原句三处修正、绘画负例/术语公网通过；混用同音词仍两处错误，不计全通过。语音23/23、网关30/30、类型/构建通过，固定网关已更新，无新APK。切换旧PID退出残留，经官方仅重载手机桥接恢复，失败/恢复分存；84健康/17重连与配置/设备/Key/Harness保持。后续第三方DeepSeek公网/本地/直连均502，完整整理验收仍有故障；累计31次供应商请求，无自动重试/Agent提交。下一步先恢复供应商、独立处理网关退出，再做真机异常场景；旧追加暂停。

最新[百炼协议与独立地址修正](audits/2026-10-23/asr-protocol.md)：APK29/固定网关已发布，preview29/previous28，正式18/hot保持。31修正为原生多模态/output.text，Qwen3兼容chat/choices；独立百炼Base/模型与有效目标Key绑定，录音改AAC_ADTS，旧M4A对Qwen3提示升级，阶段错误明确。后端356/356、手机54/54、插件30/30、更新/消息/类型/构建与窄屏通过，lint0错误/8警告；84健康/17重连与能力/15公网核验通过。旧PID2086ms自然退出，配置/设备/语音Key与原Harness保持；用户需App内升级并填业务空间地址、对应模型/Key。真实付费/麦克风待验，旧追加仍暂停。

最新[输入区与运行中排队](audits/2026-10-23/composer-queue.md)：APK28/固定网关已发布，preview28/previous27，正式18/hot保持。麦克风移至发送旁，最新按钮按footer实际高度定位，其他控件独立44px；Codex运行中默认排队，可选引导。独立持久网关FIFO在正常完成后原会话依次执行，可取消/暂停，断线及未知不重放，不覆盖桌面原生队列。后端352/352、手机53/53、类型/构建/消息/更新/实际窄屏通过，lint0错误/8警告；84健康、17重连/能力和15公网核验通过。旧PID131ms自然退出，配置/设备/原Harness保持；真机触摸、键盘和实际续发待验，旧追加联测继续暂停。

最新[第三方DeepSeek与助手重复修复](audits/2026-10-23/voice-url-dedup.md)：APK27/网关已发布，preview27/previous26，正式18/hot保持。设置支持HTTPS API地址/模型名，改地址须对应Key；按原始ID合并历史与实时助手消息，首次刷新旧正文缓存而保留草稿/待确认输入。后端337/337、手机52/52、消息/类型/构建/更新/窄屏通过，lint0错误/8警告；84健康、14重连、15公网核验及真实19条助手身份保留通过。旧网关2068ms自然退出，Harness/配置/设备保持；此次无桥接重载，不宣称长期残留根治。真实手机安装/供应商待验，旧追加继续暂停。

最新[语音预览发布](audits/2026-10-23/voice-release.md)：已更新固定网关并发布APK26，preview26/previous25，正式18/hot保持；84项网关健康/15项公网完整下载核验通过。原进程stop后残留DeepSeek连接，官方页面仅重载原手机桥接后自然退出并恢复，原Harness与配置/设备/插件保持，未根治长期残留。APK25可App内升级，安装后在手机设置填写两组Key；未调用真实供应商，录音/效果仍待验。同轮用户报告02:06/02:07重复输入和计划式回复，电脑原始输入一条，手机缓存/对应复现未取得；建议身份贯通和进度折叠，未修复。此前[本地候选验收](audits/2026-10-22/voice-input.md)记录后端332/332、手机51/51及Android lint0错误/8警告。旧追加入口验证继续暂停。

最新[手机原请求与控制验收](audits/2026-10-22/phone-controls.md)：APK25普通收发已通过，pwd自动执行、审批分支未覆盖。用户明确报告运行状态/停止按钮可见但没有追加入口，已记录真实失败；同轮原插件与公网均running/confirmed且canSteer=true，手机显示已连接、无等待确认。APK25含按钮，390px合成界面未复现；已收到任务结束态截图，确认原会话/连接及输入区；仍缺运行态画面/接收状态，不把结束态无等待提示外推到运行期间，暂不重复sleep或猜测修复。96/96既有隔离回归通过，另发现长turn重开能力恢复缺口（独立诊断1通过/1失败），不认定为本轮根因。未改生产/发包/重启，追加待定位，中断及长期测试暂缓。

最新[Android兼容性与真机验收](audits/2026-10-22/android-compat.md)：11项lint阻断已修复，完整lint0错误/5警告，minSdk23保持；后端321/321、手机46/46、类型/构建及窄屏通过。APK25成品14项、公网15项核验，preview25/previous24、正式18/hot保持。用户确认24→25 App内升级成功且原连接仍在，以及DeepSeek同一会话收发完整且无重复。两Agent真实只读短时重连通过；追加/中断/审批、Android切网/后台/电脑睡眠继续待验，长期测试暂缓。下方旧轮次证据保留，当前版本和待办以此及专项记录为准。

最新[App内APK更新链路](audits/2026-10-22/in-app-update.md)：APK24新增原生有界下载、进度、大小/SHA/身份/版本/签名校验和系统授权/安装接续；旧包先手动覆盖一次，取消/失败可重试。新包实际绑定preview源，preview24/previous23，正式18/hot保持；新5/5与Java39断言、手机46/46、类型/构建及窄屏通过，APK12项/公网14项通过。完整Android lint仍有11项既有资源/旧热更新错误，新插件0项问题，Android授权/覆盖保数据待验；未操作网关、Harness或原任务。

最新[Codex近期范围与两Agent项目折叠](audits/2026-10-22/project-groups.md)：Codex/DeepSeek均默认近30天、按需查看更早及按完整目录分组，显示项目文件夹名，折叠偏好按连接/Agent保存，搜索临时展开。Codex网关在搜索/分页前筛选，手机前台每30秒只刷新摘要，保留选中/运行/待确认。后端321/321、手机46/46、类型/消息/热更新回归、构建及360/390/430px/150%字号通过；固定网关已更新，本地公网Codex69近期/126全部、DeepSeek11会话/3项目及原生IPC健康通过。原Harness进程、配置/设备/插件保持；APK23同签名独立预览已完整下载核对，previous22、正式18/hot保持。手机安装23和真实控制仍待验，整体任务in_progress。

最新[DeepSeek全部线程与按需历史](audits/2026-10-22/deepseek-history.md)：原profile跨工作区普通线程、默认近30天及“查看更早会话”、前台摘要刷新与按需历史已实现，历史窗口可持续前翻及返回最新。固定网关/原插件0.2.0已更新，实际11线程/3工作区，本地公网历史/重连与95项健康断言通过；原Harness进程、凭证/设备/profile保持，原任务已自然完成。后端318/318、手机43/43、官方历史4项/交互8项及类型/构建/窄屏通过。APK22 `1.3.1-deepseek-history-preview`已独立预览发布并完整下载校验，需手机覆盖安装才能获得新UI；正式18/hot保持。真实发送/权限决定、Android及长期测试仍另验。

最新[网关退出与重启稳定性](audits/2026-10-22/gateway-shutdown.md)：统一适配器停止前移到HTTP排空前，修复info/首帧等待时关闭循环等待。网关/托管30/30、后端308/308、两端类型与Relay/插件构建通过。旧版切换再次残留并短暂离线，官方界面仅重载手机桥接后自然退出，失败/恢复分别保留；新固定网关真实活动只读订阅下138ms自然退出并成功重启，本地/公网/IPC及34项健康检查通过。原Harness任务/PID、配置/设备/profile保持，APK21无需重装；长期测试和手机真实决定仍分别待验。

最新[DeepSeek手机卡片与权限](audits/2026-10-21/deepseek-interactions.md)：原插件0.1.2及固定网关已实际加载，支持原生单选/多选/自填/完整计划和工具允许一次/拒绝；APK21无需重装。修复真实Cordis服务Proxy及多语言displayReason兼容，后端304/304（DeepSeek40）、手机42/42、官方运行时13项/原交互8项、窄屏/类型/构建通过。公网当前真实权限卡完整输入和once/reject及重连只读通过；用户已确认手机能看到完整参数及允许一次/拒绝，实际决定仍待验收。原Harness PID/任务、配置/设备状态保持；首次网关stop因SSE未排空短暂离线，保留失败及恢复记录，退出清理另列待办，长期测试暂缓。

最新[DeepSeek桌面实际接入](audits/2026-10-21/deepseek-desktop-connect.md)：用户授权并选择当前“附件1”工作区，官方桌面0.2.1-rc.2的原desktop配置已安装0.1.1插件，由官方HMR在原进程加载，无需重启Harness。私有备份后建立独立loopback bridge，现有网关只增加DeepSeek配置并正常重启；本地/公网鉴权、会话列表、Codex原生IPC及手机同源解码器的短时SSE/重连通过。用户确认手机“能看到会话并打开正文”；发送/追加/中断仍待分别验收，原任务等待的审批须在桌面处理，长期测试继续暂缓。

最新[旧Mac应用清理](audits/2026-10-21/legacy-mac-app-cleanup.md)：按用户要求确认当前固定网关独立运行，将工程根目录Relay/Input两个未运行生成App私有压缩归档、逐文件核对后移除。旧LaunchAgent不存在/未加载，当前网关同PID/instanceId、本地公网鉴权及IPC健康通过，配置/设备状态保持；源码、构建入口和旧配置保留，未启用登录自启动。

最新[异步选择卡生命周期修复与复测](audits/2026-10-21/codex-question-lifecycle.md)：修复助手正常结束后未答卡片被移除，异步回复复用原生发送保护，运行中追加、空闲时在同一会话继续。后端287/287、问答/原生82/82、手机42/42及类型/构建通过；私有备份后固定网关已更新，本地/公网/IPC健康通过。当前新会话重发卡后，用户确认“回复结束后卡片仍可见”，收到原题结构化回复；后台/切网仍待验收，手机无需重装。

最新[DeepSeek启动接线修复](audits/2026-10-21/deepseek-factory-wiring.md)：真实HTTP工厂漏传deepseek配置，注入适配器的旧路由测试未覆盖。新增入口回归先失败，补传后DeepSeek23项及相关合并135/135、Relay类型/构建与独立候选18文件核对通过。修复保存在独立候选，在线固定网关与APK保持，宿主实际接入仍另验。

最新[当前会话手机验收](audits/2026-10-21/current-session-phone-acceptance.md)：用户已报告手机版本`v1.3.0-deepseek-dedup-preview`并指定当前会话，旧“缺少版本/空白会话”的阻塞已解除。本地/公网连接及原生IPC健康通过，用户确认手机显示并提交，原题回复和公网权威`pending → submitting → 移除`闭环通过；重订阅未复现首张卡。手机后台/切网与其余控制仍分别待验。

最新[固定网关兼容修复上线](audits/2026-10-21/agent-compat-runtime-upgrade.md)：沿用已授权切换，在私有备份后将核验的0.2.0候选复制至新固定目录运行，OpenCode nullable分页修复已进入在线网关。本地/公网鉴权、401、Android预检、Desktop IPC及单监听者通过，配置/设备状态、APK21与三个更新清单保持。首次收尾断言触发正常回退后，补齐进程退出等待并完成二次切换；保留全部证据。未启用LaunchAgent或安装宿主插件，Claude/DeepSeek宿主修复和手机/原会话仍待验收。下文“网关保持原值”为相应历史阶段事实。

最新：[手机重复修复与DeepSeek候选](audits/2026-10-21/deepseek-dedup.md)。用户确认一次手机输入成功，随后重复显示已在源码修复；新增官方Harness原进程插件/网关/手机入口。综合后端248/248、最终DeepSeek21/21、手机42/42、消息/类型/构建与窄屏合成通过。APK21已独立预览发布并核对公网SHA/大小/CORS；Mac已私有备份并升级同源固定网关，本地/公网鉴权、401、Android预检和Desktop IPC健康通过。正式更新仍18，热更新及宿主插件安装未改；Android覆盖安装/官方dsh与长期连接仍未验收，以下为历史阶段记录。

后续[DeepSeek官方运行时复核](audits/2026-10-21/deepseek-official-runtime.md)已通过13项：原9项加载/依赖生命周期，加官方生产AgentLoop的排队、追加、流去重、中断保留Inbox与旧turn拒绝。实际AgentLoop暴露revision逐帧递增契约错误，已先复现再修复为插件0.1.1；DeepSeek22/22、Relay构建、语法和独立插件ZIP核对通过。3次本地确定性响应、外部模型请求0次；修复插件单独保存在本地候选，APK21、已发布原ZIP与运行网关未改。用户dsh原会话和Android仍待验收；前置ADB为0设备，手机版本与测试会话已询问。

最新[Claude官方运行时复核](audits/2026-10-21/claude-official-runtime.md)：临时官方2.1.287严格校验发现HTTP helper同名加载错误，插件0.1.1已修复；原8个hook/9个API识别、官方无模型7/7、既有Claude31/31及固定声明类型检查通过。检查器及外置fixture可复用，独立修复插件本地打包，用户旧CLI未升级。官方沙箱通过不计原会话Classic交互/真实provider或Android验收，APK21与运行网关保持原值。

最新[OpenCode官方服务复核](audits/2026-10-21/opencode-official-runtime.md)：独立HOME/XDG/数据库与simulation的本机2.0.16前台服务，12项通过；实际空列表暴露nullable cursor被误拒绝，先补两项失败回归再修复共用解码器。OpenCode34/34、三Agent合并87/87及Relay类型/构建通过，包含三处兼容修复的独立本地候选已核对18文件。未提交prompt、升级用户宿主或切换运行网关；自有fixture问答/心跳通过不计用户原会话、Android或长期验收。

最新[原生网关后台托管](audits/2026-10-21/gateway-service.md)：Codex插件0.2.0增加可选macOS LaunchAgent、固定SHA程序及service命令，普通start复用托管，正常stop退出0。26项隔离回归、真实plutil解析、类型/构建及本地候选核对通过，bundle增加10,786字节且无运行依赖新增。本轮未注册用户系统服务、安装插件或切换在线网关；真实登录/异常恢复/唤醒与Android仍待验收。

最新手机反馈：更新后公网连接成功、同步120线程，发送出现409，实际界面版本尚未核对。[409排查与修复预览](audits/2026-10-21/phone-send-409.md)记录证据与边界；手机修复APK20已发布到独立预览目录，原生能力未就绪时禁用发送、409显示具体原因、保留草稿。手机41/41、Desktop原生19/19及构建通过，手机真实发送待复测。下文19的三类候选及历史验收记录保持原义。

先读 [工程布局](project-layout.md)，再按 `.trellis/spec/mobile/frontend/` 或 `.trellis/spec/relay/backend/` 进入对应模块规范。任务与验收记录保存在 `.trellis/tasks/` 和 `.trellis/workspace/rorance/`；优化优先级以 [2026-10-20 审核计划](audits/2026-10-20/README.md) 为准。A–D 本轮源码实施与隔离验证已完成，统一实测步骤、当前包和限制见 [优化交付](audits/2026-10-20/delivery.md)。

已发布并备份的开发基线为 `codex-to-phone-v1.2.2`（`12c9f15`）。当前任务 `.trellis/tasks/10-20-agent-gateway/` 的 P0、P1提问/原会话控制/审批、P2插件管理、P3 OpenCode及Claude原请求问答/单次审批源码已实施；[Agent网关](agent-gateway.md)记录接口、证据及剩余阶段。最终后端227/227（Codex问答44、OpenCode32、Claude31）、手机37/37、消息回归、两端类型/构建、两插件独立包和窄屏合成验收通过。本机Claude CLI2.1.220低于Mods宿主下限2.1.287（API声明生成于2.1.277），未升级或加载；原生取消/两端先答仍须核验。实际插件安装、Codex原会话控制、真实OpenCode/Claude及Android仍待验收；用户已授权并完成原生候选网关切换，APK19提供独立预览下载；正式Android更新清单仍18，旧Mac App和权限保留，暂不开长期连接测试。

本地[1.3.0候选交付](audits/2026-10-21/agent-gateway-candidate.md)已生成versionCode19同签名APK、插件ZIP及仅兼容19的完整单文件热更新，APK已独立预览发布，真实安装待确认。修复热更新遗漏懒加载Agent页面；包内资源、双更新源、签名/权限及单HTML合成运行已核对。OpenCode已按本机2.0.16的固定官方源码修正，未知版本拒绝控制、普通form问答映射原字段值，复杂表单保留不可操作说明；Codex PATH版本与Desktop内部版本分别记录。

最新[Codex提问重连复核](audits/2026-10-21/codex-question-reconnect.md)修复重复回答保护；[长会话快照修复](audits/2026-10-21/codex-large-snapshot.md)进一步定位38MB原始帧被16MiB限制拒绝的根因。改为64MiB有界、一次分配接收后，当前真实只读v11原会话快照恢复（约620ms、120条消息、手机投影约707KB）。后端210/210及两端类型检查通过，只更新插件ZIP，APK/HTML未改；真实问答提交/两端先答、插件迁移和Android统一验收仍待完成。

[插件安装前复核](audits/2026-10-21/plugin-preflight.md)补齐Codex本机执行声明与Claude作者元数据，区分API声明生成版277和Mods宿主下限287；两处版本门及31项Claude隔离回归通过。后端210/210、技能校验和独立包通过；本机旧Claude官方校验仍失败，实际安装/加载另行验收。优先完成Codex手机选择原请求闭环，再进行插件迁移与Android公网验收。

最新[问答回包核验](audits/2026-10-21/codex-question-ack.md)修复坏响应被误标submitted：检查方法、owner、有效同步结果及异步原turn，未知保持锁定，权威移除优先。新增17项后问答44/44、综合后端227/227及两端类型/Relay与插件构建通过；Claude旧超时测试按轮询契约修正，生产逻辑未改。只重建插件ZIP，手机原会话应答与Android实测仍待办。

[真实验收条件核对](audits/2026-10-21/acceptance-readiness.md)：当前原会话只读订阅正常（约694ms），但没有待答题/审批；ADB无设备，本机没有模拟器/镜像，独立网关配置尚未建立。候选hash及ZIP与当前构建一致。该核对时缺失的网关与下载准备现已完成；当前以[迁移交接](audits/2026-10-21/gateway-migration.md)为准，等待手机覆盖安装和空白工程测试原会话，不以只读检查代替真实写入验收。

## 工程文件目录

- `CHANGELOG.md`：当前版本功能描述、修复内容、提交前检查和已知限制。
- `docs/project-layout.md`：工程布局、Trellis 工作入口和验证命令。

- `docs/project-index.md`：施工入口和文件索引。
- `docs/legacy-notes.md`：旧扫码 bridge / skill / tunnel 方案的完成内容和局限。
- `docs/product-requirements.md`：产品需求规格，包含用户已提出和工程侧补全的要求。
- `docs/architecture-feasibility.md`：可行性、架构方案、已实测证据、风险边界。
- `docs/agent-gateway.md`：开发中的插件化网关、Agent 适配接口、只读探测及阶段边界。
- `docs/network-plan.md`：本地局域网路线和公网远程方案。
- `docs/remote-broker.md`：公网 Broker 部署和 Mac/Android 配置。
- `docs/ops/remote-connection-repair.md`：公网 TLS、Broker/Mac 切换、连接验证和回退流程。
- `docs/audits/2026-10-20/work-status.md`：手机工作状态修复、APK 17 与只读验证结果。
- `docs/audits/2026-10-20/update-restore.md`：APK 18、手机更新渠道恢复、覆盖安装与公网发布验证。
- `docs/online-update.md`：Android 自托管在线更新流程。
- `docs/usage.md`：部署、启动、APK 构建和换电脑使用说明。
- `docs/ui-interaction-spec.md`：手机版 Codex 工作台 UI 和交互规范。
- `docs/implementation-roadmap.md`：分阶段施工计划和每阶段完成定义。
- `docs/test-and-acceptance-plan.md`：烟测、实测、验收标准。
- `docs/technical-notes.md`：协议、后端、平台限制等技术记录。
- `docs/safety-and-acceptance.md`：安全硬约束和阶段验收原则。
- `marketing/wechat-article.md`：微信公众号推文草稿。
- `marketing/video-script-prompt.md`：项目介绍视频稿本提示词。
- `marketing/demo.html`：可本地打开的演示 HTML。

## 当前已验证事实

- 2026-10-20 已按用户授权修复过期公网证书并升级运行中的 Broker/Mac Relay，公网鉴权健康检查通过；手机重试及真实控制验收仍待用户完成，见 [连接修复记录](audits/2026-10-20/connection-repair.md)。
- Mac Relay App 可以本地启动 Relay 并读取 Codex Desktop 会话。
- Mac 输入 helper 通过辅助功能把手机文本提交到 Codex Desktop 当前线程。
- 公网 Broker 模型已落地，Android Endpoint 可以使用 `https://broker.example.com/r/my-mac` 这类稳定入口。
- Android App 已支持 Endpoint/Token、线程列表、发送输入、上传附件、主题切换和在线更新检查。
- `1.1.12-status-context-fix` 已把手机 UI 收敛为用户输入和 Codex 文本结果，默认隐藏工具调用、环境上下文和内部桥接事件。
- `1.1.13-message-order-fix` 修复重复文本被误删、乐观消息与桌面落盘消息错配，以及缓存/增量消息排序不一致。
- Android 更新源已经改成构建时配置，仓库不再绑定个人服务器或域名。

## 当前不应再继续的方向

- 不把首页做成连接诊断页。
- 不做远程桌面画面同步。
- 不把主工作流降级成 `codex exec` 或独立 CLI 会话。
- 不修改 Codex Desktop 安装目录、系统环境变量、注册表或全局防火墙策略。
- 不把手机另开的 app-server 会话伪装成 Desktop 当前窗口的同步控制。
- 不再把早期扫码网页 bridge 作为当前主线。
- 不在仓库提交 APK、`.app`、`node_modules`、上传文件、token 或本地日志。

## 当前施工顺序

1. 以 Mac 原生网关 + Android App + Broker 作为当前主线；旧Relay/Input App仅保留源码和构建回退入口。
2. 保留旧扫码方案的历史记录，不再保留旧代码。
3. 优先保证用户能安装和管理网关、安装Android App并完成配对；当前固定网关先查status，避免重复启动旧App。
4. 继续优化远程稳定性、开机自启动、日志诊断和在线更新体验。
5. 按Agent网关P0–P3推进插件与其他Agent；手机提问、原会话控制和审批源码已实施，统一真实验收仍待完成。

## 文档维护规则

- 做代码改动前，确认改动属于哪个阶段。
- 每次 APK 构建、Relay 实测、手机真机测试，都要更新 README 或对应 docs。
- 每次改变架构判断，要更新 `docs/architecture-feasibility.md` 或 `docs/remote-broker.md`。
- 每次改变产品范围或交互方式，要更新 `docs/product-requirements.md` 或 `docs/ui-interaction-spec.md`。
