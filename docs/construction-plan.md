# 施工路线

## 总体架构

手机浏览器/PWA 连接本机 relay，relay 再连接 **Codex Desktop 已启动的 App Server**。

```text
Phone PWA
  <HTTPS/WSS + token>
Local Relay on Windows
  <stdio proxy or local WebSocket>
Codex Desktop App Server
  <reads/writes>
~/.codex state + project workspaces
```

## Desktop-first 原则

用户主要在 Codex Desktop 工作，所以本项目必须优先复用 Desktop 正在使用的 thread/history/live turn，而不是另开 `codex exec` 或 cc-connect 会话。

Codex Desktop 是 Electron 客户端，窗口 UI 本身不是合适的扩展面；真正值得接的是它背后的 App Server / 协议层。直接改 Desktop 或注入 UI 的维护成本高，也容易被版本更新破坏。

## 阶段 0：协议探测

目标：确认能从当前电脑读取 **Codex Desktop 中可见的线程**。

已确认：

- 本机可用 `codex` 命令版本：`codex-cli 0.128.0`。这里的作用是协议/调试工具，不是目标工作入口。
- Desktop 进程存在：`Codex.exe`
- Desktop 后端进程存在：`codex.exe app-server --analytics-default-enabled`
- 已生成协议类型到 `generated-protocol`

待验证：

- relay 通过 `codex app-server proxy` 或 Desktop app-server 控制 socket 连接正在运行的 Desktop app-server。
- 调用 `thread/list` 能返回 Desktop 中可见的 threads。
- 调用 `thread/read includeTurns=true` 能返回历史消息。

成功标准：

- 命令行脚本能打印最近 10 条 thread 标题、cwd、更新时间。
- 指定 threadId 后能打印 turns。

## 阶段 1：本机只读 Web

目标：手机同局域网或 Tailscale 下能看见 Codex 会话。

功能：

- relay 提供 `/api/threads`
- relay 提供 `/api/threads/:id`
- mobile web 显示 thread 列表
- mobile web 显示消息历史

技术选择：

- Node.js + TypeScript
- Fastify 或 Hono 做 relay HTTP/WSS
- Vite + React 做 PWA

成功标准：

- 手机上打开 PWA，可以看到 Desktop 中同一批 Codex threads。这个是硬门槛，不能只看到单独 CLI 会话。
- 不需要打开远程桌面。

## 阶段 2：继续对话

目标：手机能在已有 thread 里发消息并看流式输出。

接口：

- `thread/resume`
- `turn/start`
- `turn/interrupt`
- `thread/unsubscribe`

成功标准：

- 手机上输入 prompt 后，本机 Codex 执行。
- 手机能看到 agent message delta、tool event、turn completed。
- Desktop 后续能看到同一 thread 的更新。

如果 Desktop 不能看到手机端更新，这一阶段不算完成。

## 阶段 3：审批能力

目标：手机能安全处理命令和文件修改审批。

需要处理的 server request 类型：

- command execution approval
- file change approval
- permissions request
- MCP elicitation request

策略：

- 默认只允许 `workspace-write` 类权限。
- 手机端审批页面必须显示命令、cwd、风险提示、文件 diff。
- 危险操作需要二次确认。
- 不提供一键永久 yolo。

成功标准：

- Codex 请求 shell/file approval 时，手机收到弹窗。
- 手机 approve / deny 后，Codex turn 正常继续。

## 阶段 4：远程安全部署

目标：离家/离办公室也能用。

推荐：

- Tailscale 组网，relay 只监听 Tailscale IP。
- relay 自己再加登录 token。
- token 存 `.env`，不进 Git。

不推荐：

- 直接把 `codex app-server` 或 relay 暴露到公网。
- 用弱口令。
- 默认开启 `danger-full-access`。

## 阶段 5：体验增强

可选功能：

- PWA push 通知：turn 完成、需要审批、出错。
- 常用项目快捷入口。
- 文件 diff 专用视图。
- 语音输入转文本。
- 图片附件上传。
- thread 搜索与收藏。
- 任务模板。
