# 前端模块与状态

- `src/main.tsx`：仅挂载 React 与引入全局样式。
- `src/app/`：App 编排、运行参数和类型。
- `src/features/chat/`：消息组件、附件、工具输出、消息合并及线程运行态缓存。
- `src/features/connection/`：HTTP 请求、连接档案与诊断；保留 CapacitorHttp 原生请求路径。
- `src/features/threads/`：线程与项目分组的展示模型。
- `src/features/updates/`：APK清单校验、原生下载/安装状态和热更新插件适配；原生契约见[APK更新](apk-update-contract.md)。
- `src/features/agents/`：懒加载的其他Agent会话工作区，复用HTTP/订阅/消息渲染；Agent与session共同路由，不能把其ID放进Codex控制路径。
- Agent问答可带unavailableReason；暂未适配的复杂表单保留可见说明并锁定提交，不触发认证外链或用部分字段代答。
- `src/shared/`：少量跨功能的格式、剪贴板与偏好工具。
- `src/features/voice/`：共享录音/配置/预览，按连接及会话key挂载；采用只追加到捕获时未变化的草稿，切会话取消并丢弃迟到结果。原文编辑废止旧整理稿，Key不缓存。原生录音须APK26，旧包/浏览器显示兼容提示。

组件可使用纯展示模型；HTTP 不依赖 React 组件。继续使用本地 React hooks，不为拆文件引入状态库。

执行过程展示共用`MessageTimeline`和纯函数`groupMessageProcesses(messages: CodexMessage[]): MessageGroup[]`。`isProcessMessage`仅接受assistant/commentary或已知工具kind（plan、commandExecution、fileChange、function_call、function_call_output、custom_tool_call、custom_tool_call_output、mcpToolCall、webSearch、task_started）；`messagesForRender`必须保留这些工具，否则折叠区展开也无法查看。同段后续明确final_answer到达才默认折叠；已知同turn可跨引导输入匹配，缺turn则以用户输入为边界，不把不同已知turn合成一组。最终/未知阶段正文、用户和交互卡片独立可见，不按空闲状态或最后一条正文猜测完成。折叠状态只在组件内按稳定首消息ID绑定，进入终稿阶段自动收起一次，后续增量保持手动选择；重开默认按阶段展示。Codex保留原phase及真实turnId；DeepSeek插件0.2.1在原生成功turn结束时提升末步为final_answer，实时/历史同源，协议缺字段时保留原文，不由手机猜测。只投影显示，不改控制/原消息；协议边界见Relay的deepseek-contract。

## 已实施的状态契约

APK32将Codex运行状态/普通发送反馈收进`.composer-toolbar`，空草稿仅显示主停止按钮；有文本或附件才显示紧凑的引导/排队直接发送及独立停止。`hasMessageContent`只表示内容是否存在，能力/提交锁仍使用原`canSubmitMessage`/`canSend`/`canInterrupt`，不能借布局重算控制权限或静默切mode。待发由原生details默认收起并按线程key隔离，数量与uncertain/paused/sending/waiting优先摘要在收起时仍可见；明细与取消仍来自原权威队列。待确认/网络/错误不因紧凑布局被隐藏，旧网关禁用queue时仍显示兼容说明。

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

APK28语音入口为composer/agent-input内发送旁的44px独立按钮；仅打开时portal挂载遮罩。latest-pill位于relative的composer-panel上方，按footer实际高度定位，不能使用固定bottom或覆盖其他输入控件。输入增高、通知、附件和待发列表都不能改变按钮各自的点击归属。

Codex原生运行中“引导发送/排队发送”直接提交当前草稿，不再是方式选择器；箭头与快捷键默认queue。模式和guard在点击时捕获，不能因异步状态变化静默换动作。队列能力缺失时禁用排队及默认箭头，显式steer仍可用。native草稿/附件在HTTP提交前保留，只有匹配的权威接收或入队确认才按完整正文比较后清空；提交期间的新编辑必须保留。ACK/未知保持输入并锁定重复提交，不投影为已接收气泡。HTTP/SSE共用确认合并，迟到回执不能清除另一提交的标识，迟到HTTP错误不能推翻已入队/执行证据。瞬态desktopSendFeedback仅在当前工作区显示，不写缓存。queue-message仅表示网关保存，不插入已执行气泡；待发仅从control.queue渲染，可展开全文，waiting/paused可取消、sending/uncertain不可假撤回。已入队内容不会随新草稿的发送动作转换。队列能力与正文不写手机持久控制缓存；有待发的旧会话保留在近期列表。

语音APK29增加独立百炼Base URL及两种ASR模型选择；修改有效目标须对应Key，默认地域变化同步默认地址，显式业务空间地址保留。decoder缺qwenBaseUrl提示更新网关；保存/关闭清Key，不缓存；阶段错误来自固定映射，整理失败原文仍可采用。原生录音从M4A改为AAC_ADTS，旧M4A不能冒充AAC。


APK31消息合并在手机内部保留`nativeMessageId`（原native消息完整ID），与历史`sourceItemId`分开；选择历史时间/ID后仍保存原生别名，用于重放及缓存恢复。未绑定native缺少clientMessageId也可参与原有同turn、完整正文、等数量的一一配对，缺页数量不等继续保守保留；已带nativeMessageId的历史项不得再次参与未绑定配对，防止吃掉新的真实同文输入。HTTP/SSE/渲染仍经同一合并入口，原生别名不是服务端接收证据，不改变发送或控制权限。
