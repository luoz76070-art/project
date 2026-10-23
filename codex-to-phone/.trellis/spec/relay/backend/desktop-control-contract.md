# Desktop 原会话控制（P1）

用户消息投影保留所属turnId。canonical userMessage的clientId兼容原clientUserMessageId，accepted steering仍保留本次提交ID，pending/rejected不作为接收。rollout response_item用户消息保留payload.id为sourceItemId及internal_chat_message_metadata_passthrough.turn_id；其ID与accepted steering.serverUserMessageId不保证相同，不截取UUID片段伪造身份。历史分页log-offset ID保持，后端文本去重键须包含sourceItemId以保留同文同时间的不同原始输入。投影元数据不改变原生确认、写入、幂等和队列协议。

## 1. 范围

`desktopNativeControl.ts` 构建普通 follower 写入，`DesktopControl` 提供已校验 owner/host/revision 的订阅状态。与 P0 app-server-control socket 无关，不为发送恢复或新建替代会话。macOS 默认 legacy 输入；原生写须显式启用并单独做真实验收。

## 2. 签名

- `DesktopNativeControl.send({threadId,message,mode?,clientMessageId,controlToken,expectedTurnId})`。
- `interrupt({threadId,clientMessageId,controlToken,expectedTurnId})`。
- HTTP 沿用 `/api/desktop/control/threads/:id/messages` 与 `/interrupt`，复用鉴权和 SubmissionRegistry；中断也必须携带幂等 UUID。

## 3. 契约

DesktopIPC按4字节小端长度头接收，单帧最多64MiB，头和正文分别累积。校验长度后只分配一次正文缓冲，各分块只写入一次；不得Buffer.concat反复复制整个已收正文。零长/超限头在正文分配前拒绝，非法JSON断链，断开/主动停止/重新连接清空未完成帧。当前长会话真实快照约38MB，不能恢复16MiB上限；宿主256MiB上限也不等于网关的接收预算。此预算不代表整个Node进程RSS上限。

`MOBILE_CODEX_DESKTOP_TRANSPORT=native` 选择新通道。snapshot.control 为 `{transport,token,activeTurnId,canSend,canInterrupt,submission}`；token 是当前订阅 epoch 的 UUID，断线/owner失效/释放/patch缺口均废止。submission 含 `{clientMessageId,action,delivery,turnStatus?}`；前端能力和令牌不持久缓存。

原生消息携带 `expectedTurnId:string|null`，空闲显式 null；运行中必须等于当前任务。中断只接受非空任务 ID。start v2 使用 `{conversationId,turnStart:{request:{threadId,input,clientUserMessageId},context:{inheritThreadSettings:true,restoreMessage,attachments:[],commentAttachments:[]}}}`。steer v1 包含 input、clientUserMessageId、attachments 和 restoreMessage。restoreMessage 含 cwd、context.workspaceRoots/collaborationMode/commentAttachments、responsesapiClientMetadata。中断 v4 带 `mode:user-stop` 与 `expectedTurnId`；不省略 guard 来暂停整个 goal。

RPC 定向 owner，不在未知结果后重放或更换方法。每线程先同步预留；最多128个未确认线程，最近回执也最多128个。历史按 canonical islands 解码。消息确认依据 clientUserMessageId 和 accepted steering/已分配 turnId，未确认提交及乐观 pending item 不算成功；中断依据原任务的权威终态。completed 只能说明任务已结束。结果 `delivery=confirmed|submitted|uncertain`；ACK 单独最多为 submitted。迟到的 HTTP 结果不能覆盖 SSE 确认或改写任务生命周期。

## 4. 错误矩阵

| 条件 | 结果 |
| --- | --- |
| 无有效身份 / 请求格式错误 | 401 / 400 |
| 未订阅、缺失 ID/令牌、旧代次 | 409 desktop_control_refresh_required |
| 任务/模式不匹配 | 409 desktop_turn_changed |
| 在途、待确认、任务尚无服务端 ID | 409 desktop_submission_pending |
| 容量超限 | 429 desktop_control_limit |
| 超时、断线、错误 owner/method/响应、上游错误 | delivery=uncertain；不透传错误原文，不重新发送 |
| 同一幂等 ID 换正文/目标/guard | 409，不执行 |

## 5. 正常、基线、异常

正常：SSE订阅 → 权威快照 → 手机带guard发送 → 定向原owner → 历史确认同一clientUserMessageId。基线：Mac未启用native时保留旧UI输入。异常：确认回包丢失后保留未确认操作，后续快照可解除；新ID不能绕过待确认保护。

## 6. 测试

`corepack pnpm test:desktop-native` 使用真实临时Unix socket与合成Desktop。必须断言新版版本/完整参数、会话和owner绑定、accepted证据、ACK-only、无回包、连接失效、旧token、并发及HTTP幂等/鉴权。`test:mobile` 覆盖SSE/HTTP时序、断流禁用、回执匹配和缓存隔离；浏览器补测后台选定会话、待确认提示和中断确认。真实模型写入与Android验收不属于这些测试。

## 7. 错误与正确方式

- 错：steer失败后start，或用相同文本认定已收到。正确：只选一次动作，以客户端消息ID及权威状态确认。
- 错：steer只传input；正确：带restoreMessage，宿主实际会访问其cwd/context/metadata。
- 错：中断ACK后手机直接设interrupted；正确：等待原任务终态，仍运行时显示待确认。

宿主start/steer follower没有原子的expectedTurnId条件；本地发送前校验不能消除宿主侧竞态，真实验收前不宣称完全接管或移除辅助功能。

Desktop提问另保留最多128项未确认记录，以线程及完整原题的SHA-256签名绑定；记录不含答案。提交先预留，IPC失联、patch缺口和最后订阅离开只废止令牌并将记录标为uncertain。重新订阅同一道原题仍不可提交，不能依靠新令牌绕过；权威快照移除原题或改变原题签名才释放记录。容量满返回429 desktop_question_limit，不驱逐未知结果。此保护仅覆盖同一网关进程，不能宣称跨重启去重。

问答ACK须检查epoch、outer method/owner和可选内层method；同步原请求要求ok=true，异步steer要求回执turnId等于原题任务。兼容已核验的平面/包裹结果，缺失/负面结果、错方法或错turn一律uncertain且保持锁定，不重放。同代次权威状态已移除原题时，迟到的无效ACK/错误不能推翻resolved；resolved也包括原题失效，不证明工具执行成功。仅ACK最多submitted，仍须权威状态确认。

异步题除inProgress轮次外，保留canonical顺序最后一个正常completed轮次的未答题；新轮次、interrupted/failed、已答或原题移除使旧题失效。inProgress→completed不改变原题签名或未确认锁。同步工具题仍须绑定活动轮次。异步回答复用DesktopNativeControl发送保护：运行中steer v1，空闲时在同一conversation使用start v2，并携带原题回复封装和上下文；不在失败后切换方法。start ACK须含非空turn.id，steer须精确匹配原turnId，共同校验owner/method及可选内层method。与普通发送共用串行和未知结果锁，不能新ID绕过。隔离回归同时覆盖HTTP/SSE中的completed卡、同会话回复、完成后重订阅及普通发送竞争。

## 8. Desktop 审批

`desktopApprovals.ts` 独立拥有三类审批的解码、绑定、提交和不确定结果。只从权威活动任务的requests解析，文件diff取匹配item；公开随机令牌，不公开原requestId。请求内容或文件预览改变替换令牌；owner/epoch失效、patch缺口和任务终态废止旧令牌。

鉴权 `POST /api/desktop/threads/:id/approvals/:approvalId/respond` 只接受严格的 `{decision}`；拒绝任意手机提交的权限对象。按v1 command/file/permissions follower方法定向原owner，权限只能复制已核验原请求，scope为turn/session，拒绝/取消为空权限。ACK检查outer method/owner、可选内层method和ok，兼容包裹及旧平面结果；ACK只为submitted，权威移除只为resolved（已处理或失效）。

提交在await前预留，最多128项未确认操作。未知结果不重放，重订阅同签名请求仍锁定；原请求从权威状态移除才释放该记录。显式空/复杂-only决定列表不得fallback成允许；未知字段、未知权限或缺少完整预览不得批准。超过展示预算不截断后批准。宿主没有原子签名条件，单进程状态也不提供跨重启exactly-once。

隔离验证 `test:desktop-approvals` 检查三类原请求、精确权限/范围、只含复杂决定、身份/会话/代次/签名、ACK-only/坏回应/断线、并发锁、鉴权HTTP与SSE。新功能的源码验证不能代替真实Desktop审批验收。

## 9. 手机待发队列（APK28）

HTTP普通发送增加`mode:queue`，仍校验当前原生epoch和expectedTurnId；返回`action:queue-message,delivery:confirmed`仅表示网关已保存，不代表Desktop已执行。重复ID按owner/thread/message绑定，重试不因guard更新重复入队。非queue发送继续绑定原guard。鉴权取消接口为`POST /api/desktop/control/threads/:id/queue/:messageId/cancel`。

`desktopMessageQueue.ts`拥有独立FIFO；默认服务工厂以defaultCwd下`.mobile-codex/desktop-queue.json`启动，0600原子串行写。最多32条活动待发、每线程8条、16线程、128条记录；已发送/取消墓碑保留24小时，满额拒绝，不驱逐未知提交。snapshot.control.queue携带available与该线程活动项；待发自己持有follow引用，手机离开不取消队列。

只有权威status=completed、无活动turn且canSend时才以fresh epoch、expectedTurnId:null、显式mode:start在原会话发送。中断/失败使waiting转paused，可取消后重新编辑；断线只等待。发送前再次检查能力和设备有效性。submitted/uncertain转未知锁，不重放、不允许假撤回；重启sending转uncertain，匹配权威clientUserMessageId才解锁。设备撤销取消未发项，不能抹除未知结果；存储失败停止派发并显式不可用。

宿主`thread-follower-set-queued-follow-ups-state`会整批替换队列，缺少安全append/read，因此本队列不写宿主原生队列。网关待发不会出现在桌面原生待发列表，也不承诺与桌面队列的全局顺序；既有宿主start缺少原子expectedTurnId的竞态限制仍存在。

`test:desktop-native`覆盖有界FIFO、取消/幂等、正常完成、断线/重启/未知、撤销、私有持久化，以及临时Unix socket与默认HTTP工厂接线。真实Desktop自动续发、Android前后台另行验收，不自动提交模型任务。
