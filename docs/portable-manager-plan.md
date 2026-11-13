# Portable Manager 施工文件

更新时间：2026-05-12

## 本轮用户硬性要求

- APK 先修 bug：
  - 发消息会自动发送两条。
  - 设置界面/弹层透底，下面内容仍可见，界面混乱。
  - 打断和运行提示按钮文字过多，遮挡聊天窗口。
  - 所有复制按钮不可用。
- 后续做一键操作：
  - 提供一个 bat 界面或窗口界面。
  - 打开后可自动开启项目。
  - 支持设置开机自启。
  - 第一次打开可配置 IPv4、IPv6。
  - 每个配置按钮旁都有 HTML 教程。
  - 每个配置项都有测试按钮。
  - 项目可放到任何电脑使用，不只绑定当前电脑。
  - 停掉原有进程后，打包成轻量化独立项目文件。
  - 不必要文件不要带。
  - 必须实测 portable 包能配置并运行。
- 所有历史操作必须落到工程记忆文件。

## 施工拆分

### Phase M1：APK Bug Fix

目标：先解决用户正在使用 APK 的阻断问题。

任务：

- 给发送逻辑加同步锁，防止双击、Enter 与按钮、状态更新延迟导致重复发送。
- 设置面板打开时增加完整遮罩，遮罩不透底。
- 控制提示改为紧凑状态条，打断按钮只保留图标或短按钮。
- Android/Capacitor 下复制改用 Clipboard 插件，Web 下再回退 `navigator.clipboard`。
- 重新构建 APK、验签、记录烟测。

### Phase M2：Windows Manager 原型

目标：提供可配置、可测试、一键启动的管理器。

建议形态：

- 第一版用 PowerShell WinForms 图形界面，原因：
  - Windows 自带，不需要引入 Electron/.NET 打包。
  - 轻量。
  - 可以直接调用现有脚本。
  - 适合 portable 包。

功能：

- 显示项目目录、Node/pnpm/Codex 状态。
- Token 配置与随机生成。
- IPv4 模式：
  - Host: `0.0.0.0`
  - Port: `8787`
  - 打印局域网 Endpoint。
  - 测试 `/health`、`/api/threads`、`/api/live/health`。
- IPv6 模式：
  - Host: `::`
  - Port: `8787`
  - 显示本机公网 IPv6。
  - 配置 DDNS 域名。
  - 测试本机 `[::1]`、本机公网 IPv6、域名访问。
- 开机自启：
  - 使用当前用户 Startup 快捷方式或计划任务。
  - 默认只配置当前用户，不改系统级服务。
- 日志查看：
  - Relay stdout/stderr。
  - 最近 smoke 结果。

### Phase M3：HTML 教程

目标：每个配置项点“教程”可打开本地 HTML。

文件：

- `docs/html/ipv4-lan.html`
- `docs/html/ipv6-ddnsgo.html`
- `docs/html/token-security.html`
- `docs/html/autostart.html`
- `docs/html/troubleshooting.html`

### Phase M4：Portable 打包

目标：生成轻量独立目录。

初步保留：

- `apps/relay/dist`
- `apps/mobile/dist`
- `apps/mobile/android` 不默认带入 portable，APK 单独放 `dist-apk`
- `dist-apk/mobile-codex-debug.apk`
- `scripts`
- `docs`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.env.example`
- `start-relay.bat`
- `start-relay-ipv6.bat`
- 新增 manager 启动脚本

初步排除：

- `node_modules`
- `.tools`
- `.tmp`
- Android build staging
- 历史日志
- 临时 smoke 输出

注意：

- 真正“任何电脑可运行”仍要求目标电脑安装 Node.js/pnpm 和 Codex Desktop。
- 如果要完全免 Node.js，需要后续把 Relay 打包成单 exe，这属于下一阶段。

## 本轮验收

- APK bug fix 版生成并验签。
- 工程记忆文件更新。
- Portable Manager 方案文件存在。
- 下一阶段再实现 manager 和 portable 包。
