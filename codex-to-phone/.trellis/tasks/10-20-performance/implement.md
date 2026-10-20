# 实施与检查

- [x] 热路径索引与摘要 API；合成大量会话验证无重复全树扫描。
- [x] 历史分页、线程列表与阅读位置；浏览器验证。
- [x] SSE patch/seq、状态淘汰、有界输入及 IPC 异常回归。
- [x] 缓存写合并和空闲/后台请求计数。
- [x] 全部既有与新隔离测试、typecheck/build、记录性能与限制。

## 源码检查结果与剩余验收

2026-10-20 本轮源码/隔离检查完成，证据见 `docs/audits/2026-10-20/delivery.md` 与 `optimized-evidence.json`。不执行提交/部署。

- [ ] Android/真实 Desktop/睡眠恢复等适用平台验收；未通过前保持任务 in_progress。
