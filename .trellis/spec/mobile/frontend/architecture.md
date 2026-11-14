# 前端模块与状态

- `src/main.tsx`：仅挂载 React 与引入全局样式。
- `src/app/`：App 编排、运行参数和类型。
- `src/features/chat/`：消息组件、附件、工具输出、消息合并及线程运行态缓存。
- `features/chat/messageDiagnostics`仅在手动导出时比较runtime、实际渲染数组、原缓存和DOM身份；不经过缓存迁移、不改变合并结果。正文/不透明身份只输出SHA256；`diagnosticExport`白名单投影版本及有界连接事件，不导出地址、草稿或控制信息。默认摘要≤2048 UTF-8字节，详细文件≤65536字节；Android分别依赖注册的ClipboardPlugin与DiagnosticExportPlugin。完整签名、错误与验收见[短诊断契约](diagnostics-contract.md)。
- `src/features/connection/`：HTTP 请求、连接档案与诊断；保留 CapacitorHttp 原生请求路径。
- `src/features/threads/`：线程与项目分组的展示模型。
- `src/features/updates/`：APK清单校验、原生下载/安装状态和热更新插件适配；原生契约见[APK更新](apk-update-contract.md)。
- `src/features/agents/`：懒加载的其他Agent会话工作区，复用HTTP/订阅/消息渲染；Agent与session共同路由，不能把其ID放进Codex控制路径。
- Agent问答可带unavailableReason；暂未适配的复杂表单保留可见说明并锁定提交，不触发认证外链或用部分字段代答。
- `src/shared/`：少量跨功能的格式、剪贴板与偏好工具。
- `src/features/voice/`：共享录音/配置/预览，按连接及会话key挂载；采用只追加到捕获时未变化的草稿，录音阶段切会话取消；已上传请求切会话脱离等待，由应用级语音恢复协调器凭最小localStorage元数据GET查询并按原会话/草稿摘要恢复，禁止重传与跨会话覆盖。原文编辑废止旧整理稿，Key不缓存。原生录音须APK26，旧包/浏览器显示兼容提示。

组件可使用纯展示模型；HTTP 不依赖 React 组件。继续使用本地 React hooks，不为拆文件引入状态库。

执行过程展示共用`MessageTimeline`和纯函数`groupMessageProcesses(messages: CodexMessage[]): MessageGroup[]`。逻辑分组保留assistant/commentary和已知工具kind，messagesForRender必须保留这些记录；展示时commentary说明始终按原顺序直接渲染，只有连续工具调用进入ToolProcess动态摘要。默认收起命令/输出，点击一次直接查看原详情，工具偏好只隐藏工具区。明确final_answer到达只收起工具区；说明、最终/未知阶段正文、用户和交互卡片独立可见。已知同turn可跨引导输入匹配，缺turn以用户输入为边界，不合并不同已知turn。工具展开状态按稳定首工具ID绑定，终稿阶段默认收起一次，后续增量保持手动选择；不按空闲状态猜测完成。Codex保留原phase/turnId；DeepSeek提升最终阶段的契约沿Relay定义。只投影显示，不改控制、缓存或原消息。

## 已实施的状态契约

`features/chat/runtimeSync.ts`的`createRuntimeSync({getRuntime,getSignal,updateRuntime,read})`统一提供applyLiveTurnSnapshot、applyDesktopStreamSnapshot、applyDesktopDelta、watchDesktopDelta、pollLiveTurn。App在调用时读取ref并注入带endpoint/token的HTTP读函数，继续拥有effect/订阅生命周期。工厂不依赖React，不捕获创建时的runtime或signal副本；时效检查须同时保留在回包处和React updater内部。直接导入生产工厂测试状态/轮询，实际App effect及浏览器另验接线，不能复制一份状态算法到测试中。

2026-10-29同步保护：Codex两类fallback poll各持有独立AbortController，绑定Workspace取消并在effect清理/SSE online时立即失效。`features/chat/sync.ts`捕获内存syncRevision、turn、cursor/generation等同步字段；成功及错误在回调与React updater内校验，普通草稿编辑不废弃读取。SSE用订阅signal/turn保护，不使用旧render的同步版本逐条过滤，避免同批事件被误丢。完成反馈由已提交到React的运行态触发，不能由待校验回包先报完成。同generation普通delta游标不后退；显式reset允许文件轮换或同文件截断。syncRevision不持久化。

2026-10-29缓存保护：Codex输入保存至`mobileCodexThreadInputCacheV1:${scope}`，包含普通草稿、pendingMessageId/Text及本地未确认消息，不随正文LRU淘汰；关键输入JSON按UTF-16计最多1MiB，超限明确返回input-failed，不截断。正文沿用V2键与messageIdentityVersion=3，最多24线程×120消息、总JSON最多2MiB，优先最近访问，配额不足可只清理本scope正文。先写输入，成功后才替换正文；迁移重试先压缩旧正文，保留唯一的旧输入副本。新输入键存在时（包括空对象）是权威，不能从失败残留的旧正文恢复已清空输入。700ms/隐藏/pagehide/卸载flush保持；App单独展示保存失败与重试，普通进度不可覆盖。题目答案、审批/控制能力与令牌不新增持久化。

U2将所有电脑通道的当前状态/普通发送反馈收进输入框上方唯一的`.composer-status-bar`，停止按钮同属该栏，空草稿和有内容均只显示一个；有文本或附件才显示紧凑的引导/排队直接发送。`hasMessageContent`只表示内容是否存在，能力/提交锁仍使用原`canSubmitMessage`/`canSend`/`canInterrupt`，不能借布局重算控制权限或静默切mode。待发由原生details默认收起并按线程key隔离，数量与uncertain/paused/sending/waiting优先摘要在收起时仍可见；明细与取消仍来自原权威队列。待确认/网络/错误不因紧凑布局被隐藏，旧网关禁用queue时仍显示兼容说明。

- Workspace key 由 profile ID、cacheNamespace 与规范化 Endpoint 组成。保存/切换档案才替换连接；卸载时取消请求、订阅和计时器。原生 HTTP 无法物理取消时，丢弃旧作用域结果。
- 基线读取结束后才建立订阅；seq/baseSeq 不连续时重建基线。正常 SSE 暂停业务轮询，降级/健康检查 single-flight；后台暂停，回前台重新检查。
- 桌面基线和 delta 均应用 turnStatus/activity；activity 增量不单独改写生命周期。显式完成/打断/失败必须停止工作提示，即使没有助手正文；空消息页也能显示运行状态。不把已有打字动画当作真实 token 流。
- `features/threads/cache.ts` 保存最多 120 条无凭证线程元数据，优先保留选中项；与按线程消息/草稿缓存一起同步恢复首屏，再后台刷新。缓存写入合并 700 ms，pagehide/隐藏/切作用域时 flush；不能为普通消息缓存丢弃草稿与未确认发送。
- 历史页只改变 historyBefore，不推进尾部 cursor。generation 变化才重置基线；浏览历史时保留滚动位置，切回线程不自动退出历史模式。
- Android 启动先完成 Keystore 凭证解锁/迁移，再挂载工作区；成功写入密文后才删除明文。失败保留原数据并显式报错，浏览器路径仍为 localStorage。
- 切换Agent卸载原工作区、释放请求/订阅。只缓存按连接作用域隔离的有界普通草稿；题目、答案、审批及控制令牌不缓存。SSE与HTTP确认只清理匹配的已提交草稿，保留发送期间的新输入；迟到回包不得复活卡片或覆盖权威状态。
- Agent会话键按各自格式保留（OpenCode的ses、Claude的UUID、DeepSeek原进程生命周期内UUID别名），不能放宽为任意Agent/路径。DeepSeek默认queue，只在原活动任务有能力时追加/中断；原生提问和审批复用通用卡片，由当前原请求声明可操作性。完整计划沿用question字段；缺少完整工具输入仅拒绝，支持允许一次、不保存长期规则。partial说明不承诺完整历史。operationError按clientMessageId绑定，权威拒绝/过期优先于迟到HTTP。
- Desktop用户消息优先按clientMessageId合并本地占位与权威消息，兼容desktop-local-ID旧缓存。HTTP回包复用同一合并入口，不能直接append；两次不同提交ID的同文/同时间消息必须保留。合并相同正文时也保留新来的关联ID及附件，不能因优选旧对象而丢失关联。

Codex与DeepSeek列表均默认近30×24小时，range=all按需查看更早；仅列表前台每30秒/回前台刷新摘要，不轮询全部正文。Codex静默刷新不读live turn快照/桌面正文，不自动切换所选项；保留分页位置，当前选中、运行/未确认及卡片项不因日期丢失，已读缓存本身不构成保留条件。显式列表请求取消前一请求，原生HTTP不能物理取消时仍丢弃迟到结果。

两Agent共用features/threads的ProjectGroups，cwd/directory完整规范路径作key，末级文件夹作展示名；同名目录显示路径，空目录归未分类。默认展开；折叠偏好以连接scope+agentId隔离，最多256个true标记，不存正文、控制令牌或权限。刷新/分页保持偏好，搜索临时展开，清搜索恢复偏好。折叠组不构造或挂载会话行；不激活Agent或改变原控制路由。

DeepSeek历史以Codex相同240条渲染窗口向前移动，持续分页不因窗口已满停止，返回最新使用当前权威snapshot；读历史时新流/卡片不抢滚动位置。旧Agent的历史边界保持。

Codex助手消息的sourceItemId跨rollout response_item与Desktop agentMessage保留，phase保留commentary/final_answer。按原始ID合并实时/历史/缓存，不能依赖turn开始时间与落盘时间的接近；两条不同原始ID的同文同时间助手回复须保留。旧native缓存可从desktop-UUID-item恢复ID；普通相同ID合并须补齐身份/phase。稳定log-offset ID仍用于历史游标，不改为原始ID。首次载入旧缓存时只重拉服务端投影，保留草稿、待确认标识/正文和本地输入，不改配对/凭证；当前新缓存messageIdentityVersion=3，旧版0/1/2重拉后恢复正常离线缓存。

Codex用户历史也保留sourceItemId与原metadata.turn_id；Desktop用户投影带turnId及clientUserMessageId/clientId。两来源原始消息ID不一定相同，先以明确提交/原始身份合并，再按同一turnId及完整正文（只trim边缘，不折叠内部空白）的一一对应关联未绑定native/rollout；来源组数量不等或缺少归属时保守保留。多个实际同文输入保留次数，不跨turn匹配。合并采用历史时间并保存提交ID、原始ID、turnId与附件，重放/迟到HTTP不得复活另一副本；不同原始ID同文同时间不得用纯文本去重。已关联的历史用户记录同样可作为权威收到证据，本地占位不能。

语音设置允许填写DeepSeek HTTPS Base URL和供应商模型ID，保存后清空Key框，地址变化不得隐式复用原Key；旧网关缺少地址字段时提示更新网关。百炼继续使用地域选择。

APK28语音入口为composer/agent-input内发送旁的44px独立按钮；仅打开时portal挂载遮罩。U10将latest-pill放在composer-panel正常文档流中独立占位，右对齐并沿用U0卡片底色/阴影，不能绝对定位覆盖正文或其他输入控件。输入增高、通知、附件和待发列表都不能改变按钮各自的点击归属。

Codex原生运行中“引导发送/排队发送”直接提交当前草稿，不再是方式选择器；箭头与快捷键默认queue。模式和guard在点击时捕获，不能因异步状态变化静默换动作。队列能力缺失时禁用排队及默认箭头，显式steer仍可用。native草稿/附件在HTTP提交前保留，只有匹配的权威接收或入队确认才按完整正文比较后清空；提交期间的新编辑必须保留。ACK/未知保持输入并锁定重复提交，不投影为已接收气泡。HTTP/SSE共用确认合并，迟到回执不能清除另一提交的标识，迟到HTTP错误不能推翻已入队/执行证据。瞬态desktopSendFeedback仅在当前工作区显示，不写缓存。queue-message仅表示网关保存，不插入已执行气泡；待发仅从control.queue渲染，可展开全文，waiting/paused可取消、sending/uncertain不可假撤回。已入队内容不会随新草稿的发送动作转换。队列能力与正文不写手机持久控制缓存；有待发的旧会话保留在近期列表。

语音APK29增加独立百炼Base URL及两种ASR模型选择；修改有效目标须对应Key，默认地域变化同步默认地址，显式业务空间地址保留。decoder缺qwenBaseUrl提示更新网关；保存/关闭清Key，不缓存；阶段错误来自固定映射，整理失败原文仍可采用。原生录音从M4A改为AAC_ADTS，旧M4A不能冒充AAC。


APK31消息合并在手机内部保留`nativeMessageId`（原native消息完整ID），与历史`sourceItemId`分开；选择历史时间/ID后仍保存原生别名，用于重放及缓存恢复。未绑定native缺少clientMessageId也可参与原有同turn、完整正文、等数量的一一配对，缺页数量不等继续保守保留；已带nativeMessageId的历史项不得再次参与未绑定配对，防止吃掉新的真实同文输入。HTTP/SSE/渲染仍经同一合并入口，原生别名不是服务端接收证据，不改变发送或控制权限。

APK33补齐HTTP确认/历史/早期native三路时序：历史上的clientMessageId可能仅来自本地确认占位，不表示它已绑定native。未带nativeMessageId的历史仍参与同turn、完整正文、等数量配对；对应项明确client身份冲突则整组保守保留。版本3缓存及messagesForRender使用同一修复入口，不能靠更换缓存版本或清空草稿掩盖顺序缺陷。

APK35的原始输入按明确`replacesMessageId=turnId-input`继承显示身份。snapshot的`inputReplacements`独立于最近120条正文，最多240条，仅带turn/临时/native/client身份；App合并旧runtime时同步迁移临时项和历史native别名，不能只依赖snapshot reducer的removedIds。索引与已知正式正文/client冲突、多个successor争同一predecessor时保守保留；正文完整trim比较，不把同文accepted steering作为初始输入。关系保存到版本3缓存并在加载/保存/渲染共用归一化，保留草稿/待确认/历史游标。Timeline按初始输入链保持key，冲突项回退真实ID。缺权威关系的旧记录不猜测删除，不用全量snapshot覆盖分页。

输入身份还须覆盖Desktop尚无turnId时的`turn-N-input`。同client合并正式消息后，明确`replacesMessageId`及匹配的`nativeMessageId`必须同步提升临时id/turnId，否则native别名虽正确，仍无法和真实turn的history配对。只提升id恰为`turn-N-input`的原始userMessage，不按正文或时间改写任意真实轮次；缓存加载/保存、直接渲染和合并结果使用同一规则。2026-10-30手机报告的两组身份/时间已逐字段复现；回归需包含indexed turn→正式项→history、迟到indexed快照、已污染版本3缓存、草稿/待确认及真实同文第二次输入。

## 普通提示词显示边界（2026-10-29）

普通user正文不能因为`You are `、`Knowledge cutoff:`等自然语言开头被隐藏。role/item type已有系统/工具来源则按原语义处理；旧user缺来源时只沿用专用上下文包络前缀兼容规则（含问答reply），不凭语言猜来源，不虚构metadata。引用/代码块中的标记仍可见；直接以保留包络开头的正文仍受兼容过滤。保持消息身份、合并器、cache schema与问答答案不落缓存。Relay历史/native/app-server和手机使用相同合成矩阵验证。

## 所有电脑 Agent 共享体验（code9）

Codex 与 AgentWorkspace 共用 ComputerComposer、uploadAttachments、MessageTimeline/ToolMessageBubble 和 MessageMediaProvider；新通道只接线原生控制与标准 AgentMessage，不能复制第二套聊天、附件或图片组件。工具 kind 为 function_call/function_call_output、role=tool；说明用 commentary、明确成功终稿用 final_answer。相同 timestamp 保留原消息顺序。工具输出允许 Codex Output: 包络或其他 Agent 的纯文本；已知 Tool/Command/Workdir/Status 元数据自身不算正文，不能把非空纯文本误判为空。

网关声明 sessionApi:1 表示已显式注册 SessionAdapter；手机兼容原三种传输旧网关，新通道必须声明该能力。通用 Agent/session 草稿键仍限制字符和长度，已知通道继续用原 ID 格式；禁止将 Codex 放入 Agent 路由。所有列表复用 ProjectGroups。

Agent 附件沿原 /api/uploads，元数据序列化到原有有界草稿字符串的完整「已上传附件」尾段（文件名 | 绝对路径）；解析只接受完整绝对路径列表，不剥离普通示例。连接/Agent/session 隔离，确认只清匹配草稿，发送期间新编辑保留，未知结果不重发。上传中、关键存储失败阻止产品导航/返回；卸载取消请求并回收预览 URL，不把 blob URL 写进持久化。SSE 不应覆盖本地上传或存储错误。

MessageMediaProvider 目标为 threadId 或 agentId+sessionId 的互斥联合，所有通道共用鉴权取图、错误映射、重试、大图及原尺寸；目标/凭证改变中止旧请求并清旧图。未来适配器仍须保证已订阅原会话的权威绝对 directory，手机不能上传根目录。

U10：消息中的本地Markdown文件链接显示为不可导航的文件名标签，完整目的路径放title；只HTTP(S)链接可作外链，代码块/行内代码保持原文。路径展示统一正斜杠，不改变原始路径或项目持久化身份。抽屉侧栏和遮罩同读sidebarOpen，无选中项仅用于初始化；关闭后不隐式重开，分屏切换仍关闭抽屉。遮罩浅深色复用--scrim。设置details保留原生展开/键盘操作，summary使用共享Lucide箭头并隐藏原生marker。

U12：消息Markdown支持GFM表格（必须有含竖线的分隔行且列数一致；对齐用align-center/align-right类，不用内联style；`\|`为字面竖线；行内Markdown照常；超过24列截断；多余单元格丢弃、缺的补空）、引用（最多三层，更深按段落）、分隔线、####以下小标题（h4）、`*斜体*`与`~~删除线~~`（定界符须贴字，`2 * 3 * 4`保持原文）。列表按缩进嵌套（比父项多≥2列，最多四层），空行后接列表项仍是同一列表，有序列表用start保留起始编号，换符号或分隔符另起列表；列表内缩进代码块结束列表后单独显示。表格放.table-scroll横向滚动：table宽为max-content且不小于容器，单元格88–240px。Kelivo宿主里用户消息与助手正文同字号（15×remote-chat-scale），助手正文不留头像缩进，头像与名字同一行。

U11：线程行由ThreadRow展示标题/时间，项目路径只留分组标题（同名项目仍有消歧路径）。全部筛选隐藏常规桌面来源，手机/CLI/Exec/未知保留小标签；desktop隐藏桌面，relay隐藏appServer，其他来源显式保留。all/desktop/relay过滤语义不变，不将CLI伪称手机。当前桌面的唯一标记保留。连接检测只留设置的手动连接区；更早会话保留原range行为和44px命中区域，使用文字链接外观。

U1：MessageTimeline 只在展示层标记同 turnId 的非工具助手消息，工具过程卡片不打断该组，用户消息或换 turnId 时重新分组；缺 turnId 的消息仅按相邻助手正文分组。组首显示 Agent 图标/名字，正文和 data-message-id/role 仍逐条保留。用户正文用 --accent-soft（宿主 primaryContainer），助手无气泡。消息可聚焦；点击/聚焦才挂载时间与复制，焦点移入复制按钮不关闭。长按触摸/笔 550ms 复制，移动超过10px、取消、移出、放开、失焦或卸载取消计时；链接/按钮等交互子元素与已有选区不触发整条复制；从 pre、code、.code-block、table 及其子元素开始的长按不启动整条复制计时，这些区域的 contextmenu 不 preventDefault，保留原生文本选择。剪贴板结果必须 await，失败不能报成功，卸载后的结果不更新提示。系统提示使用图标细横幅；工具卡与代码块继续单独分隔。

U2：SessionStatus 的 composer 变体与 ComposerSessionStatus 统一接收 S2 推断结果，不从 running 自行猜测思考/执行。消息流和顶栏不再重复本轮执行/终态标签，工具过程摘要保留。状态栏保留有效 lastTurn 的原因、结束时间及 observed 标记；新轮运行时显示上轮结果，同 turn 的终态只展示一次。思考/执行点用 --signal 呼吸，prefers-reduced-motion 时禁用；失败用 --danger。停止和发送沿原能力门控，键盘快捷键、默认排队与草稿保护不变。
