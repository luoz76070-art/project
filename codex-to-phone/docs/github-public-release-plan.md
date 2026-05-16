# GitHub 公共发布与复用计划

更新时间：2026-05-16

## 目标

把当前 Mobile Codex 项目整理成一个其他用户可以从 GitHub 下载、部署、构建、安装并复现的项目。

当前功能已经从最早的扫码网页同步，演进为：

- Android Capacitor APK；
- Mac 本地 `Mobile Codex Relay.app`；
- Mac 辅助功能输入 Helper：`Mobile Codex Input.app`；
- 公网 Broker 架构；
- Android 到 Mac 的远程控制链路；
- 手机端平滑 Codex 回复显示；
- 工具调用摘要卡片；
- Android 在线更新 manifest + APK 发布通道。

后续发布到 GitHub 时，不能把当前目录原样上传。需要把源码、配置示例、部署脚本、文档和构建产物边界整理清楚。

## 当前已实现能力

1. 手机端从浏览器网页变成 Android APK。
2. PC 端从临时 bridge 变成 `Mobile Codex Relay.app`。
3. 新增公网 Broker 架构：

   ```text
   Android App -> Public Broker HTTPS -> Mac outbound WebSocket tunnel -> Local Relay -> Codex Desktop
   ```

4. 不再依赖同 Wi-Fi、LAN、热点或 Cloudflare quick tunnel。
5. 新增 macOS Codex 输入注入：

   ```text
   Mobile Codex Input.app + Accessibility permission
   ```

6. 修复 Codex 输入框焦点问题，手机发送可以进入当前 Codex 窗口。
7. 新增 Android 在线更新：

   ```text
   latest.json -> APK download URL
   ```

8. 已发布过：

   - `1.1.5-online-update`
   - `1.1.6-ui-rendering`
   - `1.1.7-ui-send-fix`
   - `1.1.8-ui-stream-polish`

9. 手机 UI 新增平滑 Codex 回复显示。
10. 工具调用改成摘要卡片，默认不暴露完整命令和日志。
11. 服务器已部署 `mobile-codex-broker` systemd 服务。
12. 当前示例公网入口：

   ```text
   https://zyzlz.xin/mobile-codex/
   ```

## 2026-05-16 1.1.8 UI 流式与遮罩优化记录

本次目标是修复 `1.1.7-ui-send-fix` 之后的四个体验问题：

- PC 输出已经结束后，手机端仍显示“正在生成，桌面同步输出”；
- 桌面输出经常等 PC 完成后才一次性进入手机 UI，长文本等待感明显；
- 工具调用会出现空白输出卡片；
- 设置页和会话抽屉遮罩太透明，内容互相重叠。

已做的改动方向：

- Relay 增加 `/api/desktop/threads/:id/events` tokenized SSE，尝试把 Codex Desktop IPC 的 `thread-stream-state-changed` 状态补丁转成手机端可消费的实时消息；
- Android 端桌面线程优先接 Desktop SSE，失败时保留原有 rollout delta 轮询兜底；
- rollout 兜底收到 assistant 输出后明确写入 `completed`，清理 `sending` 和 `activeTurnId`，避免完成后继续显示生成状态；
- 新增 `smoothMessageId`，只对本轮新到的 Codex 输出做打字机渲染，完成后自动清除光标；
- 调整打字机节奏，长文本用更大的自适应 chunk，减少“等很久后一整段跳出”的观感；
- 工具卡片只展示摘要；`Tool: name`、`Codex turn started` 这类低信息原文不再渲染为空白输出块；
- 设置页遮罩改为近不透明；会话抽屉遮罩加深，面板使用更实的背景，避免和主界面文字重叠；
- 已创建本地备份：`backups/20260516-1.1.8-ui-stream-polish/`。

上线前必须确认：

```bash
corepack pnpm --filter @mobile-codex/relay typecheck
corepack pnpm --filter @mobile-codex/mobile typecheck
corepack pnpm --filter @mobile-codex/relay build
corepack pnpm --filter @mobile-codex/mobile build
corepack pnpm android:apk:mac -- 1.1.8-ui-stream-polish
```

限制说明：Desktop IPC 流式输出依赖 Codex Desktop 私有状态补丁。如果当前机器没有 `/tmp/codex-ipc/ipc-<uid>.sock`，或 Codex Desktop 只在结束时写入状态，手机端会自动回退到 rollout 轮询和本地打字机补偿。

上线结果：

- Manifest：`https://zyzlz.xin/mobile-codex/releases/android/latest.json`
- APK：`https://zyzlz.xin/mobile-codex/releases/android/mobile-codex-1.1.8-ui-stream-polish.apk`
- `versionName=1.1.8-ui-stream-polish`，`versionCode=9`
- SHA256：`d4b4ef07487f6a4c75baf1b0d1162721a131764bf87b12ff9b6765bff7d4dfb9`
- APK 大小：`4052287` bytes
- 线上 APK HTTP 校验：`200 OK`，`content-type=application/vnd.android.package-archive`

## 2026-05-16 1.1.7 待上线修复记录

本次目标是修复 `1.1.6-ui-rendering` 中用户反馈的三个问题：

- 手机端消息和 PC 回复在 UI 中重复显示；
- 手机端发送后出现失败提示，但实际可能已经注入到 Codex；
- 手机界面元素偏多，不够简洁。

已做的改动方向：

- 在 Android 渲染层增加展示去重，只折叠 UI 中重复的 user/assistant 气泡，不改变真实会话历史和发送链路；
- 增加简洁的“思考中 / 正在生成 / 等待审批”运行状态；
- 调整平滑输出节奏，避免大段跳出；
- Android WebView 允许使用 tokenized SSE，失败时继续回落到轮询；
- macOS UI injector 的“提交后日志校验未及时读到”改为 warning，不再把 helper 已提交误判成发送失败；
- Relay 历史读取只去掉完全相同的重复记录；短时间内用户故意重复发送的同文本消息不在读取层丢弃；
- 简化手机端顶部和输入区状态文案，隐藏复制 Thread ID / rollout 路径等普通用户不需要的入口；
- 移动端窄屏下隐藏重复会话标题和消息复制按钮，保留单一顶部状态、消息流、桌面连接提示和输入框；
- 手机发送走 macOS UI injector 时，如果 helper 已提交但日志校验暂未确认，手机端显示“等待同步确认”而不是失败；
- 发布脚本默认从 Android `build.gradle` 读取当前 `versionName` / `versionCode`，避免生成旧版本 manifest；
- 已创建本地备份：`backups/20260516-1010-ui-send-fix/`。

上线前必须确认：

```bash
corepack pnpm --filter @mobile-codex/mobile typecheck
corepack pnpm --filter @mobile-codex/relay typecheck
corepack pnpm --filter @mobile-codex/mobile build
corepack pnpm --filter @mobile-codex/relay build
corepack pnpm android:apk:mac -- 1.1.7-ui-send-fix
```

本轮已补充 UI 截图审核：

- 截图：`output/playwright/mobile-codex-1.1.7-ui-after.png`
- 结果：输入框和发送按钮可见；重复会话标题已移除；消息复制入口在手机宽度下隐藏；桌面连接状态仍可见。

上线结果：

- Manifest：`https://zyzlz.xin/mobile-codex/releases/android/latest.json`
- APK：`https://zyzlz.xin/mobile-codex/releases/android/mobile-codex-1.1.7-ui-send-fix.apk`
- `versionName=1.1.7-ui-send-fix`，`versionCode=8`
- SHA256：`9814361ba7aeda5f64a7a1be6f0014f8a64fd548290437746801523b703416be`
- 线上 APK HTTP 校验：`200 OK`，`content-type=application/vnd.android.package-archive`

## 2026-05-16 连接超时排查记录

现象：手机端发送后出现连接超时。

排查结论：

- 本机 Relay、远程 Broker、公网转发 `/health` 均正常；
- Codex app-server 进程存在，但本次超时不在 app-server 链路；
- 慢点在 macOS UI injector 提交后等待 rollout 日志确认，发送 POST 曾耗时约 11 秒。

已调整：

- `MOBILE_CODEX_UI_VERIFY_TIMEOUT_MS` 默认从 10 秒缩短为 1.5 秒；
- helper 已提交后快速返回，若日志暂未确认则返回 warning，由手机端轮询继续补齐消息显示。

补充排查：

- 发现多个 `Mobile Codex Input.app` helper 进程停在 `T` 状态；
- 最新一次请求只有 `/tmp/mobile-codex-input-request.json`，没有生成 result，说明 helper 未完成；
- 已清理卡住的 helper 进程；
- Relay 注入器现在会在每次发送前清理旧 helper，启动后主动 `CONT` 唤醒；
- helper 4.5 秒内仍未返回时，会终止 helper 并回退到 AppleScript，避免手机继续等到连接超时。

## GitHub 仓库应保留的内容

保留源码和可复现配置：

- `apps/mobile`
- `apps/relay/src`
- `scripts/*.sh`
- `scripts/*.mjs`
- `scripts/helper/*.swift`
- `docs`
- `generated-protocol`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.env.example`
- `.gitignore`
- `README.md`

## GitHub 仓库应排除的内容

不要上传本机构建产物、依赖、临时文件、账号和密钥：

- `node_modules`
- `apps/*/dist`
- `apps/mobile/android/app/build`
- `apps/mobile/android/.gradle`
- `apps/mobile/android/build`
- `dist-apk`
- `Mobile Codex Relay.app`
- `Mobile Codex Input.app`
- `.DS_Store`
- 本机 token
- SSH key
- 服务器密码
- 真实 `relaySecret`
- 本机 `.codex` 数据
- 本机日志、上传文件、临时状态文件

## 必须先做的公共化改造

### 1. 参数化更新地址

当前 Android App 的在线更新地址仍绑定到当前域名。需要改成构建环境变量：

```text
VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL
```

默认值可以是空或示例地址，不应该把用户个人域名写死在公共源码里。

### 2. 参数化发布脚本

`scripts/publish-android-update.sh` 需要改成完全示例化：

- 默认不写死服务器 IP；
- 默认不写死 SSH key；
- 默认不写死 `zyzlz.xin`；
- 通过环境变量传入：

```text
MOBILE_CODEX_RELEASE_HOST
MOBILE_CODEX_RELEASE_SSH_KEY
MOBILE_CODEX_RELEASE_DIR
MOBILE_CODEX_RELEASE_BASE_URL
```

### 3. 增加部署示例目录

新增：

```text
deploy/nginx/mobile-codex.conf.example
deploy/systemd/mobile-codex-broker.service.example
deploy/config/config.example.json
```

这些文件只放示例，不放真实密钥。

### 4. 整理 `.gitignore`

确保排除：

```text
node_modules/
dist/
dist-apk/
*.app/
.DS_Store
*.log
mobile-uploads/
apps/mobile/android/.gradle/
apps/mobile/android/build/
apps/mobile/android/app/build/
apps/relay/dist/
.env
.env.local
```

是否提交 `apps/relay/dist` 需要单独决定：

- 源码型仓库：不提交 `dist`，用户本地 build。
- 零构建部署型仓库：可以提供 release artifact，但不放主分支。

推荐源码型仓库。

### 5. 重写 README

README 需要面向普通用户重写，包含：

- 项目是什么；
- 架构图；
- Mac 本地安装；
- Android APK 安装；
- Broker 自托管；
- 在线更新；
- 权限说明；
- 常见错误；
- 安全提醒。

### 6. 新增 Quickstart 文档

建议新增：

```text
docs/quickstart.md
docs/self-hosting.md
docs/android-build.md
docs/mac-relay-app.md
docs/troubleshooting.md
```

## 推荐发布结构

GitHub 仓库只放源码和文档。

APK 放两个位置之一：

1. GitHub Releases；
2. 用户自己的公网服务器。

推荐流程：

```text
GitHub main branch -> source code
GitHub Releases -> APK / packaged Mac app
User server -> broker + update manifest + optional APK mirror
```

## 复用者部署路线

### 普通用户路线

1. 下载 GitHub Release 的 Mac App 和 Android APK。
2. 在 Mac 打开 `Mobile Codex Relay.app`。
3. 按提示授权辅助功能。
4. 在 Android App 填写 Endpoint 和 Token。
5. 开始远程控制 Codex。

### 自托管用户路线

1. 准备一台公网服务器和域名。
2. 部署 Broker：

   ```bash
   corepack pnpm install
   corepack pnpm --filter @mobile-codex/relay build
   node apps/relay/dist/brokerServer.js
   ```

3. 配置 systemd 托管 Broker。
4. 配置 nginx 反代：

   ```text
   /mobile-codex/ -> 127.0.0.1:18888
   ```

5. Mac Relay App 配置：

   ```json
   {
     "port": 8787,
     "token": "mobile-codex-CHANGE-ME",
     "brokerUrl": "https://your-domain.example/mobile-codex",
     "relayId": "my-mac",
     "relaySecret": "replace-with-long-random-secret"
   }
   ```

6. Android App 填写：

   ```text
   Endpoint: https://your-domain.example/mobile-codex/r/my-mac
   Token: mobile-codex-CHANGE-ME
   ```

## 发布前验证清单

在推 GitHub 前必须跑：

```bash
corepack pnpm typecheck
corepack pnpm --filter @mobile-codex/relay build
corepack pnpm --filter @mobile-codex/mobile build
corepack pnpm mac:package
corepack pnpm android:apk:mac -- mac-remote
```

还需要做一次干净目录复现：

```bash
git clone <repo>
cd <repo>
corepack pnpm install
corepack pnpm typecheck
corepack pnpm mac:package
corepack pnpm android:apk:mac -- mac-remote
```

## 风险与边界

- macOS 输入注入依赖辅助功能权限。
- Android 侧载 APK 无法静默更新，必须经过系统安装确认。
- Codex Desktop 内部 IPC 不是稳定公共 API，未来版本可能变化。
- Broker 当前是简单中继，生产级需要增加更强认证、连接审计、限流和多设备管理。
- 当前在线更新 manifest 没有签名校验，后续应增加签名或固定公钥校验。

## 下一步执行顺序

1. 参数化 Android 更新地址。
2. 参数化发布脚本。
3. 新增 `deploy/` 示例配置。
4. 完善 `.gitignore`。
5. 重写 README 和 Quickstart。
6. 清理本机构建产物。
7. 用干净目录完整复现。
8. 初始化 git 仓库或对接目标 GitHub 仓库。
9. 推送源码。
10. 创建 GitHub Release 并上传 APK。
