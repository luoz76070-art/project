# 验收设计

## 2026-10-31：补齐手机待发查看与取消

只读检查确认DeepSeek现有手机、Agent路由、协议和桥接均没有取消待发入口。沿用原生next-turn队列及现有一次未确认发送锁；不创建第二个调度队列。桥接仅暴露本插件当前submission.messageId仍精确存在于原Agent.inbox.nextTurn的那一项，以clientMessageId作外部标识。队列接受与真正user/message执行确认区分：手机可凭权威待发项清理匹配草稿并展示“已排队”，新草稿保持；不能标记为任务已执行。

增加可选queue快照和cancelQueuedMessage适配器方法、鉴权且幂等的queue/:id/cancel路由。bridge同步复核原live handle、controlToken、原提交及nextTurn归属后，仅调用官方inbox.remove(messageId)，不调用cancel、clear或更改其他宿主待发项。已取走/消费的项拒绝取消；未知回包锁定按钮且不重试，队列权威移除后解除。旧插件缺queue时继续原行为，不显示可取消能力。

改动范围：mobile-deepseek/bridge与对应queue辅助模块、Relay Agent类型/schema/adapter/routes、手机Agent类型/runtime/待发卡及必要样式；新增隔离回归和官方rc.5 AgentLoop取消检查。先证实原代码无队列投影/路由，再实现并核对拒绝边界、断流重连、迟到结果及草稿保护。用户已确认上次运行时“已连接且停止可用”，不能按断线归因。运行中引导缺入口仍待该瞬间手机能力/页面证据，本修复不当作其已定位；APK37旧记录验收保持独立。

补充布局：390px待发卡展开挤占输入区，360×320聚焦草稿时旧45dvh footer裁掉停止按钮。将待发卡移到消息区、模式和停止合并一行，footer上限按剩余屏幕空间；DeepSeek running时模式入口保持，能力不足时禁用，不越过原控制守卫。此为已复现边界修复，不冒充真机根因。

## Codex临时轮次身份修复（用户追加）

手机详细报告的两组native-input指纹分别精确对应turn-45-input/turn-48-input，nativeMessageId及client与网关正式项一致，但turnId仍为turn-N；历史使用真实turnId，导致同turn配对失败。当前mergeSameMessage已合并正式native别名/替换关系，但preferredMessage在等长正文时保留了临时ID与turn。之前回归仅覆盖真实turn下的临时input，未覆盖turn本身尚未获分配的形态。

最小修改位于手机messageReconciliation：只对id恰为turn-N-input的user记录，在已有明确replacesMessageId及匹配正式nativeMessageId时提升到正式id/turn；同一规则在合并结果及缓存/渲染入口生效。继续依赖既有client/native/source身份和冲突保护，不按相同正文或时间改写真实轮次，不清缓存。后端已提供所需字段，无需协议或网关部署。

先在真实createRuntimeSync入口构造脱敏序列复现并验证输出形态与手机报告一致，再测排列、版本3缓存、迟到临时帧、长尾与不同client同文输入；更新fixture并做浏览器检查。只改合并器、针对测试、fixture及相关交付文档；不将DeepSeek入口、内部摘要显示等旁项混入。产品自审通过后按版本流程交付预览，Android结果独立记录。

- 先按列表标题与项目确认原会话别名；核对宿主版本、网关构建、本地/公网目录及目标当前状态，无待答/审批或未决提交才开始。
- 使用有时限、有体积上限的原桥接/网关只读订阅，记录目标状态、能力、测试标记消息次数、阶段、问答/权限数量与投递状态。报告不含鉴权令牌、业务正文或其他会话内容。
- 手机每项使用独立短标记，先启动观察再发用户操作卡。用户负责Android实际触摸及权限选择；观察到原生权威消息确认后才开始下一项。
- 引导、排队和停止使用有限时长且不修改文件的任务；前项先收敛。审批先查宿主已有策略和机制，自动获准不计审批通过，不改变全局权限。
- 隔离回归与真实验收分别记录。当前只增加任务/验收文档及ignored探针，不修改生产代码或重启服务。真实失败先保留证据，再界定最小修复面。

## 发送失败后的最小修正

实际原生日志确认两次用户测试分别启动turn8/9，最后均因上游INVALID_REQUEST（模型全账号冷却）失败；有原user/message确认但无assistant/message。用户看到输入清空无回复，桥接当前丢弃turn/end错误。

修正仅在插件messages.mjs添加稳定失败轮次投影，bridge.mjs将其发送；catalog既有分页复用同一函数。沿用role=assistant/kind=agent_message，并在正文明确标识“DeepSeek Harness 运行提示”，不伪造成功final_answer。只输出固定白名单摘要，原始错误文本不出桥接；稳定seq身份用于历史/实时合并。手机源码及网关协议不变，沿用APK36。新增原生事件形状的隔离回归和手机实际过滤/分组验证，插件升级0.2.3。恢复可用模型后再做原任务复测；不自动切换供应商或重发旧输入。

## 宿主重新打开后的兼容前置

用户决定保留当前模型，等待服务恢复，随后确认已重新打开原Harness。实际桌面插件页显示宿主已为0.2.1-rc.5，旧插件被精确版本门停用，9876无监听。0.2.3候选尚未安装，也只支持rc.2/rc.3。

只读提取当前官方app.asar到隔离目录，核对Agent、AgentLoop、Session、Query、Controller、LLM、Gateway、审批及提问等10个生产入口与已验证rc.3字节相同，Cordis仍4.0.5。新增rc.5握手回归先复现版本拒绝，再执行同版官方运行时、审批及历史隔离检查；通过后精确增加rc.5，未知版本继续拒绝，审批方法指纹不变。

最小兼容修改涉及插件manifest/bridge、网关deepSeekProtocol和3个官方检查器/握手回归；插件0.2.4同时带入0.2.3未发布的失败提示。APK36沿用；因网关需接纳真实rc.5版本，本次还需构建并切换固定网关，核对待发/审批为空且保留原电脑任务与全部配置。真实模型验收继续等待服务恢复，不以只读失败提示验证代替成功收发。
