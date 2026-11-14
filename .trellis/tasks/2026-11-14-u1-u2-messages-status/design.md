# 实施边界

差距在共享 MessageBubble/MessageTimeline、ComputerComposer/SessionStatus 及 App/AgentWorkspace 接线，改动不跨 Relay/Flutter，也不更改状态推断和消息数据模型。

- MessageTimeline 根据同 turnId 的非工具助手消息传展示 continuation 标记，工具卡片不打断；用户消息/换 turnId 重置，缺 turnId 时退回相邻规则；保留独立 article、data-message-id/role、去重 key 与过程摘要。
- MessageBubble 用独立交互 hook 管理点击/聚焦、长按计时与异步复制反馈；移动/取消/卸载清理，交互子元素不触发复制，不写存储。代码与表格区域（pre/code/.code-block/table，含子元素）的长按不触发整条复制，也不阻止原生 contextmenu。
- 系统消息/连接错误使用细横幅与现有图标；CSS 使用 U0 颜色、字号、间距令牌。
- ComputerComposer 上方统一状态栏承载当前状态、必要的上轮结果和停止按钮。保留 canSend/canStop/deliveries、默认排队和快捷键条件。终态不重复显示，旧轮结果的原因和时间继续可见。
- scripts/test-mobile-rendering.mjs 增加 SSR 回归与真实 hook 隔离驱动，现有工具/S2 矩阵继续运行。布局及原生长按/剪贴板只声明待视觉/真机验收。

不修改工作流、发送协议、审批权限、持久化、宿主调色板或其他 U 系列组件。
