# 使用与部署文档

更新时间：2026-05-12

## 目标

本项目由两部分组成：

- Windows 或 macOS 电脑运行 Relay。
- Android 手机安装 APK，通过 Relay 接入 Codex。

手机不直接连接 Codex app-server，也不需要远程桌面。

当前桌面输入通道：

- Windows：通过 Codex Desktop IPC 写入当前 Desktop 拥有的线程。
- macOS：通过 `codex://threads/<threadId>` 聚焦目标线程，再由 `Mobile Codex Input.app` 或 `osascript` 把手机文本粘贴到 Codex 输入框并回车。

## 第一次准备

在项目根目录运行：

```powershell
pnpm install
```

如果要构建 APK，再运行：

```powershell
.\scripts\setup-android-tools.ps1
```

这些工具会尽量放在项目 `.tools` 目录或使用本机已有 Android JDK，不写系统环境变量。

## 配置 Token

推荐新建本地配置文件：

```text
.env.local
```

内容示例：

```text
MOBILE_CODEX_HOST=0.0.0.0
MOBILE_CODEX_PORT=8787
MOBILE_CODEX_TOKEN=change-me
CODEX_HOME=C:\Users\<YOU>\.codex
MOBILE_CODEX_DEFAULT_CWD=<PROJECT_ROOT>
```

如果没有 `.env.local`，`start-relay.bat` 会使用当前开发默认值：

```text
MOBILE_CODEX_HOST=0.0.0.0
MOBILE_CODEX_PORT=8787
MOBILE_CODEX_TOKEN=change-me
```

## 一键启动 Relay

双击项目根目录：

```text
start-relay.bat
```

脚本会：

- 自动切换到项目目录。
- 读取 `.env.local` 或 `.env`。
- 如果缺少 `node_modules`，自动执行 `pnpm install`。
- 如果缺少 Relay build，自动执行 Relay build。
- 打印手机可填写的 Endpoint。
- 设置新建手机线程的默认工作目录。
- 启动 Relay 并保持窗口打开。

手机使用时不要关闭这个窗口。

## macOS 本机 Codex + Android App

在 Mac 上使用源码包时，不需要 `MobileCodexManager.exe`，主路径是 Mac 桌面 App + Android APK。在项目根目录运行：

```bash
corepack pnpm install
corepack pnpm mac:package
```

然后双击：

```text
Mobile Codex Relay.app
```

这个 App 会：

- 自动启动 Relay，默认监听 `0.0.0.0:8787`，方便同一 Wi-Fi 下的 Android 访问。
- 默认使用 `CODEX_HOME=$HOME/.codex`。
- 显示 Android App 可填写的 Endpoint 和 Token。
- 通过固定 Token 配置保持后续启动一致。

如果目标是远程使用，不要填写这个 LAN Endpoint。请使用 [[remote-broker.md]] 里的 Broker 模式：Android Endpoint 填公网 Broker 的 `https://broker.example.com/r/<relayId>`，Mac App 主动连接 Broker。

`corepack pnpm mac:package` 会同时构建 `Mobile Codex Input.app`，用于把手机消息注入到 Codex Desktop 输入框。若 Helper 构建失败，Relay 会回退到 `osascript`。更稳定的方式是安装 Xcode Command Line Tools：

```bash
xcode-select --install
corepack pnpm mac:helper
```

第一次手机向 Mac Codex 发送消息前，需要在 macOS 打开：

```text
系统设置 > 隐私与安全性 > 辅助功能
```

允许：

- `Mobile Codex Input.app`
- 如走回退通道，还可能需要允许当前终端、Node 或 `osascript`

使用步骤：

1. Mac 打开并登录 Codex Desktop。
2. 双击 `Mobile Codex Relay.app`。
3. Android 端安装 `dist-apk/mobile-codex-mac-local-debug.apk`。
4. Android App 设置里填写 Mac App 显示的 Endpoint 和 Token。
5. 点击“桌面”或打开一个 Codex Desktop 来源线程。
6. 手机输入消息并发送。Relay 会先聚焦对应 Codex 线程，再把文本粘贴进 Codex 输入框并回车。
7. 手机端通过 session tail 继续读取该线程的用户输入和 Codex 回复。

Android APK 构建：

```bash
corepack pnpm android:setup:mac
corepack pnpm android:apk:mac -- mac-local
```

产物：

```text
dist-apk/mobile-codex-mac-remote-debug.apk
```

如果暂时没有 APK，可以先用 Android 浏览器验证前端：

```bash
corepack pnpm dev:mobile
```

然后在手机浏览器打开：

```text
http://Mac局域网IP:5178
```

当前边界：

- 这条 macOS 通道要求 Codex Desktop UI 可被系统辅助功能控制。
- 它不是后台 owner 注册，也不修改 Codex Desktop 安装目录。
- 如果目标线程无法通过 `codex://threads/<threadId>` 聚焦，消息可能不会进入预期窗口，Relay 会通过 rollout 校验返回错误。

## 手机端填写

打开 APK 设置面板，填写：

```text
Endpoint: http://电脑局域网IP:8787
Token: MOBILE_CODEX_TOKEN
```

电脑局域网 IP 以 `start-relay.bat` 打印为准，例如：

```text
http://192.168.6.43:8787
```

## 查看电脑 Codex 当前窗口

新版 APK 左侧线程区有“桌面”按钮。

点击后会：

- 询问 Relay 的 `/api/desktop/active`。
- 定位最近的 Codex Desktop 来源线程。
- 打开该线程并进入“实时观看”模式。
- 持续读取 `.codex\sessions\**\rollout-*.jsonl` 的增量内容。

当前这个模式会同时启用两条通道：

- 观看：读取 Desktop 正在写入的 `rollout-*.jsonl` 增量。
- 控制：Windows 通过 Relay 调用 Codex Desktop 的 `\\.\pipe\codex-ipc` owner/follower IPC；macOS 通过可见 UI 注入把文本提交到 Codex 当前线程。

手机端在桌面线程里发送消息时，会先尝试作为当前运行中 turn 的引导；如果 Desktop 判断当前没有运行中的 turn，就启动同一桌面线程的新 turn。点击“打断”会向 Desktop owner 发送 interrupt。

边界：Desktop 必须正在运行。Windows IPC 方式要求当前窗口拥有这个线程，否则可能返回 `no-client-found` 或类似错误；macOS UI 注入方式要求辅助功能授权可用，并且 deep link 能打开目标线程。

性能策略：

- 打开桌面线程默认只加载最近一小段内容，不会把完整历史上下文全部带到手机。
- 当前默认值：文件尾部 `256KB`、最多 `80` 条桌面消息、手机内存最多保留 `140` 条。
- 这样做是为了避免 20MB 以上 rollout 文件导致切换线程卡死。
- 需要翻很早的记录时，后续应做“加载更早记录”按钮，而不是默认全量加载。

## 手机新建或续写 Relay 会话

在非“桌面实时观看”的线程里发送消息，会走 Relay 可控会话。

当前能力：

- 发送后立即进入运行中状态，不再等整轮结束才刷新。
- 手机端优先使用 SSE 推送实时显示 Codex 回复和工具输出；推送不可用时自动切回轮询。
- 运行中继续输入并发送，会作为当前 turn 的引导消息。
- 运行中点击“打断”，会停止当前 turn。

桌面线程和 Relay 会话的差异：

- 桌面线程：使用 Desktop IPC，目标是电脑 Codex 当前窗口。
- 手机/Relay 线程：使用 Relay 自己启动的 app-server，适合手机独立施工、审批和后台运行。

## 连接档案

手机端可以保存多个 Relay 连接档案：

- 在设置里选择连接档案。
- 修改 Endpoint/Token 后点“保存档案”。
- 点新增按钮创建新档案。
- 点删除按钮移除当前档案。

连接档案保存在手机本地，用于在局域网、未来外网网关、不同电脑之间快速切换。

## 运行策略与审批

设置面板里可以调整 Relay 会话的运行策略：

- `直接执行`：默认模式，适合可信局域网内快速开发。
- `需要审批`：Codex 需要执行敏感命令或扩大权限时，手机端会弹出审批卡片。
- `只读`：更保守，适合先观察 Codex 会如何规划。
- `工程写入`：默认沙箱，允许在当前工作区内开发。
- `完整权限`：仅在明确需要时使用。

审批卡片支持：

- 允许一次。
- 本会话允许。
- 拒绝。
- 取消。

命令审批已完成本地实测：Relay 能收到 Codex app-server 的审批请求，手机同款 API 批准后 turn 会继续执行。

## 本地烟测

Relay 启动后，双击：

```text
smoke-local.bat
```

或运行：

```powershell
.\scripts\smoke-local.ps1
```

通过标准：

- `healthOk=true`
- `threadCount` 大于等于 1
- `liveOk=true`
- `liveMode=app-server-ws`
- `liveControlOk=true`
- `desktopMode=desktop-session-tail-readonly`
- `desktopControlOk=true`
- `desktopControlMode=desktop-ipc-follower-control`

## 构建 APK

双击项目根目录：

```text
build-apk.bat
```

或运行：

```powershell
.\scripts\build-debug-apk.ps1
```

输出：

```text
dist-apk\mobile-codex-debug.apk
```

## 换电脑部署

换电脑时需要：

1. 安装 Node.js 和 pnpm。
2. 确认 Codex Desktop 已安装并登录。
3. 复制本项目目录。
4. 在项目根目录运行 `pnpm install`。
5. 新建 `.env.local`，确认 `CODEX_HOME` 指向新电脑用户的 `.codex`。
6. 双击 `start-relay.bat`。
7. 手机填写脚本打印的 Endpoint。

## 当前限制

- 远程外网访问还没有实施，后续优先用 Tailscale。
- Desktop 当前窗口已接入 IPC 控制首版，但仍依赖 Desktop 当前窗口拥有该 thread；忙碌 turn 的真实打断/引导需要手机真机点击验证。
- Relay/手机自己发起的 turn 已支持 SSE 推送式实时输出、轮询兜底、引导和打断。
- 手机审批 UI 已完成首版，命令审批已实测通过；文件/权限审批走同一通道，仍需要更多真机场景验证。
