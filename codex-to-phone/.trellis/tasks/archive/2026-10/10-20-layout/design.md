# 设计

保持 apps/mobile 与 apps/relay 双应用边界；前端按 app、chat、connection、threads、updates、shared 分层；后端按 server、transport、codex、desktop、store、smoke 分层。根启动入口保留。

结构迁移先用类型检查、生产构建、消息回归与原函数体比对验证行为。server.ts/serverExe.ts 复用同一服务工厂，采用 server.ts 的路由作为基准。

传输层增加可选 stream 请求能力与 start/chunk/end/ack/cancel/error 帧。每个 chunk 最多 32 KiB，Broker 消费/排空后 ACK；每 Relay 并发有界。pending 绑定连接对象；断链失败、取消、超时立即释放。新 Broker 接受旧 response，新 Tunnel 对未请求 stream 的 Broker 保持完整 response。升级时先更新 Broker 再更新 Tunnel。SSE 走 Fastify stream，确保 CORS 生命周期及关闭清理。

本轮不执行新 UI、真实 Desktop 控制、线上发布或依赖大版本升级；后续各子任务独立推进。源码迁移前快照在 output/trellis-baseline，未触碰用户原先改动的内容。
