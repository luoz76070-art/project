# 后端模块结构

- `apps/relay/src/server.ts`、`serverExe.ts`：Node / Windows SEA 启动入口，共用 `server/createRelayServer.ts`。
- `server/`：Fastify 路由与 SSE 生命周期；只组装服务，不复制第二套路由。
- `transport/`：Broker、主动连出的 Tunnel 与内部传输协议。手机仍使用 REST + SSE。
- `codex/`：可执行文件发现、app-server 客户端、Relay turn。
- `agents/`：Agent 适配器和网关状态；`codex/localAppServerClient.ts` 只连接既有服务，不拥有 daemon 或 turn。不能与 Relay 自建的 `AppServerClient` 混用。
- `plugins/mobile-deepseek/`：独立于Relay运行时的官方Harness Cordis bundle；`agents/deepSeek*`为其私有loopback适配边界，不导入宿主LLM包到Relay。
- `gateway/`：插件管理CLI、私有配置和单进程Relay+Tunnel；`macService.ts`为显式用户级LaunchAgent管理，执行器可注入，导入不注册服务。`main.ts`是有副作用入口，其余模块可隔离导入。插件源码位于根目录`plugins/mobile-codex/`，构建产物`dist-plugin/`不入Git。
- `desktop/`：Desktop 私有 IPC 与 macOS 输入适配。
- `store/`：JSONL 读取和附件存储。
- `voice/`：独立百炼ASR、DeepSeek提示词整理及设备隔离模型凭证；HTTP在`server/voiceRoutes.ts`，不混入Agent适配器。
- `smoke/`：可能访问本机 Codex 的人工 smoke，禁止并入默认隔离测试。
- `tests/`：Node test runner 隔离回归，使用随机端口、临时目录和合成数据。

编译为 NodeNext，内部导入带 `.js`；无顶层启动副作用的工厂便于隔离测试。根入口和 `dist/server.js`、`dist/brokerServer.js`、`dist/remoteTunnelClient.js` 保持可用。移动路径后复查 `import.meta.url` 的资源定位。
