# 实施顺序

1. 共享声明、结果归一化、Codex/桌面链路与隔离测试。
2. Relay Agent 适配器（包括 Claude 的保守映射）与测试。
3. DeepSeek 插件实时结果、重连内存与现有历史窗口投影、测试。
4. 手机 runtime、旧协议兼容、结果展示与合成浏览器检查。
5. 运行用户指定质量门，按上述四个模块提交；全部通过后推送分支并开中文说明 PR。

禁止修改 .github/workflows、Claude 插件或用户配置；禁止读取真实会话、提交模型任务或部署。

## 2026-11-13 验证记录

实现及代码自审完成。五通道沿用既有接口和事件名，新增结果字段；手机在现有提示区显示中文状态、原因及结束时间。新一轮保留前轮结果；已结束的 turn/start 回复直接释放手机发送状态。修正同轮权威时间补正、早到事件有界缓冲、未知终态清除和旧连接/请求隔离。

| 命令/检查 | 结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile --prefer-offline --store-dir /Users/rorance/workspace/project/.codex-lanes/pnpm-store` | 通过，296 包复用本地缓存 |
| `corepack pnpm typecheck` | Relay/Mobile 均通过 |
| `corepack pnpm build` | Relay/Mobile 均通过 |
| `node --test --test-timeout=15000 --test-concurrency=2 apps/relay/tests/{correctness,desktopNativeControl,claude,deepSeek,deepSeekHistory,openCode,agentGateway}.test.mjs` | 234/234 通过 |
| `corepack pnpm test:mobile` | 176/176 通过 |
| `corepack pnpm lint` | 通过，0 warning |
| `node --test --test-timeout=15000 --test-concurrency=2 apps/relay/tests/{userInput,desktopMessageQueue,desktopApprovals,transport}.test.mjs` | 110/110 通过 |
| `corepack pnpm build:plugin` | 通过；另外验证产物中的 DeepSeek turnResult 模块可独立导入且列入 package files |
| `lgit diff --check` | 通过 |

共享三态夹具位于 `scripts/fixtures/last-turn.mjs`。原生 IPC 形状、Relay 抢先终态/重试/ACK/退出、Claude 未知结束、OpenCode idle outcome、DeepSeek 失败与重连/无订阅均有合成用例；DeepSeek 的 model_unavailable 通过真实桥接与 Relay v1 SSE 元数据传递，并通过手机真实组件渲染断言。

窄屏浏览器视觉检查未完成：浏览器工具的自动审批拒绝访问本地合成站点（未获该 origin 权限），未绕过；合成服务已停止。后续可用 `node scripts/serve-ui-fixture.mjs` 启动离线页，`/fixture/last-turn?agent=deepseek&status=failed` 设置失败，status 可换 completed/interrupted，running=1 显示上轮。此入口只操作合成数据。

边界：Claude 无可靠结束证据为 null，未改插件和协议；旧 DeepSeek 插件省略结果时仍显示既有失败消息；无持久化与跨宿主/重启恢复，缓存淘汰或已有窗口缺少终态时为 null；observed 时间是首次观察时间。未执行真实模型、宿主控制、手机安装或部署，S2/W4 未纳入本次范围。
