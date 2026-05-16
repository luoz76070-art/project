# 安全与验收

## 硬约束

- 不修改 Codex Desktop 安装目录。
- 不修改 `~/.codex` 配置、认证、数据库和会话文件。
- 第一阶段只读读取 `~/.codex`，不写入。
- 不执行系统级安装、环境变量写入、防火墙修改、注册表修改。
- 不裸露公网端口。
- 每个阶段必须有 smoke test 记录。
- 如果只能连接 CLI 会话，不能声明达成 Desktop 同步。

## 成品验收

最终至少交付一种可用入口：

- Android APK：可安装到手机，连接 Windows Relay 使用。
- 微信/企业微信/Telegram 等接口：能从手机聊天入口读会话、发指令、收结果。

主线优先级：

1. Android APK + Windows Relay。
2. 企业微信/微信接口作为备选接入方式。

## 分阶段验收

Phase 1：

- Relay 能只读列出 Codex Desktop 持久化 threads。
- Relay 能只读解析指定 thread 的消息历史。
- 移动端界面能展示 thread 列表和详情。

Phase 2：

- 打通 Desktop live App Server 或明确可替代的 Desktop 同步机制。
- 手机端发送消息后，Desktop 能看到同一 thread 更新。

Phase 3：

- 手机端处理命令/文件修改审批。
- 具备中断 turn、查看 diff、查看命令输出能力。

Phase 4：

- 产出 APK。
- APK 在真机或模拟器完成安装烟测。
