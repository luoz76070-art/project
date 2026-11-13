# 设计

shared/activityEvidence.d.ts 仅共享声明；Relay 白名单投影有界单条证据，经已有快照/SSE 到手机，旧 activity 保留。手机 sessionStatus 负责归一化与纯推导，SessionStatus 统一展示，TurnResultNotice 兼容已有调用。

实时有效性、当前轮身份优先：pending 交互为等待，starting 为准备，thinking 为思考，working/outputting 为执行。提交回执与连接错误保持独立；未知当前轮不回退为上轮成功。断线只保留已知 lastTurn。

范围：Codex live/desktop/rollout 投影、三 Agent 适配器及 DeepSeek bridge、手机同步和现有状态挂点、相关测试。不开新控制路由、不改 Claude 插件、不改权限/发送策略、不部署、不新增持久化。

自审：组件仅展示，不使用状态推导授予控制能力；新字段可选，旧服务缺证据时少显示；五乘七展示夹具与通道真实可达性分开验收。

## 实施细节与边界

- 纯模型文件为 `sessionStatusModel.ts`，避免 macOS 上与 `SessionStatus.tsx` 的大小写解析冲突；组件使用现有 CSS 和挂载位置，权限与停止条件不依赖展示结果。
- activityEvidence.kind 仅 thinking/working/outputting，turnId 长度 1–512，observedAt 为最多 32 字符的 ISO 时间。每个活动会话只保留当前轮一条，复用已有会话容量限制；不带正文，不额外写历史或持久化。
- Desktop native 只投影当前轮明确 inProgress/running 的 item；rollout 缺可归属的 turnId 时不猜。Relay Codex 将 item/reasoning/输出事件投影，换轮、item 结束、轮次结束、断开清除；willRetry 和中断 ACK 不结算。
- Claude 使用原有 state/text/tool，仅 Relay 改动；准备阶段及未上报失败仍未知。DeepSeek 使用 turn/start、工具和 stream 活动，旧插件缺证据字段时仍可显示可靠 lastTurn 和交互状态。
- OpenCode v2 没有原生 turnId，以已知 idle 边界后的首个用户输入 ID 作为当前轮标识；分页窗口没有可验证起点时不投影活动。事件必须带匹配会话及不早于当前轮开始的时间；正在运行的工具快照可提供执行证据。
- 断线只保留已知结果，不把旧活动恢复为当前；新轮未知时不使用上一轮结果冒充当前完成。旧 activity 字段继续兼容，但统一组件不使用其默认值。
- 35 格验证共享七态显示；实际通道可达性单独测试，不声称三个 Agent 当前能提供准备信号，也不虚构 Claude 未上报的失败。
