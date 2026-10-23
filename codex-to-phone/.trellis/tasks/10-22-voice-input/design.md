# 设计

## 2026-10-23 完整过程展示设计

缺口位于数据源：DeepSeek原生assistant/message只有turn/step，turn/end.reason.kind=completed才可靠完成；共享消息Zod会剥离新增字段。新增小型原生消息投影helper，统一live与catalog历史阶段判定：有效turn助手先为commentary，只有同一最后step的无工具调用、非interrupted文本，在明确completed边界后标final_answer；step/start使旧候选失效，其他结束原因不收起。历史官方page是连续事件区间，先处理所有事件再裁剪文本，分页保留turnId。stream使用同turn的commentary，durable替换不重复。新增phase/turnId为可选协议字段，旧桥接保持兼容，不传reasoning或工具输入。

Codex native助手/工具显式带真实turnId（缺失时不伪造跨来源归属），rollout助手保留已有metadata.turn_id；手机仅已知工具kind或明确commentary进过程，工具同最终任务可收起，未知/卡片不折叠。不把所有tool消息视作已知过程。分组保持原顺序和用户边界，明确同turn可跨引导匹配。完成本地隔离/生产构建/实际窄屏验收后准备APK30与插件0.2.1，部署前核验原配置/活动/退出与preview源，保留回退。该任务不更改发送/权限决定/语音供应商，也不恢复旧sleep联测。

## 2026-10-23 执行过程展示边界

现有消息phase已贯通commentary/final_answer，缺口位于手机平铺渲染。沿用2026-10-20采集的官方手机参考图output/ui-reference/2026-10-20/official-mobile-approve.jpg：过程为单行展开入口、最终回复独立正文；不编造未同步的耗时。当前桌面应用的直接UI读取受工具限制，本轮不声明像素级复刻。

新增chat/processGroups.ts纯展示模型：仅连续的assistant/commentary归为过程，不重排、删改消息；优先匹配后续明确同turn最终回复，缺turn时仅在同用户输入区段向后寻找最终回复，跨用户边界无可靠归属则保留展开。未知phase、用户、工具及卡片不收进过程。共享MessageTimeline复用MessageBubble并将原渲染回调保留，Codex内联状态仍在原锚点；Agent复用展示入口，缺阶段标记的现有Agent文本维持可见。折叠按钮至少44px，状态只存在组件内，以稳定首消息ID绑定，完成阶段变化覆盖运行时的手动状态一次，后续流更新不覆盖手动选择。

范围：展示模型/components、App和AgentWorkspace渲染接线、少量CSS、合成fixture和针对性测试及文档。不修改网关/控制/队列/语音/缓存协议，不加载真实会话或代发测试。自审通过：最终回复不会因位置猜测而隐藏，正文/身份/附件不变，已有草稿和操作卡片不参与折叠。

## 2026-10-23 用户消息跨来源关联

缺口在CodexStore/Desktop投影和手机消息归并，不在控制发送。rollout用户消息保留原始sourceItemId及internal_chat_message_metadata_passthrough.turn_id；native用户消息保留所属turnId，canonical clientId兼容clientUserMessageId。历史ID与accepted steering的serverUserMessageId也不同，不把它们伪装成同一原始ID。

手机先按提交ID/原始ID去重，再在同一turnId、完整正文相同、来源明确且未关联的native/rollout组之间一一对应；两侧数量不等时保守保留，不猜测缺页映射。合并记录保存提交ID、历史原始ID、turnId和附件，采用历史正文/时间；后续任一来源重放均按身份合并。不同提交ID/原始ID以及不同turn之间不能纯文本合并。旧投影缓存一次重拉，保留草稿、待确认输入及附件元数据；不修改控制写入、队列、语音或网关生命周期。文件范围为两端消息投影/类型、reconciliation/runtime、对应测试和合成fixture；用实际形状的合成消息先复现，再运行邻接回归与浏览器检查。

## 2026-10-23 运行中直接发送边界

行为缺口位于手机App输入操作与回执合并：选择器被理解为发送动作，且native提交在HTTP请求前清空草稿。沿用原网关mode/guard/FIFO，不改变宿主协议。App将两个按钮接至同一sendMessage的显式steer/queue参数；箭头和快捷键在原生运行中默认queue，空闲显式start，提交时捕获模式和guard，不能因异步状态变化变成另一种操作。提交锁在整个请求期间禁用所有发送入口。

runtime复用附件正文生成器比较当前草稿与已提交正文，仅匹配的确认清空输入；queue确认只表示网关持久保存，原生steer需桌面权威确认，ACK/未知保持草稿并锁定重发。HTTP与SSE共用确认合并，保留新输入、附件和任务生命周期。App显示明确反馈，未确认输入不投影为已接收气泡。

预计文件：App.tsx操作与提示，chat/runtime.ts确认合并及types.ts瞬态反馈，styles.css按钮样式，手机回归及合成fixture；补既有原生HTTP集成回归区分有待发时的steer。沿现有任务追加记录。自审：保留既有修改，不自动转换、取消或重发真实待发项，不调用模型、不中断原任务、不切换网关或发布。

2026-10-23已核验并纠正百炼协议：31原生多模态messages、output.text；Qwen3兼容chat/messages、choices.message.content。细节以本文末“百炼协议修正”及语音契约为准。初版误用异步转写路径与output.transcription.text的设计已经废止。新APK29录音为ADTS AAC，旧M4A仅兼容31。DeepSeek聊天协议与既有约束保持。

Android插件VoiceRecorder：权限回调、私有cache、MediaRecorder AAC/MP4/单声道16kHz48kbps。开始立即应答；结束事件包含sessionId、base64/时长；主动停止、到时自动结束走同一出口。后台、电话占用/录音异常、取消/销毁清理，不上传中断片段。插件需注册与新APK。

网关独立voice/存储与供应商服务，server/voiceRoutes.ts接线；POST config /transcribe /refine /cancel和GET config，所有请求复用owner鉴权。配置文件位于defaultCwd/.mobile-codex/voice-credentials.json，0600原子串行写；每设备独立Key，GET仅configured状态。供应商只接受固定HTTPS URL，不跟随重定向、不透传错误正文。1个owner最多1个模型请求，全局最多4个；requestId去重墓碑有界，未知结果不自动重试；取消通过独立请求支持原生HTTP不能物理取消的情况，断连/撤销/preClose也取消。

手机features/voice拥有原生桥接、API、共享VoiceInput/VoiceSettings。VoiceInput按连接/Agent/会话key挂载；请求开始捕获草稿，采用前校验当前草稿未变化。回填保留原草稿并追加新文字，总长不超20000。原文编辑后只采用原文或重新整理，避免采用旧整理稿。不默认发送完整历史或项目文件。

改动边界：新增voice模块/路由/插件/共享组件与隔离测试，App及AgentWorkspace仅挂载入口，复用现有HTTP与样式。当前行为缺口是无录音/转写/整理/配置；不修改Agent控制协议、Broker、旧追加问题、生产运行配置。代码在本地验证后打本地候选；部署/公开发布不属于本次实现。

## 本轮设计与边界

配置新增可选 deepseekBaseUrl/deepseekModel，旧文件自动采用原官方默认；GET 返回有效地址及 promptModel，手机表单不持久化 Key。地址只接收 HTTPS、拒绝凭证/query/hash，不跟随重定向；规范化尾斜杠及完整聊天后缀。改地址且已有 Key 时需要新的非空 Key，否则409固定错误；模型名不限定官方列表。官方地址保留 thinking.disabled，第三方仅传通用 Chat Completions 参数。

真实只读证据：02:52最终回复的 rollout response_item.id 与 native agentMessage.id 一致，但历史时间18:52:19.963Z与原生fallback turn开始18:52:02.622Z相差17秒，展示ID分别为log-offset与desktop-turn-item，旧去重只认时间窗口。投影保留 sourceItemId/phase，手机跨来源按原始ID合并，保留旧kind/时间镜像兼容与不同ID隔离；合并不能丢失新身份。旧原生缓存可从desktop-UUID-item恢复ID，旧rollout缓存通过稳定log ID的刷新补齐元数据。不扩展旧追加排查或模型执行控制。

文件边界：voice配置/服务/手机设置与隔离测试；CodexStore、desktopControl、两端消息类型与现有reconciliation。独立fixture及窄屏浏览器检查，不调用付费服务。沿既有preview方式准备新APK与网关候选；发布与运行验证独立记录。

## 2026-10-23 输入区与队列设计

缺口分别位于composer布局及Desktop普通发送自动选择steer。VoiceInput触发器保留portal弹层，仅改为icon按钮并移入composer/agent-input，latest-pill移入position:relative的footer，以bottom:calc(100% + 8px)定位，不依赖输入区固定高度。

只读检查当前桌面提取产物app-initial-90eb42395b7d.js：thread-follower-set-queued-follow-ups-state v1执行acceptFromFollower，整批替换队列且缺乏原子append/初始read，不安全地拼接旧状态可能覆盖桌面操作。本轮用独立网关待发队列，不修改宿主队列、不接管owner。DesktopControl原生guard验证入队；私有0600文件保存有界FIFO及幂等墓碑，队列自己保留follow引用，离开页面仍同步；正常完成且权威空闲、无未知提交时才以fresh epoch、expectedTurnId:null及mode:start执行。中断/失败暂停；未知结果锁定不重放，重启sending转uncertain，历史同clientMessageId证据才解除。设备撤销取消未发；发送中的请求不能声称撤回。

文件范围：新增desktopMessageQueue及隔离测试；DesktopControl与server接入、SSE capability带queue状态；App选择/待发取消，types/runtime防迟到回包；VoiceInput/AgentWorkspace/styles布局；fixture合成控制与浏览器检查。不改Broker/Harness或旧DeepSeek追加诊断。发布沿preview，真实供应商不调用。

## 2026-10-23 百炼协议修正

纠正本文开头错误协议：3.1原生 /api/v1/services/aigc/multimodal-generation/generation，input.messages[].content[].input_audio.data，parameters.format/sample_rate，非流输出output.text；Qwen3走兼容 /chat/completions、messages.input_audio.data和asr_options，输出choices[0].message.content，finish_reason=stop。官方材料保存output/audit/2026-10-23/asr-protocol。qwenBaseUrl规范到同origin的/compatible-mode/v1（仅接受root/兼容/原生已知路径）；原生请求保留该origin。旧记录无新字段时保持31及原地域共享域名。比较更新前后有效目标，地域改变默认域名也要求新Key。Android改AAC_ADTS/.aac，网关按帧头验证，兼容旧M4A给31；不假冒格式、不加转码依赖。固定阶段code拒绝透传供应商正文。范围仅voice配置/服务/设置/录音与测试及preview交付，不动Agent控制/队列。

## 2026-10-23 真实质量回归与术语修正

APK29用户确认识别/整理/仅回填草稿成功；真实公网31.97秒合成长句把三处“会话”识别为“绘画”，HTTP200不能作为语义验收。行为发生在百炼识别层，DeepSeek按原文整理无法恢复声学信息。先在独立运营probe中测试31官方parameters.vocabulary的低权重固定词（会话/Codex/DeepSeek，权重2），使用完全相同失败音频、绘画负例和混合句；不预设效果，不全局替换词、不读取真实会话或项目正文补上下文、不把热词传给Qwen3。

仅当真实对照和负例通过，修改voice/service.ts的31请求参数及voice.test.mjs的官方契约/原样输出检查，补语音spec与审计。无需新配置字段或APK，沿既有备份/固定目录切换网关；部署后另做公网验收。失败则保留证据并调整或停止该候选，不以测试fixture文本代替识别质量。规划自审通过，保持现有Key目标、取消/并发/草稿边界与暂停的追加诊断。

实际对照否决了单词“会话”与“旧会话”热词：后者会误改纯绘画句。最终仅保留手机会话/聊天会话/Codex/DeepSeek，权重1；相同32秒原句三处会话正确、纯绘画三处正确。混用挑战原模型3处误识别、最终候选2处，仍未达准确性目标，明确留为限制而不标记通过；Qwen3无上下文对照也未解决，不更换用户模型。此增量采用已验证的原句改善与负例不退化，不承诺同音混用完全识别，保留原文编辑/采用前预览，不在网关或DeepSeek擅自全文纠词。候选及所有失败运营证据均保留。
