# 后端验证

- `corepack pnpm typecheck`：两端类型检查。
- `corepack pnpm build`：Relay + Mobile 构建。
- `corepack pnpm test:messages`：消息合并历史回归。
- `corepack pnpm test:transport`：新增 Broker/Tunnel/SSE 隔离回归。
- `corepack pnpm test:codex-executable`：可执行文件发现，不启动模型。
- `corepack pnpm test:correctness`：JSONL、初始化、发送等隔离回归。
- `corepack pnpm test:performance`：10,000 会话热索引、分页、IPC 坏帧和 patch；不读真实会话。
- `corepack pnpm test:availability`：设备配对/撤销、配额、输入队列与只读客户端生命周期；注入输入执行器。

最终可合并构建一次后运行 `node --test apps/relay/tests/{correctness,performance,transport,availability}.test.mjs`，避免四次重复清理/编译 dist。原生构建与真机控制分开记，不能把 Swift typecheck 或 APK 构建成功当作辅助功能权限/安装/唤醒验收。

传输回归检查首块可及时读取、二进制字节完整、取消传递、断线立即失败、旧连接/异 Relay 回包隔离、慢消费者及重连。随机端口和临时资源在 finally 中清理。不把缺陷复现脚本退出 0 当作验收通过。
