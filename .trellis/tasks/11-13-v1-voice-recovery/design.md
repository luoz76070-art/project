# 设计
Relay VoiceService 持有按 owner/requestId 隔离的有界内存记录，区分处理中与完成（成功/失败/取消），保留输入摘要防 ID 冲突。终态 TTL15分钟，不因查询续期；预留最大结果字节预算，拒绝新任务而不提前淘汰。HTTP 生命周期与供应商任务解耦，取消/撤销/关闭/供应商截止仍有效。
GET /api/voice/results/:requestId 返回 processing/completed/not_found；重复 POST 处理中202，完成重放原结果。手机持久化 requestId、stage、scope、会话身份、createdAt 及用于草稿保护的 SHA256 摘要，不存文本/录音/凭证。正常交互保持预览；重启后的恢复只 GET 并比较草稿摘要后写回原会话，不自动进入新整理阶段。后台暂停轮询，前台恢复；原生迟到 POST 与 GET 结果只消费一次。
涉及 voice 后端路由/服务、手机 voice 与两个会话接入点、隔离测试及语音契约。不开模型任务、不改工作流、不部署。
