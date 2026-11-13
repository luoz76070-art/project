# 当前会话手机验收

日期：2026-10-21

## 输出结束后卡片保留复测

第二张恢复测试卡随后由用户明确反馈“手机端看不到这个卡片”，不能计为后台/切网通过。原生只读状态确认父轮次已completed，旧Relay仅投影inProgress异步题。修复、回归及固定网关更新见[生命周期修复](codex-question-lifecycle.md)。下文为当时观察。

接续工作转到当前会话`01a15dc8-0d94-77b1-94a5-a2bcb7378d48`。在助手最终回复结束后，用户对重新发出的“卡片保留复测”返回结构化原题回复“回复结束后卡片仍可见”。本次卡片保留和回复回到同一会话通过；后台/切网仍待实测，不能由本次回复推断。脱敏复核证据为`output/audit/2026-10-21/question-lifecycle-phone-acceptance.json`。

用户报告手机设置显示`v1.3.0-deepseek-dedup-preview`，并明确使用当前开发会话。该确认解除此前“缺少实际版本和指定原会话”的前置阻塞；旧状态保存在`output/audit/2026-10-21/acceptance-gate-before-user-confirmation.json`。未通过ADB读取versionCode，不将用户报告扩大为所有真机项目已通过。

## 本轮观察

- 本地/公网`/api/connection`均200，网关native、Tunnel connected；Desktop health为200、`desktop-ipc-follower-control`且IPC连接正常。
- 使用现有异步提问工具在当前原会话发出一张无副作用验收卡，由用户在手机选择提交。
- 有截止时间的公网v1订阅直接使用当前手机`createSnapshotReducer`；约3.42秒出现有效交互/控制能力，约5.13秒观察到同会话`desktop-async`、`pending`卡片。
- 用户已回复“已在手机看到并提交”，当前会话收到绑定原题目的结构化回复；公网权威状态依次为`pending → submitting → 移除`，本张异步选择卡的显示/提交闭环通过。
- 探测90.01秒正常关闭，1完整/67增量快照、无序列缺口。该时长包括用户阅读/操作，不能用作手机请求延迟。
- 随后的新订阅已看到第二张恢复测试卡，首张已处理卡没有重新出现；第二张要求手机后台约10秒并在方便时切网，用户实际恢复结果仍待反馈。

脱敏订阅证据：`output/audit/2026-10-21/current-session-question-live.json`、`current-session-recovery-live.json`；当前验收条件：`output/audit/2026-10-21/acceptance-gate-current.json`。

## 范围

选择卡探测不提交答案或模型任务；不代用户审批或中断当前开发。期间源码复查另发现并修复DeepSeek启动工厂遗漏配置，修复与本次手机操作分别记录，既有APK和在线网关保持。Android恢复/切网、其他Agent原宿主、后台托管分别记录；长期连接测试继续暂缓。

复测提交后公网v1只读订阅返回200，核对同一固定网关、当前会话及有效交互能力；待答卡总数0，本张测试卡已移除。使用手机同一快照解码器，客户端已关闭；探测未提交答案或模型任务。
