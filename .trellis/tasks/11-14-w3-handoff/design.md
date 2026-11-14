# W3：交给任意 Agent（已有会话）

## 范围与边界
- 仅 todo 事项可交接到 Codex Desktop、Claude、DeepSeek、OpenCode 的已有会话；不创建会话，不显示新建按钮。W3b 等 C2 后实施。
- 统一服务端组装标题、说明、冻结语音原文、代码引用、目标项目/cwd、已绑定图片的 Mac 绝对路径。本文只使用仓库相对代码路径。
- W3 只记录交接和送达，不调用 recordDelivery/applyTurnResult、不改变事项 state/verifyItem。W4 才消费送达和 lastTurn。

## 数据与可靠性
- shared/handoff.d.ts 定义目标、预览、交接记录；shared/workItem.d.ts 增加可选 handoffs，旧快照视为空。记录所属 attemptId、序号、retryOf、发起设备、时间、确切文本、资产清单与指纹。
- 状态 sending/submitted/queued/delivered/unknown/rejected。ACK 不当送达；明确队列为 queued；未知绝不自动重发。同一目标的未知屏障跨卡片、跨设备有效；只读证据可解除，不能用新 ID 绕过。
- 同一 storeId 内 handoffId 唯一且永久保留（每卡32条、单卡256KiB、总库32MiB，满则拒绝）。沿用 WorkItemStore 串行写、原子替换和损坏时拒绝服务。
- 确认后、通道调用前先持久化 sending 与 everDispatched；重启未结算 sending 视为 unknown，不恢复派发。预留失败零发送；发送后持久化失败保留未知屏障。
- POST 返回固定接纳回执 {handoffId,accepted:true}（202），相同请求重放返回同一回执而不调用通道；GET 返回可更新的送达结果。请求指纹包含 owner、uid、storeId、expectedRevision、目标、previewHash、retryOf，不包含易变控制令牌。

## API 与通道
- POST /api/work-items/:uid/handoffs/preview：{storeId,expectedRevision,handoffId,target:{agentId,sessionId},retryOf?}，返回确切 text、附件、权威 target、sendNumber、previewHash。无创建/发送副作用。
- POST /api/work-items/:uid/handoffs：上述字段 + previewHash + confirmed:true；服务端重新取权威控制状态，校验 cwd/内容摘要，持久化后只调用一次。
- GET /api/work-items/:uid/handoffs/:handoffId：当前记录；复用 work-item.changed SSE。只读核验可以更新送达，不能更新事项生命周期。
- server/handoffChannels.ts 有界订阅目标、释放监听；Desktop 复用 DesktopControl.sendMessage，其他复用 SessionAdapter.sendMessage；忙碌默认 queue，不 steer；保留原未知锁。
- 图片从 workItems/handoffMessage.ts 经受管清单/realpath/hash核验得到，原图路径仅以文本发送。手机预览沿用捕获取图鉴权，不扩大助手图片引用授权。
- 超过通道20000个UTF-16计数单位（与现有适配器一致）时，预览返回413及 limit/length/excess，不截断；UI说明计数并要求删减。
- 错误：400格式、401撤销、404不存在、409版本/重复内容冲突/目标锁、410已删除、413内容超限、422资产、503能力/存储、507容量。设备撤销取消订阅与未开始派发，迟到结果不得向撤销设备返回或发布。

## 手机端
- 捕获卡片操作区复用 handoff-card 和 U0令牌；保存编辑后选择通道及已有会话，完整文本/图片/目标确认一次；取消不发送。
- 提示“Agent 需要能读取这些 Mac 本地路径”。只在 unknown/queued 使用 --signal。
- 恢复只 GET，不重发 POST；结果不明提供打开目标会话和显式查询。手动再次发送产生新 ID、retryOf 和“第2次发送，可能重复”确认；原目标未知锁未解除只能选别的目标。
- 已交接卡删除按钮展示“已交给 Agent，删除会让对方读不到图片”，不能只灰掉。普通编辑不会改动已冻结交接。

## 测试与验收
- 四通道各一次合成发送，验证完全相同的组装规则、路径、ID与目标。覆盖原图/原文、路径空格、错误资产、超长、取消零调用、todo限制和 verify不变。
- 并发双击/跨设备、重放/ID冲突、写盘失败、进程重启、ACK/队列/迟到结果、未知不重发、人工二次确认、撤销401、目标和内容变更。
- corepack pnpm typecheck / lint / build；新增 handoff Relay/mobile 测试；workItems/capture/deviceRevocation；test:desktop-native、test:claude、test:deepseek、test:opencode、test:mobile、test:voice。
- 隔离测试不访问真实会话或模型；真实四通道和 Android 操作另验。Agent 沙箱可能拒绝读取项目外路径；无法取得同 ID 接收证据时继续未知。
