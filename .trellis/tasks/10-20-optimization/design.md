# 总体设计

保留 React/Capacitor + Node/Fastify，维持双应用 workspace、Mac 主动连出与手机 REST/SSE。布局见 `docs/project-layout.md`；传输实现契约见 `.trellis/spec/relay/backend/transport-contract.md`。

先完成布局和 A1，后续 A2 修正客户端/数据正确性，再推进开销、常驻与配对。UI 以真实 Codex 手机版基线为依据，实施复用连接与缓存边界。父任务只负责任务地图、跨任务验收与进度；每个子任务独立计划、验证和记录。
