# 设计

## 2026-10-22 手机控制验收推进

本阶段先完成真实行为验收，不预设产品缺陷或新增生产功能。复用现有DeepSeek原请求单次决定、原turn控制及手机卡片，使用异步问题提供一项一个结果的手机步骤。必要时增加仅保存在output/audit的显式只读观察器：只GET元数据/事件及POST短流令牌，不提交messages/interrupt/respond，不保存消息正文、凭证或控制令牌。只有快照包含本次测试标记才关联为该场景旁证；卡片消失与任务终态不独立证明批准/拒绝，由用户原题结果补证。没有卡片则该分支未覆盖，不更改宿主权限规则。发现具体失败后才缩小复现与修复，并按受影响层验证；不发布新APK/切换网关来替代验收。

追加入口失败已由用户确认。新增原插件/公网双端观察并匹配本次输入，running/confirmed和canSteer=true均已到公网；APK25确含入口，390×844/390×430合成页面可见。用户已提供结束态截图，确认原DeepSeek会话、22:51输入/22:53完成与底部输入区；当前无运行提示/停止按钮，按现有条件应隐藏追加入口。已连接/无待确认是结束态证据，不能外推运行期间。运行态接收快照/资源和画面仍未知，下一步取对应真机证据后再改代码。独立合成长turn重开在40条基线之外丢失turn/start可复现能力false，但该状态与本轮双端true不一致，仅作为另一个缺口记录，未实施修复。生产代码和线上服务保持，审计观察器不纳入默认回归。

## 2026-10-22 Android兼容性与短时验收

缺口在HotUpdatePaths.deleteTree直接使用API26的Path以及HotUpdatePlugin直接使用API24的Content-Length API，另有7个方向限定splash缺省资源。路径包含关系改为canonical File父链比较，保留根目录/外部路径/符号链接边界；长度改用API23可用的响应头读取和long解析，流量仍受32MiB限制。drawable/splash.xml补与现有主题一致的背景缺省，保留全部方向资源与主题。预期代码仅修改这两处Java、一个资源、路径回归及Android/Web版本；不重构更新器、不升级依赖或改Agent控制协议。完整lint用JDK17分析、已有JDK25编译fork，保留可重跑入口。修复通过后沿用独立preview原子发布，保留previous24，正式18/hot保持。真机升级与真实控制、切网/后台/睡眠分别记录，不能以合成测试代替。

最终实现另将隔离fixture版本随appVersionCode递增，保持每次构建后仍能模拟下一版更新；不进入APK。完整lint0错误/5警告，用户24→25升级及DeepSeek普通收发已确认，1万会话合成性能未发现需要新改动。未改变网关/Agent生产代码或重启线上进程；结果与未验项记录在专项审计中。

## 2026-10-22 Codex近期范围与项目分组

缺口分别在CodexStore分页前缺少时间下界、Workspace恢复所有已读线程而没有近期范围，以及项目标题静态/DeepSeek平铺。CodexStore.listThreads增加可选since毫秒下界，内部旧调用仍默认全部；HTTP列表接受recent/all、默认recent并多取一项计算hasMore。过滤发生在候选摘要阶段，复用既有目录增量索引与文件头缓存，不扫描所有正文。

前端复用features/threads/model按路径分组，新增共享ProjectGroup与有界折叠偏好。Codex保留现有行，DeepSeek目录映射到同一模型；同名项目展示路径，默认展开，搜索时临时展开但不覆盖保存状态。小屏left/top也保留可点击项目头，触控至少44px，不新增依赖。

Codex增加范围及后台请求代次/取消，拒绝迟到结果覆盖新范围。仅列表可见且前台每30秒/回前台静默请求摘要；静默刷新不调用完整live turns或正文，保留已分页数据并去重，普通手动刷新保留选中/运行/未知操作而非全部已读缓存。旧网关兼容路径也执行近期显示过滤。分组与范围不改变发送、审批和历史控制协议。

预计修改store/HTTP路由、手机queries/model/偏好与共享分组组件、两列表及CSS/配置、合成fixture和相关隔离测试；不迁移聊天编排、不重做原生控制或Agent插件。复用2026-10-20已采集官方单色手机导航参考，新增分组仅作本产品交互，不能声称官方存在相同分组样式。测试/构建/浏览器通过后制作独立APK23及固定网关，真实只读及手机安装验收分开。

## 2026-10-22 DeepSeek全部线程与历史继续

用户后续确认默认近30天，保留“查看更早会话”。官方metadata短缓存15秒，原session创建/消息/status失效，下次按需刷新；手机仅列表前台每30秒及回前台刷新摘要，打开正文仍按需分页。按官方最后用户对话/创建时间筛选，运行中及当前查看/未确认线程保留。旧会话有新对话恢复到近期列表，不删除桌面记录、不后台遍历正文。历史视图复用Codex240条窗口，继续往前翻时移窗，提供返回最新，不再190条硬停止。新增手机APK22预览交付，正式更新不改变。

固定当前安装包332895e0的官方sessionController.list/page/prompt及sessionQuery.observeSession：list合并live/persisted并复用title/sessionListMetadata缓存，不为列表读取全部日志；observe+page提供非激活历史。禁止使用follow读取冷会话，因为该接口首快照后会promote。显式发送才调用官方prompt，在原进程恢复原sessionId，clientMessageId作为requestId/rpcId，权威user/message确认；已有live线程仍沿原handle同步控制与交互归属。

新增插件catalog模块管理官方列表/分页、原ID与有界opaque UUID映射、线程绑定游标；bridge整合冷会话快照和显式发送，不拆分原任务。Relay仅在私有scope=all且info声明对应能力时允许跨目录/历史，通过原通用session routes和手机现有分页/发送协议。目录模式兼容原插件；新全量模式需要明确配置并核对原宿主接口，未知契约拒绝，不扩大远端权限或创建会话。期望修改插件catalog/bridge/index包元数据、Relay DeepSeek三模块/测试、手机说明与fixture、契约/任务/交付；不改Codex或其他Agent控制行为。

先用合成目录/冷存储与官方隔离模块验证多页列表/标题/去重/子Agent排除、历史分页/游标隔离、只读无激活、显式一次prompt及rpcId权威确认、热加载/断线未知/关闭释放。随后生成独立网关与插件候选，私有备份并按既有授权更新原进程，真实只读对照线程计数和正文；真实历史继续/模型写入由用户选定任务验收，不自动发测试消息。

## 2026-10-22 网关停止时的订阅排空

缺口在createRelayServer生命周期：preClose仅销毁下游流并提前停止Claude，而AgentGateway.stop在onClose才执行。Agent路由先await watchSession再reply.send，初始化中的上游请求可以阻塞HTTP关闭，使onClose无法执行。先用真实HTTP及默认DeepSeek适配器的隔离bridge验证此顺序，再将统一AgentGateway停止移到preClose，取消初始化和活动连接后等待HTTP排空；其余资源沿既有onClose释放，不重复停止Claude。

预计只改createRelayServer关闭顺序和managedGateway.test回归，复用现有stop与AbortController，不引入全局fetch池销毁、进程强退或新协议。验证info等待、首帧等待、正常流及独立包daemon自然退出/同端口重启，失败时只清理自有fixture。成功后独立打包并按既有授权范围准备固定运行更新；线上旧版退出若仍需排空，先记录事实与恢复点，保持原Harness和请求。界面、模型控制、自启动均不在本轮范围。

## 2026-10-21 DeepSeek 桌面安装与动态加载

本机官方桌面版自带runtime/cli/bin/dsh，包装器允许plugin管理保留的desktop配置，但禁止通过普通启动或dump-config启动desktop。使用自带CLI plugin命令安装经逐文件核对的固定0.1.1包，保留profile的autoInstallPeers:false，离线且不执行安装脚本。私有bridge配置通过profile的mobile-codex.configFile绝对路径注入；不依赖GUI进程继承shell环境。官方HMR会监视profile manifest和patch并重新组合配置，新插件可进入原进程；需要重启时不得终止正在运行的任务。

操作前备份desktop原配置及网关配置，记录权限/SHA/原进程；插件复制到独立固定目录，配置目录0700/文件0600。确认bridge精确工作区、401与在线根会话后，增加网关deepseek字段并使用原instance绑定管理接口正常停止/启动，原有字段与设备状态保持。接通后执行本机及公网Agent列表与有截止的只读SSE核验，不记录会话正文/密钥/控制令牌。失败恢复本次改动配置并核对原网关；不升级宿主、修改应用包、启用自启动或控制原模型任务。

## 2026-10-21 旧 Mac 应用清理边界

通过当前监听PID、固定程序路径、bundle SHA、网关instanceId及native IPC健康确认运行链路。只清理工程根目录两个未入Git的生成App；先校验bundle ID、无运行进程/符号链接及无旧LaunchAgent，再制作0700目录内的压缩归档，逐文件核对内容与权限后移除原App。压缩归档避免留下可误启的同名App副本。保留Swift源码、mac构建命令、旧凭证/日志和现有固定发布。当前网关不重启，清理后核对同PID/instanceId、配置与设备状态、本地/公网鉴权及Desktop IPC。系统后台项目清单读取有截止时间，失败记unknown，不修改TCC或扩大为注册新后台服务。

## 2026-10-21 异步题正常完成后的生命周期

只读原生元数据确认第二卡父轮次completed且题目仍存在，后续用户原题反馈在新轮次accepted；旧desktopQuestionCandidates只遍历inProgress，真实丢失位置在Relay投影。保留活动轮次异步题，并保留canonical最新轮次正常completed的未答异步题；有更新用户轮次、interrupted/failed或原题消失则失效，避免从长历史复活旧问题。原题签名不随inProgress→completed改变，未确认锁跨完成/重订阅保持。

异步应答复用DesktopNativeControl普通发送边界，发送前绑定原题与当前轮次：原轮次运行时steer v1，已正常完成且仍是最新轮次时对同一conversation start v2，并携带原题回复封装。只选择一次方法，无失败回退；复用普通发送的串行/待确认保护。共享ACK继续严格核对owner/method/可选内层method与steer原turnId，权威题目移除优先。同步requestUserInput仍使用原请求v1，不受该放宽影响。

修改限desktopQuestions、desktopControl、desktopNativeControl及原socket回归/规范/证据；手机现有卡片支持completed快照，不必重打APK。验证后单独打包，并沿用既有单网关切换授权私有备份/固定目录更新；不改手机配置、Mac辅助功能或Agent宿主。

## 2026-10-21 DeepSeek启动配置接线

`createAgentGateway`已支持可选DeepSeek配置，但`createRelayServer`构造默认网关时遗漏该字段，导致环境配置和托管配置到达HTTP工厂后丢失，已有注入AgentGateway的路由测试无法发现。修改仅在现有工厂补传配置，并新增不注入AgentGateway、只使用临时目录/合成bridge的生产入口回归，验证被动注册、会话列表与探测。无新增依赖、不改宿主插件或手机；先复现失败再修复，候选另存，在线网关不隐式替换。

## 2026-10-21 当前会话选择卡真实验收

沿用当前固定网关与用户指定的Desktop原会话，先检查本地/公网鉴权和原生IPC，再以现有异步提问工具产生无副作用的真实选择卡。独立有截止时间的只读公网v1订阅使用当前手机解码器，记录同会话、交互能力、卡片出现/状态/移除，不保存私有会话正文、题目答案或控制令牌。用户在手机自行选择并提交；观察投影通过不等于Android展示或原请求应答通过，权威移除也不能单独证明具体应答路径。当前会话不用于自发审批或自我中断，其他控制验收须安排可观察的实际操作。

## 2026-10-21 固定运行包兼容更新边界

现有固定网关尚未包含官方运行时复核发现的OpenCode nullable游标兼容修复。本轮沿用用户已授权的单网关切换，使用逐文件核验的0.2.0候选固定包；配置、设备文件、端口、公网入口及APK保持。先私有备份当前固定版本，再按原instanceId正常停止并确认旧监听释放，使用新固定目录普通start。启动/健康失败回退旧固定目录，不通过kill、不建立第二个Tunnel，也不自动启用service命令或安装Agent插件。只进行被动鉴权/状态及原生IPC健康检查，不向任何原会话发送任务、答案、审批或中断。宿主侧Claude/DeepSeek修复仍需用户在兼容宿主安装，不能因网关包包含插件便记为已生效。

## 2026-10-21 原生网关可选macOS后台托管

当前CLI start是detached子进程，退出后无恢复；旧mac-autostart.sh只运行Swift Relay App，不能监督新原生单网关。补齐gateway/macService.ts与CLI service install/status/uninstall，普通start/stop复用托管注册的生命周期。仅用户主动service install时复制独立bundle至私有固定目录、写用户LaunchAgent并bootstrap；源码本轮不操作真实launchd。平台/UID/进程执行器可注入，测试只使用临时HOME与合成launchctl，plutil只读验证生成XML。

每用户固定label，私有receipt绑定config绝对路径、固定bundle SHA、Node绝对路径及安装时workspace；plist精确校验后才认领。配置/设备文件不复制也不删除。操作锁串行install/start/uninstall，已有旧Relay登录项、其他配置注册、未知服务/端口拒绝接管。bootstrap/kickstart/bootout使用参数数组无shell；print仅明确的service missing可判未加载，其他失败为unknown。失败保留可诊断注册，不以盲目bootout或回退detached掩盖。

RunAtLoad与KeepAlive.SuccessfulExit=false、15秒ThrottleInterval；daemon处理SIGTERM并正常0退出，原stop须保持停止。已注册服务的start走bootstrap/kickstart并核对同一HTTP网关，不spawn第二个候选；stop继续原instance绑定HTTP。卸载只在确认job移除后删除自己receipt/plist，保留配置/设备及固定bundle。不开机/睡眠/权限或长期验收不能由合成launchctl通过替代。修改限gateway模块、现有CLI/测试、插件README/技能入口及契约/任务/交付记录，不修改旧App或旧自启脚本。

## 2026-10-21 OpenCode 官方服务隔离复核边界

现有32项OpenCode回归使用合成HTTP/SSE，尚未验证本机官方2.0.16的实际鉴权、路由、响应解码及心跳。新增显式检查器，要求绝对路径官方可执行文件；HOME、XDG、配置、工作目录、TMPDIR全部自建，环境变量采用白名单，禁用项目配置、模型目录抓取、文件监控及自动更新。仅启动自有loopback随机端口的前台serve，不使用service/恢复模式；官方simulation拦截未注册出站HTTP，不提交prompt、不加载用户Agent配置。

测试owner可在此独立数据库创建自身空白fixture及question表单，驱动产品现有适配器验证列表/订阅/原字段应答、空闲中断、断开释放与SSE心跳；fixture创建直接由检查脚本完成，产品适配器仍不得create/fork/resume。脚本退出停止自有子进程并删除临时目录，不访问用户真实会话。修改限检查器、可能暴露的OpenCode协议缺陷及对应回归/规范/证据；既有APK、运行网关与用户宿主不升级或部署。模拟网络和自有fixture通过不计真实provider、原用户会话或Android验收。

实际空列表返回cursor.previous/next=null，原Zod optional字符串导致列表报OPENCODE_PROTOCOL_ERROR，消息分页也使用同一解码器。先保存官方失败响应及两项失败回归，再在唯一cursorSchema接受nullish值，保留8192字符与类型边界。产品只修改这一内部解码，不更改HTTP路径/写入/会话归属；独立本地三插件候选包含此修复及前两轮0.1.1宿主修复，不覆盖已发布包。

## 2026-10-21 Claude 官方校验器复核边界

本机Claude2.1.220低于现有Mods最低版本，先在临时目录下载并核对官方2.1.287原生包完整性，只调用版本/help、plugin validate及官方无模型plugin test入口。HOME/CLAUDE_CONFIG_DIR/工作目录独立，不安装到用户PATH，不更改用户Claude或profile，不启动会话/模型。先记录真实校验结果，再决定是否有插件源代码缺陷；若有，修改限mobile-claude模块、对应隔离/官方回归及文档。原已发布候选和运行网关保持原值，宿主原会话/Android仍需单独验收。

## 2026-10-21 官方运行时加载复核边界

已有DeepSeek测试使用合成Cordis上下文，尚未证明官方loader、依赖注入与异步卸载可用。先在独立临时目录使用固定0.2.1-rc.2发布产物及其官方依赖，核对包完整性，隔离DSH_HOME和profile，仅检查配置与插件生命周期；不更改用户Agent配置，不启动模型。若官方运行时暴露可复现问题，修改限于mobile-deepseek插件、直接受影响隔离测试与验收文档，保持现有协议/会话归属。官方加载通过仍不能替代真实dsh原会话、Android和长期连接验收。

加载9项通过后，继续使用同版本官方agent-loop-testkit装载生产AgentLoop，并仅登记本地确定性LLM adapter，检查真实driver的排队/追加/中断与turn边界。所有Agent、Session、配置均限脚本自建临时Context；不连接外部模型或用户进程。此部分与先前合成handle的加载检查分别记证据，真实用户原会话仍需单独验收。

实际AgentLoop暴露流revision契约错误：官方逐帧递增，原插件/合成fixture却按attempt固定。修复限bridge.mjs的帧校验、插件patch版本、DeepSeek回归与检查器及相应说明；已接受revision记录entry水位，chunk/end另匹配attempt/index，权威文本替换规则保留。独立0.1.1插件本地打包，不覆盖已发布三插件ZIP或APK21，不切换运行网关或安装用户宿主。

## 2026-10-21 消息重复与 DeepSeek 接入边界

重复入口位于手机发送回包后直接追加本地消息，而权威 SSE 可能先到。原投影丢弃 clientUserMessageId，运行中追加消息又可能使用任务开始时间，文本/两分钟窗口无法可靠匹配。修改消息 DTO/原生 Desktop 投影、手机单一合并边界及发送回包入口：优先按客户端提交 ID 对齐，兼容旧版 desktop-local-ID 占位；保留无关联标识的旧服务文本匹配，但不同明确 ID 的两次提交不得折叠。仅已接受的 steeringUserMessage 投影为用户消息，待接纳/拒绝不伪装为已收到。回包与 SSE 两种先后顺序均复用合并，不更改执行次数或自动重发。

预计涉及 mobile 的 types/messageReconciliation/App、relay 的 CodexMessage/desktopControl、合成fixture及相应回归。保留旧服务兼容和附件；不通过全局同文去重掩盖问题。DeepSeek 先固定官方主源和原会话读写协议，再补充独立适配契约、配置及共享手机入口，不改已有 Agent 的会话所有权或自动安装宿主。

DeepSeek核验结果见research-deepseek.md及deepseek-contract.md。落地为官方Cordis bundle在原进程通过agents.get/list操作live handle，独立127.0.0.1 HTTP/SSE由Relay deepSeekClient/Adapter/Protocol校验并复用原Agent routes；手机新增精确transport白名单、UUID生命周期别名与独立草稿。私有JSON0600/密钥隔离/精确cwd，engines精确宿主版本；不使用会自动resume的session-controller。首次订阅小log读一次官方observation，4096事件及以上保持lazy只跟随后续增量；200ms合并、文本与缓冲有界、原turn控制令牌、同步预留与权威user/message确认。问答/审批/分页/附件暂不声明支持。APK21及三插件候选已验证；部署认证恢复后已发布独立预览，备份并切换Mac固定网关，连接/鉴权/CORS与IPC健康通过。正式更新及热更新保持原状；真实dsh/Android与长期验收分别待办。

## 用户授权后的候选迁移（2026-10-21）

以固定 SHA 的独立插件 bundle 作为运行版本，独立私有配置显式导入旧 Relay 参数，workspace 保持原工程以沿用设备文件；空白测试工程单独建立。备份旧配置/设备文件、切换前磁盘 dist，并从 v1.2.2 运行备份提取原发布 dist，避免将开发期已覆盖的磁盘 dist 误认为原运行版本。旧 App 与辅助功能权限保留，切换只停止核实的旧进程链并启动单个 native 网关。

APK 使用原发布脚本上传独立 preview 子目录，正式 Android/hot 指针保持。验证部署、凭证、HTTPS/CORS、IPC 健康与短时只读 SSE；原会话真实写入、Android安装和正式发布分别验收。同名 App 查询实际打开旧副本并造成 Relay ID 争用后，已退出对应旧副本，后续按绝对路径/父子关系定位；不改认证边界。界面工具拒绝访问 Codex，未通过其他 UI 技术绕过，测试原会话仍待建立。

## Codex 问答回包核验（2026-10-21）

原题应答只核对epoch、resultType与owner，未像普通控制/审批检查method和有效结果，错误方法、空结果或负面结果会被显示为submitted。修正放在DesktopControl.respondUserInput：记录本次method，核验outer method、owner、可选内层method；同步题要求ok=true，异步题要求turnId等于原题任务。未知结果保持uncertain及原题锁定，不重放；同代次权威状态已移除原题时仍可返回resolved，不依赖ACK。修改仅涉及DesktopControl、既有合成socket回归、契约与插件候选记录；手机源码/APK/HTML不变，不发送真实答案或切换生产。

综合回归暴露Claude旧超时用例将一次长轮询当作生命周期截止。定时器可能稍早返回pending，宿主契约允许继续轮询；仅修正该用例，以既有有界until按原请求继续取结果，仍断言终态closed、迟到回答拒绝和原题不会复活。不修改Claude生产逻辑或延长生命周期。

## 插件安装前契约复核（2026-10-21）

当前Codex捆绑CLI0.163.0-alpha.10.2有plugin/marketplace管理命令，但没有plugin validate；不能把其他CLI的validator当作Codex安装验收。官方desktop-only文档明确skills-only且依赖本机执行的插件须在extensions.com.openai声明requires_local_executor=true，当前manifest缺此字段。补齐该元数据并核对独立包，不执行marketplace add或安装。

本机Claude2.1.220的plugin validate --strict已在隔离配置目录运行：缺作者的warning，以及旧hooks schema不接受modules入口的error。补齐作者信息，但不添加空hooks来掩盖版本差异。存档的官方Mods create明确要求2.1.287或以后，而当前项目仅以类型声明的生成版本2.1.277作为宿主下限，二者应分开。将宿主与Relay登记门同步收紧为2.1.x且patch>=287，类型API仍记录固定277生成声明，不改变接口或降级加载。官方站本次直取返回403，沿用当日已存主源并明确来源；不升级/安装宿主。

修改仅涉及两插件manifest/说明、Claude两处版本门与合成边界回归、构建包和契约/交付记录。验证旧版本无登记/无模型/网络副作用、287合成流程以及包元数据一致性；独立插件仍按既有脚本重建。真实兼容宿主校验/加载和原会话应答保持待验收。

## Codex 大快照接收（2026-10-21）

当前安装包的IPC版本仍为snapshot v11/following v1。只读诊断证明owner已发送38,411,290字节快照，但DesktopIpcClient在16MiB帧限制处主动断链，并非owner未发布或协议版本变化。原Buffer.concat累积方式还会随每个分块复制此前全部内容。

修复放在IPC字节解码层：4字节头独立累积，校验后按帧长度只分配一次，分块写入当前位置；单帧上限64MiB，保留零长/超限/非法JSON拒绝与断链清理。64MiB覆盖当前真实长会话，低于宿主256MiB上限，避免无界接收；不修改版本、owner路由、写能力或手机缓存。修改DesktopIpcClient、已有performance隔离回归及契约/交付记录；验证超过16MiB的合成快照、分片头/UTF-8/连续帧、复制量线性、坏帧和重新连接。真实只读复核另存脱敏计数，仍不发送任务/答案/审批、不部署。

## Codex 提问重连保护（2026-10-21）

复核发现Desktop提问的提交状态只属于当前订阅：IPC断线、patch缺口或最后手机订阅离开会清除卡片，重新取到相同原题时生成新的pending令牌，使已发送但结果未知的回答可被再次提交。保护应放在DesktopControl的原请求绑定层，复用审批的有界未确认记录做法；按线程和完整原题签名保留状态，不保存答案。提交前同步预留，最多128项；失联改为uncertain，重订阅同题仍锁定，仅权威状态不再包含原题时释放。新题和变更题按新签名处理，不承诺跨网关重启去重。

本切片只修改DesktopControl、合成原生IPC问答回归及相关契约/交付记录；前端已有uncertain展示无需改动，不重建APK。验证重连、释放后重订阅、权威移除/内容变化及容量边界，之后重建受影响的独立插件候选。真实Desktop只读核验单独记录，不发模型任务或答案、不安装插件或切换生产。

## OpenCode 2.0.16 契约修正（2026-10-21）

固定本机安装版2.0.16的官方tag commit `3a103fe0aff726a4edc7492f03f7b88195d9e4c9`。原1.19.3候选未安装/发布，不增加双协议猜测或回退；唯一适配基线切换到2.0.16。显式列表/新SSE连接先读`/api/info`确认版本，未知版本不给控制能力。prompt顶层text、回执inbox user/payload、permission.decision、interrupt JSON回执及session.*事件均按固定主源校正。canonical内容以ordinal定位，文字流使用事件created，不再假设textID/内容id。

question工具已改走`/form`。新增边界helper，只将metadata.kind=question且可完整映射的string/multiselect题转换为现有卡片；按原字段key和option.value回传answer对象，保留完整原请求签名，提交前重新读取。隐藏/条件/外部认证/数值/约束等未适配表单显示不可操作说明，不能丢字段后代答或触发外链。手机仅增加可选unavailableReason展示，不新增通用表单框架。

修改范围为OpenCode协议/流/适配器、独立问答helper、共享问答DTO及手机禁用文案、合成HTTP/SSE和浏览器验证、插件/候选记录。保持现有目录范围、随机令牌、先锁定、不确定结果不重放、按需单SSE及资源边界；不启动真实宿主/模型，不安装/升级Agent、部署或修改Mac权限。验证完成后重建本地候选，真实原会话和Android仍需另行验收。

## 候选包准备（2026-10-21）

源码与隔离检查已完成，需要把同一版前端和插件做成可核对的本地候选交付物。Android与前端config同步升为1.3.0-agent-gateway-preview/versionCode19，保留应用ID、签名、双更新源及配置/设备存储路径。通过既有具名APK构建脚本校验持久化更新源，包内JS/CSS与最终dist逐文件核对，与基线18比较签名/权限/组件并检查版本递增；只制作候选包与校验记录，不发布或安装，不代替真实覆盖升级和原会话联测。

修改限于两处版本常量及交付记录。沿用现有构建/更新入口，不新增原生能力或依赖；旧App、用户Agent配置、生产Relay与更新manifest保持当前状态，长期测试仍暂缓。兼容宿主与Android真实行为是剩余验收项。

打包检查发现既有热更新脚本仅内联dist主入口，新增懒加载Agent块仍以相对import引用，单HTML安装后无法打开Agent。修复范围增加热更新构建入口、应用侧Vite构建helper、合成构建回归和fixture单HTML模式：热更新单独使用inlineDynamicImports/cssCodeSplit=false构建到临时目录，再内联所有脚本/样式，拒绝残留chunk依赖；普通APK/Web构建继续懒加载。不增加运行时依赖，不改原生热更新存储/权限，也不发布旧原生版本不兼容的HTML。

## P3 Claude 原请求交互切片（2026-10-21）

在已有基础桥接上增加原进程的 `classic.PreToolUse` AskUserQuestion 和 `classic.PermissionRequest`。依据固定 Mods 声明及当日官方 hooks/user-input 文档，问答返回原 questions 与 answers 的 updatedInput，让原工具生成结果；不猜造工具输出。审批只返回一次 allow/deny，不修改输入、权限规则或模式，下游已有决定保持原样。未展示完整参数或未识别问题结构时保留宿主处理。

交互经独立、会话/代次绑定的本机 HTTP 长轮询取答案，等待停留在 `$.http.fetch` 内，不用自建 Promise 长时间占用 hook 预算。请求的随机 ID 与不可变描述绑定，手机仅回复已订阅且待答的原请求；提交先锁，取回确认不等于工具执行完成。取消、任务变化、失联、最后手机订阅离开和五分钟期限使旧卡片失效，迟到回复不能作用于新请求。没有手机时直接保留宿主流程，不能宣称所有桌面原生对话框均可同时操作；桌面/SDK先处理的取消行为仍需真实宿主核验。

修改仅涉及 Claude 协议/适配器/bridge、独立宿主模块、现有 Agent 卡片的名称与说明、合成测试及记录。保留全部原输入和保留字段，不开启全局权限、不启动/恢复模型、不改用户插件或生产配置。源码和合成通过后仍需兼容版本的原生 validator、原会话和 Android 验收。

## P3 Claude Mods 原会话接入（2026-10-21）

依据 anthropics/claude-code 的 bf2323b3021c9d3db7a31e1e7d61068c3f704497 中 mods/types/claude-code.d.ts（由2.1.277生成），接入宿主已加载插件的原进程。插件使用 hooks/hooks.json 的 modules 入口，所有网络和计时通过 $.http/$.clock；不使用Node、SDK resume或新模型进程。

基础切片最小交付为登记在线会话、按需最近文本、turn.step可见文本流、工作状态、$.prompt.submit排队输入和$.turn.abort({turnId})中断。prompt.submit只支持空闲后执行，不声明steer；基础切片最初不暴露问答/审批，后续已由上方原请求交互切片补齐。

Relay增加claudeProtocol/claudeAdapter和本机专用bridge路由；复用既有Agent会话API/SSE和手机工作区。bridge使用独立私有token、拒绝浏览器Origin、限制loopback，不复用手机管理员密钥。宿主登记绑定sessionId+activationId+服务端generation；45秒租期、单个20秒长轮询、操作取出即不重发，未知结果禁写。文本有界批处理，推理/工具参数不转发。手机订阅才取最近文本，无订阅不读取会话历史；退出、租期失效和网关关闭清理订阅与计时器。共享会话ID由各adapter校验，不放宽OpenCode边界。

修改范围是上述Relay模块、私有配置、独立Claude插件、手机Agent筛选/草稿键、构建脚本、合成测试及工程记录。保留生产两个App、签名、系统权限、用户Agent配置和APK；不安装、部署或发真实任务。旧版本与未加载插件的进程不自动接管。真实宿主的问答/审批/取消/两端先答继续待办，不以本切片完成整体兼容。

## 边界

现有 macOS 路由固定走 `DesktopControl` → `MacosUiInjector`。本轮保留该行为，新增现有服务只读接入层，先取得兼容性证据。`AppServerClient` 仍负责 Relay 自己拥有的 WebSocket app-server，不混用进程或会话所有权。

## 实现

- `codex/localAppServerClient.ts`：通过 `net.createConnection({path})` 和既有 ws 依赖，直接在 Unix socket 上执行 HTTP Upgrade / WebSocket JSON-RPC。只公开连接及加载会话摘要，不暴露通用写入 RPC。
- `agents/agentGateway.ts`：统一状态与适配接口，首个为 Codex 现有服务。区分未探测、探测中、已连接、失败；`sameDesktopThreadVerified=false`，所有写能力为 false。
- `server/createRelayServer.ts`：`GET /api/agents` 和管理员 `POST /api/agents/:id/probe`，复用既有鉴权与工厂注入。关闭服务释放 adapter。
- `smoke/agentGatewayProbe.ts`：显式人工只读探测，不放入默认测试，不输出 socket 路径、服务器原文、会话 ID、正文或凭证。

## 资源与失败

构造无子进程、无轮询、无连接。初始化和 probe 合并并发工作；握手和 RPC 各默认 8 秒截止、最多 16 个 pending；聚合消息上限 4 MiB，禁压缩，拒绝二进制/坏 UTF-8。成功后 15 秒 ping、下一周期无 pong 则失败；只在按需连接存续时有心跳，不自动重连。

关闭仅断开持有的 WebSocket，不 shutdown daemon、不杀进程。失败拒绝 pending 并清理计时器；旧初始化/连接不能污染下一代连接。服务器主动请求不自动回复，本阶段不拥有任何 turn。

## 传输修正与实证

最初误将 `app-server proxy --sock` 的字节转发视为 JSONL，合成子进程测试通过但真实握手超时。官方文档明确 Unix socket 使用 WebSocket，已删除该实现和错误 fixture，改用真实 HTTP/WS over UDS 隔离服务验证。

正式只读探测成功：`connected`、`loadedSessions={count:0,hasMore:false}`、`sameDesktopThreadVerified=false`。count 是最多 100 个的单页数量。没有读取正文或提交消息；该结果不能证明当前 Desktop 会话属于这个 daemon。

## 验证和回退

隔离测试不调用真实 CLI；HTTP 工厂注入合成适配器。人工摘要写在被忽略的 output。官方 app-server / WS 属于实验性，后续控制接入须单独验证兼容性。

当前运行输入未切换，两个 App 不重建、不改签名、不移除权限。基线发布及备份在本轮代码之前已完成；下一阶段源码保持未提交，不自动发版或部署。

## P1 手机提问应答实施边界

已只读验证当前 Desktop 的 `CODEX_HOME/ipc/ipc.sock`、owner discovery v1、following v1 和原会话 snapshot v11（仅保存字段结构，submittedMessages=0）。现有 control socket 的加载列表并非 Desktop 同会话证明。

最小缺口位于 Desktop IPC 状态投影和手机卡片：同步题来自 requests/item/tool/requestUserInput，异步题来自活动 turn 的 agentMessage.questions；分别使用 owner 定向 submit-user-input 和特殊 question reply 文本的 steer，禁止回退新 turn。canonical turnHistory 按 islands 顺序读取。

本阶段修改 DesktopIpcClient（新路径、断线通知、定向广播）、DesktopControl（选定会话引用订阅、owner/revision 校验、问题代次和提交确认）、desktopQuestions（统一边界解码）、鉴权路由、手机类型/卡片/状态，以及合成原生 IPC 与 UI fixture。题目和答案不进普通持久缓存；不复制宿主提取源码、不改 Mac App 签名、不部署、不提交真实测试任务。

题目 ID 是当前权威连接中生成的不可复用令牌。提交同步加锁；传输成功后等待权威快照确认，结果未知时锁定且不自动重放。桌面已答、任务结束、owner/IPC 失效或 patch 缺口使旧题失效；重连重新发现 owner 和获取完整快照。

## P1 普通原会话控制

差距在 DesktopControl 的旧 follower 参数和手机依据前台线程推断能力：新版 start 使用 v2 的 turnStart.request/context；steer v1 必须有 restoreMessage；interrupt v4 必须带 user-stop 与 expectedTurnId。先补齐异步问答缺失的 restoreMessage，再单独建立 desktopNativeControl 边界，复用 owner/revision 已核验的订阅和 HTTP SubmissionRegistry。

原生发送显式配置 MOBILE_CODEX_DESKTOP_TRANSPORT=native；macOS 默认保留现有 UI 输入。新通道失败不切换输入方式。snapshot.control 发布连接代次 token、当前 turnId 和发送/中断能力，HTTP 原生写必须携带该 token 和所见 turnId，校验后定向原 owner。按线程防并发；未知结果保留待确认操作，不能更换 ID 再发。确认必须是权威历史中的 clientUserMessageId/accepted steering 或指定 turn 的终态；IPC ACK 不等于完成。中断看到 completed 只能显示任务已结束，不能写成已打断。

修改边界：desktopNativeControl/desktopControl（原生命令与确认），config/server（选择通道、校验与幂等），mobile types/runtime/App（能力、请求守卫和确认提示），合成 IPC/HTTP 与手机状态测试。不给 P0 control socket 开启写能力；不建立替代会话、不改 Desktop 安装文件、不部署或提交真实任务。start/steer follower 没有宿主端原子的 turn 条件，连接代次和发送前校验只能缩小竞态，真实验收前不能宣称已完全接管。

## P1 Desktop 审批

基于已核对宿主的三种 v1 follower 方法，desktopApprovals 独立解码原会话活动任务中的命令、文件和权限请求。外部 ID 为随机令牌，内部绑定原 requestId、完整请求签名及 owner/epoch；文件预览变化也废止旧令牌。手机只能提交四种既有决定，授权对象由 Relay 从原请求构造，不能上传自定义权限。

仅复杂策略决定、未知权限或缺失操作明细时不生成普通允许按钮；显示需电脑处理的原因。展示命令、目录、文件路径/diff、授权范围及理由。同步预留后只发送一次；ACK 只表示 submitted，权威请求移除仅表示已处理或失效，不能证明本次决定已采纳。超时/断线为 uncertain，不自动重放。断线清除旧可操作令牌，重新订阅同一未确认请求仍锁定，最多保留128项未确认操作。

Mobile 复用审批卡片并区分 Desktop/Relay 路由，提交状态禁用按钮，断流清空 Desktop 卡片，重连等待权威状态；迟到 HTTP 不恢复已移除卡片或覆盖新快照。所有验证使用合成 socket、HTTP/SSE 和浏览器 fixture，不真实批准命令、不部署或发 APK。

## P2 插件与单实例网关实施边界

现有 Swift App 启动两个 Node 进程，安装/配对管理依赖 App 菜单。新增 gateway 配置、运行工厂和 CLI，复用 createRelayServer、DeviceRegistry 和 startTunnel；插件只提供技能入口，加载无副作用。管理命令为 init/start/status/stop/pair/devices/revoke。插件通过根 plugin.json 和 skills 发布，独立构建包包含 Node bundle，不依赖源码工作区或 node_modules。

单实例以固定 loopback Relay 端口绑定为唯一所有权：成功 listen 后才启动 Tunnel；并发启动至多一个隧道，旧 Relay/未知进程占用时明确报错，不停旧服务。status 只访问新增被动 /api/gateway，不触发会话读取、探测或模型。stop 需要管理员凭证、独立管理密钥和匹配的实例 ID，经 HTTP 关闭自己持有的服务/隧道，不按 PID 杀进程。进程退出后不自动重放写操作。

新配置单独保存，0600 原子创建，管理员/管理密钥随机生成。旧配置仅由显式 import 读取，保留旧 token、port、workspace（从参数明确传入）及设备文件位置；不读取或修改生产配置作为测试。managed 模式只支持 native，避免插件缺少 Swift helper 时隐式走 UI 输入；真实控制能力仍待验收。默认只监听127.0.0.1，远程经既有 Broker 主动隧道；公网地址只接受 TLS。

修改范围：gateway/ 的配置/CLI/运行工厂；createRelayServer 增加可选被动管理接口；Tunnel 暴露状态并允许关闭管理模式日志；plugins/mobile-codex 插件源码与独立构建脚本；手机配对说明和按需能力展示；隔离回归、文档/spec/task。保留旧入口与生产两个App，不安装插件到用户目录、不改权限/签名、不部署、不发APK、不真实控制或长期连接测试。

## P3 OpenCode 实施边界

缺口是其他 Agent 只有状态抽象，没有手机可用的会话操作。本轮在 agents/ 增加独立会话契约、OpenCode HTTP/SSE 客户端和适配器；Gateway 仅把配置明确启用的适配器注册进来。Relay 增加鉴权的 sessions/stream-token/events/发送/中断/问题/审批接口，手机增加独立 Agent 工作区入口，复用现有消息渲染、HTTP、订阅和 SSE 增量。Agent 与 session 共同决定路由，不能把 OpenCode ID 放进 Codex Desktop 控制路径。

主源固定为 OpenCode v1.19.3（e3c4eb242585dcd77be1a867391b7c25fd47ce52）的 packages/sdk/openapi.json。实现当前 /api/ v2 会话接口，拒绝不匹配的响应；不能依据旧版 prose 把 /session v1 和当前 GUI 的会话模型混用。连接由管理员在私有配置提供现有本机 server URL、目录和可选 Basic Auth；只访问该固定 loopback 服务、不启动 OpenCode、不创建或 fork 会话。默认无连接；用户进入 Agent 列表或显式 probe 后才读，只有手机订阅时保持一个共享上游 SSE。

每个已订阅会话绑定已验证 location、连接代次和控制令牌；断线/取消废止题目、审批及写能力，重新订阅先全量核验。prompt 使用调用方 UUID 派生 msg_ ID，明确 steer/queue；HTTP 接受不等于任务完成。问答/审批以原 request 签名和随机外部令牌绑定，提交前重新核对；未知结果锁定、不自动重放。权限展示 action/resources/save 和 metadata，允许一次与保存规则分别表示。中断接口不含 expectedTurnId，不能宣称有宿主原子的任务绑定。

所有验证用随机端口合成 OpenCode HTTP/SSE、临时配置和手机 fixture，不读真实 Agent 会话、不启动模型或自动审批。不安装/部署、不改生产 APK 或 Mac 权限；Claude Code 接入边界及统一真实验收另行推进。修改 config/gateway、agents、Relay 路由、独立手机工作区与入口、隔离测试、任务/spec/docs；不重构既有 Codex App 编排。
## 手机409修复边界（2026-10-21）

手机明确反馈更新/公网连接/120线程成功，发送409；历史响应错误码未留存，实际界面版本尚未核对。只读原生快照含有效控制令牌，优先检查旧界面不匹配与首次快照未就绪，不能直接宣称根因已定。

修改限手机发送能力/guard编排、HTTP错误解码、合成fixture与回归。启动时一次读取服务状态以区分native/legacy，未知方式等待；native必须收到所选会话实时能力才能发送。已知409保留稳定错误码与中文说明；仅执行前明确拒绝可清匹配待发标识，已有回执/未知结果不自动重发。保留失败草稿和发送期间新输入，目标切换后不发往其他会话。APK20独立预览发布并核对；服务固定版本不变，用户手机复测前不标记真实发送通过。


## 2026-10-21 DeepSeek 手机提问与审批

缺口在原进程bridge和Relay适配器：手机已有通用卡片，但DeepSeek快照一直返回空数组，响应方法固定拒绝。新增独立interactions模块，固定0.2.1-rc.2的原Typert Gateway pending请求作为唯一待答来源，不注册新的terminal answerer；同步核验pending对象、原live Agent、完整内容签名和订阅令牌后结算同一个waterfall。桌面先答/原signal取消以pending权威移除为准，手机轮询仅在有订阅时运行，不持有原请求或阻止桌面。

审批需原callId对应的完整tool/call参数，拿不到或超过展示上限时保留拒绝、禁用允许；只映射allowed-once/rejected，永不保存长期规则。提问按原question.id构造selected/custom，单选自填覆盖选项；plan-review保留detail全文。沿用现有问题字符串承载完整题干与detail以兼容APK21，手机补充文案，避免仅更新服务后旧包漏掉计划详情。continued问题只允许原live root的官方answer，不恢复冷会话。提交保护按原请求对象和签名保持，未知不自动重发且不被普通消息队列的待确认锁阻挡。

预计修改plugins/mobile-deepseek的interaction helper/bridge/index/package、relay的deepSeekProtocol/Adapter、手机AgentWorkspace文案及合成测试/fixture；不修改其他Agent协议，不新增长期授权或宿主权限设置。先隔离验证，实际加载保持原任务，真实答案由用户在手机决定。


## 2026-10-22 App 内 APK 更新设计与自审

缺口归属 Android 原生安装能力与手机更新编排。新增 ApkUpdatePlugin 及纯 Java 有界下载校验器，通过 Capacitor getStatus / downloadAndInstall / install 与 progress 事件提供带 revision 的状态。APK 位于 cache/apk-updates；验证后的描述保存到专用偏好，重启只恢复继续安装，不自动下载或弹系统界面。下载完成后通过现有 FileProvider 交付 content URI；API26+ 检查 canRequestPackageInstalls，显式打开本 App 的未知来源设置，返回获批后继续；安装器返回未升级时保留重试入口。每次继续安装重新校验文件/版本/签名。

前端 features/updates 持有清单解码、原生状态订阅和下载展示，App 仅串联现有设置/热更新入口。先订阅后取状态，以 revision 丢弃迟到结果，防止跨工作区卸载后写状态。无原生能力的浏览器/旧包保留明确下载引导，不伪装 App 内安装。新预览 APK24 构建时使用 preview 清单；不修改正式 latest 或热更新清单。

预计改动：Android 新插件/下载器、MainActivity注册/manifest安装权限、前端updates模块及App/types/config、build.gradle版本、针对性隔离回归与更新/验收文档。复用已有 FileProvider、HTTP和样式，不更改网关、Agent协议或系统权限，不引入后台常驻服务。自审：权限拒绝不循环弹窗、安装取消不误报成功、进程退出只清理本插件的半包、缓存复用前重验、APK/热更新交叉禁用；源码构建/浏览器检查与真机验收分开。
