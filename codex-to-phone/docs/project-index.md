# Mobile Codex 工程档案入口

更新时间：2026-07-11

## 作用

每次继续施工前，先读本文件，再按链接读取对应工程文件。后续不能只靠聊天记忆推进，所有需求变更、技术判断、实测结果、阶段验收都要落到本目录。

## 当前项目定义

项目名：Mobile Codex / Codex To Phone

目标：把 Android 手机变成 Mac 上 Codex Desktop 的移动工作台。电脑继续运行 Codex Desktop 和 Relay，手机不是远程桌面画面，而是通过 Relay/Broker 读取会话、查看最新文本结果、发送输入、上传附件，并在离开局域网后继续远程控制。

当前主入口：

- Android APK：`1.1.12-status-context-fix` 或本地 `dist-apk/` 构建产物
- Mac Relay App：`Mobile Codex Relay.app`
- Mac 输入 helper：`Mobile Codex Input.app`
- Relay/Broker：`apps/relay`
- 手机客户端：`apps/mobile`
- 协议类型：`generated-protocol`

## 工程文件目录

- `docs/project-index.md`：施工入口和文件索引。
- `docs/legacy-notes.md`：旧扫码 bridge / skill / tunnel 方案的完成内容和局限。
- `docs/product-requirements.md`：产品需求规格，包含用户已提出和工程侧补全的要求。
- `docs/architecture-feasibility.md`：可行性、架构方案、已实测证据、风险边界。
- `docs/network-plan.md`：本地局域网路线和公网远程方案。
- `docs/remote-broker.md`：公网 Broker 部署和 Mac/Android 配置。
- `docs/online-update.md`：Android 自托管在线更新流程。
- `docs/usage.md`：部署、启动、APK 构建和换电脑使用说明。
- `docs/ui-interaction-spec.md`：手机版 Codex 工作台 UI 和交互规范。
- `docs/implementation-roadmap.md`：分阶段施工计划和每阶段完成定义。
- `docs/test-and-acceptance-plan.md`：烟测、实测、验收标准。
- `docs/technical-notes.md`：协议、后端、平台限制等技术记录。
- `docs/safety-and-acceptance.md`：安全硬约束和阶段验收原则。
- `marketing/wechat-article.md`：微信公众号推文草稿。
- `marketing/video-script-prompt.md`：项目介绍视频稿本提示词。
- `marketing/demo.html`：可本地打开的演示 HTML。

## 当前已验证事实

- Mac Relay App 可以本地启动 Relay 并读取 Codex Desktop 会话。
- Mac 输入 helper 通过辅助功能把手机文本提交到 Codex Desktop 当前线程。
- 公网 Broker 模型已落地，Android Endpoint 可以使用 `https://broker.example.com/r/my-mac` 这类稳定入口。
- Android App 已支持 Endpoint/Token、线程列表、发送输入、上传附件、主题切换和在线更新检查。
- `1.1.12-status-context-fix` 已把手机 UI 收敛为用户输入和 Codex 文本结果，默认隐藏工具调用、环境上下文和内部桥接事件。
- Android 更新源已经改成构建时配置，仓库不再绑定个人服务器或域名。

## 当前不应再继续的方向

- 不把首页做成连接诊断页。
- 不做远程桌面画面同步。
- 不把主工作流降级成 `codex exec` 或独立 CLI 会话。
- 不修改 Codex Desktop 安装目录、系统环境变量、注册表或全局防火墙策略。
- 不把手机另开的 app-server 会话伪装成 Desktop 当前窗口的同步控制。
- 不再把早期扫码网页 bridge 作为当前主线。
- 不在仓库提交 APK、`.app`、`node_modules`、上传文件、token 或本地日志。

## 当前施工顺序

1. 以 Mac Relay App + Android App + Broker 作为当前主线。
2. 保留旧扫码方案的历史记录，不再保留旧代码。
3. 优先保证小白能下载、构建、打开 Mac App、安装 Android App、填写 Broker Endpoint。
4. 继续优化远程稳定性、开机自启动、日志诊断和在线更新体验。
5. 后续再评估多会话、多设备和手机审批能力。

## 文档维护规则

- 做代码改动前，确认改动属于哪个阶段。
- 每次 APK 构建、Relay 实测、手机真机测试，都要更新 README 或对应 docs。
- 每次改变架构判断，要更新 `docs/architecture-feasibility.md` 或 `docs/remote-broker.md`。
- 每次改变产品范围或交互方式，要更新 `docs/product-requirements.md` 或 `docs/ui-interaction-spec.md`。
