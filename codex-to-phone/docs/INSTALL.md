# Codex To Phone 新手安装手册

这份手册面向第一次使用的人：按顺序执行即可从 GitHub 下载、安装、扫码连接手机，并让手机向当前 Codex 窗口发送输入。

## 1. 准备条件

- macOS 电脑。
- 已安装并登录 Codex Desktop。
- 手机可以扫码，蜂窝网络或 Wi-Fi 都可以。
- Homebrew，用于安装 Cloudflare Tunnel。
- Node.js 22 或更高版本。
- Xcode Command Line Tools，用于编译本地输入 helper。

安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

安装 Cloudflare Tunnel：

```bash
brew install cloudflared
```

确认 Node.js 版本：

```bash
node -v
```

如果版本低于 22，先升级 Node.js。

## 2. 下载项目

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/codex-to-phone
npm install
```

## 3. 先跑体检

```bash
npm run doctor
```

体检会检查：

- 当前是不是 macOS；
- Node.js 版本是否满足要求；
- `cloudflared` 是否可用；
- `swiftc` 是否可用；
- `/Applications/Codex.app` 是否存在；
- helper 是否能构建。

如果有失败项，先按体检输出的提示修复。

## 4. 不安装插件，直接运行

先打开 Codex Desktop，并切到你希望同步到手机的会话窗口。然后运行：

```bash
npm start
```

终端会输出：

- PNG 二维码图片路径；
- 当前绑定的 thread id；
- 当前读取的 rollout 文件路径。

用手机扫描二维码。手机会打开一个网页，显示当前会话进展。

## 5. 允许手机向 PC 发送消息

第一次从手机发送消息时，macOS 可能会拦截本地输入 helper。请打开：

```text
系统设置 > 隐私与安全性 > 辅助功能
```

允许：

```text
Codex Live Session Input.app
```

这个 helper 是项目启动时自动构建的本地 App，用来把手机输入粘贴到当前 Codex 输入框并回车发送。授权后再次从手机发送消息即可。

## 6. 安装为 Codex 本地插件

只需要执行一次：

```bash
npm run plugin:install
```

这会创建或刷新：

- `~/plugins/codex-to-phone`；
- `~/.agents/plugins/marketplace.json` 里的本地插件入口。

安装后重启 Codex Desktop。

然后在 Codex 里说：

```text
启动 Codex To Phone
```

Codex To Phone skill 会运行：

```bash
cd <plugin-root>
npm install
npm run plugin:start
```

它会在后台启动服务，并把二维码图片作为最终输出。

## 7. 日常使用

启动：

```text
启动 Codex To Phone
```

查看状态：

```text
查看 Codex To Phone 状态
```

停止：

```text
停止 Codex To Phone
```

对应命令：

```bash
npm run plugin:start
npm run plugin:status
npm run plugin:stop
npm run plugin:url
npm run plugin:lan
```

## 8. 手机页面会显示什么

手机页面会显示：

- 用户输入；
- Codex 回复，优先使用 Desktop IPC 状态补丁做增量同步；
- 平滑流式输出，前端会把突发 delta 缓冲成打字机效果；
- 简化后的工具进度，例如“搜索代码”“读取 bridge.mjs”“修改文件”“运行项目检查”；
- 工具失败摘要和连接状态。

它会隐藏：

- 完整代码补丁；
- 完整命令输出；
- bridge 内部 accepted/sending/sent 确认消息。

当前默认链路是：

```text
Codex Desktop 当前窗口
  -> Desktop IPC 状态补丁 + rollout 事件补充
  -> 本地 bridge
  -> Cloudflare Tunnel
  -> 手机 Web UI
```

手机向 PC 发送消息时仍走可见 UI 注入：

```text
手机输入
  -> bridge
  -> 打开 codex://threads/<threadId>
  -> Codex Live Session Input.app 粘贴并回车
  -> Codex Desktop 当前窗口执行
```

## 9. 更新

```bash
cd project
git pull
cd codex-to-phone
npm install
npm run plugin:install
```

如果插件说明或 skill 有更新，重启 Codex Desktop。

## 9.1 验证当前 checkout 是否可用

每次更新后建议运行：

```bash
npm install
npm run check
npm run doctor
npm run plugin:install
```

`npm run check` 只检查项目脚本语法；`npm run doctor` 会检查本机是否满足 macOS、Node.js、`cloudflared`、`swiftc` 和 Codex Desktop 等运行条件。

## 10. 常见问题

如果 `cloudflared` 缺失：

```bash
brew install cloudflared
```

如果提示 `Missing swiftc`：

```bash
xcode-select --install
```

如果二维码没有出现：

```bash
npm run plugin:status
npm run plugin:url
tail -120 ~/.codex-to-phone/service.log
```

如果 Android 浏览器报 `-2`，说明手机可能无法解析 Cloudflare 临时域名。手机和电脑在同一个 Wi-Fi 时可以使用 LAN 兜底二维码：

```bash
npm run plugin:lan
```

如果手机发送失败并提示 macOS 权限错误，请给 `Codex Live Session Input.app` 辅助功能权限。启动脚本会复用现有 helper，只有 Swift 源码变化才重新构建，所以授权后通常不会反复失效。

如果 `npm run plugin:install` 提示已有旧插件路径，脚本会自动更新指向旧 checkout 的 symlink；如果本地存在同名普通目录，先备份里面的内容，再运行：

```bash
npm run plugin:install -- --force
```

配对二维码只对本次启动有效。二维码里包含短 token 和绑定的 `session=<threadId>`，bridge 会拒绝不匹配的请求。

如果手机页面打开后没有立即更新，等几秒或刷新页面。页面有 polling 兜底，Cloudflare SSE 延迟时也能同步。
