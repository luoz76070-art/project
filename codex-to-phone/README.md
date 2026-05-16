# Mobile Codex / Codex To Phone

把 Mac 上正在运行的 Codex Desktop 延伸到 Android 手机上：手机可以远程查看会话进展、发送输入到 Codex、上传附件、查看结果，并通过公网 Broker 在离开电脑网络后继续使用。

当前仓库已经从早期的“单个会话扫码网页绑定”重构为 `1.1.11-text-sync` 版本的 App 项目：

- Mac 端：`Mobile Codex Relay.app`，负责读取 Codex 会话、连接公网 Broker、把手机输入注入 Codex Desktop。
- Android 端：React + Capacitor App，负责连接 Relay/Broker、显示会话、发送输入和检查在线更新。
- Relay/Broker：Fastify/Node 服务，提供本地 Relay、远程 Broker、WebSocket 隧道和移动端 API。

> 当前主要验证目标是 Mac 本机 Codex Desktop + Android 手机远程使用。Windows IPC 路线仍保留在源码中，但不是这一轮主路径。

## 当前能力

- Android App 连接 Mac Relay 或公网 Broker，不再依赖浏览器扫码页面。
- 支持远程公网连接：Android 和 Mac 只需要能访问同一个 Broker，手机不必和电脑在同一局域网。
- 手机可以查看 Codex Desktop 会话列表、打开桌面当前线程、跟随最新消息。
- 手机上发送文字后，Mac 端通过 `codex://threads/<threadId>` 聚焦目标线程，再用 `Mobile Codex Input.app` 或 `osascript` 把文字提交到 Codex Desktop 输入框。
- UI 只显示用户输入和 Codex 文本结果，默认隐藏工具调用、命令日志、补丁 diff 和桥接内部确认。
- 输出同步做了低延迟轮询和前端平滑显示，目标是接近 Codex 的阅读节奏，而不是一次性丢出整段缓存。
- 支持 Light / Dark / System 主题。
- 支持手机端上传附件，聊天区显示缩略图，不把本机绝对路径塞进对话文本。
- Android 支持自托管在线更新检查，当前 manifest 示例：`https://zyzlz.xin/mobile-codex/releases/android/latest.json`。

## 项目结构

```text
apps/mobile          React + Capacitor Android 客户端
apps/relay           Fastify/Node 本地 Relay、Broker、Codex 会话控制
generated-protocol   Codex Desktop / app-server 协议类型
scripts              Mac helper、Mac Relay App、Android APK、发布脚本
docs                 架构、部署、网络、在线更新、历史与验收文档
marketing            公众号推文、视频稿提示词、HTML 演示稿
```

## 小白快速部署

### 1. 下载源码

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/codex-to-phone
```

### 2. 安装依赖

```bash
corepack enable
corepack pnpm install
```

### 3. 构建 Mac Relay App

```bash
corepack pnpm mac:package
```

构建成功后，项目根目录会生成：

```text
Mobile Codex Relay.app
Mobile Codex Input.app
```

这两个 `.app` 是本机构建产物，不提交到 GitHub。重新下载项目后按上面的命令生成即可。

### 4. 打开 Mac Relay App

双击：

```text
Mobile Codex Relay.app
```

它会启动本地 Relay，并显示 Android 端需要填写的 Endpoint 和 Token。

首次让手机向 Codex 发送消息前，在 macOS 打开：

```text
系统设置 > 隐私与安全性 > 辅助功能
```

允许：

```text
Mobile Codex Input.app
```

这是 Mac 端把手机输入粘贴进 Codex Desktop 输入框的 helper。没有这个权限时，手机可能能看见会话，但不能稳定发送消息到当前 Codex 窗口。

### 5. 安装 Android App

如果只是使用当前发布包，可以从在线更新地址下载：

```text
https://zyzlz.xin/mobile-codex/releases/android/mobile-codex-1.1.11-text-sync.apk
```

当前 manifest：

```text
https://zyzlz.xin/mobile-codex/releases/android/latest.json
```

如果要自己构建 APK：

```bash
corepack pnpm android:setup:mac
corepack pnpm android:apk:mac -- 1.1.11-text-sync
```

构建产物会放在 `dist-apk/`，该目录不会提交到仓库。

### 6. 局域网验证

Mac 和 Android 在同一 Wi-Fi 下时，可以先用 Mac Relay App 显示的 LAN Endpoint 测试，例如：

```text
Endpoint: http://192.168.x.x:8787
Token: <Mac App 显示的 token>
```

局域网只用于本机验证，不是项目的最终目标。

### 7. 远程公网使用

正式远程使用请部署 Broker，让 Mac 主动连 Broker，Android 也连 Broker：

```text
Android App -> https://broker.example.com/r/<relayId>
Mac Relay   -> outbound WSS tunnel -> https://broker.example.com
```

当前示例：

```text
Broker URL:       https://zyzlz.xin/mobile-codex
Android Endpoint: https://zyzlz.xin/mobile-codex/r/rorance-mac
```

Mac Relay App 配置文件：

```text
~/Library/Application Support/Mobile Codex Relay/config.json
```

示例：

```json
{
  "port": 8787,
  "token": "mobile-codex-CHANGE-ME",
  "brokerUrl": "https://zyzlz.xin/mobile-codex",
  "relayId": "rorance-mac",
  "relaySecret": "replace-with-long-random-secret"
}
```

Android App 设置里填写：

```text
Endpoint: https://zyzlz.xin/mobile-codex/r/rorance-mac
Token: mobile-codex-CHANGE-ME
```

`token` 是手机访问 Mac Relay 的凭证，`relaySecret` 只用于 Mac Relay 和 Broker 建立隧道，不应该填到手机里。

完整部署说明见 [docs/remote-broker.md](docs/remote-broker.md)、[docs/usage.md](docs/usage.md) 和 [docs/online-update.md](docs/online-update.md)。

## 常用命令

```bash
# 安装依赖
corepack pnpm install

# 类型检查
corepack pnpm typecheck

# 构建 relay + mobile web
corepack pnpm build

# 开发模式启动 relay
corepack pnpm dev:relay

# 开发模式启动 mobile web
corepack pnpm dev:mobile

# 构建 Mac Relay App 和输入 helper
corepack pnpm mac:package

# 构建 Android APK
corepack pnpm android:setup:mac
corepack pnpm android:apk:mac -- 1.1.11-text-sync
```

## 从扫码绑定到 1.1.11 的阶段记录

### Phase 0：单个会话扫码绑定

最早版本是一个本地 bridge：启动后绑定当前 Codex 会话，生成二维码，手机扫码打开网页。

完成内容：

- 验证 PC 到手机的会话可见性。
- 验证手机可以打开当前会话页面。
- 验证只加载“上一轮/当前轮”而不是导入全部历史。

局限：

- 依赖浏览器页面，体验不像 App。
- Quick Tunnel 域名临时变化，二维码容易失效。
- 局域网模式不满足“用户离开电脑也能用”的目标。

### Phase 1：手机输入回到 PC

项目开始解决手机到 PC 的链路：手机发送消息后，PC 端 Codex Desktop 要像用户亲自输入一样执行。

完成内容：

- 尝试过 bridge-owned app-server、Desktop IPC、UI 注入等路线。
- 确认后台 app-server 能写入同一个 thread，但 Desktop 当前窗口不会实时显示过程。
- 在 macOS 上落地可见 UI 注入路线：先聚焦 `codex://threads/<threadId>`，再通过辅助功能粘贴并提交。

局限：

- Desktop IPC owner 注册不稳定，不适合作为 Mac 端默认输入路径。
- UI 注入依赖 macOS Accessibility 权限和当前 Codex Desktop 可见输入框。
- 如果 Codex Desktop 没有成功聚焦目标线程，必须做 rollout 校验并报错。

### Phase 2：公网 Relay/Broker

为了摆脱同一 Wi-Fi 和临时隧道，项目切到 Relay/Broker 架构。

完成内容：

- Mac Relay 在本机读取 Codex 会话，并主动连公网 Broker。
- Android 通过 Broker Endpoint 访问 Mac Relay。
- Broker 只做转发，不保存完整会话历史。
- 支持 `https://zyzlz.xin/mobile-codex/r/rorance-mac` 这类稳定公网入口。

局限：

- 需要维护一台公网 Broker。
- Broker 反向代理必须正确支持 WebSocket upgrade。
- 长期稳定性取决于 Broker、Mac Relay 和 Android 网络重连策略。

### Phase 3：Android App 替代扫码网页

浏览器页面被替换为 React + Capacitor Android App。

完成内容：

- 支持 Endpoint/Token 配置。
- 支持会话列表、桌面当前线程、发送输入、上传附件。
- 支持 Android 侧载 APK 和自托管在线更新检查。
- 保留开发期 mobile web，方便在构建 APK 前调试。

局限：

- 当前 APK 仍是侧载安装，不是应用商店发布。
- 在线更新需要用户确认安装，不能绕过 Android 系统安装器。
- UI 仍需要持续做真机审核。

### Version 1.1.7：发送链路和 UI 初步修复

完成内容：

- 修复手机端发送消息失败和连接状态不一致的问题。
- 优化了发送后状态显示，减少重复的输入/输出桥接事件。

局限：

- 工具调用卡片、生成状态和流式观感仍不稳定。

### Version 1.1.8：UI 与流式观感抛光

完成内容：

- 增加平滑显示逻辑，让长文本不再完全等结束后一次性展示。
- 修复“正在生成，桌面同步输出”状态与实际结束不一致的部分场景。
- 设置页和会话栏遮罩更接近真实面板，减少内容重叠。

局限：

- Desktop 同步不是底层 token 流，某些 Codex 状态仍会以块状更新。

### Version 1.1.9：工具空白卡和输出体验修复

完成内容：

- 针对工具调用空白卡做了过滤和摘要逻辑。
- 优化手机端输出的分段节奏。

局限：

- 工具概要信息仍然容易因为 Codex 事件格式变化而不稳定。

### Version 1.1.10：主题与附件体验

完成内容：

- 增加 Light / Dark / System 主题。
- 上传图片改为缩略图展示，不再把文件路径文本直接塞进对话框。
- 优化会话栏视觉细节。

局限：

- 附件能力还没有做到和 Codex Desktop 完全一致。

### Version 1.1.11-text-sync：只保留文本结果、降低同步延迟

完成内容：

- 手机 UI 默认只显示用户输入和 Codex 文本回复。
- 隐藏工具调用、命令输出、补丁 diff 和内部 bridge ack，避免空白工具卡干扰阅读。
- 降低桌面同步延迟：active polling、fallback polling、SSE throttle 都做了收紧。
- 继续保留附件缩略图、主题切换、在线更新检查。

当前公开构建：

```text
Version: 1.1.11-text-sync
VersionCode: 12
APK: https://zyzlz.xin/mobile-codex/releases/android/mobile-codex-1.1.11-text-sync.apk
Manifest: https://zyzlz.xin/mobile-codex/releases/android/latest.json
SHA256: 9a8aa3a14761b2aa28a77a202d81aaf4e726fc039b3d614a89c6463648a078e8
```

## 当前限制

- Mac 手机输入默认依赖 `Mobile Codex Input.app` 的辅助功能权限。
- UI 注入要求 Codex Desktop 能被聚焦，且目标 thread 能通过 `codex://threads/<threadId>` 打开。
- Desktop IPC 输出和 rollout/session tail 不是模型底层 token 流，长文本仍可能按块同步。
- Broker 不应该保存会话历史；它是中转层，不是云端 Codex 运行时。
- 多 Mac、多会话、多手机协同控制还没有产品化。
- 当前 GitHub 仓库只提交源码和文档，不提交 APK、`.app`、`node_modules`、本地 token、上传文件和构建输出。

## 后续方向

- 把 Broker 部署脚本完善成一键服务器安装。
- 增强 Mac Relay App 的状态页、开机自启动和日志诊断。
- 做更稳定的断线重连、心跳和离线提示。
- 将在线更新从“下载 APK”升级为 App 内下载并唤起系统安装器。
- 在保证安全边界的前提下，支持多会话绑定和多设备查看。
