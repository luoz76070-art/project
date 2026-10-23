# 后端验证

执行过程跨层回归须验证native所有角色的真实record.turnId及rollout助手metadata.turn_id；不能只给用户消息加任务号。DeepSeek插件0.2.1增加6项实时/异常/重连及1项冷历史阶段用例，断言原生成功边界、stream.turn而非chunk.turn、末步候选失效、分页预算及零激活。info.messagePhases可选兼容旧插件；源码测试通过不等于实际HMR已加载，运营只读验证和原Harness保持单独记证据。详见[DeepSeek阶段契约](deepseek-contract.md)。

- `corepack pnpm typecheck`：两端类型检查。
- `corepack pnpm build`：Relay + Mobile 构建。
- `corepack pnpm test:messages`：消息合并历史回归。
- `corepack pnpm test:transport`：新增 Broker/Tunnel/SSE 隔离回归。
- `corepack pnpm test:codex-executable`：可执行文件发现，不启动模型。
- `corepack pnpm test:correctness`：JSONL、初始化、发送等隔离回归。
- `corepack pnpm test:performance`：10,000 会话热索引、分页、IPC 坏帧和 patch；不读真实会话。
- IPC接收回归还须覆盖大于16MiB的合成长会话、分片长度头/UTF-8/连续帧、按字节统计的线性复制、64MiB超限头和断开重连；真实只读快照的大小/时延另记，不能把合成接收当成原会话控制通过。
- `corepack pnpm test:availability`：设备配对/撤销、配额、输入队列与只读客户端生命周期；注入输入执行器。
- `corepack pnpm test:gateway`：临时 Unix socket 上的 WebSocket 握手、分片/边界、心跳、资源清理与管理员鉴权；不运行真实 CLI。`probe:gateway` 是人工只读集成入口，不能纳入默认测试。

最终可合并构建一次后运行 `node --test apps/relay/tests/{correctness,performance,transport,availability,agentGateway}.test.mjs`，避免重复清理/编译 dist。原生构建与真机控制分开记，不能把 Swift typecheck 或 APK 构建成功当作辅助功能权限/安装/唤醒验收。

传输回归检查首块可及时读取、二进制字节完整、取消传递、断线立即失败、旧连接/异 Relay 回包隔离、慢消费者及重连。随机端口和临时资源在 finally 中清理。不把缺陷复现脚本退出 0 当作验收通过。
- `corepack pnpm test:user-input`：Desktop 原生 IPC/HTTP/SSE 问答与 Relay 请求分流；不连接真实 Codex。合并后端回归时加入 `userInput.test.mjs`。
- 问答回包覆盖平面/包裹ACK、错方法/owner/内层方法、空/负面结果和异步错turn；无效响应保持uncertain及一次写入，权威移除优先于迟到回包。不能用合成fixture的宽泛ok代替宿主steer的turnId回执。
- `corepack pnpm test:desktop-native`：普通发送/追加/任务绑定中断、权威确认与HTTP幂等；临时socket严格检查宿主参数，不能仅返回宽泛的ok掩盖restoreMessage等契约缺失。合并回归另加入 `desktopNativeControl.test.mjs`。

- `corepack pnpm test:desktop-approvals`：三类Desktop审批的原owner/request绑定、精确权限、复杂策略、提交锁、未知结果、断线/签名失效与HTTP/SSE；合并回归加入 `desktopApprovals.test.mjs`。不得真实批准本机请求。

- `corepack pnpm test:managed-gateway`：单实例端口归属、私有配置/迁移、配对/撤销、实例停止及复制到独立目录后的完整CLI生命周期；先构建插件，再将`managedGateway.test.mjs`纳入合并回归。不得读取生产配置或安装插件到用户Codex目录。
- 关闭顺序须使用默认适配器和合成HTTP验证info响应头、首帧等待及活动订阅，断言及时释放上游、并发stop合并和同端口重启。独立bundle daemon另检查自然退出0而非仅端口释放；测试失败仅可终止本测试创建的child。线上只读订阅下的正常退出/重启独立记证据，不能以合成通过宣称所有真实竞态已消除。
- 同命令还运行`macGatewayService.test.mjs`：临时HOME/合成launchctl验证用户级托管文件/权限/SHA/并发与失败状态、普通stop退出0与托管start，实际plutil仅解析临时plist；没有真实bootstrap/bootout。独立CLI测试必须显式覆盖HOME/USERPROFILE，不能碰真实登录项。合并后端回归同时加入此文件，真实登录/崩溃/唤醒另验收。
- `corepack pnpm test:opencode`：随机端口合成2.0.16 HTTP/SSE，包含版本拒绝、原form字段/选项值、未适配表单及中断no-op；真实delta与段末全文、私有delta不逐字读REST、目录/完整请求签名、未知结果跨重连、鉴权/幂等/撤销及释放。合并回归加入`openCode.test.mjs`，不连接真实OpenCode或启动模型。
- OpenCode分页须覆盖官方显式null的previous/next、混合字符串/null、字段省略，以及非法类型/超长值拒绝，列表/初始订阅/历史均可用。`node scripts/check-opencode-runtime.mjs <2.0.16二进制绝对路径>`为显式官方服务复核：自有前台进程、临时HOME/XDG/数据库和simulation，12项检查，无prompt，清理自有fixture/进程；不能纳入默认测试或当作用户原会话/Android验收。
- `corepack pnpm test:claude`：真实插件源码+合成宿主API/随机HTTP端口，验证登记所有权、按需文本、流、queue/原任务中断、拒绝/未知/租期、体积及退出释放；还包括原questions/metadata保留、完整工具参数、单次决定、取消/错代次/重复/迟到、墓碑/回收及配对设备应答。31项不运行真实Claude。合并回归加入`claude.test.mjs`，先构建独立插件。版本不满足时不得绕过或静默启动替代会话；真实取消/两端先答须另验收。
- `node scripts/check-claude-runtime.mjs <隔离官方2.1.287二进制绝对路径>`：显式官方版本门、严格plugin validate与plugin test；HOME/配置/工作目录均自建，HTTP/模型底层由官方测试hook应答。7项覆盖加载、按需文本、重复输入、原流终值/私有正文、任务绑定中断和403停轮询。脚本不下载安装/升级用户CLI，不读用户会话，退出清理。固定类型复核同时加入scripts/fixtures/claude-official-runtime/bridge.test.ts；勿把旧CLI校验失败混作新版本校验，也勿把官方沙箱通过计为原会话面板验收。
- `corepack pnpm test:deepseek`：原插件源码+合成Cordis上下文、随机HTTP端口，覆盖原live别名、精确cwd、无订阅不读正文、大log不物化、流/权威消息去重、逐帧revision与错序拒绝、旧turn令牌、未知锁/重连、原中断、配置脱敏、配对鉴权与并发提交去重。22项不运行真实dsh或模型；真实官方运行时单独验收。SSE write返回false仅代表背压，按有界writableLength处理，不能把合法大快照误当慢连接直接关闭。
- DeepSeek当前增加默认HTTP工厂配置接线回归，共23项：该用例不能注入AgentGateway，须让配置经过与生产相同的构造路径，否则即使全部适配器与注入路由测试通过，也可能遗漏可选Agent注册。
- 插件0.1.2后DeepSeek共40项，增加原生问题/完整计划、continued、工具输入索引/PTC、单次允许/拒绝、多语言displayReason、缺参/歧义/非法/超限、旧turn/step、两端先答/取消、unknown跨重连及设备HTTP幂等。原23项为前期计数。官方交互检查另用`node scripts/check-deepseek-interactions.mjs <隔离运行时绝对目录>`，8项含真实Cordis traceable服务，避免只用普通对象fixture遗漏服务Proxy契约；无外部模型和用户真实审批。
- `node scripts/check-deepseek-runtime.mjs <隔离运行时绝对目录>`：显式使用固定官方发布依赖，检查bundle/版本门、CLI配置合成、真实Loader/内存会话/事件总线和卸载；再使用官方agent-loop-testkit装载生产AgentLoop，仅登记本地确定性LLM adapter，验证queue/steer、canonical去重、keepInbox及旧turn拒绝。13项检查、3次本地响应、无外部模型；脚本创建并清理临时profile，不读用户profile，不安装依赖，也不计为用户原会话控制验收。不要并入默认离线测试。
