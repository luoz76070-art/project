# Mac 合盖后手机断线检查

检查时间：2026-10-29 21:10起，Asia/Shanghai。

## 结论

用户确认触发操作是合上 MacBook 屏幕。系统电源日志明确出现合盖睡眠；Amphetamine 当前会话未启用合盖保持运行。现有证据支持合盖导致整机睡眠，从而中断手机到本机网关的实时连接。

本轮为只读检查，没有修改电源设置、Amphetamine 配置、产品源码或网关，也没有提交模型任务。未进行新的合盖复测，因此不宣称问题已经修复。

## 本机证据

- 机器：MacBook Air，Apple M4；检查时使用电池，仅检测到内置显示器。
- `pmset -g log`：2026-10-29 17:51:19 +0800，`Entering Sleep state due to 'Clamshell Sleep'`，电池84%。之后有多次维护唤醒/重新睡眠，20:49:45恢复FullWake。维护唤醒记录不能证明网关持续在线。
- Amphetamine 5.3.2：通过应用自带AppleScript只读命令查询，`session is active=true`、`closed display mode enabled=false`、`display sleep allowed=false`。
- Amphetamine持久偏好也显示`Allow Closed-Display Sleep=1`。应用脚本字典说明，合盖模式启用状态与“Allow System to Sleep When Display is Closed”复选框相反。
- `pmset -g assertions`显示Amphetamine防止空闲系统休眠；另有caffeinate防止显示器空闲休眠。这些当前断言不能作为合盖继续运行的验收证据。
- 本机网关PID 36651，启动于2026-10-24 10:22:39；检查时`GET /api/gateway`返回200，tunnel为`connected`。
- 本机及既有公网入口`GET /api/connection`均返回200，`ok=true`、`authenticated=true`。凭证仅在进程内从既有配置读取，没有输出或写入此记录。
- 现有gateway.log未提供足以逐秒关联此次合盖断线的事件；不以当前健康检查推断睡眠期间也正常。

## 建议与验收边界

优先使用已有Amphetamine配置合盖保持运行（取消“Allow System to Sleep When Display is Closed”）；按需要允许显示器睡眠。此设置尚未更改。应用当前版本自带脚本字典提供`enable closed display mode`命令，但提示可能需要先处理应用自己的说明弹窗。

设置完成后，另做一次受控合盖测试：合盖前确认手机在线，合盖后检查手机读取与公网连通性，开盖后对照电源日志确认测试期间是否进入Clamshell Sleep。没有这一步，不将“配置已启用”称为“合盖连接已验证”。

本轮无需更新APK；未改变重连逻辑。后续若在整机未睡眠时仍断线，再检查网络、Broker心跳与恢复路径。
