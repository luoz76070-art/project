# 现有 Agent 网关契约

## 1. 范围与触发

插件化 P0 的只读服务接入。`LocalAppServerClient` 仅持有现有服务的一条连接；不得创建替代 app-server、会话或 turn。本页主体描述 Codex P0；后续 Agent 能力由各自契约限定。

P3已另加可选OpenCode会话适配，见[独立契约](opencode-contract.md)。此页的P0只读能力限制仍适用于Codex control socket，不应因其他Agent可写而开启该socket写能力。AgentGateway.sessions仅返回明确注册的会话适配器；不同Agent不能共用Codex会话ID或控制路由。

Claude适配见 [Claude 契约](claude-contract.md)。`AgentAdapter.sessionApi` 是可选的显式会话接口，网关不按 OpenCode 实例类型推断能力；共享路由调用适配器的 `validSessionId`，OpenCode 保持自身 ses 格式、Claude 保持 UUID 格式。Claude bridge只返回已配置的Claude实例，并使用独立本机鉴权路由；问答/单次审批仅对登记interactions:1的原任务请求开放。queue未知锁不得阻塞当前原任务应答，普通发送/中断仍守未知锁；真实宿主取消/两端先答另验收。

## 2. 签名

- `new LocalAppServerClient({socketPath, timeoutMs?, heartbeatMs?})`，socketPath 必须是绝对路径。
- `connect(): Promise<void>`、`isConnected(): boolean`、`loadedThreadSummary(): Promise<{count:number,hasMore:boolean}>`、`stop(): Promise<void>`。
- `AgentAdapter.snapshot()/probe()/stop()`；`AgentGateway.snapshot()/probe(id)/stop()`。
- `GET /api/agents`、`POST /api/agents/:id/probe`；手工命令 `corepack pnpm probe:gateway`。

## 3. 请求、响应与生命周期

默认服务路径由 config.codexHome 拼接 `app-server-control/app-server-control.sock`。只使用 `net.createConnection({path})` 加 `ws` 的 HTTP Upgrade；不开放 TCP 监听、不运行 CLI proxy、不假定 socket 是 JSONL。

允许的应用消息仅有 `initialize`（`experimentalApi=false`）、`initialized`、`thread/loaded/list({limit:100})`。Zod 校验初始化 `userAgent`、响应信封及加载结果。丢弃会话 ID 和分页游标，仅暴露数量与 hasMore；状态不得含原始错误、路径、审批参数、凭证或正文。

`AgentStatus` 的 Codex P0 写能力和 `sameDesktopThreadVerified` 始终为 false，只有成功探测后 `inspectLoadedSessions=true`。`usesAccessibility=false` 不代表旧 Desktop 输入已免权限。API GET 无连接副作用；POST 仅管理员可调用。状态表示最近一次探测及所持连接状态，不保证桌面当前会话可控。

共享初始化和 probe Promise；最多 16 个 pending RPC，握手和每次 RPC 各默认 8 秒截止；聚合消息上限 4 MiB，禁用压缩，拒绝二进制。连接后每 15 秒 ping，下一周期无 pong 失败；不轮询会话，不自动重连或重放。停止须清理心跳和 pending，禁止旧初始化覆盖新连接；关闭仅操作自己创建的 WebSocket，不 shutdown daemon。

## 4. 校验与错误矩阵

| 场景 | 结果 |
| --- | --- |
| 缺少有效身份 | HTTP 401 |
| 设备凭证 POST 探测 | HTTP 403 `admin_required` |
| Agent 不存在 / 网关已停 | HTTP 404 / 503 |
| 相对 socket 路径 | `CODEX_SOCKET_PATH_REQUIRED` |
| socket 不存在 / 拒绝 Upgrade | `CODEX_SOCKET_CONNECTION_FAILED` |
| 握手或 RPC 静默 | `CODEX_SOCKET_TIMEOUT` |
| 无 pong | `CODEX_SOCKET_UNRESPONSIVE` |
| JSON / schema / UTF-8 / 二进制错误 | `CODEX_SOCKET_PROTOCOL_ERROR` |
| 聚合消息超限 | `CODEX_SOCKET_FRAME_TOO_LARGE` |
| RPC 被拒绝 | `CODEX_SOCKET_RPC_REJECTED`，不透传服务端文本 |
| 在途超限 / 未连接 / 断线 / 停止 | `CODEX_SOCKET_BUSY` / `NOT_CONNECTED` / `DISCONNECTED` / `STOPPED`（均带 `CODEX_SOCKET_` 前缀） |

探测本身失败为 HTTP 200、`agent.state=failed` 和稳定 errorCode；不能让 Fastify 直接输出服务端 RPC 原文。

## 5. 正常、基线和异常

- 正常：GET unprobed → 管理员 probe → WS Upgrade → initialize/initialized → loaded summary → connected。
- 基线：没有 socket 时返回 failed，不启动其他 Codex 服务；旧手机输入路径继续独立工作。
- 异常：停止期间初始化回包不得发布 ready；旧连接事件不能清空新连接 pending；服务器审批请求不得自动批准/拒绝。

## 6. 必需测试

`corepack pnpm test:gateway` 用临时 Unix socket、合成 HTTP/WebSocket。覆盖 UTF-8 跨片、聚合超限、非法 UTF-8、坏帧、握手拒绝/静默、RPC 超时/错误、并发初始化/探测/容量、停止与立即重连、心跳失活、daemon 所有权、状态脱敏、API 鉴权及关闭清理。

既有 correctness/performance/transport/availability 回归保持通过。人工 `probe:gateway` 单独记录，不纳入隔离测试；只能证明服务握手与一页加载摘要，不能替代 Desktop 同会话控制验收。

## 7. 错误与正确方式

- 错误：向 `app-server proxy --sock` stdin 写 JSONL，合成子进程测试通过就认为可连接；正确：UDS 上执行标准 WebSocket 握手，用真正的 WS 服务隔离验证，再单独做只读集成探测。
- 错误：已加载数量 0 或普通握手成功就移除辅助功能；正确：写能力始终关闭，先验证目标 Desktop 会话归属与真实控制。

## Desktop 提问（P1，独立于 P0 control socket）

- 当前宿主原生 IPC 为 CODEX_HOME/ipc/ipc.sock；默认优先存在的新路径，旧路径仅兼容。帧仍是四字节 LE 长度加 JSON。
- 按选定 SSE 会话引用订阅，owner discovery v1、following v1、state v11。owner/host/revision 与连接代次共同决定权威状态；patch 缺口或非法 patch 必须使旧表单失效并重新获取快照，不能把旧状态继续作为可写依据。
- `desktopQuestions.ts` 单一拥有 canonical history、同步题、异步题和答案解码；后端不可用落盘工具文本恢复可操作题。普通审批与问答分开。Relay 自建 turn 同步题使用同一解码器，serverRequest/resolved 才结束待答。
- 对外 userInputs.id 是代次内随机令牌，内部才保留 requestId/owner。POST 校验准确题目集合及自由回答权限；提交加锁在第一个 await 前。不缓存/记录答案，不自动重放。ACK 不等于处理完成；submitted/uncertain 均锁定。
- 异步题以活动 turn 的 agentMessage.questions 为依据；只接受 accepted 的 steeringUserMessage 回答证据。回复必须携带原题目 ID，通过定向 steer 提交，禁止新建 turn 回退。宿主没有 expectedTurnId 条件，原子性边界须记录而不能假称已验证。
- 所有新增单元/集成测试使用临时 socket 和合成服务。真实只读订阅与真实发送验收分开记录。
