# DeepSeek启动配置接线修复

日期：2026-10-21

## 问题与修复

`config.ts`和托管网关已接收DeepSeek配置，`createAgentGateway`也支持相应适配器，但`createRelayServer`创建默认网关时只传了Codex/OpenCode/Claude字段。用户即使填好DeepSeek配置，生产Agent列表也会缺少它。既有HTTP测试直接注入包含DeepSeek的AgentGateway，跳过了出错的构造路径。

生产代码仅补传`deepseek: config.deepseek`。新增隔离回归不注入AgentGateway，使用临时Codex目录和原合成bridge，检查默认HTTP工厂的被动注册、会话列表、显式探测、没有读取消息正文/调用模型或泄露密钥。

## 验证

- 修复前新用例确定失败：DeepSeek状态为undefined，而非期望的unprobed。证据：`output/audit/2026-10-21/deepseek-factory-before.tap`。
- Relay类型检查、Relay构建与独立插件构建通过，日志为同目录`deepseek-factory-{typecheck,build,plugin-build}.log`。
- `node --test apps/relay/tests/{deepSeek,openCode,claude,managedGateway,macGatewayService,agentGateway}.test.mjs`：135/135通过，其中DeepSeek23项，证据`deepseek-factory-regression.tap`。仅临时目录/端口及合成Agent，无真实模型或用户会话。
- 独立ZIP18文件与本次构建逐字节一致，相对上一网关托管候选仅`mobile-codex/lib/gateway.mjs`改变：1,167,452字节，增加20字节，无新增运行依赖。

## 独立本地候选

目录：`output/delivery/2026-10-21/deepseek-factory-preview/`。

- ZIP：`mobile-codex-agent-plugins-deepseek-factory-0.2.0-preview.zip`，345443字节，SHA256 `93c86f822f7a1b6265c1d5a9f793da969ca4550ceac2d3c9e72b19ca08382959`。
- bundle SHA256 `a0990f6806d912498b50edf2537d59ae49d118c9a401494d701e1cfd109bf3b3`。
- `manifest.json`记录源码SHA、18文件一致性与原候选差异；原候选保留，插件版本仍为本地未发布的0.2.0/0.1.1/0.1.1。

修复尚未替换当前在线固定网关，也未安装用户DeepSeek宿主插件。手机APK没有变化；[当前会话手机选择卡验收](current-session-phone-acceptance.md)与该源码修复分别记录。长期连接测试继续暂缓。
