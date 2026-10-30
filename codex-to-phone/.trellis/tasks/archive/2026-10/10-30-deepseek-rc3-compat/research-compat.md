# 官方接口与实际版本证据

已安装宿主：0.2.1-rc.3，desktop host protocol4，Node24.21.0，Cordis4.0.5。通过官方应用的app.asar只读提取，未修改应用。细项SHA在ignored output/audit/2026-10-30/deepseek-rc3-compat/runtime-identities.json。

旧插件manifest由HEAD读取，rc.3原evaluatePluginCompatibility明确返回engines.dsh不匹配。插件外还有网关deepSeekInfo的rc.2 literal及bridge.info的硬编码，不可只放宽manifest。

实际对照：
- app-boot：精确版本OR表达式允许rc.2/rc.3，rc.1/rc.4/正式版本拒绝；CLI profile合成正常。
- SessionStore/Query/作用域事件与AgentLoop：既有接口仍匹配，逐帧revision与权威消息替换、steer、keepInbox/旧turn拒绝各通过官方生产循环。
- SessionController：list/page/prompt仍可沿用；requestId→source.rpcId确认、prepared分页不promote、去重通过。
- TypertGateway：settleRemoteEvent/finishRemoteEvent指纹与原严格白名单一致，未放宽内部审批指纹；真实官方问题、计划、审批、取消、桌面先答及continued均通过。

rc.3检查使用已安装桌面打包模块，仅补入官方registry同版agent-loop-testkit；rc.2另用官方registry精确版本的隔离安装，禁用安装脚本。两版各25项通过，本地确定性adapter各3次响应，外部模型0次。

部署旧插件版本拒绝状态不会随CLI add自动消失；官方插件页刷新后显示新0.2.2，但组件仍关闭。仅切换该插件启用开关off/on后组件运行，桥接9876恢复，原Harness全部PID保持。原任务已完成，遗留后台brew命令不被停止。
