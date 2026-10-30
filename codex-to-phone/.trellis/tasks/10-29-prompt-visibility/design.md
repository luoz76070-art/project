# 设计

已定位：mobile chat/messages、Relay codexStore、desktopControl、liveTurnController均按自然语言前缀隐藏用户输入；codexStore标题选择也含同类条件。

保留既有role/item type语义：system/developer不会成为用户气泡，hookPrompt不投影为普通用户文本。不臆造上游来源字段。缺少可靠来源的旧user记录继续按既有专用包络标记（environment_context、permissions instructions、app-context、collaboration_mode、personality_spec、skills_instructions、plugins_instructions、AGENTS.md instructions、INSTRUCTIONS及问答reply）兼容过滤。该兼容规则仍保留字面以前述保留标记起始的正文受过滤这一已知限制；引号、代码块或解释性正文里的提及不匹配。自然语言You are / Knowledge cutoff不作为来源证据。

最小差异：移除上述四处正文及一处标题的两个宽泛前缀。历史及app-server补齐已有手机/desktop的问答回执标记，避免普通投影路径差异。保持类型、cache schema、合并器与发送语义。

测试使用同一合成正文矩阵覆盖生产入口：临时rollout的response_item/event_msg/分页增量/标题、合成IPC params/canonical/accepted steering、假app-server item通知及完成后thread/read、手机渲染/缓存/真实同文。浏览器只连隔离fixture，验证显示、完成和离线重开。

自审：无需新增通用包或跨运行时依赖；不调整真实数据或运行服务；已有未提交修改保持；无法判定旧纯自然语言系统文本时优先保留，避免误吞真实用户输入。
