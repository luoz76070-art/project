# OpenCode 现有会话契约

## 范围与入口

P3可选适配器，独立于Codex Desktop与P0 socket。`openCodeClient.ts`拥有HTTP/SSE，`openCodeProtocol.ts`拥有边界解码，`openCodeStream.ts`拥有文本overlay，`openCodeAdapter.ts`拥有订阅/控制。`server/agentSessionRoutes.ts`复用设备鉴权、SubmissionRegistry、SSE配额与增量。

固定研究基线为OpenCode v2.0.16、commit 3a103fe0aff726a4edc7492f03f7b88195d9e4c9，替代未发布的1.19.3适配。显式列表/历史和新SSE连接先读`/api/info`，只接受2.0.16，未知版本不给控制能力。只调用info、session、session/active、event及选中会话的GET、message、form、permission、prompt、interrupt和reply；不得创建/fork/resume会话，不猜测旧版路由回退。

## 配置与生命周期

配置可选，构造/GET agents无副作用。仅固定literal loopback HTTP根URL、绝对directory与可选Basic Auth；拒绝额外配置键、redirect和URL内凭证。只控制目录完全匹配且无workspaceID的会话；列表过滤，读写前再次核验。

HTTP默认8秒、4MiB、最多16在途；只在显式列表/probe或手机订阅后访问。所有消费者共享一个上游SSE，必须先收到server.connected；初始化8秒、30秒字节空闲、2MiB帧缓冲。最多4个已订阅会话；最后一个离开关闭连接。停止仅关闭本客户端连接，不终止宿主Agent；取消/失败清计时器，旧代次不能发布控制。

会话列表与消息分页共用cursor解码：previous/next可省略、为null或最长8192字符的字符串；官方2.0.16实际在空页/分页边界输出显式null。不能仅用`cursor:{}`合成fixture证明兼容；其他类型及超长值继续拒绝。DTO以`?? null`表示无后页，不把null传为查询参数。

## 实时与写操作

- 事件为`{id,type,created,data}`（connected例外），名称为session.text.*等，不再有session.next前缀。最近2048个ID去重；text.started/delta/ended进入有界overlay（1MB/128part），40ms批量下发，不逐token读取REST。使用事件created和同类text的ordinal，ordinal不是混合content数组下标；canonical文本没有id。段末全文校正，中途加入缺段首标注partialText。canonical追上后释放overlay。reasoning/tool-input delta只更新状态，不暴露原文或触发REST。
- 每会话随机controlToken；run状态/用户消息变化和断线使旧token失效。写前在首个await前加锁，核验目录与代次。手机不能上传任意上游路由/对象。
- prompt正文`{id:msg_UUID无横线,text,delivery:steer|queue}`。inbox user回执必须匹配ID/session/文本/delivery；匹配session.inbox.enqueued的inboxID/item.payload/text/delivery或canonical用户消息也可确认接收，不能改写任务完成。内部hash和上游消息ID不在submission DTO暴露。
- interrupt上游POST无正文，返回200 JSON `{interrupted:boolean}`；true仍等idle，false为明确空闲no-op且不留未知写锁。宿主无expectedTurnId，前置核验无法消除服务端竞态。
- 提问/审批随机外部ID绑定完整请求签名，包括未知/内部来源及嵌套字段；只映射明确展示字段到手机。提交前重读并比签名。问答来自form，openCodeForms仅支持kind=question的完整string/multiselect映射，按原key及option.value提交`{answer:{…}}`；隐藏/条件/外部认证/数值/约束等保留不可操作说明，禁止丢字段代答。权限提交`{decision:once|always|reject}`，无save不能always，范围不完整/详情超限只可reject。
- 未确认写进程内有界锁定（最多128），重连不重放。确定失败不伪装提交成功。跨进程幂等不作保证；断线清除卡片/控制，保留已收到正文，重新连接取得全量核验。

## 验证

`test:opencode`使用随机端口合成v2HTTP/SSE，覆盖delta在REST未变化时出现、去重/补齐、无每token查询、精确发送与空正文中断、完整请求签名、目录变化、未知结果跨重连、鉴权/撤销/幂等、超时/坏帧/上限和资源释放。最终合并回归加入`openCode.test.mjs`；真实OpenCode/模型/Android单独验收，不进入隔离测试。

`node scripts/check-opencode-runtime.mjs <官方2.0.16二进制绝对路径>`要求先构建Relay，使用自建HOME/XDG/配置/临时数据库，白名单环境及官方simulation，启动自有前台serve随机端口。12项覆盖版本/鉴权、空列表/nullable cursor、测试owner fixture与目录范围、生产适配器快照、空闲中断、question原字段应答/复杂表单拒绝、owner先答结果不被覆盖、15秒SSE注释心跳及重连令牌。仅脚本owner建立自有空白会话/表单，产品不得增加create/fork/resume；不提交prompt、不访问用户profile。退出关闭自有进程并删除临时目录，不安装或升级CLI；通过不计用户原会话、provider、Android或长期验收。
