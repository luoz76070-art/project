# W4 进度自动回写

- `apps/relay/src/workItems/progress.ts` 的 `WorkItemProgress` 订阅事项存储。卡片最后一次交接还需要推进时，它就对交接目标开一个只读观察：用 `openHandoffTarget` 加 `onChange` 回调，同时最多 8 个，交接超过 24 小时就不再跟踪。
- 推进只走 W1 状态机，系统身份执行：
  - 交接送达后，用 `recordDelivery` 把状态改成进行中，绑定 clientMessageId。
  - `bindTurn` 记录是哪个原生回合消费了这条消息。
  - 用 `applyTurnResult` 处理回合结果：完成转为待验证，失败或中断转为退回。
  - 到不了“完成”，也不会覆盖用户已经做的操作。
- 排队中的交接，要等到消息真正被消费才转为进行中。“结果不明”的交接不会自己推进；用户核对后标记“已收到”，才开始跟踪。
- 只有 Codex 桌面端能精确对应回合：用户消息带 clientMessageId 和 turnId，再拿 lastTurn 比对。三个 Agent 通道送达后只转为进行中，之后由用户手动标记，精确对应留给 W4b。
- relay 重启后，只要 `.mobile-codex/work-items.json` 存在，就按已持久化的绑定恢复跟踪。工作区没用过事项功能时，不会因此新建存储文件。
- 手机端卡片的状态操作（`ItemStateActions`）：
  - 待验证：验收通过 / 退回（要填原因）。
  - 进行中：标记为待验证 / 退回。
  - 退回或完成：重新打开。
  - 另有“刷新状态”。由系统自动推进的状态会注明“由 Agent 进度自动更新”。
