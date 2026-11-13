# Relay 后端规范

## Pre-Development Checklist

先读 [模块结构](directory-structure.md)、[运行与错误边界](runtime.md)、[传输契约](transport-contract.md) 和 [验证](quality-guidelines.md)，再读当前 task 的 PRD/design/implement。修改现有服务适配器时另读 [Agent 网关契约](agent-gateway-contract.md)。

修改 Desktop 原会话写入时另读 [Desktop 控制契约](desktop-control-contract.md)，避免混用 P0 socket、旧 follower 参数与 UI 输入。

修改插件管理入口、独立配置或后台进程时另读 [插件管理网关契约](managed-gateway-contract.md)。

修改原生网关的macOS登录启动、进程托管与service命令时另读 [后台托管契约](mac-gateway-service-contract.md)。

修改可选OpenCode会话、HTTP/SSE或手机Agent路由时另读 [OpenCode契约](opencode-contract.md)。

修改Claude Mods宿主模块、本机bridge或共享Agent会话ID校验时另读 [Claude契约](claude-contract.md)。

修改DeepSeek官方Harness插件、本机HTTP/SSE或UUID别名时另读 [DeepSeek契约](deepseek-contract.md)。

## Quality Check

修改语音/模型凭证时读[语音契约](voice-contract.md)，不能从Agent适配器转发任意模型URL或客户端指定owner。

按验证文档完成类型检查、构建和隔离传输测试；核对未触发真实 Desktop 控制。模块迁移保持入口兼容。
