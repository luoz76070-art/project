# Claude Code 原接口接入 MobiCodex

## Goal

沿用用户选定的本机旧接口，通过已有 Claude Mods/Agent 通道接入 MobiCodex；保留现有 Codex/DeepSeek、凭证与手机配置，区分隔离校验和真机联动。

## Requirements

- 2026-11-08 用户确认：在电脑页接入 Claude Code，沿用此前接口地址、密钥和模型配置。
- 复用 code10 既有 Claude 页面、共享输入/工具/图片组件及一个 Relay/Broker。
- 本机 Claude 2.1.220 不支持现有 Mods 契约；兼容运行时须通过官方包完整性和隔离加载验证。
- 用户追加：先清理旧配置，再使用当前CC Switch的cc配置。已由只读数据库及真实UI确认：当前Claude Desktop选中名为cc的Vulcan API配置；将该来源同步给Claude Code。接口替换前私有备份，保留权限/Hooks/会话；凭证不进源码或日志。
- 用户随后报告 Claude Desktop 连接超时。本轮先诊断该问题，再继续接入；2026-11-08真实最小消息/流式探测均返回上游502，不将模型列表200当作生成可用。
- 用户选择「改用我在 CC Switch 中指定的新接口」，随后指定cc1。已确认Desktop选中cc1，但完整连接配置与原cc相同，此前13:28真实消息仍502；最新13:33/13:38实际响应已恢复200，继续采用cc1，不能擅自回退旧服务商。
- 保留原 Claude 配置/历史、Codex/DeepSeek 连接和手机配对。

## Acceptance Criteria

- [x] 确认旧接口来源、兼容运行时及原配置回退点。
- [x] 官方严格插件校验与8项无模型检查通过，Claude 隔离回归通过。
- [ ] 原在线网关登记 Claude，本地/公网只读检查通过，原两通道与配对保持。
- [ ] 用户在 MobiCodex 电脑页打开 Claude 会话，真实收发和手机显示按实测记录。

## Notes

现有手机0.1.8/code10已验收，无手机功能改动时不重打APK。Claude Desktop/Code均选cc1，native settings及基础Sonnet默认模型已同步，健康接口已恢复。用户已批准启用Claude桥接，原进程登记与手机联动待完成；总整合59组验收保持原状态。
