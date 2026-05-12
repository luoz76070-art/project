# Codex To Phone

把一个正在打开的 Codex Desktop 会话同步到手机端，并允许手机向当前会话发送输入。

当前版本是可复现 MVP：PC 端启动本地 bridge，Cloudflare Quick Tunnel 暴露临时 HTTPS 通道，终端输出二维码，手机扫码后进入轻量 Web UI。

这个目录同时也是一个 Codex 本地插件：包含 `.codex-plugin/plugin.json` 和 `skills/codex-to-phone/SKILL.md`。安装插件后，可以在 Codex 里用自然语言启动、停止和查看状态。

## 能力

- 手机实时查看当前 Codex 会话的用户输入、Codex 回复、工具调用摘要和最终结果。
- 手机发送消息后，通过 Codex Desktop 本地 IPC 让当前 PC 窗口发起新回合。
- 手机 UI 默认隐藏代码补丁、命令完整输出和 bridge 内部 ack，只展示输入、输出和工具名称。
- 每次启动生成短期 token 和临时公网 URL；bridge 退出后本次配对失效。
- 默认不保存手机端历史，不导入旧会话全量历史。

## 前置条件

- macOS 上已运行 Codex Desktop。
- 当前 Codex Desktop 窗口打开了你要同步的会话。
- Node.js 22 或更高版本。
- `cloudflared` 已安装：

```bash
brew install cloudflared
```

## 快速开始

直接命令启动：

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/codex-to-phone
npm install
npm start
```

启动后终端会输出二维码。用手机扫码即可打开当前会话页面。

如果脚本没有自动识别到正确的 Codex 会话，可以显式传入 rollout 文件和 thread id：

```bash
npm start -- \
  --rollout-file ~/.codex/sessions/<date>/rollout-<session>.jsonl \
  --thread-id <session-id>
```

## 安装为 Codex 插件

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/codex-to-phone
npm install
npm run plugin:install
```

然后重启 Codex Desktop。在 Codex 里说：

```text
启动 Codex To Phone
```

Codex 会根据插件 Skill 运行后台服务，并把二维码作为最终输出。

常用自然语言：

```text
启动 Codex To Phone
查看 Codex To Phone 状态
停止 Codex To Phone
```

对应命令：

```bash
npm run plugin:start
npm run plugin:status
npm run plugin:stop
npm run plugin:url
```

## 当前实现

PC 到手机：

1. bridge 读取当前 Codex rollout JSONL。
2. 启动时回填上一轮完成回合和当前活跃回合。
3. 运行时 tail rollout，把事件转换成手机 UI 需要的轻量事件。
4. 手机端使用 SSE + polling 双通道接收，Cloudflare SSE 不稳定时仍可轮询同步。

手机到 PC：

1. 手机 `POST /input` 发送文本。
2. bridge 连接 Codex Desktop 本地 IPC socket。
3. bridge 注册为 IPC client 后发送 `thread-follower-start-turn`。
4. 拥有该会话的 Codex Desktop 窗口发起新 turn，因此 PC UI 和手机端都能看到过程。
5. bridge 校验该输入写入绑定的 rollout，避免误发到旁路会话。

## 常用命令

```bash
npm run check
npm run plugin:start
npm run plugin:status
npm run plugin:stop
node scripts/start-cloudflare-tunnel.mjs --help
node scripts/bridge.mjs --help
```

## 已知限制

- 当前只绑定一个会话窗口。后续可以扩展为多个 bridge session，并在手机端做会话列表和切换。
- Cloudflare Quick Tunnel 是临时测试通道，不适合作为正式产品后端。
- 如果 PC 端没有打开对应 Codex Desktop 会话窗口，Desktop IPC 会返回找不到 owner 窗口。
- 远程审批、文件确认和多端权限控制还没有做成手机端能力。

## 后续更新

后续更新会继续同步到这个仓库的 `codex-to-phone/` 目录。用户更新方式：

```bash
git pull
cd codex-to-phone
npm install
npm run plugin:install
```

如果已经安装过本地插件，`plugin:install` 会刷新 marketplace 条目并继续指向当前 checkout。
