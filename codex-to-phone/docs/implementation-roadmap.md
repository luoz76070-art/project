# 施工路线图

更新时间：2026-05-12

## Phase A：工程档案与可行性固化

目标：

- 建立工程文件档案。
- 明确产品目标、架构边界、UI 方向、验收标准。
- 复测当前 Relay/app-server 基础链路。

完成标准：

- `docs/project-index.md` 存在并作为入口。
- 产品需求、架构可行性、UI 规范、测试验收文档齐全。
- 本地 Relay 基础 API 复测通过。

## Phase B：手机端工作台 UI 重构

目标：

- 把当前诊断页重构成 Codex Desktop-like 工作台。
- 连接配置移入设置。
- 实现竖屏抽屉、横屏分屏、白天黑夜主题。

范围：

- `apps/mobile/src/main.tsx`
- `apps/mobile/src/styles.css`
- 必要时拆分 React 组件。

完成标准：

- 首页是聊天工作台。
- 线程列表和聊天详情为核心区域。
- 设置面板包含 Endpoint、Token、连接诊断。
- 打开线程自动滚动到底部。
- 上拉可看历史。
- 主题切换可用。

验证：

- `pnpm --filter @mobile-codex/mobile typecheck`
- `pnpm --filter @mobile-codex/mobile build`
- 浏览器 preview 截图检查。
- APK 构建。

## Phase C：数据层和线程体验

目标：

- 让线程打开、刷新、滚动、状态恢复稳定。

范围：

- 前端 API client。
- 本地状态管理。
- 每个线程滚动位置缓存。
- 错误状态模型。

完成标准：

- 启动后自动加载最近线程。
- 默认打开最近线程或上次打开线程。
- 线程切换不会丢输入草稿。
- 失败时能重试。

## Phase D：实时事件通道

目标：

- 从“整轮完成后返回”升级为实时输出。
- 先把 Desktop 当前窗口的真实进度做成只读实时观看。
- 再把 Relay/手机发起的 turn 做成可 steer / interrupt 的实时控制。

### Phase D0：Desktop 当前窗口只读实时观看

目标：

- 手机打开“桌面当前窗口”后，能实时看到电脑 Codex 正在写入的消息、工具调用、工具输出和完成状态。

Relay 需要新增：

- `GET /api/desktop/active`：定位最近的 Desktop 来源 thread。
- `GET /api/desktop/threads/:id`：读取完整 thread，并返回 cursor。
- `GET /api/desktop/threads/:id/delta?cursor=`：按 cursor 增量读取 `rollout-*.jsonl`。
- 移动端工具输出截断，避免超长日志卡住 APK。

手机端需要新增：

- “桌面”快捷入口。
- 桌面来源 thread 打开后自动进入实时观看模式。
- 每 1.2 秒增量刷新一次，自动滚动到底部，用户上拉时保留阅读位置。
- 桌面只读 banner：明确当前可看进度，但不能从手机打断 Desktop turn。
- 桌面来源 thread 锁定输入框，避免误把消息发送到隐藏 app-server 会话。

完成标准：

- 电脑 Codex 正在跑任务时，手机能看到该 thread 增量追加。
- Relay 不修改 Codex 安装目录，不写系统环境，不影响 Desktop 正在运行的 turn。
- 手机界面明确区分“桌面实时观看”和“Relay 可控会话”。

当前状态：

- 2026-05-12 已实现 `desktop-session-tail-readonly` 第一版。

### Phase D1：Relay 可控实时会话

目标：

- 手机发起或续写 Relay/app-server 会话后，可以在运行中看到进度、追加引导、打断当前 turn。

已实现：

- Relay 维护长连接 `codex app-server` client。
- `POST /api/live/turns` 启动 turn 后立即返回 `threadId` 和 `turnId`。
- `GET /api/live/turns/:turnId` 返回当前消息、状态、事件数和错误。
- `POST /api/live/turns/:turnId/steer` 调用协议 `turn/steer`。
- `POST /api/live/turns/:turnId/interrupt` 调用协议 `turn/interrupt`。
- 手机端运行中不锁输入框，继续发送会作为 steer 引导当前 turn。
- 手机端运行中显示“打断”按钮。

实测结果：

- 完整完成 smoke：`status=completed`，assistant 回复 `CONTROL_COMPLETE_OK`。
- 引导/打断 smoke：`steerAccepted=true`、`interruptAccepted=true`、最终 `afterInterruptStatus=interrupted`。

阶段边界：

- D1 控制的是 Relay 自己维护的 app-server 会话。
- Desktop 当前窗口仍走 D0 只读观看；不能把 D1 控制冒充为 Desktop 当前窗口控制。

### Phase D1.5：实时推送优化

Relay 需要新增：

- 手机 WebSocket 或 SSE endpoint。
- app-server 长连接管理器，避免每次请求都临时启动/关闭客户端。
- app-server notification 转发：`turn/started`、`item/agentMessage/delta`、`command/exec/outputDelta`、`item/fileChange/patchUpdated`、`turn/completed`、错误事件。
- 订阅当前 thread，并维护每个 thread 的运行态。
- turn/start 后持续推送状态。
- 运行锁：同一 thread 同时只允许一个 active turn；同一 cwd 并发需要提示风险。

手机端需要新增：

- 流式 assistant message。
- 工具输出实时追加。
- turn 状态条。
- 中断按钮。
- 运行中追加指令入口。
- 等待审批/等待用户输入状态卡。
- 线程列表显示运行中、等待审批、失败、完成。

完成标准：

- 手机发送消息后能逐字或分段看到 Codex 输出，不需要轮询。
- 命令输出能实时显示。
- turn completed 后状态正确。
- 中断当前 turn 可用，并沿用 D1 接口。
- 运行中追加指令可用，并沿用 D1 接口。
- 手机切到其他线程再切回来，仍能看到该 thread 的实时状态。

阶段边界：

- Phase D 先保证 Relay/手机发起的 turn 可实时显示、steer、interrupt。
- Desktop UI 正在运行的 turn 是否能被手机实时接管，单独作为 Phase D2 研究项，不能阻塞 Phase D1。

### Phase D2：Desktop 当前窗口控制通道研究与首版接入

目标：

- 找到 Codex Desktop 当前 app-server/control channel，确认是否能外部附加、订阅、steer、interrupt。

验证项：

- 进程命令行与环境变量。
- `app-server-control` socket 是否存在且可连接。
- Desktop Electron 是否有 deep link 或内部 IPC 可打开指定 thread。
- `thread/loaded/list` 是否能看到 Desktop 当前加载线程。
- 手机新建 thread 后能否通过稳定通道让 Desktop 打开该 thread。

完成标准：

- 若能打通：新增“在电脑端打开/定位线程”和“接管桌面运行中 turn”。
- 若不能打通：明确产品口径为“手机与 Desktop 共享持久化会话，但 Desktop 当前 UI 需要刷新/手动定位”。

当前状态：

- 已找到 Desktop Electron IPC：`\\.\pipe\codex-ipc`。
- Relay 已实现 4 字节长度帧 + JSON 的 IPC client，并能完成 `initialize`。
- Relay 已实现 `desktop-ipc-follower-control`：
  - `thread-follower-start-turn`
  - `thread-follower-steer-turn`
  - `thread-follower-interrupt-turn`
- 手机端桌面线程发送、引导、打断已接入 Desktop IPC。
- 本地 health/smoke 已通过；真实忙碌 turn 的手机点击打断/引导仍需真机验收。

## Phase E：审批与开发操作

目标：

- 手机端能处理 Codex 的审批请求。

范围：

- command approval。
- file change approval。
- permissions request。
- MCP elicitation request。

完成标准：

- 手机收到审批弹窗。
- approve / deny 能回写 app-server。
- 危险操作有二次确认。
- 审批结果写入消息流或状态流。

## Phase F：APK 成品化

目标：

- 输出可安装、可复测、可长期迭代的 APK。

范围：

- 构建脚本稳定。
- APK 版本号。
- 图标和启动页。
- 真机安装测试。
- 使用说明。

完成标准：

- `dist-apk/mobile-codex-debug.apk` 是最新可用包。
- APK 签名验证通过。
- 真机完成连接、打开线程、发送消息、查看历史。
- `docs/smoke-tests.md` 有完整记录。

## Phase G：远程访问

目标：

- 离开局域网也能安全使用。

推荐方案：

- Tailscale。
- Relay 监听 Tailscale IP。
- Token 认证。

完成标准：

- 手机走 Tailscale 能访问 Relay。
- 不暴露公网端口。
- 断网、换网、Relay 重启后能恢复。

## 当前下一步

Phase B/C/D0/D1/D2 首版已完成。下一步执行 Phase E/F 真机验收：

- 手机真机安装最新 APK 做 UI、连接、Relay turn 实时控制验证。
- 手机真机验证 Desktop 当前窗口线程发送、运行中引导、打断。
- 继续增强线程体验：滚动位置保存、错误重试、运行状态恢复。
- 继续验证 Desktop UI 自动显现手机新建线程的方式；如无稳定入口，保留定位信息和手动打开提示。
