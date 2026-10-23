# Codex To Phone

> 把 Mac 上的 Codex Desktop 延伸到 Android 手机：远程查看线程、跟随输出、发送消息、上传附件，并继续控制正在运行的会话。

[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-2f855a.svg)](https://nodejs.org/)
[![Android](https://img.shields.io/badge/client-Android-3ddc84.svg)](apps/mobile)
[![macOS](https://img.shields.io/badge/relay-macOS-111827.svg)](scripts/helper/MobileCodexRelay.swift)

Codex To Phone 不是远程桌面，也不会把 Codex 账号放到手机上。Codex 仍在电脑上运行，手机通过你自己控制的 Relay 和 Broker 查看最近会话并提交输入。

当前开发预览为APK32 `1.3.11-compact-composer-preview`：运行状态收进输入框，紧凑引导/排队按需显示，待发默认折叠；390px运行态footer由271.5px缩至125px。手机69项、类型/构建/更新、浏览器19项及公网19项通过，Android lint0错误/8项既有警告。preview32/previous31，正式18/hot保持；手机App内检查更新，真机触摸/键盘待验，见[交付记录](docs/audits/2026-10-23/compact-running-composer.md)。包含APK31的[输入关联与缓存补修](docs/audits/2026-10-23/input-mirror-cache.md)，原重复截图仍待实机复核。

源码采用“分步本地提交，完整版本验收后集中推送GitHub”的流程；本项目位于父仓库`project`的`codex-to-phone/`子目录，提交和推送前必须核对项目范围。预览版本与正式验收分开标记，手机/网关部署仍沿各自发布流程。具体步骤见[版本同步约定](docs/ops/version-sync.md)。

上一轮用户已确认APK24→25 App内升级成功、原连接保留，以及DeepSeek手机同一会话普通收发完整且无重复；审批、追加/中断及切网等仍分别待验，长期测试暂缓。见[兼容性与真机验收](docs/audits/2026-10-22/android-compat.md)及[更新链路交付](docs/audits/2026-10-22/in-app-update.md)。

上一项已交付APK23 `1.3.2-project-groups-preview`：Codex与DeepSeek默认近30天、可查看更早，均按项目文件夹分组并记住展开/折叠；同名目录按完整路径区分，搜索临时展开。列表前台每30秒刷新摘要，正文按需读取。固定网关已更新，本地/公网Codex近期69/全部126、DeepSeek11会话/3项目通过；后端321/321、手机46/46及类型/构建、窄屏检查通过。APK23同签名独立预览已完整下载校验，需手机覆盖安装，正式18/hot保持；原会话发送和权限决定另验。下载与边界见[本轮交付](docs/audits/2026-10-22/project-groups.md)，历史接入见[DeepSeek配置](plugins/mobile-deepseek/README.md)。

```text
Android App
    |
    | HTTPS
    v
Public Broker
    ^
    | outbound WSS tunnel
    |
Mac native gateway  ->  Codex Desktop IPC
```

## 能做什么

- 在 Android 上查看 Codex Desktop 的线程列表和最近消息。
- Codex与DeepSeek默认近30天，可按需加载更早会话；按项目目录分组并记住折叠状态。
- 从手机向指定 Codex Desktop 线程发送文字和附件。
- 录音后经百炼转写、DeepSeek整理，预览编辑后回填草稿；模型Key在手机设置配置，真实效果待验。
- 显示“正在思考”“正在输出”“等待审批”等运行状态。
- 低延迟同步 Codex 文本结果，并在手机端平滑显示。
- 支持 Light、Dark、System 三种主题。
- 通过自建 Broker 跨网络使用，不要求手机和电脑连接同一 Wi-Fi。
- 支持带 SHA-256 校验和自动回滚的前端热更新，以及自托管 APK 版本更新。

默认界面只展示用户输入和 Codex 文本结果。工具日志、补丁内容、环境上下文和桥接内部消息不会占据聊天区。

## 源码结构与优化进度

项目已接入 Trellis；源码布局与任务入口见 [工程布局](docs/project-layout.md)，原始问题见 [源码审核](docs/audits/2026-10-20/README.md)。本轮已实施公网流、自动恢复、缓存/档案隔离、索引分页、设备配对和 Codex 手机版 UI；[优化交付与统一实测](docs/audits/2026-10-20/delivery.md) 记录当前 APK、验证结果及真机待办。

本地隔离回归使用 `corepack pnpm test:transport`；该命令不会提交模型任务。

## 当前实现

| 组件 | 技术 | 作用 |
| --- | --- | --- |
| Android App | React 19、Vite 7、Capacitor 7 | 手机 UI、连接管理、消息同步、附件和更新检查 |
| Local Relay | Node.js、TypeScript、Fastify | 读取 Codex 会话、提供 API、控制当前线程 |
| Public Broker | Fastify、WebSocket | 转发 Android 请求和 Mac 主动建立的加密隧道 |
| Mac 原生网关 | 插件自包含 Node bundle | 单进程运行 Relay + Tunnel，经 Desktop IPC 控制原会话 |
| 旧 Mac Relay App / Input Helper | Swift、AppKit、macOS Accessibility | 旧版回退方式；源码与构建入口保留，当前原生网关不依赖两个 App |
| Protocol Types | Codex app-server generated types | 解析线程、turn、审批和增量事件 |

当前已发布手机版本为 `1.2.2-update-restore` / versionCode 18，已恢复手机更新源，包含工作状态修复与前序优化，等待统一真机实测。下述插件开发预览尚未包含在该APK中。原更新通道交付与安装说明见 [手机更新恢复](docs/audits/2026-10-20/update-restore.md)。主验证环境是 **macOS + Codex Desktop + Android**。Windows 相关代码仍保留，但不是当前重点支持路径。

本次版本的功能、修复、验证范围和已知限制见 [更新说明](CHANGELOG.md)。公开仓库包含源码和构建说明；APK、Mac App、部署凭证及本地验收日志不随源码提交。正式1.2.2的旧版App说明保留供回退，当前开发环境已迁移至原生网关。

开发中的 [Agent 网关](docs/agent-gateway.md) 已实现只读探测、手机提问卡片与原请求应答，以及原会话发送/追加/中断通道和三类Desktop审批。2026-10-21 已按用户授权切换原生候选网关，选择卡已真实验证，其余控制继续分项验收。[插件开发预览](plugins/mobile-codex/README.md)通过`corepack pnpm build:plugin`生成独立插件包，提供单进程Relay+Tunnel、配对与设备管理CLI；实际Codex插件尚未安装，当前直接运行固定包。旧App已归档清理，源码、构建命令与旧配置保留。`test:gateway`、`test:user-input`、`test:desktop-native`、`test:desktop-approvals`、`test:managed-gateway` 使用合成服务；`probe:gateway` 是单独的本机只读检查，不运行真实模型任务。

同一网关的OpenCode及[Claude Code预览](plugins/mobile-claude/README.md)已完成原会话控制、手机问答与审批的源码/合成验证；Claude仅排队输入和单次审批，本机版本低于开发契约，尚未真实加载。OpenCode已修正为固定2.0.16协议，最终后端210项、手机37项及窄屏浏览器检查通过，生产APK仍1.2.2/versionCode18；[统一验收计划](docs/test-and-acceptance-plan.md)记录插件安装、真实原会话与Android公网的剩余步骤，长期连接测试暂缓。

已生成[1.3.0/versionCode19候选包](docs/audits/2026-10-21/agent-gateway-candidate.md)：同签名APK、独立插件ZIP和完整单文件热更新。用户确认手机连接成功并同步120线程后反馈发送409；最新[手机修复预览APK20](docs/audits/2026-10-21/phone-send-409.md)已发布，补齐发送前能力检查与具体错误提示，真实发送待复测。正式更新清单仍18；宿主版本兼容与原会话控制等验收继续见[迁移交接](docs/audits/2026-10-21/gateway-migration.md)。

## 当前 Mac 原生网关入口

当前后台运行程序为`~/Library/Application Support/Mobile Codex Gateway/releases/<固定版本>/mobile-codex/lib/gateway.mjs`，配置为同一Gateway目录下的`gateway.json`，日志为`gateway.log`。它由独立Node进程运行，当前未注册登录自启动。固定目录中的`scripts/mobile-codex.mjs`提供`status/start/stop/pair`，具体安装与初始化见[插件说明](plugins/mobile-codex/README.md)。已有配置时先查看status，不要重复init或另起旧App。

2026-10-21已将工程根目录的Relay/Input两个生成App压缩归档并移除；原生网关PID、配置及公网连接保持。实际程序位置、清理和恢复记录见[旧Mac应用清理](docs/audits/2026-10-21/legacy-mac-app-cleanup.md)。

## 快速开始（旧版 App 回退方式）

以下Mac步骤适用于旧App方式；当前原生网关按上节管理，不需要重建App或授予辅助功能权限。Android构建步骤继续适用。

### 环境要求

- macOS 13 或更高版本
- 已安装并登录 Codex Desktop
- Node.js 20 或更高版本
- Android 8 或更高版本
- 构建 APK 时需要 JDK 21 或更高版本和 Android SDK；本轮使用 JDK 25 + Gradle 9.4.1

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

优先在 Mac App 点击 `Pair phone`，把复制的配对信息粘贴到手机设置中。配对码 5 分钟内有效且仅用一次，手机取得独立、可撤销的设备凭证；Endpoint/管理员 Token 保留为手工恢复入口。

### 4. 授予输入权限

打开：

```text
系统设置 -> 隐私与安全性 -> 辅助功能
```

为当前工程中的 `Mobile Codex Relay.app` 与 `Mobile Codex Input.app` 开启辅助功能权限，用于把手机消息提交到可见的 Codex Desktop 输入框。当前 Relay 直接启动输入助手，系统可能将控制权限归属到 Relay；只授权 Input 仍可能失败。若迁移或重建后开关已开却报未授权，移除旧副本的授权项，再手动添加当前工程中的两个 App。不要授权旧工程路径，也不要在输入结果未知时反复发送。排查步骤见 [公网连接维护](docs/ops/remote-connection-repair.md#mac-输入权限)。

### 5. 构建 Android APK

第一次构建先安装 Android 工具：

```bash
corepack pnpm android:setup:mac
```

先按下文“在线更新”保存本地生产更新源，再构建 APK：

```bash
corepack pnpm android:apk:mac -- 1.2.2-update-restore
```

产物位于：

```text
dist-apk/mobile-codex-1.2.2-update-restore-debug.apk
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

手机入口为“设置 → 版本与更新 → 检查更新 → 下载并安装”。APK24起在App内下载校验并调用系统安装器，首次来源授权返回可继续；旧APK需先手动覆盖安装24一次。更新地址使用构建配置，预览包必须选择preview清单。将双通道地址保存到被 Git 忽略的 `apps/mobile/.env.production.local`，避免下次打包遗漏；也支持环境变量覆盖：

```bash
cat > apps/mobile/.env.production.local <<'EOF'
VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL=https://downloads.example.com/mobile-codex/android/latest.json
VITE_MOBILE_CODEX_HOT_MANIFEST_URL=https://downloads.example.com/mobile-codex/hot/latest.json
EOF
corepack pnpm android:apk:mac -- 1.2.2-update-restore
```

请替换示例域名。具名 APK 构建要求两个地址齐全且有效，缺失时立即失败；仅本地 `mac-local` 调试包允许两个地址都为空。未带更新源的旧 APK 16/17 需要先从手机浏览器下载修复 APK 并覆盖安装一次，之后可在 App 内继续检查更新，无需卸载或清除数据。

生产环境的热更新 Manifest 和 bundle 地址必须使用 HTTPS。仅本机开发调试允许使用 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`；更新下载不跟随 HTTP 重定向。

发布脚本同样不包含服务器、账号或 SSH 私钥默认值：

```bash
export MOBILE_CODEX_RELEASE_HOST=deploy@example.com
export MOBILE_CODEX_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
export MOBILE_CODEX_RELEASE_DIR=/var/www/mobile-codex/releases/android
export MOBILE_CODEX_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/android

scripts/publish-android-update.sh \
  dist-apk/mobile-codex-1.2.2-update-restore-debug.apk \
  1.2.2-update-restore \
  18 \
  "Your release notes"
```

仅修改 React UI、样式或前端状态逻辑时，可以构建并发布热更新：

```bash
corepack pnpm android:hot-bundle -- 1.2.2-web.1

scripts/publish-hot-update.sh \
  dist-hot/mobile-codex-1.2.2-web.1.html \
  1.2.2-web.1 \
  18 \
  "UI update"
```

热更新会先校验 SHA-256，再切换到应用私有目录中的单文件 bundle；未成功确认加载时，下次启动自动回滚。原生代码、权限、Capacitor 插件和不兼容协议变化必须发布 APK。

详情见 [Android 在线更新](docs/online-update.md)。

## 常用命令

```bash
# 类型检查
corepack pnpm typecheck

# 消息顺序和重复消息回归测试
corepack pnpm test:messages

# Codex CLI 路径解析回归测试
corepack pnpm test:codex-executable

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
- `1.1.14`：修复 macOS GUI 环境找不到 Codex CLI 的 `spawn codex ENOENT`，增加可校验、可回滚的热更新和 APK 双通道更新。

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
