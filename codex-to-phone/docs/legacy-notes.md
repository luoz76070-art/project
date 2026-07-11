# Legacy Notes

这份文件只保留 Codex To Phone 早期实现的“完成内容”和“局限性”。旧 bridge、Cloudflare Quick Tunnel、Codex 本地 skill 以及 `Codex Live Session Input.app` 相关代码已经从当前源码主线清理，避免污染当前 App 架构。

## 早期目标

早期目标是做一个“会话级插件”：用户在某个 Codex Desktop 会话里启动插件，手机扫码后只连接这一个会话，从启动到关闭期间同步当前内容，不保存历史会话。

## 完成过的内容

- 证明 PC 到手机的基本可见链路可行。
- 证明二维码配对、短 token、session 绑定可以限制到单个会话。
- 证明启动时只回填上一轮对话，比全量导入历史更符合远程控制场景。
- 证明手机到 PC 的输入需要让 Codex Desktop 当前窗口参与，否则 PC UI 无法看到实时回复过程。
- 验证 bridge-owned `codex app-server` 能恢复同一个 thread 并生成回复。
- 验证 bridge-owned app-server 不是最终方案，因为 Desktop 当前窗口不订阅这个后台运行时。
- 验证 macOS 可见 UI 注入路线可用：打开 `codex://threads/<threadId>`，再通过辅助功能把手机文本提交到 Codex Desktop 输入框。
- 验证 Cloudflare Quick Tunnel 可以临时把本地页面暴露到公网，便于快速测试蜂窝网络访问。
- 验证公网 Relay/Broker 模型比临时隧道更适合长期远距离使用。

## 主要局限

- 扫码网页体验弱，无法替代真正的手机 App。
- Cloudflare Quick Tunnel 地址临时变化，不适合长期稳定使用。
- LAN 二维码只能解决同网段测试，不符合用户离开 PC 网络的需求。
- Desktop IPC 的 owner/follower 输入控制在 Mac 当前窗口场景下不稳定。
- 后台 app-server 能写 thread，但 PC Codex Desktop UI 不会实时显示这一轮过程。
- macOS UI 注入依赖辅助功能授权、窗口聚焦和输入框可见，不能当成完全后台能力。
- 旧 skill/plugin 启动方式对普通用户仍然偏复杂，不如可双击启动的 Mac App。
- 旧手机网页混入桥接事件、工具调用空卡、完整代码 diff 和内部 ack，信息密度过高。

## 当前处理

- 旧实现不再作为源码主线保留。
- 历史只作为架构演进和限制说明保留在本文档与 README 中。
- 当前主线是 `Mobile Codex Relay.app` + Android App + 公网 Broker。
