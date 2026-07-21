# 技术记录

## Desktop-first 说明

本项目不是 cc-connect / `codex exec` 路线。目标是连接 Codex Desktop 自己启动的后端：

```text
codex.exe app-server --analytics-default-enabled
```

`codex` 命令在这里只承担三类作用：

- 查看本机 App Server 能力。
- 生成协议 TypeScript 类型。
- 通过 proxy/control socket 调试连接 Desktop 后端。

不能把“用了 codex 命令调试协议”理解为“把工作迁到 Codex CLI”。

## Codex App Server 能力

本机 `codex app-server --help` 显示：

- 默认 listen：`stdio://`
- 支持：`stdio://`、`unix://`、`ws://IP:PORT`、`off`
- WebSocket 非 loopback listener 支持 auth：
  - `capability-token`
  - `signed-bearer-token`

本机 `codex app-server generate-ts --experimental` 已生成 TypeScript 协议到：

```text
<PROJECT_ROOT>\generated-protocol
```

## 关键协议接口

线程读取：

- `thread/list`
- `thread/read`
- `thread/turns/list`

线程生命周期：

- `thread/start`
- `thread/resume`
- `thread/unsubscribe`
- `thread/archive`
- `thread/fork`

对话控制：

- `turn/start`
- `turn/steer`
- `turn/interrupt`

重要通知：

- `thread/started`
- `thread/statusChanged`
- `turn/started`
- `turn/completed`
- `agentMessageDelta`
- `fileChangePatchUpdated`
- `commandExecOutputDelta`

审批相关：

- command execution approval
- file change approval
- permissions request
- MCP elicitation request

## 已知风险

- App Server WebSocket 仍是 experimental，协议可能随 Codex 更新变化。
- Codex Desktop 当前启动的 app-server 是默认 `stdio://` 模式，没有发现可供第二客户端附加的 TCP 端口。
- 默认 `codex app-server proxy` 控制 socket 在本机失败，不能作为稳定 live 通道。
- 当前落地路径是 relay 受控启动一个 loopback WebSocket app-server，并复用同一 `~/.codex` 历史目录；这不是 `codex exec`，但也不是直接附加到 Desktop 已有 stdio 子进程。
- 审批自动放行必须谨慎。当前手机发送遇到审批请求时先阻断，不代替用户批准命令或文件修改。
- Android APK 访问电脑局域网 HTTP 时，浏览器成功不代表 WebView `fetch` 成功；真机环境应优先使用 Capacitor 原生 HTTP。

## 2026-05-11 初步验证

Desktop 进程确认：

```text
Codex.exe
codex.exe app-server --analytics-default-enabled
```

尝试通过默认 proxy 连接 Desktop app-server：

```text
codex app-server proxy
```

结果：

```text
failed to connect to socket at C:\Users\<YOU>\.codex\app-server-control\app-server-control.sock
套接字操作遇到了一个已死的网络。 (os error 10050)
```

结论：

- 不能先假设 `codex app-server proxy` 已经能接管 Desktop live backend。
- 下一步要找 Desktop 实际控制通道，或研究 Desktop/Electron 如何启动和连接 app-server。
- 目前已确认 Desktop 的会话索引和 prompt history 写入 `~/.codex`，所以“读取桌面端已持久化历史”有基础；但“同步 live turn、审批、实时输出”仍需要接入 Desktop app-server 才算达标。

## 2026-05-12 App Server WS 验证

验证方式：

```powershell
pnpm --filter @mobile-codex/relay appserver:smoke
pnpm --filter @mobile-codex/relay appserver:read-smoke
pnpm --filter @mobile-codex/relay appserver:turn-smoke
```

结果：

- `thread/list` 返回 Codex Desktop 历史线程，`source` 为 `vscode`。
- `thread/read` / `thread/resume` 能读取指定 Desktop 线程的 turns 和 items。
- `thread/start` + `turn/start` 能创建测试线程并收到助手回复。
- 测试线程落盘到 `C:\Users\<YOU>\.codex\sessions\2026\05\12\...jsonl`。

结论：

- 官方 App Server 协议链路可用。
- 这条链路可以支持手机端原生聊天/开发界面。
- 还需要继续补齐：长连接事件推送、手机审批 UI、中断 turn、局域网/Tailscale 安全接入。

## 资料来源

- OpenAI Codex App Server 文档：https://developers.openai.com/codex/app-server
- OpenAI Codex Remote Connections 文档：https://developers.openai.com/codex/remote-connections
- 本机 Codex CLI help：`codex app-server --help`
- 本机协议 schema：`codex app-server generate-json-schema --experimental`
