# Codex To Phone

> 把 Mac 上的 Codex Desktop 延伸到 Android 手机：远程查看线程、跟随输出、发送消息、上传附件，并继续控制正在运行的会话。

[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f855a.svg)](https://nodejs.org/)
[![Android](https://img.shields.io/badge/client-Android-3ddc84.svg)](apps/mobile)
[![macOS](https://img.shields.io/badge/relay-macOS-111827.svg)](scripts/helper/MobileCodexRelay.swift)

Codex To Phone 不是远程桌面，也不会把 Codex 账号放到手机上。Codex 仍在电脑上运行，手机通过你自己控制的 Relay 和 Broker 查看最近会话并提交输入。

```text
Android App
    |
    | HTTPS
    v
Public Broker
    ^
    | outbound WSS tunnel
    |
Mac Relay App  ->  Codex Desktop
```

## 能做什么

- 在 Android 上查看 Codex Desktop 的线程列表和最近消息。
- 按项目目录分组线程，并保留连接后的最近会话记录。
- 从手机向指定 Codex Desktop 线程发送文字和附件。
- 显示“正在思考”“正在输出”“等待审批”等运行状态。
- 低延迟同步 Codex 文本结果，并在手机端平滑显示。
- 支持 Light、Dark、System 三种主题。
- 通过自建 Broker 跨网络使用，不要求手机和电脑连接同一 Wi-Fi。
- 支持自托管 APK 更新源，不依赖应用商店。

默认界面只展示用户输入和 Codex 文本结果。工具日志、补丁内容、环境上下文和桥接内部消息不会占据聊天区。

## 当前实现

| 组件 | 技术 | 作用 |
| --- | --- | --- |
| Android App | React 19、Vite 7、Capacitor 7 | 手机 UI、连接管理、消息同步、附件和更新检查 |
| Local Relay | Node.js、TypeScript、Fastify | 读取 Codex 会话、提供 API、控制当前线程 |
| Public Broker | Fastify、WebSocket | 转发 Android 请求和 Mac 主动建立的加密隧道 |
| Mac Relay App | Swift、AppKit | 启停 Relay、保存本地配置、展示 Endpoint 和 Token |
| Input Helper | Swift、macOS Accessibility | 聚焦目标线程并把手机输入提交到 Codex Desktop |
| Protocol Types | Codex app-server generated types | 解析线程、turn、审批和增量事件 |

当前源码版本为 `1.1.13-message-order-fix`。主验证环境是 **macOS + Codex Desktop + Android**。Windows 相关代码仍保留，但不是当前重点支持路径。

## 快速开始

### 环境要求

- macOS 13 或更高版本
- 已安装并登录 Codex Desktop
- Node.js 20 或更高版本
- Android 8 或更高版本
- 构建 APK 时需要 JDK 17 和 Android SDK

### 1. 获取源码

本项目目前位于 `project` 仓库的 `codex-to-phone` 子目录：

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/codex-to-phone
corepack enable
corepack pnpm install --frozen-lockfile
```

### 2. 构建 Mac Relay

```bash
corepack pnpm mac:package
```

项目根目录会生成：

```text
Mobile Codex Relay.app
Mobile Codex Input.app
```

这两个 App 包含本机路径和本机构建信息，因此不会提交到 Git。每台 Mac 都应从源码重新构建。

### 3. 启动 Relay

双击 `Mobile Codex Relay.app`。首次启动会在以下位置生成随机 Token、Relay ID 和 Relay Secret：

```text
~/Library/Application Support/Mobile Codex Relay/config.json
```

局域网测试时，在 Android App 中填写 Mac App 显示的 `LAN Endpoint` 和 `Token`。

### 4. 授予输入权限

打开：

```text
系统设置 -> 隐私与安全性 -> 辅助功能
```

允许 `Mobile Codex Input.app`。该权限只用于把手机消息提交到可见的 Codex Desktop 输入框。

### 5. 构建 Android APK

第一次构建先安装 Android 工具：

```bash
corepack pnpm android:setup:mac
```

构建 APK：

```bash
corepack pnpm android:apk:mac -- 1.1.13-local
```

产物位于：

```text
dist-apk/mobile-codex-1.1.13-local-debug.apk
```

在 Android 上安装后，打开设置，填写 Relay Endpoint 和 Token，然后执行“测试连接”。

## 远程使用

正式远程场景使用 Public Broker。Mac 和手机都只需要能够主动访问 Broker，不需要公网 IP、路由器端口转发或同一局域网。

### 1. 配置 Broker 凭证

生成两个不同的随机值：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

其中一个作为手机访问 Relay 的 `token`，另一个作为 Broker 隧道的 `relaySecret`。不要混用。

### 2. 启动 Broker

```bash
export MOBILE_CODEX_BROKER_HOST=127.0.0.1
export MOBILE_CODEX_BROKER_PORT=18888
export MOBILE_CODEX_BROKER_RELAYS='{"my-mac":"replace-with-at-least-24-random-characters"}'

corepack pnpm --filter @mobile-codex/relay build
corepack pnpm --filter @mobile-codex/relay broker:start
```

使用 Nginx、Caddy 或其他反向代理把 `https://broker.example.com` 转发到 `127.0.0.1:18888`，并启用 WebSocket upgrade。

### 3. 配置 Mac Relay

编辑：

```text
~/Library/Application Support/Mobile Codex Relay/config.json
```

示例：

```json
{
  "port": 8787,
  "token": "replace-with-a-separate-phone-access-token",
  "brokerUrl": "https://broker.example.com",
  "relayId": "my-mac",
  "relaySecret": "replace-with-at-least-24-random-characters"
}
```

重新打开 `Mobile Codex Relay.app`。Android App 中填写：

```text
Endpoint: https://broker.example.com/r/my-mac
Token: replace-with-a-separate-phone-access-token
```

完整的反向代理和验证步骤见 [公网 Broker 部署](docs/remote-broker.md)。

## 在线更新

在线更新地址不再写死在源码中。构建 APK 时通过环境变量注入：

```bash
export VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL=https://downloads.example.com/mobile-codex/android/latest.json
corepack pnpm android:apk:mac -- 1.1.13-self-hosted
```

不设置该变量时，App 会禁用在线更新检查，其他功能不受影响。

发布脚本同样不包含服务器、账号或 SSH 私钥默认值：

```bash
export MOBILE_CODEX_RELEASE_HOST=deploy@example.com
export MOBILE_CODEX_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
export MOBILE_CODEX_RELEASE_DIR=/var/www/mobile-codex/releases/android
export MOBILE_CODEX_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/android

scripts/publish-android-update.sh \
  dist-apk/mobile-codex-1.1.13-self-hosted-debug.apk \
  1.1.13-self-hosted \
  14 \
  "Your release notes"
```

详情见 [Android 在线更新](docs/online-update.md)。

## 常用命令

```bash
# 类型检查
corepack pnpm typecheck

# 消息顺序和重复消息回归测试
corepack pnpm test:messages

# 构建 Relay 和移动端 Web
corepack pnpm build

# 开发模式启动 Relay
corepack pnpm dev:relay

# 开发模式启动移动端
corepack pnpm dev:mobile

# 构建 Mac App 和输入 Helper
corepack pnpm mac:package

# Relay 本地烟测
corepack pnpm smoke
```

## 安全说明

- 不要把 `.env.local`、`config.json`、Token、Relay Secret、SSH 私钥、APK 或本地日志提交到 Git。
- Public Broker 默认要求通过 `MOBILE_CODEX_BROKER_RELAYS` 明确配置允许连接的 Relay。
- Relay Secret 通过 WebSocket `Authorization` 请求头发送，不会写入连接 URL。
- Relay API 使用独立 Bearer Token；Broker 只负责转发，不应保存完整会话。
- 生产环境必须使用 HTTPS/WSS，并限制服务器日志、备份和访问权限。
- 手机端获得的是远程执行入口。只应连接自己控制的电脑、Broker 和 Codex 环境。

更多边界和漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 项目结构

```text
apps/mobile          React + Capacitor Android 客户端
apps/relay           Relay、Broker、Codex 会话读取与控制
generated-protocol   Codex app-server 协议类型
scripts              Mac/Windows helper、构建和发布脚本
docs                 架构、部署、更新、测试和历史记录
marketing            项目介绍素材和演示 HTML
```

## 演进过程

- `Phase 0`：单会话二维码和浏览器页面，验证 PC 到手机的可见性。
- `Phase 1`：增加手机输入，验证 app-server、Desktop IPC 和 UI 注入路线。
- `Phase 2`：引入 Public Broker，摆脱局域网和临时隧道域名。
- `Phase 3`：用 React + Capacitor Android App 替代扫码网页。
- `Phase 4`：增加线程分组、最近记录、平滑输出、状态标签、附件缩略图和在线更新。
- `1.1.12`：保留连接后的记录，过滤环境上下文卡片，补充 Codex 运行状态。
- `1.1.13`：按桌面事件顺序同步消息，保留连续相同输入，并只合并同一事件的双来源副本。

早期方案的完成内容和限制记录在 [legacy-notes.md](docs/legacy-notes.md)。

## 已知限制

- macOS 输入控制依赖 Accessibility 权限和可见的 Codex Desktop 窗口。
- Codex Desktop 内部行为升级后，线程聚焦或会话格式可能需要适配。
- 当前 APK 以侧载方式安装，更新时仍需 Android 系统确认。
- Broker 是转发层，不是高可用集群；长期运行需要自行配置进程守护、TLS、监控和备份。
- 本项目不是 OpenAI 官方产品，也不代表 OpenAI 提供或支持的远程控制能力。

## 文档

- [使用和部署](docs/usage.md)
- [公网 Broker](docs/remote-broker.md)
- [Android 在线更新](docs/online-update.md)
- [架构与可行性](docs/architecture-feasibility.md)
- [测试与验收](docs/test-and-acceptance-plan.md)
- [项目档案入口](docs/project-index.md)
- [参与贡献](CONTRIBUTING.md)

## 参与贡献

仓库公开，任何 GitHub 用户都可以 Fork 项目并提交 Pull Request。提交前请运行消息回归测试、类型检查和生产构建，并确保改动不包含 Token、私有地址、会话数据或本机绝对路径。

直接提交到主仓库的权限只授予经过确认的协作者，需要由仓库管理员按 GitHub 用户名逐个邀请。完整流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
