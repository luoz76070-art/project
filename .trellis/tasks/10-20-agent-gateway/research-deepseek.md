# DeepSeek 官方 Harness 接入核验（2026-10-21）

主源：`deepseek-ai/deepseek-harness`，固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317`（2026-10-17），版本 `0.2.1-rc.2`。参考副本位于被忽略的 `output/research/2026-10-21/deepseek-harness/`，只下载源码，未安装或执行宿主；本机未发现 `dsh`。

- `docs/user/develop/basic/publish.md`：Cordis bundle、patch、peer依赖和 `engines.dsh`；安装及profile启动均执行版本门。
- `docs/user/develop/framework/{service,index}.md`：`inject=['agents','sessionQuery']`，`ctx.effect`返回异步清理函数。
- `packages/core/agent/src/{index,runtime-types}.ts`：只用 `agents.list/get`，操作原live handle；`followup/steer/cancel`同步，取消保留inbox，`whenIdle`不是特定消息确认。
- `packages/core/session/src/types.ts`：`SessionId`为任意branded字符串，并非固定UUID；外部采用插件生命周期内随机UUID别名，防止路径/跨Agent误路由。session/event含seq/time；只投影真实user source和assistant text。
- `packages/llm/llm/src/{message,types}.ts`：通过官方 `createUserMessage`生成冻结身份；仅text块可见，reasoning/tool参数不转发。
- `packages/core/agent/src/runtime-types.ts`：assistant-stream有attempt/revision/index；start/chunk/end，chunk只收text-delta/block-end的text，durable assistant/message替代临时文本。
- `packages/session-query/session-query/src/observation.ts`：observeSession的header/cursor不复制全文，events首次访问会复制整个log。只在首个订阅读取一次，cursor>=4096时不materialize，明确partialText；不逐token读历史，不使用deprecated snapshotEvents/eventAt。
- 普通session-controller可以resume冷会话，SDK/ACP启动独立runtime，不用于原宿主接管。

实现：原进程Cordis插件提供有独立密钥的127.0.0.1 HTTP/SSE；Relay主动按需连接，单会话共享流，最后订阅离开即关闭。私有文件0600，精确cwd范围，禁止浏览器Origin、重定向和自动重试。插件只暴露在线root Agent，不能create/resume。控制令牌绑定live实例/turn边界，先同步锁再调用；未知不重放，权威user/message确认输入。最多128个别名、32个订阅项、120条/256KiB文本、200ms合并与慢消费者断流。未确认记录在原插件生命周期内保留，进程重启不承诺exactly-once。

初期不支持历史分页/附件/原请求问答/审批；手机明确显示最近文本不完整，审批能力false。源码与合成宿主通过不代表真实dsh加载或原会话控制已验收。

## 2026-10-21 原生问答/审批补充

本机实际桌面仍标0.2.1-rc.2，但构建提交为332895e0f7c9d4dbfb29729f5eb367fa263ff986，与最初研究的源码提交不同；以下以安装包只读源码为准。dsh-api-gateway/lib/index.js的TypertGatewayService包含pendingRemoteEvents、settleRemoteEvent和finishRemoteEvent（758、1062、1115–1154行）。前者Map保留原source.request.agent/signal及原resolve，后者完整结算会清理signal/Context/桌面投递并发cancel。必须先同步核验Map对象身份，不能只resolve或只finish；桌面先答、signal取消、Agent释放会移除条目。Map没有变更订阅，仅在有手机订阅时250ms有界轮询。新增helper固定settle/finish去空白源码SHA，契约未知时不显示可操作waterfall，也不声明审批能力。

审批服务approval.request负责新请求和approval/asked/decided审计，不能用来回答旧请求。手机只向原pending返回allowed-once或rejected；完成交接不代表工具执行成功。原请求不含完整参数；从tool/call的callId/name/arguments（JSON字符串）及tool/ptc-dispatch-start的subCallId/name/arguments（JSON值）建立当前turn/step的有界索引，重复或歧义/非法JSON/超限/缺失禁用允许。索引仅首订阅的小log及增量构建，不复制大日志，不将正文中的任意命令视为审批输入。完整工具输入与最终进程cwd/环境不是同一保证，后者可能在审批后才计算。

正在等待的user-questions/request以原Map结算{answers:[{id,selected:[原label],custom?}]}，plan-review的detail和intent需保留且approve必须是原选项。为兼容已安装APK21，detail全文追加在现有question字段中，不引入旧包会忽略的新字段。continued问题取ctx.userQuestions.continued(agent)，用原service.answer(agent,callId,batch)；true仅表示结构化reply已排队，直到原user/message/source.kind=user-question-reply才权威关闭。continued可跨turn，必须原live root，不调用可能resume冷会话的Remote会话控制器。桌面已排队reply同样锁定。

标准子Agent默认approval policy never，userQuestions拒绝owned child。当前只处理选定原root的请求，不将自定义子Agent请求默认为root授权；未来需要独立requestOwner/displayRoot映射。新插件不注册terminal answerer或改变policy，桌面可照常响应，卸载只关闭本插件订阅。网络未知锁在bridge原对象WeakMap及Relay有界记录中跨重连保留，不保存答案，不自动重放。

实际加载补充：Cordis ctx.get返回的traceable服务Proxy每次身份不同、函数toString为包装代码，方法指纹必须沿原型descriptor取原函数，缓存与宿主相等按原pending Map；官方隔离检查已使用真实tracker/provide/get服务路径。仅普通对象fixture会漏掉此兼容问题。

官方`dsh-user-approval/lib/types/types.d.ts`的ApprovalRequestEvent.displayReason为`{readonly en:string; readonly [locale:string]:string}`；`dsh-client-ui-approval/lib/client.js`通过`ctx.locale.resolveText`显示，并非字符串。手机保留全部语言的有界JSON及原reason，不丢约束；畸形/超限禁用允许。真实卡曾因此仅剩reject，修复及40项/官方8项后，公网当前卡完整输入702字符、once/reject恢复，未执行真实决定。实际加载、首次网关排空失败及恢复详见`docs/audits/2026-10-21/deepseek-interactions.md`。

## 2026-10-22 全部线程/历史与近期列表补充

实装0.2.1-rc.2构建332895e0f7c9d4dbfb29729f5eb367fa263ff986，本轮只读提取dsh-api-session-controller、session-query、projection-cache/title等；原应用包不修改。提取位置output/research/2026-10-22/deepseek-official/。官方Controller index.js：SessionCommandController约735行/prompt925行，SessionHistoryController1441/page1475/follow1513（首快照后promote），ApiSessionList1897/list1962，list元数据updatedAt2124（max createdAt,lastPromptAt），公共list3061/prompt3218。title直接为projections.values.title字符串，非嵌套title.title。

官方page内部访问source.events并按surfaceOp append消息分组；插件不自行复制events，但不能将此写成底层整个日志从不读取。只读observe prepared保留lease，finally释放。官方prompt保留requestId→user/message.source.rpcId，并按inbox及原session快照去重。其accepted不是落盘确认。

用户确认默认近30天、保留更早入口。当前官方list不接收时间过滤，30天是桥接层筛选；短缓存与前台低频刷新削减重复metadata工作，不能声称Host完全不枚举老会话。官方timestamp是最后用户对话/创建时间，原运行/当前查看项保留。单条长文本与附件/工具过程仍有当前文本投影限制。

显式隔离检查check-deepseek-history.mjs使用官方公共Controller方法、真实SessionQuery/SessionStore和原内部list/history/commands算法。72个合成持久化Session、95条冷历史，读取列表零正文/零Agent，prepared分页完整，原id发送/rpc确认和重复requestId只接纳一次，共4项通过；resolver与存储是自有替身，不宣称实际AgentLoop恢复已验收。既有官方交互8项同版再检查通过，无模型/用户profile。
