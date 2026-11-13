# APK36集成预览交付与真机验收

日期：2026-10-30。状态：本轮预览交付完成；保持preview，未晋升稳定版。用户启动的[计划](../../plans/2026-10-30-preview-validation.md)已执行；DeepSeek rc.3兼容经用户明确选择留到[下一轮计划](../../plans/2026-10-30-deepseek-rc3-compat.md)。

## 交付与真机结果

- APK36 `1.3.15-reliability-preview`于08:39（上海时间）原子发布到既有preview，previous保留APK35。正式18及hot清单逐字节保持。
- 用户确认已覆盖升级36，原连接保留，短摘要复制正常，系统保存先取消、再重试保存正常。
- 用户查看原来重复的输入，返回列表并重开会话后确认“现在只显示一次”。这证明该手机原记录的本次验收通过；未将其扩大成所有运行中时序或新发送/引导/排队均已真机验证。
- 配套固定网关已切换，新实例本地/公网连接、实际构建诊断、鉴权、近期/全部列表、语音配置与Codex原生IPC通过；公网Codex首帧及重连通过。未代发模型任务、回答卡片、批准权限或调用外部模型。

## 产物身份与自动验证

APK SHA256：`ecc3db0a880e152a6ff48a0147c471556b3830a6fe24e9d7a66966b09f3c6c7e`，4,077,185字节，与线上APK35同签名。4个Web产物逐字节匹配APK，preview/hot更新地址正确、无fixture；DEX核实六个原生插件存在及MainActivity诊断/剪贴板/更新注册，安装和录音权限保持。

Web构建：`web-3d9952a9-c6c8-4109-b38a-181968c55ca2`。网关构建：`gateway-e5e3ce97-882c-45b4-8e14-fcd998a1c28f`，bundle SHA256 `7a2bbd240cf276001c2a62e22b44e14f355a853a4e3dde6ef373d1203226d56f`。独立网关ZIP保存在ignored output/delivery/2026-10-30/reliability-preview/。

完整`corepack pnpm verify:all`最终通过：手机121/121、后端377/377、入口6/6、APK5/5、热更新1/1、发布4/4，另含lint、类型、消息、CLI发现及两端/插件构建。Android Java编译与lint为0 Error/Fatal、8 Warning。最终APK clean assembleDebug通过。沿用阶段五真实App的390px合成时序/草稿/终稿折叠与重开检查，其结果与本轮手机反馈分别记录。

公网发布19/19项通过：完整下载与本地包逐字节一致，大小/SHA256/CORS/清单版本/previous正确。新网关58/58项只读检查、Codex首帧与重连12/12项通过，尾窗120条与36条输入替换关系有效。

## 网关切换与保留

基线是preview35/previous34，固定网关为10月24日bundle `a79f7a9b1eb36f5b21d32a9067b7156b6362ddfa85727e5099db9b11e336f8f6`。起初另一个Codex业务任务运行，候选先准备；待只读快照确认其他业务任务结束、待发队列及审批为空后，于08:46执行精确instance管理stop，原PID约2.17秒自然退出，端口释放后启动新固定包并连接Tunnel。

原配置、设备配对、语音凭证、DeepSeek profile/插件等保留文件逐项SHA核对一致。DeepSeek原进程没有被停止或重启；桥接在切换前就未监听。未注册新的LaunchAgent。

## 失败与修正记录

- 初次与二次全量后端并发4均失败于原生文件通知更新用例；单独及并发2全量通过。最终入口恢复既有版本同步流程的并发2，该断言按可观察状态最多等待3秒，仍小于生产60秒扫描兜底；未跳过断言。失败日志保留，完整入口最终重跑通过。
- 成品检查脚本第一次因DEX中非UTF8字符串解码失败；对工具输出采用容错解码后完成原生注册核验，无需修改APK。
- 用户打开DeepSeek后，原桌面插件页明确报：宿主0.2.1-rc.3不兼容dsh-mobile-codex0.2.1的engines.dsh =0.2.1-rc.2；9876无监听、列表502。这是更新前已存在的宿主兼容问题。用户选择本轮先交付APK36，下一轮修复；没有放宽版本门或改原profile。

## Git与证据

fetch发现origin/main领先一条`9c80e49 Create SECURITY.md`，仅新增父仓库SECURITY.md。按项目约定暂停自动合并；用户明确批准后使用`merge --ff-only`接收，保留所有项目修改。

集成源码提交：`a29e32867dad48c19544ff79daff61febc4337e4`；annotated标签：`codex-to-phone-v1.3.15-reliability-preview`。已原子推送main与标签，并核实远端main及标签展开值都等于该提交。后续交付文档另作docs提交，标签保持指向该源码构建基线，不移动已发布标签。仅提交codex-to-phone/下101项源码与文档，暂存前后校验范围、无二进制/构建包/凭证；父仓库其他工程修改保持。

详细证据：ignored `output/audit/2026-10-30/preview-validation/`中的verify-all-final.log、apk-verification.json、publication-check.json、switch-report.json、health-report.json、stream-check.json、github-sync.json和phone-acceptance.json。初始失败日志独立保留。私有源码/原网关/配置备份位置在backup-path.txt与state-path.txt中，不入Git。

## 回退与本轮边界

网关回退仅对核验后的当前instance执行管理stop，确认自然退出与端口释放后以原配置启动备份oldEntry；不覆盖设备/语音配置、不关闭Harness。通道回退须先核对latest仍为本轮36，再原子恢复preview-before.json和必要的previous-before.json，不删除包。已安装36的手机不能普通覆盖降到35，应发布同签名且更高versionCode修复包，不卸载或清数据。

复用既有发布脚本、成品核验与私有备份流程；新增下一轮兼容计划，不另造发布系统。真实新发送/引导/排队/审批、长时间后台/切网及合盖恢复不在本轮作为已通过结论。
