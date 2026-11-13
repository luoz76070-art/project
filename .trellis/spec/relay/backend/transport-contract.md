# Broker / Tunnel 流式契约

## 手动连接诊断（2026-10-29）

`GET /api/diagnostics`沿用Bearer/配对设备鉴权，仅返回schema、当前产物buildId和托管Tunnel最近20条内存事件。`startTunnel`可选onDiagnostic记录代次/序号/固定原因/数字closeCode；不记录URL、密钥、close reason或原错误，不读模型会话、不重放写入。普通Relay无托管Tunnel时enabled=false。完整数据、大小限制及手机兼容见[短诊断契约](../../mobile/frontend/diagnostics-contract.md)。

Desktop初始`userMessage`首项带`replacesMessageId=turnId-input`；accepted steering不替换初始占位。snapshot附加`inputReplacements`身份索引，最多最近240条，消息正文尾窗仍120条。索引只含turnId/replacesMessageId/nativeMessageId及可选clientMessageId，不含正文/控制信息；full与partial均须保留该metadata，允许零正文变化时只更新关系。长尾与边界在desktopNativeControl隔离测试验证，手机接入/缓存过渡另验。

## 1. 范围与触发

实现 F01/F02/F03 与 F19 的传输部分；源码为 `src/transport/`、`src/server/eventStream.ts`。手机的 REST/SSE 地址不变。此契约不表示前端档案隔离、订阅恢复或真实 Desktop 控制已完成。

## 2. 签名与入口

- `createBroker(config = loadBrokerConfig())`：返回未 listen 的 Fastify 实例。
- `startTunnel(loadTunnelConfig())`：返回 `{ done, stop() }`；stop 取消请求并关闭连接。
- `createRelayServer({ config?, logger?, services? })`：Node 与 SEA 共享路由；测试可注入合成服务。
- 根 `brokerServer.ts`、`remoteTunnelClient.ts`、`server.ts`、`serverExe.ts` 是启动入口。

## 3. 消息与环境变量

```text
Broker → Tunnel
request { id, method, path, headers, body: string|null, stream?: true }
ack     { id, seq }
cancel  { id }

Tunnel → Broker
response-start { id, status, headers }
response-chunk { id, seq, body: base64 }
response-end   { id }
response-error { id, message }
response       { id, status, headers, body: string }  # 旧协议
```

`protocol.ts` 的 Zod schema 是消息结构的执行依据。chunk 序号从 0 连续增长，每块最多 32768 字节；Broker 写入 stream 未触发背压时 ACK，否则 drain 后 ACK，Tunnel 收到匹配 ACK 才读下一块。同一条连接最多 32 个在途请求，Broker 总 pending 最多 256。WebSocket 帧上限 56 MiB，保留旧 base64 上传兼容；这不是上传流式化的完成标记。

新 Broker 在 request 中带 `stream:true`，并接受旧 `response`。新 Tunnel 对没有 stream 标记的请求返回旧 `response`。旧组合只保证普通响应兼容；两端都更新后才能流式转发 SSE，部署先 Broker 后 Tunnel。

- `MOBILE_CODEX_BROKER_REQUEST_TIMEOUT_MS`：默认 180000，首响应或响应块空闲截止时间。
- `MOBILE_CODEX_TUNNEL_REQUEST_TIMEOUT_MS`：默认 180000，本地 fetch / ACK 空闲截止时间。
- `MOBILE_CODEX_HEARTBEAT_MS`：两端默认 15000；未收到 pong 在下一次周期终止连接，正常约两个周期内发现黑洞。
- `MOBILE_CODEX_TUNNEL_RECONNECT_MS`：默认 3000，指数退避起始预算，全抖动、预算上限 30000；稳定连接 30 秒后重置失败计数。
- WebSocket 握手截止 10000 ms；SSE ping 每 15000 ms。

正常活跃流不受固定总时长截止限制。SSE 单连接待消费快照缓冲上限 2 MiB，超过则关闭慢端。Broker 的 PassThrough highWaterMark 为 64 KiB；并发连接与系统网络缓冲另计，不能用此数值宣称总 RSS。

## 4. 校验与错误矩阵

| 场景 | 行为 |
| --- | --- |
| Relay 未连接 | HTTP 503 `relay_offline` |
| 明确断链或旧连接被替换 | 未起响应返回 503 `relay_disconnected`；已起流则关闭；对应 pending 清理 |
| 超过请求/发送缓冲预算 | HTTP 503 `relay_busy` |
| Broker 截止 | 未起响应返回 504 `relay_timeout`；取消本地请求 |
| 本地 fetch 失败 | 未起响应返回 502 `local_relay_failed`；已起流则关闭 |
| 手机关闭响应 | cancel 传到 Tunnel，AbortController 中止本地读取和 ACK 等待 |
| 其他 Relay / 连接代次回包 | 不匹配连接对象则忽略，不能完成该 pending |
| 无 start、重复 start、错序/非法 base64 chunk | 中止该请求，取消上游 |
| 流 token 错误 | Relay 返回 401；合法流保留正常 Fastify CORS |

禁止自动重放发送请求。取消与失败均释放计时器、监听器、pending、fetch 和 ACK 等待。转发时删除逐跳头、content-length 及 fetch 解压后已失效的 content-encoding。

## 5. 正常、兼容与异常示例

- 正常：request(stream) → start → chunk(seq=0) → ACK(0) → chunk(1) → ACK(1) → end。
- 兼容：request(无 stream) → response；新 Broker 收到旧 response 仍正常回复普通 API。
- 异常：A 请求的 id 由 B 回包，忽略 B；A 断开后立即失败；不会等旧 180 秒截止。

## 6. 验证

`corepack pnpm test:transport`：首块在 EOF 前可读、活跃流不被总时长截断、UTF-8/二进制与状态码、取消、断链、串 Relay、防旧连接、CORS/鉴权/监听器清理、双端失活心跳、超时取消、重启恢复无重放、慢端不阻塞其他请求、普通旧协议兼容与并发上限。

隔离测试使用随机端口、合成 HTTP/WebSocket 和注入 Desktop 服务，不启动 Codex turn。Android 网络切换、Mac 休眠唤醒、Windows 和 24 小时运行需要单独验证。

## 7. 错误做法与正确做法

- 错误：先 `await response.text()` 再回 Broker；正确：发送响应头和有界块，消费后 ACK。
- 错误：仅按 requestId 匹配或相信 readyState=OPEN；正确：绑定连接对象，并主动心跳探测。
- 错误：SSE 使用 raw.writeHead 绕开 Fastify；正确：`reply.send(PassThrough)` 并在响应关闭时清理。
- 错误：为迁移建空规范或复制第二套路由；正确：规范指向真实模块，Node/SEA 只保留同一工厂。

## 用户正文投影兼容（2026-10-29）

role/item type维持原含义，普通用户正文和标题不能因自然语言角色前缀被隐藏。缺明确来源的旧记录按现有专用包络标记兼容过滤：environment_context、permissions instructions、app-context、collaboration_mode、personality_spec、skills_instructions、plugins_instructions、AGENTS.md instructions、INSTRUCTIONS、send_user_message_question_reply；不新增未经证实的来源字段。此边界同时适用于rollout、Desktop与app-server，问答回执不投影为普通用户输入。通用`You are `和`Knowledge cutoff:`不是上下文来源证据。
