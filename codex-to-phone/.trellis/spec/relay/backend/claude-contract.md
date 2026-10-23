# Claude Mods 桥接契约

## 范围与证据

固定参考 `anthropics/claude-code@bf2323b3021c9d3db7a31e1e7d61068c3f704497/mods/types/claude-code.d.ts`（生成版本2.1.277）；入口遵循当日官方create文档的`modules`，不是早期猜测的`functions.capabilities`。仅接入原进程内已加载Mods的会话，绝不启动CLI/SDK、resume/fork或读用户会话目录。宿主仍待真实验收；本机2.1.220不满足开发契约，未升级/安装。

官方入门文档的宿主下限为2.1.287；不可将类型声明生成版本277当作可加载下限。当前2.1.220旧validator不接受modules入口；补齐作者等元数据不等于解决运行兼容。

2026-10-21另在临时目录使用核对完整性的官方2.1.287二进制：严格校验暴露HTTP helper与局部request变量重名，改为唯一bridgeRequest后通过，原8个hook和9个API调用均被识别。官方plugin test的7项无模型沙箱测试通过，用户CLI与原会话未变。此证据补齐官方沙箱加载，不等于原会话/真实面板验收。

## API、身份和边界

- 私有配置`claude:{bridgeToken}`可选；没有配置不注册adapter或bridge路由。不复用手机管理员密钥。
- `POST /api/claude-bridge/register`：session UUID、activation UUID、2.1.x且patch>=287、绝对目录、turnId|null，可选`interactions:1`。返回服务端generation。存活的另一activation不得替换；同activation重复登记不改变token或序号，也不得静默改变交互能力。
- `POST /api/claude-bridge/:sessionId/poll`：generation；最长20秒，一会话一个在途。快照请求可重复发；模型输入/中断取出后绝不再次投递。HTTP断开需取消等待。
- `POST .../events`：generation、正整数sequence、有界白名单事件，body<=256KiB。只读重复序号忽略，缺口即失去权威。可见text以turnId及段ID合并；推理/工具参数不进入事件。
- `POST .../end`：generation，独立于事件序号，避免退出通知被在途batch吞掉。
- `POST .../interaction`：generation/id UUID、正整数serial、原turnId和不可变request。request为`{kind:"question",questions}`或`{kind:"permission",action,directory,detail}`；最长20秒返回pending/closed或answered+answer。question answer为`{answers:string[][]}`，permission为`{decision:"once"|"reject"}`。body上限128KiB。
- `POST .../interaction/close`：generation/id/serial；body上限4KiB。允许取消先于打开到达，留有界取消墓碑，旧请求不能复活。
- 所有bridge路由均须独立Bearer、真实socket loopback、无Origin。不能用手机设备/Admin凭证访问；关闭不依赖用户提供PID。日志不输出密钥或原始正文。
- 共享会话API先调用adapter.validSessionId；OpenCode仍只接受自身ses ID，Claude只接受UUID。AgentAdapter.sessionApi明确注册写契约，不能用鸭子类型猜写能力。

## 生命周期、数据和确认

最多32条登记，容量满时只回收离线且没有uncertain操作的旧项；不能为了腾位置丢掉未知锁。按需启动一个不阻止退出的租期timer，45秒无host活动失效。停止在preClose唤醒长轮询，以免HTTP关闭等待20秒；关闭只释放本工具持有资源。

手机watch才发snapshot，最后listener离开清正文/overlay/快照队列。宿主只调用一次session.messages获取最近文本，保留最近80条并限制UTF-8编码体积；它本身最多返回4096条，不能宣称只读取80条。overlay上限256k字符/128段，宿主40ms合并；背压明确partial，任务结束快照覆盖live。没有向前历史接口；手机不能说“结束一定补齐全部历史”。

原生输入仅$.prompt.submit，queue；steer能力始终false。返回明确text/无drop才确认原会话接收；不改生命周期。中断带宿主原turnId，abort返回只submitted；匹配turn的aborted终态才confirmed，普通结束为uncertain。未知或已取出超时不重放，跨订阅/同进程重登记保留锁。

未取出便过期/宿主明确drop：submission清空，operationError带clientMessageId+code，草稿保留。手机agentDelivery必须识别同ID权威拒绝，迟到HTTP不得复活等待状态。

## 原请求问答与审批

只有登记interactions:1且原任务仍活跃时接受交互，手机必须持有当前订阅/代次的控制token。问答应答不受普通queue未知锁阻塞，避免原任务等待回答而永远无法解除queue等待；普通发送/中断仍遵守原未知锁。

每activation最多16个活动请求和128条已知记录，以完整描述SHA256、随机id和单调serial绑定。同一id换描述关闭旧题；允许并发初始请求乱序到达，回收已关闭记录时提升退休serial水位，旧记录不得重建。五分钟期限，HTTP断开、原任务变化/结束、失联、最后listener离开和网关关闭均关闭并唤醒等待。关闭立即清题目/答案正文，只留签名和编号；未知close墓碑也有128上限。

手机提交先锁原请求，即便新operationId也不能二次回答。宿主可以重复取同一已答结果，但不产生第二个原工具调用。结果只在内存存活，不承诺跨网关重启恰好一次。取消、断流和迟到HTTP不能恢复旧卡片或对新任务授权。

`classic.PreToolUse`的ToolCallEnvelope参数在顶层，tool/tool_use_id是保留字段；先await next(e)，尊重已有allow/ask/deny/updatedInput。已识别的AskUserQuestion转换为手机问题，回传时保留原questions、metadata及其他输入，answers以完整题目为key，多选以逗号加空格拼接。返回扁平`{allow:true,updatedInput}`，由原工具校验并生成结果；不构造猜测的工具结果，不使用经典shell hook的hookSpecificOutput包装。未知题目结构/额外字段或超限回宿主，preview只以文本展示。

`classic.PermissionRequest`先尊重已有decision/block/preventContinuation，仅支持Bash/PowerShell/Read/Write/Edit/NotebookEdit。手机展示完整JSON tool_input与cwd；不完整/超限/未知工具留宿主。只返回扁平`{decision:{behavior:"allow"}}`或deny，不回写输入、权限规则或模式；permission_suggestions不能当成已提供的按钮。

等待通过`$.http.fetch`的长轮询完成，不用自建延迟Promise占用hook自身10秒预算。保留next.signal，取消发close，返回前核对signal/generation/turn；网络失败不授权。先共享flushPromise并排空已排队turn事件，避免发布原任务尚未送达的题目。没有手机订阅时立即保留宿主流程。

不能宣称所有宿主原生对话框同时可点。固定声明/官方文档支持此接入设计，但Mods的原生加载、预算行为、取消和桌面/SDK/手机先答竞争仍需兼容宿主实测；合成先答锁只证明本项目边界。

宿主模块只使用literal on/$ API及同文件顶层helpers；不用Node、全局fetch、动态import或alias `$`。`.http.fetch`无可用取消参数，保持single-flight，不能用Promise.race伪装取消后叠加新请求。固定2.1.287静态校验已补齐，其他版本兼容及真实网络挂起行为仍需验收。

传递`$`的顶层helper名称须在整个文件中唯一；即便局部变量在JS作用域内合法，与该helper同名也会令固定官方静态分析报“declared more than once”。不得通过增加空hooks或把API搬到动态调用中绕过。官方校验器/测试runner必须使用临时HOME与CLAUDE_CONFIG_DIR，关闭自动更新，只运行plugin validate/test，不启动会话。官方测试Engine的turn.step以标准iterator终值读取结果；固定声明的.result便利字段在该测试Engine上不存在，不据此改写产品next(e)的结果处理。

## 必需验证

`test:claude`为临时目录/合成HTTP与注入宿主，无真实模型、安装、生产配置或会话访问。31项包含完整题目/输入保留、多选/自由、原请求取消、重复/迟到、墓碑/记录回收、租期/订阅/关闭释放、配对设备应答与撤销。合并既有回归；手动以固定官方声明检查模块类型。真实CLI版本、官方plugin validate、原进程输入/中断/问答/审批及Android远程另记，不能因源码/模拟通过标记整体完成。

`node scripts/check-claude-runtime.mjs <隔离官方2.1.287二进制绝对路径>`补官方版本门/严格静态校验与7项无模型测试，脚本不安装；fixture位于scripts/fixtures/claude-official-runtime，复制到自建临时插件，避免将测试打进发布包。所有HTTP通过官方on hook应答，底层模型响应只由本地流hook提供。须验证无配置/旧版本不登记、不订阅读正文0次、原会话ID登记、按需快照/重复命令、原流及终值完整透传、推理不外传、旧turn中断拒绝和403后不再poll；用户原会话、Classic实际交互与长期网络挂起保持单独待验收。
