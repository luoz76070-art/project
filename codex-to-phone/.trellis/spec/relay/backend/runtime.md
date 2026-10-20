# 运行与错误边界

配置由 `src/config.ts` 和各传输入口环境变量加载，不记录 Token 或请求正文。HTTP 输入沿用 Zod 校验。

SSE 走 Fastify 的 stream reply，使 CORS/onSend 钩子可运行；响应关闭时释放监听器和心跳。慢消费者缓冲必须有上限。

Tunnel 请求以 requestId 加连接对象绑定；响应帧不得跨 Relay 完成请求。断链、取消、超时都清理 pending 并取消本地 fetch。流使用 start/chunk/end，传输层 ACK 在消费后放行下一块。保持原普通 response 兼容。

连接必须有握手超时、主动 ping/pong 与重连退避。非幂等发送不自动重放。Desktop 与 Relay app-server 是不同控制对象，界面不得隐式混用。

JSONL 游标表示完整 UTF-8 记录的字节边界；未完成末行不能越过；长行、截断、轮换必须单独覆盖。

## 索引、配额和生命周期

- `readThreadWithCursor` 保持完整历史语义；有限读窗可分块继续，不能静默只读文件尾。分页使用字节 before/generation，文件换代时清楚返回 reset/409。
- `readThreadLatest` 初次打开补齐最近 turnStatus，向前查生命周期标记最多 8 MiB；只恢复状态，不能改变消息页或游标。`turnActivity.ts` 统一解析基线/增量，activity 只含 thinking/working/outputting，不携带推理原文或工具参数。普通助手正文不代表完成，显式完成/打断/失败事件才结束 turn。
- rollout 路径使用规范 UUID，不锁定 `019` 前缀。索引冷盘点后靠 fs.watch 更新并每 60 秒对账；根目录 dev/ino/birthtime 改变须重建 watcher。头缓存按文件签名失效，摘要接口不读取全历史。
- app-server 在同一初始化 Promise 完成前不发布 client；断线失效，停止期间旧初始化不能复活。只读调用共享客户端，独立发送客户端不能混接事件；start 在 await 前预留容量。
- 输入全进程串行，最多 16 个事务；每请求 0700 目录/0600 文件。只终止自己拥有的 helper 子进程，不能全局 pkill；helper 开始后的未知结果禁止换输入方法重发。
- 幂等记录仅单进程、24 小时、1000 条，不保证跨重启 exactly-once。SSE 每设备 4/全局 32，上传每设备 2/全局 4；上传解析前预留，成功/异常/取消均释放。base64 仍非流式文件上传。
- 配对码 5 分钟、一次性，最多 8 个待用码/16 台设备；设备凭证仅存哈希，默认保存在 defaultCwd 下 `.mobile-codex/devices.json`，0600 原子写；操作串行，撤销立即关闭流并废止流 token。
- onRequest 完成鉴权再解析正文；日志只含 method/path，不含 query/凭证/正文。Tunnel secret 走 Authorization header；旧 Broker 握手 query 兼容保留，部署仍需检查代理日志策略。
- 公网修复先严格校验 TLS、检查实际进程 cwd 和 `/api/connection`，再按 Broker → Mac 切换；源码构建成功不能代替运行版本验证。续期需 timer、deploy hook 与目标证书 dry-run 证据；流程见 `docs/ops/remote-connection-repair.md`。
