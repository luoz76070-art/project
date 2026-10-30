# DeepSeek rc.3兼容与手机复联验收

状态：2026-10-30用户已启动。两版官方隔离验证与60项DeepSeek回归已通过，原插件与网关均已更新，真实本地/公网通过，手机复联待用户确认。

## 已确认的原因

- 官方桌面DeepSeek Harness当前为0.2.1-rc.3；用户已打开原进程。
- 桌面“插件 → dsh-mobile-codex”显示v0.2.1异常：engines.dsh要求精确0.2.1-rc.2，因此不加载。既有桥接9876无监听，网关查询DeepSeek列表502。此情况在APK36/网关切换之前已存在。
- 原desktop profile、独立桥接配置及插件文件保持。APK36/网关可正常服务Codex；原用户会话、凭证、队列不得为兼容修复而清理。

## 目标与步骤

1. 核对实际rc.3运行时、原desktop profile与插件来源，备份私有配置、原插件及profile。比较官方加载器、SessionStore/Query、事件、AgentLoop、问答/审批接口；先用隔离rc.3运行时复现旧包版本拒绝。
2. 按实际差异修复插件并升级插件版本；仅在验证后声明精确支持的宿主及peer版本，不能直接去掉engines或使用无限范围绕过版本门。保持rc.2支持与否应以双版本验证为准。
3. 执行DeepSeek隔离回归及check-deepseek-runtime/interactions/history对应的官方运行时检查。使用临时profile和确定性本地adapter，不读取用户会话、不调用外部模型。默认verify入口不得自动启动这些真实运行时探针。
4. 原任务空闲时，通过已有官方CLI/HMR把核验的新插件加载到原desktop进程；若宿主要求重启，等原任务结束再正常重启。保持原配置、凭证、会话与工作区，不创建替代profile或模型任务。
5. 核验鉴权/info、近期/历史列表、本地及公网会话首帧/重连、旧端口单监听者、无凭证泄露；手机能打开原会话。发送/引导/排队/权限与中断仅在用户选定测试会话、给出明确指令后验收，未知结果不重放。

验收：插件页不再报版本异常；rc.3官方隔离接口回归通过；手机DeepSeek原会话恢复列表/正文与重连；实控测试分别记录，不以只读检查替代。失败保留证据并恢复原插件/profile，不影响已交付Codex链路。

## 本轮关联证据

[APK36交付](../audits/2026-10-30/preview-validation.md)、plugins/mobile-deepseek/package.json、plugins/mobile-deepseek/README.md、ignored output/audit/2026-10-30/preview-validation/activity-baseline.json。宿主不兼容文字已通过原桌面插件页直接确认。
