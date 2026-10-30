# 执行

- [x] 核对已安装runtime，私有备份profile/配置/旧插件，隔离复现旧版本门。
- [x] 比较加载器、Session/Query/Controller、AgentLoop及交互接口，完成精确兼容修复。
- [x] 运行官方runtime/interactions/history检查、DeepSeek回归、lint/typecheck/build及必要网关回归。
- [x] 自审，固定产物并核对内容、哈希与回退入口。
- [x] 官方HMR更新插件；用户授权业务任务运行中仅切网关，精确instance自然退出；本地/公网只读验收通过。
- [ ] 用户手机确认原会话正文和重新打开。
- [x] 更新spec/交付记录/工程入口，按项目版本同步流程提交并推送preview标签。
- [ ] 手机确认后记最终验收并完成本轮。

自审：用户已授权本计划；实现前先验证API，不以放宽门限代替验证；发送/审批等真实控制不在只读验收中。
