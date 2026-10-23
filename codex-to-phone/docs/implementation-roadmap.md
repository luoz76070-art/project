# 施工路线图

更新时间：2026-10-21

最新[固定网关兼容更新](audits/2026-10-21/agent-compat-runtime-upgrade.md)已按既有切换授权上线：私有备份、原instance正常停止与单实例新版本、公网/本地鉴权和原生IPC检查通过。真实手机v1协议17.34秒、1完整/3增量/1心跳，当前手机解码器无序列缺口，样本正文较同等全量估算减少74.3%。未安装宿主插件或启用后台托管；APK21及三个更新清单未改，Android和用户测试原会话仍待验收。下文“固定网关保持原值”为相应历史阶段记录。

当前：审核A–D及插件网关P0–P3已完成源码与隔离验证，新增DeepSeek与消息去重后综合后端248/248、手机42/42。独立预览已发布1.3.0/code21，Mac候选网关已备份升级，正式更新仍1.2.2/code18。UI已按Codex手机版真实参考完成本轮对齐；手机原请求应答、实际插件安装及Android仍待真实验收，当前交接见[专项记录](audits/2026-10-21/deepseek-dedup.md)。以下Phase A–G保留原建设阶段记录；优先级、连接方案及性能验收以[审核计划](audits/2026-10-20/README.md#分阶段实施与验收)为准，UI细则见[交互规范](ui-interaction-spec.md)。

后续官方运行时复核分别完成DeepSeek13项及Claude严格校验/无模型7项，修复两插件各一处真实兼容缺陷并单独本地打包0.1.1。用户原会话/真实provider和Android仍待验收，已发布APK21与固定网关保持原值，详见[DeepSeek记录](audits/2026-10-21/deepseek-official-runtime.md)与[Claude记录](audits/2026-10-21/claude-official-runtime.md)。

后续[OpenCode官方服务复核](audits/2026-10-21/opencode-official-runtime.md)完成12项临时数据库/simulation检查，修复会话与消息分页的显式null游标兼容缺陷；OpenCode34/34及三Agent合并87/87通过，独立本地候选已打包。用户原会话、真实provider、Android及长期验收仍分别待办，当前运行网关不因本地候选生成而更新。

原生单网关另补齐[可选macOS后台托管](audits/2026-10-21/gateway-service.md)：插件0.2.0、固定程序与显式service命令，26项隔离/独立Node/plutil检查通过。此项承接C阶段的进程监督，当前未注册实际登录项；真实登录、崩溃、唤醒与手机联测仍须完成。

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

- 以 Codex 手机版为主要视觉与交互参考，优化现有手机工作台。
- 连接配置移入设置。
- 实现竖屏抽屉、横屏分屏、白天黑夜主题。
- 先采集可核验的参考画面并记录平台与版本/日期，再对齐线程列表、聊天排版、底部输入栏、运行与连接状态、设置入口。
- 复用现有 React/CSS 和组件，避免引入重型 UI 依赖、持续动画与大面积模糊。

范围：

- `apps/mobile/src/main.tsx`
- `apps/mobile/src/styles.css`
- 必要时拆分 React 组件。

设计与参考采集可和连接修复并行；UI 实施需衔接审核计划的连接作用域、消息状态与缓存边界，避免重复维护状态。优先修复公网流转发和重连，再验收断线、换网及恢复状态下的界面表现。

完成标准：

- 首页是聊天工作台，核心页面有 Codex 手机版真实画面对照，项目特有功能的差异有说明。
- 线程列表和聊天详情为核心区域。
- 设置面板包含 Endpoint、Token、连接诊断。
- 首次打开线程定位最新消息，返回时恢复阅读位置和按连接隔离的草稿。
- 上拉阅读不被新消息打断，接入历史分页后可加载更早消息。
- 主题切换可用。
- 360/390/430 CSS px、横屏、键盘、安全区和字体缩放下可正常阅读与发送。
- 断流、鉴权失败、Desktop 不可控分别提示；按钮按真实能力显示。
- UI 调整后缓存首屏与实时渲染满足审核性能门槛，新增包体有说明。

验证：

- `pnpm --filter @mobile-codex/mobile typecheck`
- `pnpm --filter @mobile-codex/mobile build`
- 浏览器 preview 截图检查。
- APK 构建。
- 与参考基线逐页对照，覆盖浅深主题、长代码、工具输出、历史浏览和断线恢复。
- Android 真机验证键盘、手势、前后台恢复，并记录构建体积与渲染表现。

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

Phase B/C/D0/D1/D2 已有首版实现。2026-10-20 审核后，下一步按以下顺序推进，原有真机验收继续纳入各阶段：

2026-10-21最新进展：手机已确认一次真实输入成功；消息重复修复及DeepSeek官方Harness源码/合成接入完成。APK21独立预览已发布并完整下载校验；Mac已私有备份并切换同源固定网关，本地/公网鉴权、401、Android预检及Desktop IPC健康通过。正式更新仍18，热更新未改。本机无dsh，真实官方加载及Android覆盖安装仍待验收，长期测试暂缓。详见[专项记录](audits/2026-10-21/deepseek-dedup.md)。

历史阶段更新：审核源码优化及网关P0、P1手机提问/原会话控制/三类审批、P2插件管理、P3 OpenCode和Claude控制/原请求问答/单次审批已完成源码与隔离验证。Claude支持原进程Mods登记、最近文本/实时状态、queue和原任务中断；问答不伪造工具结果、审批不保存规则。本机Claude2.1.220不满足当前Mods宿主下限2.1.287（API声明生成于2.1.277），未升级；真实宿主取消/两端先答、插件安装、原会话控制、Android远程仍待验收。详情以[网关计划](agent-gateway.md)为准；以下保留审核阶段的实施次序与真机待办。

- 先修复公网流转发、重连、档案隔离与消息一致性，再减少轮询、全量读取和缓存写入开销。
- 将 Codex 手机版 UI 对照列为独立工作包：参考采集和设计可并行，实施与连接/缓存修复衔接。
- 手机真机安装修复后的 APK，验证 UI、网络切换、前后台恢复、Relay 实时控制和 Desktop 实际支持的控制能力。
- 继续验证 Desktop UI 自动显现手机新建线程的方式；如无稳定入口，保留定位信息和手动打开提示。
