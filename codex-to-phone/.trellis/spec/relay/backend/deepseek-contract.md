# DeepSeek 官方 Harness 原进程契约

固定主源/版本见当前task的research-deepseek.md。插件 `plugins/mobile-deepseek` 通过官方Cordis bundle加载，插件0.2.4的engines.dsh与peer dsh-llm精确允许0.2.1-rc.2、0.2.1-rc.3或0.2.1-rc.5；安装/profile启动拒绝未知版本。不得用Claude wrapper/SDK resume/新CLI代替原Session。

官方macOS桌面版的runtime/cli/bin/dsh允许plugin命令管理保留desktop配置，但普通启动与dump-config拒绝该profile。GUI配置须使用profile patch的mobile-codex.configFile，不能假设继承shell export。新插件可经官方HMR监视manifest/patch动态加载；须核对原进程、插件启用状态和真实鉴权bridge响应，安装成功不等于加载成功。需要重启时不强停用户运行中任务。离线链接无运行依赖的固定插件包，保留autoInstallPeers:false；peer由官方profile runtime resolution共享，不能为消除pnpm提示安装重复宿主依赖。

Relay可选私有配置 `deepseek:{url,token,directory,scope?}`；仅http://127.0.0.1:port/，token至少32字符且不等于手机token/managerKey/Claude bridgeToken。插件configFile为绝对路径，JSON `{port,token,directory,scope?}`，POSIX权限0600，精确cwd。公网手机沿用Agent routes鉴权/stream-token/配额。

`createRelayServer`必须将可选deepseek配置传入默认`createAgentGateway`，不能只在托管配置或环境解析层保留字段。至少一项配置接线回归须不注入AgentGateway，从真实HTTP工厂验证被动注册、原bridge会话列表和显式探测；注入适配器的路由测试不能证明生产入口已注册。

默认directory模式私有协议v1（all扩展见后文）：GET /info、/sessions，GET /sessions/:UUID/events（首帧完整snapshot，随后200ms合并，10s心跳），POST /sessions/:UUID/messages、/interrupt、/questions/:UUID/respond、/permissions/:UUID/respond。返回AgentSessionSnapshot，agentId=deepseek，partialText=true，historyCursor=null，questions/permissions按原待答请求投影。info.interactions可选，只有true才声明审批能力，旧bridge兼容。别名绑定原live handle，dispose/替换立即失效；不把任意宿主ID放入HTTP路径。

原live控制要求有效订阅/随机controlToken/UUID clientMessageId；先锁定再同步调用followup/steer/cancel。turn/start/end轮换token；steer/interrupt要求原open turn仍有效，取消keepInbox。消息仅user/message且id匹配才confirmed；discard权威拒绝；无回包保持uncertain、不自动重放。最后订阅释放token，未确认记录仍保留；重新订阅恢复锁。进程重启不保证操作幂等。

directory模式构造不连接，无手机不读正文；首订阅observeSession projectionMode:none，只live且cursor<4096时读取一次events，使用Symbol.dispose释放。大log仅后续增量。普通消息text-only、120条/256KiB、每条32KiB，推理内容和普通工具日志不跨进程；仅当前待审批可发送其完整工具输入。流按attempt/revision/index，durable替换临时消息。每插件最多128 live别名、32entries，单SSE与最后订阅清理，慢消费者断开。HTTP8秒/1MiB、SSE30秒idle/1MiB帧、最多16requests、无重定向或重试，错误仅稳定DEEPSEEK_*码。

官方AssistantStreamAttempt的revision在Agent生命周期内逐帧递增，start/chunk/end各取新值，并非一次attempt保持不变。entry保存已接受revision高水位，新start也须更新；chunk/end还须匹配当前attempt与下一个index，拒绝重复/过期/错attempt/错index时不推进水位。合成fixture必须按此官方契约递增，不能固定revision以掩盖实时输出丢失。durable替代临时文本仍以turn/step关联。

验证：合成Cordis上下文、官方工厂形状、临时端口，不安装真实dsh、不读真实会话、不调用模型。必须覆盖scope、鉴权/Origin、别名归属、事件投影/流去重、同步竞态、旧turn、未知结果/重连锁、无订阅不读log、大log不materialize、慢消费者/释放及配置/手机入口。

## 可见消息阶段（插件0.2.1）

### 1. 范围与触发

手机需要按可靠的原始任务归属折叠过程。阶段投影属于插件/Relay/手机跨层契约，实时和历史复用同一原生事件算法；不开放推理正文或额外普通工具参数，不增加模型请求。

### 2. 签名

`plugins/mobile-deepseek/messages.mjs`导出`messageOf(event): AgentMessage | null`及`finalMessageId(state, event): string | null`；`createDeepSeekCatalog(ctx, token, retained)`复用该投影。私有`GET /info`可选`messagePhases:boolean`，新插件声明true；旧协议v1仍可省略。AgentMessage增加可选`turnId:string`和`phase:"commentary"|"final_answer"`，Relay的deepSeekInfo/消息Zod必须保留字段。

### 3. 数据契约

可见助手消息有有效非负safe integer原生turn时映射`turnId=String(turn)`并先标commentary。原生turn/start或step/start清空旧候选；最新assistant/message有可见text、有效step/turn、未interrupted且无tool-call，才成为终稿候选。仅同turn的`turn/end.data.reason.kind === "completed"`提升该候选为final_answer，随后清候选。历史先扫描官方连续page的完成边界，再按文本预算裁剪；游标/零激活规则保持。流式chunk自身没有turn，临时文本必须使用当前`stream.turn`，durable仍替换同turn/step的临时消息。重连清候选，不能从上次断开的末步猜完成。

### 4. 校验及异常矩阵

| 输入 | 展示/协议结果 |
| --- | --- |
| 原生成功turn结束且存在同turn有效候选 | 仅该消息final_answer |
| stream/end或idle；aborted/error/max-tokens/blocked | 不提升，过程保持 |
| 下一step为空/只有工具，或interrupted消息 | 清除/拒绝旧候选，不能折叠旧过程 |
| 缺失/非法原生turn | 可见原文保留，不造任务号或阶段 |
| 旧插件缺messagePhases/phase/turnId | 继续解码；手机保守显示 |
| 非法phase或过长turnId | 原消息schema拒绝，不能静默补成final |

### 5. Good / Base / Bad

Good：turn12先输出进度，末step为纯文本“完成”，成功turn/end后仅“完成”为final。Base：旧插件仅有text时保持普通正文。Bad：工具步骤后的idle或取消被当作final，会吞掉未完成过程，禁止。

### 6. 必需测试

deepSeek.test覆盖逐帧stream.turn、临时到durable替换、成功提升及重放、四类异常、后续空step与重连；deepSeekHistory.test覆盖跨官方页的进度/成功终稿/中断、预算裁剪及读取零Agent激活。手机从messagesForRender到分组入口断言同ID阶段升级、无重复终稿及已知工具可展开。实际加载另以鉴权/info.messagePhases=true确认，磁盘版本升级不代表HMR已完成。

### 7. Wrong / Correct

Wrong：从chunk.frame.turn取任务号，或用最后一条助手文本/idle猜终稿。Correct：从已验证的当前stream.turn投影临时文本；只以原生成功边界提升同turn有效末步。文件HMR未生效时，核对原进程后通过官方组件开关仅重载手机桥接；不重启Harness/Agent或更改审批策略，最后核对profile配置字节及bridge能力。

### 失败轮次提示（插件0.2.3）

- 触发：原生`turn/end.data.reason.kind === "error"`，且turn和seq为有效非负safe integer；`messageOf(event)`输出稳定`turn-error-${seq}`消息。实时bridge及catalog历史分页共用该函数。
- 消息沿用`role:assistant/kind:agent_message`，正文明确标识“DeepSeek Harness 运行提示”，有原turnId但不标`final_answer`或`commentary`。失败提示保持在过程块外，旧APK36/网关现有schema可以直接读取。
- `reason.error.code`按已知错误码映射固定说明；INVALID_REQUEST仅在有界原文同时包含已知全账号不可用与冷却字样时提示模型服务暂不可用。未知码、缺详情使用通用提示。原始错误正文、URL、凭证与堆栈均不转发。
- `confirmed`只确认输入送达，后续模型失败不改投递确认、不恢复已送达草稿、不自动重发。完成、取消、blocked/max-tokens不伪造该错误提示；已有部分输出仍为原阶段。
- 必需验证：接受输入后失败、实时/重开单提示与稳定身份、冷历史零激活、后续成功不隐藏旧失败、固定摘要及敏感原文不透出；手机真实过滤/分组和组件显示分别核对。
- Wrong：输入已确认且宿主转idle就宣称任务成功。Correct：保留原输入，由原生终态显示执行失败，恢复服务后由用户决定是否再发新请求。

官方运行时检查另用`node scripts/check-deepseek-runtime.mjs <隔离运行时绝对目录>`。显式提供官方dsh与agent-loop-testkit同版0.2.1-rc.2、0.2.1-rc.3或0.2.1-rc.5及Cordis4.0.5目录，脚本不安装依赖，所有profile/配置/会话位于自建临时目录并最终清理。先以真实bundle解析/版本门/CLI dump、Loader、AgentRegistry、SessionStore、SessionQuery和作用域事件总线验证9项加载/恢复/异步卸载；再用官方生产AgentLoop与唯一的本地确定性LLM adapter验证4项排队/追加/流去重/中断保留Inbox/旧turn拒绝，无外部provider、外部模型或用户持久化服务。官方const enum在JS无导出，状态值取固定版本类型声明；Session.append可见消息须带surfaceOp，不能因合成fixture省略该参数而误报插件失败。此检查通过不等于用户dsh原会话或Android验收通过。

## 全部工作区与按需历史（插件0.2.0）

用户2026-10-22显式扩展：两端私有配置scope=all，默认仍兼容旧directory。all覆盖原profile普通线程，不含子Agent；原ID经独立bridge密钥HMAC稳定映射为UUID，不在HTTP路径暴露原ID。info声明scope=all/history=true，Relay核验后才接纳；旧配置沿上述live目录约束。跨宿主/profile不自动聚合。

官方sessionController.list({},signal)合并live与persisted元数据，复用title投影，列表不访问正文。近期默认过去30×24小时，以官方最后用户对话/创建时间为准，running及已订阅/未确认项保留；range=all显式扩展，search匹配标题/目录，50条分页。摘要缓存15秒，原session/created、可见消息及Agent状态改变后失效，下一请求读取；没有手机列表请求不扫描。手机列表前台每30秒及回前台补查，不后台同步全部正文。列表opaque游标绑定range/query和固定切片，15分钟/16个。

30天只过滤手机下发范围；官方list仍读取全部摘要，不承诺数据库仅访问近期元数据。它减少手机传输/渲染和不必要正文读取，不等于摘要查询复杂度随近期记录数量下降。

历史使用原sessionQuery.observeSession(projectionMode:none)验证身份/cwd/cursor并释放lease，再走官方sessionController.page，throughSeq固定、beforeSeq严格递减、maxMessages40。不能使用官方follow：prepared会在首次snapshot后promote。插件不访问observation.events；官方page内部仍可能读/物化该会话日志，不承诺底层随机读。可见文本每页256KiB，预算裁剪游标落在最早保留消息seq，确保未显示旧消息可继续取；单条最多32768字符，附件/工具过程/推理不投影。历史游标绑定线程/固定throughSeq，15分钟/512个。只读查看不创建Agent，不把历史提问/权限变可操作卡片。

### all模式接口与验收矩阵

触发范围：两份配置显式scope=all，Relay验证bridge能力后接入跨工作区列表和冷历史。

接口：`GET /api/agents/deepseek/sessions?range=recent|all&search=...&cursor=...`返回`{sessions,cursor}`；`GET /api/agents/deepseek/sessions/:id/history?cursor=...`返回`{messages,cursor}`。首历史页由原events完整snapshot提供，后续cursor不由手机构造。原`POST .../messages`仍需有效订阅、controlToken与UUID clientMessageId。

| 条件 | 结果 |
| --- | --- |
| range省略 | recent，过去30×24小时及保留项 |
| range用于非DeepSeek | 400 AGENT_RANGE_UNSUPPORTED |
| query/range与列表游标不匹配、历史跨线程/过期 | 400 DEEPSEEK_CURSOR_INVALID |
| all配置对端未声明scope/history | 409 DEEPSEEK_SCOPE_UNAVAILABLE |
| 冷历史仅包含工具事件 | messages可为空，cursor仍严格向前，允许继续 |
| 目录/原ID变化或原线程已不存在 | SESSION_CHANGED/SESSION_GONE，禁止控制回退 |

Good：打开另一工作区的prepared历史，零Agent激活并可向前翻页；Base：旧配置缺省directory保持既有行为；Bad：拿all游标查询recent或用follow加载prepared，分别应拒绝/禁止实现。所需断言：近期边界与运行保留、缓存失效、多页无丢失/重复、空正文页游标推进、读取零激活、原prompt确认和未知不重放、stop取消待页请求。

Wrong：前台/后台每30秒读所有会话正文，或以accepted当confirmed。Correct：仅列表前台请求摘要；选中会话按需page；显式发送后以原rpcId权威消息确认。

仅显式cold message可调用原sessionController.prompt({sessionId,requestId:clientMessageId,mode:queue,content},signal)，在原Host恢复同一sessionId，禁止create/fork/新CLI。调用前锁定并轮换token，accepted只表示submitted，原user/message.source.rpcId确认；未知锁跨重订阅，不重放，权威消息优先于迟到异常。冷转热后复用原live控制与卡片；并非跨进程重启exactly-once。每请求signal从res.close/stop取消；只关闭自有HTTP和服务，不终止原任务。

隔离回归覆盖146普通线程、多页跨目录、冷历史/UTF-8预算切片、未知锁/迟到ACK/rpcId/旧token、近期缓存与原桌面活动失效、真实HTTP工厂range与鉴权、关闭待页请求。显式官方检查器scripts/check-deepseek-history.mjs仅在自建隔离runtime复制官方模块临时导出内部算法，使用官方SessionStore/Query/Controller和合成持久化/Agent resolver，验证72条摘要零正文、prepared分页零激活、原prompt及requestId去重；无用户profile、原会话或外部模型。resolver是隔离替身，不把它作为用户真实恢复验收。

## 原生问题与单次审批（插件0.1.2）

实际桌面0.2.1-rc.2构建为332895e0f7c9d4dbfb29729f5eb367fa263ff986，不能仅凭版本号视作早期687f282研究提交。原typertGateway.pendingRemoteEvents是待答来源，不增加answerer、不替换宿主方法、不改变approval policy。固定settleRemoteEvent/finishRemoteEvent去空白源码SHA；沿原型descriptor取原函数，避免Cordis服务Proxy包装导致误判。ctx.get每次可返回新Proxy，缓存和宿主相等以原pending Map身份为准。仅手机订阅期间每250ms有界读取，末订阅/stop/dispose清理。

提交前在无await同步段内核验原pending对象、原live root、signal、turn、完整签名与控制令牌，再调用完整settleRemoteEvent；不能仅resolve或仅finish。审批另绑定step，只回allowed-once/rejected，无always。完整工具输入从tool/call或tool/ptc-dispatch-start建立最多128条/256KiB索引，校验turn/step/name/callId和JSON；重复、缺失、旧步骤、超限或未知约束只允许拒绝，不从助手文字猜参数。大log连接前的审批可能无法补齐参数。

displayReason是必含en的locale→string对象，不是字符串；保留全部语言的有界JSON和原reason，最多32个语言、单key64字符、序列化总量32KiB。非法或超限不允许。单卡明细192KiB、交互合计384KiB，不能截断关键内容后仍显示允许。当前工具输入完整不代表审批后才生成的最终进程cwd/环境已知。

原问题保留单选/多选/自填，按question.id及原label映射selected/custom。plan-review校验approve属于原选项，detail全文追加现有question字段兼容APK21。continued问题调用原userQuestions.continued/answer；true仅表示结构化回复已排队，权威user/message才关闭，跨turn保留，不恢复冷会话。桌面已排队reply锁定。子Agent不能默认为root授权。

每个原请求以随机public ID及完整签名绑定；内容改变、桌面先答、取消、旧turn/step禁止手机迟答。结果未知在bridge原对象及Relay有界256条记录跨重连锁定，不保存答案、不自动重放；普通消息未知不妨碍回答独立问题。沿用设备鉴权、stream-token及SubmissionRegistry。

显式`node scripts/check-deepseek-interactions.mjs <隔离运行时绝对目录>`以官方Gateway原型算法、真实Cordis traceable服务和Approval/UserQuestions/Session/Projection/AgentRegistry检查8项，含多语言理由、审计、取消、桌面先答及continued，无模型、用户profile或真实权限决定。不纳入默认离线测试；公网只读显示、手机实际决定与长期稳定性分别验收。

## 宿主升级兼容（插件0.2.2）

1. **范围**：宿主升级导致bundle被版本门拒绝；插件和网关协议校验必须同时核对。
2. **签名**：`createDeepSeekBridge(ctx, config, createUserMessage, harnessVersion)`第四参必填，由入口动态导入宿主共享LLM包的package.json获得，不接纳私有JSON或手机指定版本。
3. **契约**：engines/peer、bridge白名单与Relay deepSeekInfo均仅允许rc.2/rc.3。`/info.harnessVersion`为实际共享包版本。跨运行时保持各自校验，不把宿主依赖引入Relay；测试握手覆盖两端。
4. **异常**：缺失/rc.1/rc.4/正式0.2.1/0.2.2等未验证版本，bridge在监听前抛`DEEPSEEK_VERSION_UNSUPPORTED`，网关schema拒绝；官方版本门拒绝加载。待答内部接口指纹仍独立核验，不能跟随版本门一起取消。
5. **用例**：Good=rc.3加载后info返回rc.3且同源正文正常；Base=rc.2保持能力；Bad=硬编码rc.2冒充实际新版或允许所有未来版本。
6. **验证**：两版各自官方runtime13/interaction8/history4，隔离profile和本地adapter；旧manifest在rc.3官方evaluatePluginCompatibility明确拒绝；未知版本门和默认HTTP握手回归。官方探针保持显式入口，不并入verify。原profile部署、手机及实控单独验收。
7. **错误/正确**：错误是只放宽engines；正确是核对加载器、Query/Controller、AgentLoop和审批接口，双版回归后同步peer、真实版本上报与网关白名单，再通过官方CLI/HMR加载到原profile。

## 宿主升级后的兼容恢复

重开应用可能已切换官方宿主版本。不得继续安装只验过旧版本的候选，或硬编码旧版本绕过检查。先读取官方插件页拒绝原因及已安装运行时；只读提取到隔离目录，比较关键接口并跑对应版本的运行时/审批/历史检查，再同时更新manifest、bridge和网关握手的精确白名单。rc.5关键入口与rc.3字节一致，25项官方隔离检查通过；未知rc.4/rc.6仍拒绝。手机协议不变时沿用现有APK；部署分别确认插件实际/info及网关下发，不把磁盘安装成功当加载成功。

## 手机待发定向取消（插件0.2.5）

可选queue快照仅投影本桥接当前未确认手机submission对应的原生nextTurn项，最多一条；available要求当前live Agent具有数组nextTurn和同步remove方法。无该字段的旧插件不宣称支持。原生waiting/paused/uncertain；网关额外合成cancelling。手机凭匹配的waiting/paused权威项清理原草稿，新编辑保持；队列接纳仍submitted，只有原user/message确认执行。

POST /api/agents/:agentId/sessions/:sessionId/queue/:clientMessageId/cancel采用既有设备鉴权、原订阅controlToken及操作UUID幂等。bridge无await核验当前live handle、同一submission和nextTurn归属，精确remove(messageId)；禁止cancel/clear。已消费、外国项、旧token拒绝。取消未知由bridge和Relay双层锁定，跨重订阅不可重试；权威移除清锁，迟到未知结果不污染新待发项。插件重载不恢复映射，部署前必须清空未决手机提交；不宣称跨进程exactly-once。

隔离覆盖取消不影响任务/桌面项、过期拒绝、重连旧token、未知与迟到HTTP、路由鉴权/幂等。官方rc.2/rc.3/rc.5运行时脚本新增生产AgentLoop中定向remove验证，外部模型请求0；手机真实排队顺序/取消仍独立验收。
