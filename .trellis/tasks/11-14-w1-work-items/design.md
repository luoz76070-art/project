# 设计与变更边界
新增 shared/workItem.d.ts 与 Relay workItems/schema/stateMachine/store；server/workItemRoutes.ts 复用鉴权、deviceStreams、eventStream。持久状态位于 defaultCwd/.mobile-codex/work-items.json；串行候选快照、revision CAS、持久幂等、fsync+rename，损坏返回503保留原件，人工核验上一份.bak恢复。
内部 applyTurnResult 仅校验已绑定 attempt/channel/session/turn；completed→to_verify，failed/interrupted→returned。无自动监听器或公开回写API。用户 actions 与 verify 分离，PATCH禁止状态/控制信息。
迁移合并 native ProductHandoff 与 Web独立草稿；不同ID独立保留。源摘要、稳定storeId和旧ID去重，回读后原生ackMigration原子归档并移除活动记录，Web仅清除匹配快照，失败/未知不重发交接。缺少新原生能力时保留旧流程。资产只关联现有 mobile-uploads 中核验后的文件，不搬运/删除用户文件。
五个模块分开提交；不改 .github/workflows，不推main，不安装Android SDK。

## 状态与权限
| 来源状态 | 目标状态 | 入口与条件 |
| --- | --- | --- |
| todo | in_progress | 用户 start；内部 recordDelivery 确认送达（queued/unknown 不算） |
| in_progress | to_verify | 用户 review；内部精确匹配 attempt/channel/agent/session/turn 的 S1 completed |
| todo/in_progress/to_verify | returned | 用户 return，必须给出原因 |
| in_progress | returned | 内部 S1 failed/interrupted，保存完整 lastTurn 与中文原因 |
| to_verify | done | 仅用户 verify accept |
| to_verify | returned | 用户 verify return，必须给出原因 |
| returned/done | todo | 用户 reopen，重新生成 attemptId |
未列跳转拒绝；null、未知、旧轮、不匹配或迟到的结果不改状态。内部接口不暴露 REST，W1 不接任何自动监听/派发。只保留当前 attempt 与最近一次状态变更；重开不触发发送，W3 必须自行确认旧送达结果与绑定新轮次。

## REST 与 SSE
- GET /api/work-items?state=&limit=（1–50）&cursor=：{storeId,storeRevision,items:摘要[],nextCursor}；游标绑定版本，变化后409要求重读。
- GET /api/work-items/:uid：{storeId,storeRevision,item}。
- POST /api/work-items：{uid,mutationId,expectedRevision:0,kind,title,detail,assets,codeRefs}。
- PATCH /api/work-items/:uid：{mutationId,expectedRevision,...可编辑字段}，禁止 state/currentAttempt/source/actor。
- POST /api/work-items/:uid/actions：{mutationId,expectedRevision,action:start|review|return|reopen,reason?}。
- POST /api/work-items/:uid/verify：{mutationId,expectedRevision,decision:accept|return,reason?}。
- POST /api/work-items/import-handoff：{storeId,scope,handoff|null,draft|null} → {storeId,storeRevision,imports:[{legacyId,uid,fingerprint}]}。
- POST /api/work-items/stream-token → {streamToken,expiresAt}；GET /api/work-items/events?streamToken=：首帧 work-items.reset {storeId,storeRevision}，变更 work-item.changed {uid,revision,storeRevision}；不携带正文、附件或凭证，不保留事件历史。
- 一般写入返回详情响应；错误为 {error:code}。401撤销；400格式；404不存在；409身份/版本/状态冲突；413请求体超限；422附件；429流配额；503存储不可用；507容量已满。
- 鉴权沿用 D2；写入在进入串行队列及主文件 rename 前复核设备，响应和订阅仍由 D2 全局生命周期复核。其他设备和管理员共享事项，撤销不删除共享事项。

## 迁移和恢复
- 原生 SharedPreferences product-handoff-v1/handoff 与 Web mobileCodexProductHandoffV1；同ID合并，不同ID保留两项。
- 显式“迁移为事项”入口；孤立 Web 草稿或遗留 journal 在现有提示区可恢复。原交接卡只将“完成”改名为“关闭”。
- Web 先写单份有界（600KiB）journal，再提交不可变白名单快照；Relay 按 storeId+旧ID+SHA256 去重。每项回读验证旧ID/UID/摘要后才能清源。
- draft→todo；uncertain→todo+unknown；confirmed queue→todo+queued；confirmed desktop→in_progress。冻结正文与 clientMessageId 保留；无 turnId 不生成 lastTurn。已发送记录仅关联冻结正文中匹配且仍存在的 Web 附件，其余原始路径仍保留在冻结正文。
- 原生摘要按 SharedPreferences 原字节计算；ackMigration 核对 id/digest 后一次 commit 归档到单份256KiB备份并删除活动项。重复ACK不清掉新卡，失败保留/恢复活动项；旧原生没有摘要能力时保留旧交接入口。
- Web 只清除仍等于迁移快照的本地草稿，期间新编辑保留；HTTP/回读/ACK失败均保留journal并由用户显式重试，不重新发送交接。
- 存储采用单 Relay 写者，文件0600、串行CAS、每项64条幂等回执、临时文件fsync+rename。损坏/未知版本/缺主文件但仍有备份时事项功能503，其他Relay功能继续。
- 人工恢复：先停止 Relay、保存损坏原件；核验 .bak 的版本与身份关系再替换主文件并重启。备份是上一份快照，可能缺最后一次写入；不自动覆盖/回滚。
- 满额拒绝，不删除附件/事项。多 Relay 进程并发写同一路径、历史结果恢复、旧记录人工冲突处理和事项历史审计不在 W1 范围。
