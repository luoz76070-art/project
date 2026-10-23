# Mobile Codex 工程档案入口

更新时间：2026-10-23

## 作用

每次继续施工前，先读本文件，再按链接读取对应工程文件。后续不能只靠聊天记忆推进，所有需求变更、技术判断、实测结果、阶段验收都要落到本目录。

## 当前项目定义

项目名：Mobile Codex / Codex To Phone

目标：把 Android 手机变成 Mac 上 Codex Desktop 的移动工作台。电脑继续运行 Codex Desktop 和 Relay，手机不是远程桌面画面，而是通过 Relay/Broker 读取会话、查看最新文本结果、发送输入、上传附件，并在离开局域网后继续远程控制。

当前主入口：

- Android APK：`dist-apk/mobile-codex-1.2.2-update-restore-debug.apk`（versionCode 18，已恢复原手机更新通道并发布，待真机验收）
- Android独立预览：`dist-apk/mobile-codex-1.3.9-process-collapse-preview-debug.apk`（versionCode30，Codex/DeepSeek过程折叠完整实现并发布，配套网关和DeepSeek插件0.2.1已更新；preview30/previous29、正式18/hot保持。APK30真机安装及真实显示待验。用户此前确认29识别/整理/回填成功；后续第三方DeepSeek生成接口502及后台/来电/弱网问题另验）。
- Mac 原生网关：`~/Library/Application Support/Mobile Codex Gateway/releases/<固定版本>/mobile-codex/lib/gateway.mjs`，当前单Node进程、native IPC；[插件管理入口](../plugins/mobile-codex/README.md)。
- 旧 Mac Relay/Input App：生成App已压缩归档并移除，源码与构建入口保留；[清理及恢复记录](audits/2026-10-21/legacy-mac-app-cleanup.md)。
- Relay/Broker：`apps/relay`
- 手机客户端：`apps/mobile`
- 协议类型：`generated-protocol`

## Trellis 与当前优化

最新[版本同步约定](ops/version-sync.md)：用户已确认独立功能/修复完成后分步本地提交，完整版本验收后集中推送现有GitHub并打版本标签。父仓库为project，仅提交codex-to-phone子目录；保留其他工程和用户暂存项，不自动建分支/PR或部署。当前APK30作为明确preview源码基线，真实手机验收及语音供应商问题仍独立保留；本轮同步结果见后续专项记录。

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
