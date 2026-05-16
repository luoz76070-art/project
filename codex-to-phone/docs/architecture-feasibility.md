# 架构与可行性

更新时间：2026-05-12

## 结论

这条路线能走通，但要明确边界：

- 已经可落地的是：手机端通过 Windows Relay 实时读取 Codex Desktop 当前会话写入的 `rollout-*.jsonl`，从而在手机上看到电脑 Codex 当前窗口运行进度。
- 对 Relay/手机自己发起的 turn，已通过 loopback `codex app-server` 做到 SSE 推送式实时查看、轮询兜底、interrupt、steer。
- 已经接入首版的是：无侵入地连接 Codex Desktop 的本机 `\\.\pipe\codex-ipc`，调用 Desktop owner/follower IPC 的 `thread-follower-start-turn`、`thread-follower-steer-turn`、`thread-follower-interrupt-turn`。
- 仍需真机和忙碌 turn 验证的是：手机点击后能否稳定打断/引导当前 Desktop UI 正在运行的 turn，以及 Desktop UI 是否在所有线程状态下自动刷新。
- 因此当前架构必须区分三类能力：`desktop-session-tail-readonly` 用于真实桌面窗口实时观看；`desktop-ipc-follower-control` 用于控制 Desktop owner 窗口；`app-server-ws` 用于 Relay 自己维护的可控会话。

这不是 `codex exec` 路线，也不是远程桌面。它是“Codex Desktop 安装包里的 app-server 能力 + 本机 Codex 数据目录 + 手机端原生工作台”。

## 当前架构

```text
Android APK
  React + Capacitor
  Native HTTP / later WebSocket
        |
        | LAN / Tailscale + Bearer Token
        v
Windows Relay
  Fastify + TypeScript
  Auth / API / event bridge
        |                         |                         |
        | read-only tail          | \\.\pipe\codex-ipc       | loopback ws://127.0.0.1:<port>
        v                         v                         v
C:\Users\<YOU>\.codex
  sessions / history      Codex Desktop Electron      Codex app-server
  rollout-*.jsonl         owner/follower IPC          C:\Program Files\WindowsApps\OpenAI.Codex_...\codex.exe
```

## 已实测证据

### 1. Codex 可执行文件

Relay 已能自动发现：

```text
C:\Program Files\WindowsApps\OpenAI.Codex_26.506.3741.0_x64__2p2nqsd0c76g0\app\resources\codex.exe
```

### 2. App Server 协议

已实测：

- `thread/list`
- `thread/read`
- `thread/resume`
- `thread/start`
- `turn/start`

### 3. Relay HTTP API

已实测：

- `GET /health`
- `GET /api/threads`
- `GET /api/threads/:id`
- `GET /api/live/health`
- `GET /api/live/threads`
- `GET /api/live/threads/:id`
- `POST /api/live/messages`
- `GET /api/desktop/active`
- `GET /api/desktop/threads/:id`
- `GET /api/desktop/threads/:id/delta`
- `GET /api/desktop/control/health`
- `POST /api/desktop/control/threads/:id/messages`
- `POST /api/desktop/control/threads/:id/interrupt`
- `GET /api/live/control/health`
- `POST /api/live/turns`
- `GET /api/live/turns/:turnId`
- `POST /api/live/turns/:turnId/steer`
- `POST /api/live/turns/:turnId/interrupt`
- `POST /api/live/turns/:turnId/stream-token`
- `GET /api/live/turns/:turnId/events?streamToken=`
- `POST /api/live/turns/:turnId/approvals/:approvalId/respond`

### 4. Android APK

已实测：

- Capacitor Android 工程可构建。
- APK 可生成到 `dist-apk/mobile-codex-debug.apk`。
- APK v1/v2 签名验证通过。
- Android Manifest 包含 `INTERNET` 权限。
- Capacitor 配置已启用明文开发网络和原生 HTTP。

### 5. 手机网络

已实测：

- 手机浏览器可访问 `http://192.168.6.43:8787/health`。
- APK 之前的 WebView `fetch` 有失败案例。
- 已改为 Capacitor 原生 HTTP，作为真机请求层。

## 当前技术短板

### 0. Desktop 当前窗口控制通道首版已打通

2026-05-12 已验证：

- Codex Desktop 进程结构是 `Codex.exe` 启动内部 `codex.exe app-server --analytics-default-enabled`。
- 没有发现 `codex.exe` 对外监听 TCP 端口。
- `codex app-server proxy` 会尝试连接 `C:\Users\<YOU>\.codex\app-server-control\app-server-control.sock`，但当前机器该目录不存在，实测报 `failed to connect to socket`。
- Desktop 包内存在 owner/follower IPC：`thread-follower-start-turn`、`thread-follower-steer-turn`、`thread-follower-interrupt-turn` 等。
- Desktop 本机命名管道为 `\\.\pipe\codex-ipc`，协议为 4 字节 little-endian 长度帧 + UTF-8 JSON。
- Relay 已能作为外部 IPC client 完成 `initialize`，并通过 `thread-follower-*` 请求让 Desktop 主进程寻找拥有该 `conversationId` 的 renderer。
- Desktop 包内存在 Remote Control/Remote Connections 代码，但当前全局状态 `codexCloudAccess` 为 `disabled`；同时分析到 device-key 模块在该路径中有 macOS-only 限制，需要继续实测 Windows 是否能作为被控端。

结论：

- 手机实时观看桌面当前窗口：已通过 `~/.codex/sessions/**/rollout-*.jsonl` 增量读取落地。
- 手机直接操控桌面当前窗口：已接入 Desktop IPC 首版。它不是修改 Codex 安装目录，也不是注入 UI；它复用 Desktop 自己的 owner/follower 消息机制。
- 关键边界：Desktop renderer 必须拥有目标 conversation；否则会 `no-client-found`。真实 interrupt/steer 当前忙碌 turn 还需要真机点击实测。

### 1. Relay 可控会话已完成 SSE 推送式实时控制

旧 `/api/live/messages` 是等待整轮完成后返回。现在新增的 `/api/live/turns` 已经能启动后立即返回，手机优先通过 SSE 接收 snapshot，失败时回退轮询，且实测 `turn/steer`、`turn/interrupt` 可用。

后续为了体验更接近 Codex Desktop，还需要补：

- 更细粒度的工具状态卡片。
- 审批请求的手机 UI。
- 断线恢复和多设备订阅。

本机生成协议已经确认存在以下能力：

- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `turn/started`
- `turn/completed`
- `item/agentMessage/delta`
- `command/exec/outputDelta`
- `item/commandExecution/outputDelta`
- `item/fileChange/patchUpdated`
- `item/fileChange/outputDelta`

因此，手机实时进度和中断能力对 Relay 自己维护的 app-server 长连接已经落地；当前短板是推送形态和审批，而不是协议缺失。

补充：Desktop 当前窗口的实时观看不依赖 app-server notification，第一版通过 session tail 做只读实时同步。

### 2. 审批链路首版已落地

当前 Relay 已能处理 app-server 发来的 server request，并向 app-server 回写审批结果。已覆盖：

- command execution approval。
- file change approval。
- permissions request。
- 手机端审批 UI。
- approve / deny / cancel 回写 app-server。

已实测：

- `approvalPolicy=on-request`
- `sandbox=read-only`
- Codex 请求执行命令审批。
- Relay 收到 `item/commandExecution/requestApproval`。
- 通过 `/api/live/turns/:turnId/approvals/:approvalId/respond` 返回 `accept`。
- turn 继续执行并完成。

仍需补强：

- 文件修改审批的复杂场景。
- 权限扩大审批的更多返回组合。
- MCP elicitation / tool user input。
- 手机 UI 对高风险命令的更强提示。

### 3. 还缺稳定会话管理

当前 LiveCodex 每次请求启动一个 app-server 客户端。后续应改为：

- Relay 维护 app-server 客户端池或单例长连接。
- 每个手机会话订阅当前 thread。
- 离开线程时 unsubscribe。
- Relay 崩溃或 app-server 退出时自动恢复。

### 4. Desktop UI 同步仍需验证

已确认共用 `~/.codex` 数据可读写。还需要继续验证：

- 手机端新 turn 是否能在 Desktop UI 中及时出现。
- Desktop UI 正在打开同一线程时，是否自动刷新。
- 如果 Desktop 不自动刷新，需要做“数据一致但 UI 需要手动刷新”的产品提示。

2026-05-12 补充判断：

- Relay `thread/list` 当前能看到 `vscode` 来源线程，这是桌面端 Codex 会话。
- 手机端新建/续写后线程会落盘并能被 app-server 列表读取。
- 用户反馈 Desktop UI 找不到手机新建窗口，说明“落盘可读”和“Desktop 当前 UI 自动展示”不是同一个验收标准。
- 产品策略调整为：优先续写桌面端已有线程；手机新建线程必须标识为手机/Relay 发起，并显示 threadId、cwd、source 供定位。
- 后续如果要做到 Desktop UI 当前窗口实时同步，需要继续研究 Desktop 当前 app-server 控制通道，而不是仅依赖 loopback app-server。

关键边界：

- 手机续写桌面端已有 `vscode` thread，数据层能落盘并可被 app-server 读取。
- 手机新建 thread，当前能在 `~/.codex` 和 Relay live 列表中出现，但不保证 Codex Desktop 当前 UI 自动弹出新窗口。
- 手机要实时打断“Relay 自己发起的 turn”，已通过 `turn/interrupt` 实测落地。
- 手机要实时打断“Desktop UI 当前正在运行的 turn”，当前实现路线是 Desktop IPC `thread-follower-interrupt-turn`，已接入 Relay 和手机按钮，仍需真机忙碌 turn 验证。
- 手机端同步策略现在是：实时观看桌面当前 thread 的日志增量，优先通过 Desktop IPC 续写/引导/打断桌面已有 thread；手机独立施工继续使用 Relay app-server。

## 推荐落地方案

### 本地和局域网阶段

- Relay 监听 `0.0.0.0:8787` 或指定局域网 IP。
- 手机 APK 访问 `http://电脑IP:8787`。
- Relay 使用 Bearer Token。
- 只在可信局域网测试。

### 远程阶段

首选：

- Tailscale。
- Relay 只监听 Tailscale IP。
- 仍然保留 Bearer Token。

不推荐：

- 直接公网端口转发。
- 弱 token。
- 裸露 Codex app-server。

## 可行性等级

- 读取 Desktop 历史线程：已验证，可行性高。
- 手机打开线程看历史：已验证基础能力，可行性高。
- 手机发送消息并得到回复：已验证基础能力，可行性高。
- 轮询式实时输出：已验证，可行性高。
- SSE 推送式实时输出：已验证，可行性高。
- 电脑 Desktop 当前窗口实时观看：session tail 已验证，可行性高。
- 手机中断 Relay 发起的 turn：已验证，可行性高。
- 手机追加 steer 到 Relay 发起的 turn：已验证，可行性高。
- 手机审批：命令审批已实测落地，文件/权限审批同通道待更多场景验证，可行性中高。
- 与 Desktop UI 完全同步显示：控制通道已找到，仍需验证 Desktop UI 在不同状态下是否自动刷新，可行性中。
- 中断 Desktop UI 当前正在跑的 turn：Desktop IPC 首版已接入，可行性中到中高，待真机忙碌 turn 验收。
- 做成接近 Codex Desktop 的手机 UI：前端可控，可行性高。

## 架构验收标准

不能只看“接口返回 200”。每阶段必须同时满足：

- Relay 不崩溃。
- Codex 进程可恢复。
- 手机端状态能解释失败原因。
- 不写系统环境。
- 不破坏 Codex 安装和 `~/.codex`。
- 实测结果写入 `docs/smoke-tests.md`。
