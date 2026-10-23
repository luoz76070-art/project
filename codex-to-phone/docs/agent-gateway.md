# 插件化网关与多 Agent 接入

更新时间：2026-10-22。当前独立预览为APK22 `1.3.1-deepseek-history-preview`，Mac固定网关及DeepSeek原插件0.2.0已实际更新；正式Android更新清单仍为18，手机覆盖安装和原会话真实控制待分项验收。首次迁移见[网关迁移记录](audits/2026-10-21/gateway-migration.md)，下方各阶段记录保留当时的验证边界。

最新[DeepSeek全部线程与按需历史](audits/2026-10-22/deepseek-history.md)：原profile跨工作区普通线程默认近30天，可查看更早，列表前台每30秒及回前台刷新摘要，正文按需分页。240条手机窗口可持续前翻/返回最新；单条文本32768字符，附件/工具过程/推理不投影。只读查看不激活Agent，显式发送才通过官方prompt恢复原sessionId。实际11线程/3工作区及本地公网历史、重连、95项健康断言通过；原进程/凭证/设备/profile保持，原任务已自然完成。后端318/318、手机43/43、官方历史4项/交互8项及类型/构建通过。APK22已发布独立预览，APK21不能获得本轮新UI；手机真实发送和权限决定另验。30天只过滤下发范围，官方摘要仍全量读取并缓存15秒；不后台遍历全部正文。

最新[网关退出与重启稳定性](audits/2026-10-22/gateway-shutdown.md)已更新固定运行包：HTTP排空前统一取消Agent订阅，覆盖info/首帧初始化及活动流。全部后端308/308、网关/托管30/30及类型/构建通过；真实活动只读订阅下138ms自然退出、同端口重启和本地/公网/IPC健康通过。旧版切换仍残留，已通过官方界面仅重载手机桥接恢复，失败与恢复分别记录；原Harness任务及进程、配置/设备/profile保持，APK21无需重装，长期测试继续暂缓。

最新[DeepSeek手机原生卡片与单次审批](audits/2026-10-21/deepseek-interactions.md)已加载原Harness插件0.1.2及对应固定网关。原问题/完整计划、continued与单次允许/拒绝复用现有手机卡片；完整输入缺失则禁用允许，未知跨重连锁定。后端304/304、官方交互8项和公网实际权限卡只读通过，原Harness PID保持；手机实际决定及真实问题仍分别待验，APK21无需重装。首次stop未排空旧SSE的离线/恢复有独立记录，整体任务保持in_progress。

最新[固定运行包兼容更新](audits/2026-10-21/agent-compat-runtime-upgrade.md)已将核验的0.2.0候选复制到独立固定目录并运行，OpenCode nullable分页修复进入当前网关。私有备份、首轮正常回退/二次切换、本地公网检查及真实手机v1增量流通过；17.34秒样本用当前手机解码器还原120条消息且无序列缺口。未启用后台托管或安装宿主插件，Claude/DeepSeek宿主侧0.1.1仍待安装验收；APK21及三个更新清单未改。下方“运行网关未改”保留对应历史阶段原义。

最新新增[官方DeepSeek Harness及手机重复修复](audits/2026-10-21/deepseek-dedup.md)：独立Cordis原进程插件、loopback适配器与手机入口已通过合成检查；[安装说明](../plugins/mobile-deepseek/README.md)。APK21已发布独立预览并完整下载校验，Mac同源固定网关已切换，本地/公网连接和原生IPC健康通过。正式更新仍18，热更新未改；本机无dsh，真实加载及Android覆盖安装仍待验收，三插件未自动安装进宿主。

[官方运行时复核](audits/2026-10-21/deepseek-official-runtime.md)随后补齐13项：9项bundle/Loader/内存Session/事件总线及卸载，加4项官方生产AgentLoop的queue/steer/流去重/keepInbox/旧turn拒绝。发现并修复revision逐帧递增被误当attempt固定的缺陷，独立插件0.1.1及DeepSeek22/22通过；3次本地确定性响应，无外部模型。修复插件本地单独打包，APK21与运行网关未改；用户dsh原会话/真实provider与Android仍需验收。

[Claude官方运行时复核](audits/2026-10-21/claude-official-runtime.md)进一步以临时官方2.1.287验证：严格校验识别原8个hook/9个API，官方无模型7/7及Claude31/31通过。HTTP helper同名静态加载错误已修复为独立插件0.1.1；用户旧CLI未升级，修复包未装入用户宿主，真实Classic面板/原会话及Android仍待验收。

[OpenCode官方服务复核](audits/2026-10-21/opencode-official-runtime.md)完成12项自建数据库检查，并修复分页显式null游标兼容；用户原会话/模型另验收。随后[后台托管候选](audits/2026-10-21/gateway-service.md)为Codex插件0.2.0补齐可选macOS登录启动/异常恢复入口，固定程序不依赖插件缓存。26项隔离/独立网关及plutil检查通过，当前用户登录项未注册，运行网关与APK21不变。

## 目标与阶段

手机继续通过 Broker 连接一个本地 Relay，插件提供安装、配对和连接状态入口，各 Agent 通过独立适配器接入。插件不能绕过 macOS 权限，也不能仅凭安装就获得 Desktop 当前会话的控制权。

| 阶段 | 内容 | 当前结果 |
| --- | --- | --- |
| P0 | 连接现有服务、统一状态接口、按需只读探测 | 源码及隔离验证完成；本机只读握手成功 |
| P1 | 优先打通手机方案选择，再验证 Desktop 同会话的发送、追加、中断和审批归属 | 提问、普通控制和三类Desktop审批源码与合成验证完成；真实同会话与手机验收待做 |
| P2 | Codex 插件安装、配对入口、单实例后台网关、能力展示 | 源码/独立构建包与隔离CLI通过；网关已实际切换并保留凭证，Codex插件安装与手机联测待验收 |
| P3 | OpenCode / Claude Code 等原生适配器 | OpenCode及Claude控制/问答/单次审批源码与隔离验收完成；真实宿主、取消/两端先答及Android待验收 |

当前候选网关使用 DesktopControl 原生 IPC 通道，旧 Input Helper 与 Relay App 保留作回退，权限未修改。真实同会话控制仍待验收。普通联网、会话读取与辅助功能是不同能力；后台网关仍须运行，Mac 休眠或离线时不能立即执行输入。

## 新增优先需求：手机上的方案选择

2026-10-20 用户反馈：Codex 桌面发起的选择面板在手机上既不可见，也无法作答。这是远程工作流的阻塞项，优先于插件打包和其他 Agent 接入。

实施前的源码根因：

- `codexStore.toMessage` 把 function_call 转为 tool 消息；手机 `isTextConversationMessage` 只保留用户/助手文本，不能传递结构化问题的交互语义。
- `LiveTurnController` 将携带 id 的服务器请求统一交给审批分支；`approvalFromRequest` 不处理用户提问。手机仅有 `ApprovalCard`，没有题目、选项和答案表单。
- 生成协议已经包含 `item/tool/requestUserInput`、问题及答案结构和 `serverRequest/resolved`，但当前桌面提问是否从这条连接发出尚未验证。Desktop/宿主的异步提问工具也可能使用另一种事件，不能仅按工具名称相似就假定兼容。

实施顺序：

1. 确定当前 Desktop 提问事件的真实来源、目标会话和回复所有权；不启动另一个 app-server 或 turn 代替验证。先用合成数据开发，不为测试自动发起真实选择题。
2. Relay 将问题转换为独立的待答交互对象，通过现有快照/SSE 下发；与隐藏的普通工具日志分开。手机展示“等待你选择”、完整题目、选项说明、允许时的自由输入和明确提交按钮；不把预选项当成已提交。
3. 答案只能回到原请求的所属通道；绑定连接档案、Agent、threadId、turnId、itemId、requestId 和连接代次，不能当作新聊天消息代替协议应答。已配对设备的响应权限须服务端校验。
4. 桌面已作答、turn 结束/中断、请求撤销或过期时，手机同步禁用卡片。重复点击只产生一次应答；结果未知时不自动换通道重发。重连只恢复可由服务端确认仍待答的请求，旧缓存不能恢复可操作状态。
5. 分别验证选择题、自由输入、多问题、切换会话、两端同时作答、断线恢复与过期。普通方案选择与命令/文件/权限审批分别实现；通用 MCP 表单另按各自协议适配。

协议不支持跨客户端接管时，卡片必须显示真实能力和处理入口，不能伪装提交成功。读取落盘问题最多证明“看见”，并不能证明该问题仍待答或可以从另一条 socket 回复。

生产版本完成适配前的会话约定：新的普通方案选择直接写入聊天正文，提供编号选项，让用户从手机回复编号或文字。已经挂起的结构化面板不能保证由普通聊天回复解除；系统授权仍遵循实际权限入口。此约定无需升级 APK；当前新增卡片源码的实施状态见下方 P1 记录。

P0/P1/P2、P3的OpenCode及Claude原请求控制/问答/审批源码与隔离验证已实施；接下来准备统一联测和升级包，满足宿主版本条件后再核验插件实际安装、原会话及Android远程行为。长期连接实测继续按用户要求暂缓。

## P0 实现

- `apps/relay/src/codex/localAppServerClient.ts`：直接通过 Unix socket 完成 HTTP Upgrade 和 WebSocket JSON-RPC。只公开连接、加载会话摘要和停止，不提供任意 RPC 或消息写入。
- `apps/relay/src/agents/agentGateway.ts`：`AgentAdapter` 与 `AgentGateway`，首个适配器为 Codex。构造和状态查询不建立连接，不启动子进程。
- `apps/relay/src/server/createRelayServer.ts`：复用现有鉴权和服务生命周期，提供状态与管理员探测 API。
- `apps/relay/src/smoke/agentGatewayProbe.ts`：显式人工只读检查，退出时关闭自己的连接。

默认 socket 为 `$CODEX_HOME/app-server-control/app-server-control.sock`，未设置 `CODEX_HOME` 时使用 `~/.codex`。这只是当前安装版本验证过的服务发现位置，跨版本仍须检测兼容性。

[OpenAI 官方 App Server 文档](https://developers.openai.com/codex/app-server/) 规定 Unix socket 传输也是 WebSocket；stdio 才使用 JSONL。`app-server proxy --sock` 转发原始字节，不会将 JSONL 自动转换为 WebSocket。最初按 JSONL 编写的探测超时，已修正并改用真实 WebSocket 隔离服务验证。官方同时将 app-server 命令及 WebSocket 传输标记为实验性，不能据此承诺长期生产兼容。

## API 与状态解释

| 请求 | 权限 | 行为 |
| --- | --- | --- |
| `GET /api/agents` | 管理员或有效配对设备 | 返回 `{ agents: AgentStatus[] }`；不触发连接 |
| `POST /api/agents/:id/probe` | 仅管理员 | 按需连接并读取一页已加载会话摘要；返回 `{ agent: AgentStatus }` |

请求复用 `Authorization: Bearer <token>`。Agent ID 由服务端注册，P0 仅有 `codex`。请求体无需字段，最大 4096 字节。协议探测失败仍返回 HTTP 200 和 `state=failed`，身份/参数/未知 Agent 则走现有 HTTP 错误处理。

`AgentStatus` 包含 `id`、`label`、`state`、`transport`、`usesAccessibility`、`sameDesktopThreadVerified`、`capabilities`、`loadedSessions`、`checkedAt` 和 `errorCode`。

- `state`：`unprobed`、`probing`、`connected`、`failed`。`checkedAt` 是最近探测完成时间，不是长期运行证明。
- `transport=local-app-server-socket`、`usesAccessibility=false` 仅描述这个新诊断适配器。
- `loadedSessions={count, hasMore}` 是一页最多 100 个已加载会话的摘要，不是磁盘历史总量；API 不返回会话 ID、正文或游标内容。
- `sameDesktopThreadVerified=false`；发送、追加、中断和审批能力始终为 false。连接成功后仅 `inspectLoadedSessions=true`。

并发探测合并为同一工作；握手及每次 RPC 默认各有 8 秒截止，最多 16 个在途 RPC。WebSocket 消息累计上限 4 MiB，禁用压缩；错误、二进制、非法 UTF-8 或超限消息关闭连接，只返回稳定错误码。收到服务器审批请求时不自动回复。

连接建立后每 15 秒 ping；下一周期仍未收到 pong 则标记失败并关闭自己的连接，正常约两周期发现失活。这不是会话轮询。断线后由下一次显式探测重连，不自动重放请求。停止服务清理 pending、截止计时器、心跳与连接，不向既有 daemon 发送 shutdown。

## 验证方式与本机证据

```bash
# 完全隔离；临时 Unix socket、合成 HTTP/WebSocket，不启动 Codex
corepack pnpm test:gateway

# 人工集成检查；连接本机服务，仅 initialize / initialized / thread/loaded/list
corepack pnpm probe:gateway
```

不要把第二条命令加入默认单元测试或无人值守探测。客户端既不调用 `thread/start` / `thread/resume` / `turn/start`，也不输出服务端错误原文或会话标识。

2026-10-20，本机安装的 `codex-cli 0.163.0-alpha.10.2` 所提供的既有 socket 完成了正式只读探测：`state=connected`、`loadedSessions={count:0,hasMore:false}`、`sameDesktopThreadVerified=false`。未提交消息、启动 turn、接管审批或修改系统权限。原始安全摘要保存在被忽略的 `output/audit/2026-10-20/gateway-readonly-probe.json`。

该结果尚未证明当前 Desktop 会话属于这个服务。P1 先核对服务所有权与桌面会话的关联，再单独安排真实控制验收；不能新建另一个会话后宣称控制成功。长期连接、睡眠唤醒和手机网络切换仍待独立实测，用户当前要求暂不开长期测试。

## 版本基线与恢复

开发前基线：`codex-to-phone-v1.2.2`，提交 `12c9f15616bf0c5622f0bd77f990ab8625c8f3c6`。功能与更新说明见根目录 `CHANGELOG.md`。备份包含源码、Git bundle、当时的 APK / App / dist 和必要本地配置，恢复细节以备份目录中的 README 为准；凭证和运行产物不上传 GitHub。

P0 未替换运行中的输入通道。回退本轮研究只需停止诊断连接、使用已发布基线构建；恢复运行包前须停止相应服务并按运维说明验证。不要在恢复前覆盖当前配置或删除工作区其他修改。

## P1 源码实施：手机提问卡片

2026-10-20 已实现，未部署。新增入口：

- Desktop `POST /api/desktop/threads/:id/user-inputs/:inputId/respond`，正文 `{answers:{questionId:[answer]}}`。
- Relay 自建 turn `POST /api/live/turns/:turnId/user-inputs/:inputId/respond`，正文额外包含 `threadId`。
- 快照/SSE 的 `userInputs` 与审批 `approvals` 分开；Desktop 额外提供 `interactionsAvailable`。不支持新版 IPC 的服务继续同步普通消息，不生成可操作提问。

手机支持题目、选项说明、多问题、允许时的文字回答、显式提交、等待回答/确认状态和秘密输入遮挡。表单不预选，不复用普通聊天草稿，不持久化题目/表单答案；缓存过滤原生问题回复封装及 userInputResponse。新题抵达时优先显示题头，阅读历史时保留阅读位置。

原生 Desktop 订阅以当前 SSE 消费者为引用计数，只跟随选中的本机会话；新路径为 `CODEX_HOME/ipc/ipc.sock`，保留旧路径兼容。owner discovery v1 → 定向 following v1 → snapshot/patches v11。拒绝其他 owner/host、旧版本和错序 patch；断线/owner 消失立即清除待答令牌，活跃订阅按 1–30 秒退避重新发现，必须取得完整快照才能再操作。最后一个消费者离开时取消原生订阅。

同步题根据原始 requestId 定向调用 `thread-follower-submit-user-input`。宿主异步题由活动 turn 的 `agentMessage.questions` 生成，题目 ID 保留 `JSON.stringify(["request_user_input_async",itemId,index])`；特殊 reply 封装通过原 owner 的 `thread-follower-steer-turn` 提交，不回退新 turn。仅 accepted 的 steering 回复使异步题失效；canonical history 按 islands 顺序投影。

每个表单持有当前连接中生成的随机令牌。提交前校验线程、待答状态、完整问题集合、选项/文字权限，并同步锁定，重复请求返回 409。IPC ACK 只能证明请求已传输；等待后续权威状态移除问题才返回 resolved（表示不再待答，也可能是桌面处理或任务结束，不能单凭此证明本次答案被采纳）。无状态确认则 submitted，超时/断线/不确定回包则 uncertain；两者都禁止自动重放。宿主 steer 接口没有 expectedTurnId 原子条件，Relay 使用最新原会话状态校验和题目 ID 绑定，并保留此并发边界，需实测原会话接受情况。

2026-10-21补齐同进程内的重连保护：已发送的原题按线程/完整签名保留最多128项未确认记录，不保存答案。断线、patch缺口或重新进入会话不会让同一原题恢复可提交；权威移除或内容变化才释放记录，容量满拒绝新写入。新增6项回归，问答27/27、后端207/207及两端类型检查通过。最新真实只读核验能发现owner但未收到选定会话快照，尚不能确认当前宿主问答可用；先解决订阅，再安排真实应答验收，详见[本轮记录](audits/2026-10-21/codex-question-reconnect.md)。

隔离验证命令：`corepack pnpm test:user-input`。合成原生 Unix socket + 真实 HTTP/SSE + 配对设备鉴权覆盖请求路由、两端同步、重复发送、过期、错序与断线；测试不连接真实 Codex、不调用模型。人工只读原生快照另存 `output/audit/2026-10-20/desktop-native-stream-shape.json`，提交消息数为 0。

当前尚未执行真实手机应答、真实 Desktop 控制验收、APK 发布或服务升级；生产 v1.2.2 不会自动获得本次功能。普通同会话控制的后续源码进展见下节；原生读取成功不能据此撤掉两个 Mac App 的现有权限。

最新补充：先前未收到快照的问题已定位为16MiB原始帧限制；修复为64MiB有界、一次分配接收后，当前真实只读成功取得v11原会话快照（约620ms、120条消息），不需更改协议版本或owner路由。合并后端210/210、两端类型检查及独立插件构建通过；真实提问提交仍待验收，见[长会话记录](audits/2026-10-21/codex-large-snapshot.md)。

## P1 源码实施：普通原会话控制

已新增 `desktopNativeControl.ts`，将旧start/steer/interrupt参数更换为当前宿主契约，并补齐异步题回复的restoreMessage。新通道为按原owner定向的原生IPC；macOS生产默认仍走旧UI输入，开发环境显式设置 `MOBILE_CODEX_DESKTOP_TRANSPORT=native` 才选择新通道。未切换线上配置，不重建或改签App。

手机使用当前选定会话的 `snapshot.control`，包含连接代次token、任务ID、收发/中断能力及最近回执。原生消息POST在原正文之外带 `clientMessageId`、`controlToken`、`expectedTurnId`（空闲显式null）；中断也带幂等ID、token和非空任务ID。接口沿用原路径及配对鉴权。不同的前台会话不会使已订阅会话误判为不可控。

每线程预留一次操作，未知/待确认状态阻止用新ID重发。新start使用v2 request/context，steer使用v1完整上下文，中断使用v4 user-stop和原任务guard，不扩大为整个goal的暂停。只凭ACK分别显示“提交结果待确认”或“打断结果待确认”，后续权威历史确认才解除。自然完成不显示成“已打断”，HTTP回包不强行重新点亮或停止工作状态。断线失效控制能力，重连重新核验；没有重放或更换输入方法的fallback。

合成测试19项严格检查实际请求结构，合并后端104/104；手机状态24/24、消息回归与两端typecheck/build通过。证据：`output/audit/2026-10-20/native-control-regression.tap`、`native-control-mobile.tap`。真实Desktop发送、追加、中断和Android仍待统一验收；宿主start/steer没有原子的任务guard，当前保护不能消除宿主侧竞态。P0适配器写能力继续false。

## P1 源码实施：Desktop 审批（2026-10-21）

`desktopApprovals.ts` 解码原会话活动任务的命令、文件和权限审批，通过已有 Desktop SSE 的 `approvals` 下发。每张卡片包含 `source=desktop`、threadId、turnId、随机 id、操作内容、目录、理由、文件差异或权限范围，以及原请求真正可用的简单决定；不对手机公开原 requestId。

- `POST /api/desktop/threads/:id/approvals/:approvalId/respond`，正文严格为 `{decision:"accept"|"acceptForSession"|"decline"|"cancel"}`，沿用设备/管理员鉴权。手机不能提交任意权限对象。
- Relay 将决定定向到当前原 owner 的三种 v1 follower 方法；命令/文件沿用原 requestId，权限响应仅复制原请求的已核验权限，scope 按当前任务或会话选择。拒绝和取消均返回空权限。
- 请求签名和文件差异变化会替换卡片令牌；任务终态、断线、owner消失、patch缺口或取消订阅废止旧令牌。提交在首个 await 前锁定，同一请求只发送一次。
- ACK 仅为 submitted；权威请求消失为 resolved（已处理或失效，不能证明本次选择被采纳）。超时/坏响应/断线为 uncertain；不自动重放。重订阅同一未确认请求仍锁定，最多保留128项未确认操作；服务重启不保证跨进程幂等。宿主方法只有 requestId，没有原子签名条件，因此仍存在请求在宿主执行前变化的竞态边界。
- 显式空/仅复杂策略选项不能回退成通用允许按钮；未知权限、未知参数或缺少完整操作内容时只保留真正支持的拒绝/取消选项，允许操作提示在电脑处理。大于展示预算的内容不截断后允许。

手机复用审批卡片，默认展开操作详情，显示提交中/等待同步/结果待确认并禁用重复按钮。Desktop 与 Relay 分路由；断流清除 Desktop 卡片，重连只用新快照恢复。迟到 HTTP 只更新原卡片，不能恢复失效卡片或改写任务运行状态。卡片和令牌不进持久缓存。

验证：新增审批24项，合并后端128/128；手机状态28/28、消息回归、两端typecheck/build通过。360/390/430px浏览器检查包括目录/差异/权限范围、44px按钮、ACK锁定、刷新后恢复、桌面处理后移除、复杂策略无允许按钮和断流清卡片。Mobile JS 300.25kB / gzip95.98kB，无新增运行依赖。证据在 `output/audit/2026-10-21/desktop-approvals-{regression,mobile}.tap` 与 `output/ui-review/2026-10-21/desktop-approvals-checks.md`。

本轮未提交/部署/重建Mac App或发布APK，未真实批准任何请求，未开启长期测试。生产APK仍为1.2.2/versionCode18；P2插件入口与单实例网关、P3其他Agent及统一真机验收尚未完成。


## P2 源码实施：插件与单实例后台网关

2026-10-21新增[插件开发预览](../plugins/mobile-codex/README.md)。`corepack pnpm build:plugin`生成`dist-plugin/mobile-codex/`及本地marketplace。插件根`plugin.json`按官方portable schema验证，技能只调用附带CLI，加载无副作用；未向用户Codex配置实际安装。

CLI命令为init/start/status/stop/pair/devices/revoke。新配置独立于旧App，0600原子创建；显式导入保留旧token/端口/公网配置，workspace需传原工程绝对路径，以保留设备哈希。只监听127.0.0.1；一个Node进程复用Relay+Tunnel，端口bind成功后才连Broker，旧/未知服务占用时不启动、不自动停止旧进程。详情与命令见插件README和Trellis的managed-gateway-contract。

新增被动`GET /api/gateway`供管理员/设备查看，不访问Codex会话；停止接口需要管理员、loopback、独立管理密钥与当前instanceId。CLI管理请求不共享HTTP连接池、不跟随重定向，1.5秒/64KiB边界；启动/停止只轮询被动状态，未知回包不重发写入。pair在公网Tunnel已连接后生成五分钟一次性JSON；手机配对界面新增插件指引与按需能力展示，旧服务404兼容，切连接清旧结果。

隔离结果：新增网关10/10，最终合并后端138/138；手机状态28/28、消息回归、两端typecheck/build、独立插件构建通过。插件bundle约1.10MB，手机JS302.72kB/gzip96.88kB，无新增运行依赖（显式声明已有esbuild版本为构建依赖）。四个CLI并发start仅一个实例和Broker连接；临时目录包通过配对、消费、撤销、stop，迁移后原设备凭证仍有效。状态探测没有访问Desktop socket或真实会话。

浏览器360/390/430px、浅深主题、150%字体/44px按钮、旧服务提示、503错误及切换连接清结果通过。证据为`output/audit/2026-10-21/gateway-plugin-regression.tap`、`managed-gateway.tap`、`gateway-plugin-mobile.tap`及`output/ui-review/2026-10-21/gateway-plugin-checks.md`。实际Codex安装、生产迁移、Desktop真实控制和Android仍未验收；未发APK、部署、改签或改权限，暂不开长期测试。本阶段不提供系统自启动。P3及统一真实验收仍待完成，整体任务保持in_progress。

## P3 源码实施：OpenCode

2026-10-21完成首个其他Agent接入，随后按本机安装版修正为OpenCode v2.0.16（commit `3a103fe0aff726a4edc7492f03f7b88195d9e4c9`）的protocol OpenAPI与服务源码。原1.19.3候选未发布，当前仅支持2.0.16，按/api/info核验，不猜测旧协议回退。研究结论见[任务研究](../.trellis/tasks/10-20-agent-gateway/research-opencode.md)，执行契约见[OpenCode规范](../.trellis/spec/relay/backend/opencode-contract.md)。尚未连接真实OpenCode服务或运行模型。

私有网关JSON可增加`opencode`对象，见[插件配置](../plugins/mobile-codex/README.md)。只有明确配置的现有本机服务才注册此Agent；不启动Agent、不创建、fork或resume会话。手机顶栏“切换Agent”进入独立工作区，浏览配置目录内的现有会话、搜索与历史，切换时释放原工作区订阅。关闭最后一个观察者时停止上游SSE；普通状态GET不会触发连接。

Relay复用设备鉴权、撤销、SSE配额和快照增量，新增：

| 路由（前缀`/api/agents/:agentId`） | 行为 |
| --- | --- |
| `GET /sessions?search&cursor` | 目录范围内分页 |
| `GET /sessions/:sessionId/history?cursor` | 读取较早消息 |
| `POST /sessions/:sessionId/stream-token`、`GET .../events` | 绑定设备、Agent、会话的订阅，事件`agent-session` |
| `POST /sessions/:sessionId/messages` | `{clientMessageId,controlToken,text,delivery:"steer"\|"queue"}` |
| `POST /sessions/:sessionId/interrupt` | `{clientMessageId,controlToken}` |
| `POST /sessions/:sessionId/questions/:id/respond` | 加`answers:string[][]`，按原问题顺序 |
| `POST /sessions/:sessionId/permissions/:id/respond` | 加`decision:"once"\|"always"\|"reject"` |

控制依据当前订阅的随机token、已核验目录与连接代次；问题/审批令牌绑定包括内部来源和额外字段在内的请求签名。提交前重读请求和会话位置，防重复提交；断流清卡片与控制能力，重连重新核验。结果未知跨订阅锁定、不会重放；保护只保证当前网关进程，不能承诺跨重启恰好一次。消息HTTP或匹配inbox.enqueued事件只证明接收，不表示任务完成；interrupt返回JSON，false明确表示空闲no-op，true仍等待空闲证据，宿主无原子的expectedTurnId。

实际文字流直接合并session.text.started/delta/ended，按text自身ordinal定位，40ms批量下发；不靠打字动画或每token重读REST模拟实时。中途加入但没收到段首时标注暂缺前文，段结束以全文校正。私有reasoning/tool-input的delta只更新思考/执行状态，不传递原文、不触发逐字查询。问答取原form，仅完整映射kind=question的string/multiselect、按原字段key与选项value提交answer对象；隐藏/条件/外部认证等复杂表单在手机显示原因并禁用，不能丢字段代答。审批完整展示本次范围和保存规则；明细过长或范围为空仅保留拒绝。卡片、令牌与答案不持久化；有界普通草稿按连接/Agent/会话隔离。权威确认只清理已提交且未被改写的草稿，迟到HTTP不会删除新输入。

最终后端合并163/163（原138+OpenCode25），手机35/35、消息回归、两端typecheck/build、独立插件构建通过。手机主JS304.50kB/gzip97.62kB，独立懒加载Agent块16.60kB/gzip6.39kB，无新增运行依赖。隔离HTTP/SSE覆盖真实delta、去重/段末补齐、提交/未知结果、目录/完整签名、鉴权/撤销/幂等及资源释放。浏览器360/390/430、浅深色、150%字体和44px按钮通过；问答/审批、历史、追加/排队/中断、断流/恢复、订阅切换和草稿保留通过。证据在`output/audit/2026-10-21/p3-opencode-*`及`output/ui-review/2026-10-21/opencode-*`。

以上为源码和隔离验收，未安装插件、替换生产服务、发APK或改变Mac权限；生产仍1.2.2/versionCode18。Claude Code、真实Desktop与OpenCode控制、Android远程实测及统一打包仍待完成。长期测试暂不开启。

## P3 Claude 基础接入（2026-10-21，预览源码）

独立`plugins/mobile-claude/`使用官方Mods模块，在加载它的原进程内登记会话，复用一个网关、设备鉴权和手机Agent工作区。接入`$.prompt.submit`排队、精确turnId中断、可见`turn.step`文本和工作生命周期。无新增运行依赖或模型/Node/MCP子进程；未订阅不读取正文，订阅后有界保留最近80条。不是SDK恢复或另开会话。

参考固定的官方`claude-code.d.ts`（bf2323b3021c9d3db7a31e1e7d61068c3f704497，生成于2.1.277）及当日官方入口文档。官方入门文档要求2.1.287或以后，模块与网关只接受2.1.x且patch>=287；类型声明的生成版本与宿主下限分别记录。**本机CLI2.1.220的隔离manifest校验拒绝modules入口，未升级或加载；兼容宿主校验和真实运行仍待完成**。静态对照固定声明通过不等同于宿主加载成功。未加载插件、热重载中已有任务及已退出历史不保证可接管。

桥接用独立私有密钥，禁止复用管理员/管理密钥；仅loopback和无Origin请求通过。命令单个20秒长轮询、45秒租期，取出后不重发；30秒未确认分为未取出可恢复与已取出未知锁定。中断只按原任务aborted终态确认。共享API按adapter校验session ID，不放宽OpenCode的ses边界。拒绝/过期带操作ID，迟到HTTP不能复活等待状态；草稿保留。

基础切片最初关闭问答/审批，后续原请求交互切片已补齐源码和合成验收，见下节。即时追加或完整历史能力仍关闭。插件配置、人工安装条件及HTTP不能由模块直接取消的限制，见`plugins/mobile-claude/README.md`与`.trellis/spec/relay/backend/claude-contract.md`。

验证：新增Claude16项，合并后端**179/179**；手机**37/37**、消息回归、两端类型检查/构建、独立两插件包与固定声明检查通过。主JS仍**304.50kB/gzip97.62kB**，Agent懒加载**17.58kB/gzip6.78kB**。浏览器360/390/430、深浅色、150%字体、44px按钮、queue/工作态/中断终态及partial提示已检查。证据`output/audit/2026-10-21/p3-claude-*.{tap,log}`和`output/ui-review/2026-10-21/claude-*`。

生产仍1.2.2/versionCode18；以上数字为基础切片的历史记录，最终交互切片结果见下节。任务保持in_progress。

## P3 Claude 原请求问答与单次审批（2026-10-21）

宿主登记`interactions:1`后，通过`classic.PreToolUse`传递已识别的AskUserQuestion。手机支持单选、多选、自由回答和多题一次提交，预览按纯文本展示；回传保留原questions/metadata，仅增加answers到updatedInput，由原工具生成结果，不伪造工具结果。原有hooks决定优先，未识别结构留在宿主处理。

`classic.PermissionRequest`仅支持Bash/PowerShell/Read/Write/Edit/NotebookEdit；手机完整显示cwd和JSON参数，只提供允许一次/拒绝，不保存规则、不改权限模式。没有手机、参数超限或未知工具时保留宿主流程。不能把该接口说成所有桌面面板都可同时点击；真实宿主的取消、两端先答、网络挂起和hook预算行为仍待验收。

新增独立鉴权的`interaction`及`interaction/close`本机端点，答案通过20秒HTTP长轮询交回原hook；请求绑定原任务/代次、随机ID、单调serial和完整签名。手机先提交锁定，取消先到保留墓碑，回收关闭记录后旧请求不能复活。每activation最多16个活动/128个已知请求，五分钟过期；任务结束、失联、最后手机订阅离开和关闭网关会清题目/答案正文并唤醒等待。普通queue未知锁不阻塞原任务问答；已答不等于工具完成。

最终合并后端**194/194**（Claude31）、手机**37/37**、消息回归、两端typecheck/build、两插件独立包与固定声明检查通过。主JS**304.50kB/gzip97.62kB**、Agent懒加载**17.71kB/gzip6.82kB**、CSS**41.23kB/gzip8.20kB**，无新增运行依赖。浏览器360/390/430px、浅深色、150%根字号、44px按钮通过；双题多选+自填只提交一次，单次允许/拒绝、断流清卡片、重开核验及OpenCode动态名称复核通过。证据`output/audit/2026-10-21/p3-claude-interactions-*`与`output/ui-review/2026-10-21/claude-interactions-*`。

下一步按[统一验收顺序](test-and-acceptance-plan.md)准备候选包，再在兼容宿主上验证原会话问答/控制/审批，最后做Android公网、键盘/前后台/切网验收。生产仍1.2.2/versionCode18；本轮没有安装、部署、发APK、提交、真实模型/审批或长期测试，不能移除现有两个App权限。

## 本地候选包（2026-10-21）

已生成1.3.0-agent-gateway-preview/versionCode19 APK、两个插件的ZIP和仅兼容原生19的热更新HTML。APK签名/应用ID/权限/双更新源与18一致，4个dist文件全匹配；真实覆盖安装与配对保留尚未验收。修复热更新仅内联主文件而遗漏Agent懒加载块的问题，合成单HTML运行与构建回归通过。候选目录、hash及检查见[交付记录](audits/2026-10-21/agent-gateway-candidate.md)。

当前PATH的OpenCode为2.0.16，固定主源与合成契约复核已完成，见下节；Claude仍2.1.220，低于Mods开发契约。PATH Codex0.160.1不替代Desktop内部版本。生产仍18、未安装/部署/真实模型或审批/提交，长期测试暂缓；继续宿主兼容复核和统一真实验收，不标记整个任务完成。

## OpenCode 2.0.16 契约复核与候选重建（2026-10-21）

按固定官方tag修正info版本门、顶层text与inbox回执、200 JSON中断/no-op、permission.decision、原form字段和值、session.*事件及text独立ordinal。未知版本不提供控制，复杂表单保留手机不可操作说明。提交前完整签名/目录/代次核验和不确定结果不重放保持。

最终后端201/201（OpenCode32）、手机37/37及消息回归、两端类型/构建、独立插件包通过。新增7项覆盖未核验版本、无标题、交错text ordinal、中断no-op和不可映射表单；原问答、签名、鉴权与资源释放测试切换到真实2.0.16结构。浏览器390px普通双题一次应答、复杂表单说明与禁用提交通过；360/430px无横溢、按钮44px、warn/error为空，资源已清理。证据`output/audit/2026-10-21/opencode-2-*`与`output/ui-review/2026-10-21/opencode-2-*`。

[候选交付](audits/2026-10-21/agent-gateway-candidate.md)已按同一源码重建APK/HTML/插件ZIP并更新hash；只是本地预览，未安装/发布。Claude本机版本仍不满足开发契约，真实宿主和Android待验收；不把固定源码与合成测试当作已接管本机OpenCode。

2026-10-21问答回包复核：同步要求ok=true、异步steer要求原题turnId，额外核对outer method/owner和可选内层method。坏回包保持uncertain及提交锁，同代次权威移除优先，不重放。新增17项后问答44/44、综合后端227/227及两端类型/独立构建通过。只更新插件ZIP，APK/HTML与生产18保持；真实原会话应答及Android仍待验，详见[专项记录](audits/2026-10-21/codex-question-ack.md)。
