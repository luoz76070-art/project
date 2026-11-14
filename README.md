<div align="center">

# MobiCodex

<img src="docs/images/mobicodex-app-icon.png" width="128" alt="MobiCodex 手机连接电脑图标" />

**在手机上继续电脑上的 Codex 与各 Agent 会话**

[![Android](https://img.shields.io/badge/Android-6.0%2B-3DDC84?logo=android&logoColor=white)](#下载)
[![Preview](https://img.shields.io/badge/preview-0.2.0-blue)](releases/android/mobicodex/0.2.0/)
[![License](https://img.shields.io/badge/License-MIT-555)](LICENSE)

[下载](#下载) · [界面预览](#界面预览) · [开始使用](#开始使用) · [开发与构建](#开发与构建)

</div>

MobiCodex 是一个 Android App：在手机上查看并继续电脑上的 Codex、DeepSeek Harness、Claude Code 或 OpenCode 会话，跟随输出，发送文字、图片和语音，处理审批与提问；用「事项」把工作交给 Agent，进度自动回写，由你验收。

当前版本 **0.2.0 / versionCode 40**（2026-11-14）。从这一版起 MobiCodex 是独立 App（包名 `com.mobilecodex.app`），不再和 Kelivo 的 AI 聊天打包在一起。电脑页的界面、配色和功能与之前 Kelivo 整合版 0.1.11 里一致；Kelivo 整合版停止更新，历史版本与源码仍保留在仓库。

## 下载

| 文件 | 用途 |
| --- | --- |
| [Android APK：0.2.0（下载页）](https://zyzlz.xin/mobile-codex/releases/android/preview/index.html) | Android 6.0+；预览证书签名，可直接覆盖安装旧版 Mobile Codex 1.x |
| [GitHub Release](https://github.com/luoz76070-art/MobiCodex/releases/tag/mobicodex-v0.2.0) | 同一源码由 GitHub Actions 构建，含 APK、界面更新包与校验值 |
| [版本说明与校验值](releases/android/mobicodex/0.2.0/) | 本版内容、签名说明与安装步骤 |

**从 Kelivo 整合版换过来**：新 App 与 Kelivo 版是两个不同的应用，可以同时安装。装好后在电脑上运行 `pair` 生成配对信息，在 App「设置」里粘贴，配对一次即可；确认正常后再卸载 Kelivo 版。Kelivo 里的 AI 聊天记录和手机上保存的语音转写记录不会迁移。

**以后的更新**：打开「设置 → 应用更新」。只改界面的更新会在后台下载、下次打开时生效，不用重装；需要新安装包时在同一页下载安装。

## 界面预览

<p align="center">
  <img src="docs/images/remote-rendering-light.jpg" width="260" alt="电脑页浅色：折叠执行摘要、图片和紧凑代码" />
  <img src="docs/images/remote-rendering-dark.jpg" width="260" alt="电脑页深色：相同布局与图片展示" />
</p>

<p align="center">
  <img src="docs/images/agent-parity-deepseek-summary.png" width="260" alt="code9 DeepSeek：执行说明常显、工具摘要和共用输入" />
  <img src="docs/images/agent-parity-deepseek-light.png" width="260" alt="code9 DeepSeek：同款图片大图与代码展示" />
</p>

截图来自隔离浏览器中的合成会话与图片（Kelivo 整合版时期），独立 App 的电脑页与之相同；不包含个人项目或模型任务。

## 功能

| 部分 | 能做什么 |
| --- | --- |
| 会话 | 按项目查看各 Agent 会话，跟随输出，发送文字、附件与语音，处理已适配的问答、审批、排队和停止操作 |
| 事项 | 把工作交给指定 Agent，进度自动回写为进行中/待验证，由你验收或退回 |
| 语音 | 最长 10 分钟，边录边转文字，可整理成提示词再回填 |
| 设置 | 配对与设备、语音；外观（主题、跟随系统取色、聊天字号、工具显示）；应用更新与界面更新 |

电脑页能力（所有通道共用）：

- 执行说明和记录按顺序直接显示；连续工具调用合并为动态摘要，默认只收起命令/输出，点击一次查看明细，最终回复单独显示。
- 默认正文 15px、代码 12px、工具输出约 11px；长输出在块内滚动，聊天字号可在设置中调整。
- Markdown 图片直接显示，点击查看大图，可切换原尺寸并重试加载。
- Codex 与各 Agent 共用输入框、附件、语音、独立草稿和运行中操作；按钮以原通道能力为准，Claude 保持只支持排队。
- DeepSeek 原生/PTC、Claude 原工具和 OpenCode 混合消息投影命令与可见输出；推理和私有内部结果不进入手机展示。
- 后续通道实现标准 SessionAdapter 并登记能力后直接复用这一套界面，无需复制页面。
- 本地图片经过电脑网关鉴权，支持当前会话项目目录内的 PNG、JPEG、GIF、WebP、AVIF，以及同一会话助手 Markdown 明确引用的项目外精确图片，单图不超过 8 MiB。HTTPS 图片也可显示。

本地图片需要 **本版本配套网关**；旧网关会显示升级提示。Codex、DeepSeek Harness、Claude Code、OpenCode 及注册 SessionAdapter 的后续通道均共用取图接口；后三类需要已连接的原会话订阅。只有路径、没有 Markdown 图片引用的文本不会自动变成图片。

## 开始使用

### 连接电脑

电脑需运行 Codex Desktop 和本项目网关；跨网络访问还需你自己的 HTTPS Broker。网关通过主动连接 Broker 传输消息，手机不需要与电脑处于同一 Wi-Fi。

首次从源码准备：

```sh
git clone https://github.com/luoz76070-art/project.git
cd project
corepack pnpm install --frozen-lockfile
corepack pnpm build:plugin
node dist-plugin/mobile-codex/scripts/mobile-codex.mjs status
node dist-plugin/mobile-codex/scripts/mobile-codex.mjs init --workspace /absolute/path/to/your/project
```

按照[网关配置说明](plugins/mobile-codex/README.md)补全私有 Broker 配置，再执行：

```sh
node dist-plugin/mobile-codex/scripts/mobile-codex.mjs start
node dist-plugin/mobile-codex/scripts/mobile-codex.mjs pair
```

在手机 App「设置」粘贴一次性配对信息，连接后选择已有会话。`pair` 只生成短期配对信息，不调用模型。已有配置请先 `status`，沿用原配置和工作目录，按[版本包说明](releases/android/kelivo-preview/0.1.7/README.md)切换网关程序。

[Broker 部署](docs/remote-broker.md) · [网关管理](plugins/mobile-codex/README.md) · [其他 Agent 接入](docs/agent-gateway.md)

## 开发与构建

| 目录 | 职责 |
| --- | --- |
| `apps/mobile` | MobiCodex Android App：React 页面 + Capacitor 原生壳（录音、更新、凭据、系统栏与取色） |
| `apps/relay` | Fastify API、Codex Desktop IPC、Broker 与 Tunnel |
| `plugins` | 电脑网关及其他 Agent 的接入包 |
| `apps/kelivo`、`integrations/kelivo`、`releases/android/kelivo-preview` | 已停止的 Kelivo 整合版（0.1.x）源码、构建契约与历史发布 |

Node.js 22+、pnpm 10.20.0；Android 构建需要 Android SDK 35 与 JDK 21+（lint 用 JDK 17）。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm --filter @mobile-codex/mobile build
corepack pnpm --filter @mobile-codex/mobile exec cap sync android
gradle --project-dir apps/mobile/android :app:assembleRelease
```

构建前在 `apps/mobile/.env.production.local` 配置 App 内更新与界面更新的清单地址（见 `apps/mobile/scripts/check-update-sources.mjs`）。发布由推送 `mobicodex-v<版本>` 标签触发 [Android 发布工作流](.github/workflows/release-android.yml)。自己的构建签名与下载页的预览证书不同，不能覆盖安装下载页的版本。

## 致谢与许可

MobiCodex App 与电脑网关源自 Codex To Phone，按 [MIT 许可](LICENSE) 发行。App 内置 `@material/material-color-utilities` 的一小部分（Apache-2.0，见 `apps/mobile/src/vendor/material-color-utilities`），用于和系统动态取色保持一致。各依赖沿用其原许可。

0.1.x 整合版的 AI 部分来自 [Chevey339/Kelivo](https://github.com/Chevey339/kelivo)（固定 v1.3.4 / `4a7da9b6`），按随附 [GNU AGPL v3](apps/kelivo/LICENSE) 发行；这些历史版本的源码归档、来源与修改清单见 [integrations/kelivo](integrations/kelivo/README.md)。感谢 Kelivo 及其贡献者。
