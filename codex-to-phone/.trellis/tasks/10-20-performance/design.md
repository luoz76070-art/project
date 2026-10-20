# B 设计

- CodexStore 维护按目录与文件签名增量刷新的路径/摘要索引，合并并发刷新，热摘要不再读取完整历史。目录发现定期低频对账，不在每个请求全树扫描。
- 桌面事件订阅推送日志 delta，IPC/turn 推送提供带 seq 与 baseSeq 的 changed-message patch；首连/重连全快照，序列不连续则重建订阅取基线。原协议客户端继续收完整快照。
- 手机健康 SSE 下停止业务轮询；后台暂停；缓存定时合并写并在 pagehide/连接切换落盘，保留草稿与当前页。按线程保存阅读位置。
- 历史 API 接收 before 字节边界和 generation；客户端加载更早页并保留阅读位置，不影响尾部 cursor。线程列表分页与搜索不限于 12 条。
- IPC 帧长度、JSON 与输入结构校验；完成 turn 与 inactive Desktop 状态有 TTL/数量边界，上传与设备流有并发上限。

改动范围：store、desktop/codex 状态与帧处理、SSE 路由、mobile 缓存/订阅/历史；不增加状态库或额外服务，不部署。
