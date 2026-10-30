# 集成预览交付与手机验收

日期：2026-10-30。状态：APK36预览已发布，网关切换、源码同步与真机验收进行中。用户启动范围见[计划](../../plans/2026-10-30-preview-validation.md)。

线上只读确认preview35（1.3.14-input-replacement-preview）、previous34、正式18及hot1.2.2-web.1；固定网关仍为2026-10-24版本，bundle SHA256 a79f7a9b1eb36f5b21d32a9067b7156b6362ddfa85727e5099db9b11e336f8f6，本地与Tunnel在线。旧版/api/diagnostics返回404，符合尚未部署新诊断的事实。

候选：APK36 1.3.15-reliability-preview，集成可靠性阶段一至五。详细证据保存于ignored的output/audit/2026-10-30/preview-validation/；私有备份路径保存在backup-path.txt。ADB当前无设备，手机升级/系统保存/原双气泡仍待验。

## 候选验证

APK36构建通过；SHA256 `ecc3db0a880e152a6ff48a0147c471556b3830a6fe24e9d7a66966b09f3c6c7e`，4,077,185字节，与线上APK35同签名。4个Web产物逐字节一致，preview/hot地址正确、无fixture；DEX确认六个原生插件存在及MainActivity注册诊断/剪贴板/更新入口，安装与录音权限保持。完整verify:all最终通过：手机121、后端377、入口6、APK5、热更新1、发布4，以及lint/类型/消息/CLI/构建。Android lint 0 Error/Fatal、8 Warning。

初次与二次全量后端并发4均失败于原生文件通知更新用例；单独用例及并发2全量通过，最终入口按既有版本同步流程调整为并发2，文件通知断言按可观察状态最多等3秒（小于60秒扫描兜底）。保留失败日志，未跳过断言。成品检查脚本第一次因DEX包含非UTF8字符串解码失败，改为容错解码后完成原生注册核验，APK无需修改。

## 当前外部条件

- 用户已打开DeepSeek Harness；实际宿主为0.2.1-rc.3，已安装dsh-mobile-codex0.2.1要求engines.dsh精确rc.2，宿主插件页显示不兼容并停用，9876未监听。问题在本轮切换前已存在，未绕过版本门。
- 原生只读快照显示另一个Codex会话运行中，网关候选已备份并复制固定目录但尚未切换；候选bundle SHA256 `7a2bbd240cf276001c2a62e22b44e14f355a853a4e3dde6ef373d1203226d56f`。
- fetch发现origin/main领先1条：`9c80e49 Create SECURITY.md`，仅新增父仓库根SECURITY.md；与项目修改无路径冲突，按version-sync约定不能自动merge/rebase。

## APK36已发布

2026-10-30 08:39（上海时间）已原子切换preview36/previous35，公网19项核验通过：完整下载与本地APK逐字节一致、大小/SHA256/CORS正确，正式18与hot清单字节保持。手机可通过设置→版本与更新→检查更新→下载并安装覆盖升级。新原生系统保存能力需要安装APK36。

构建身份：Web `web-3d9952a9-c6c8-4109-b38a-181968c55ca2`；候选网关 `gateway-e5e3ce97-882c-45b4-8e14-fcd998a1c28f`。目前在线仍为旧网关，因此手机摘要暂会标记网关诊断不支持，不能误报为新网关已部署。

## 回退边界

网关恢复使用原固定包和原配置，仅管理stop确认当前实例自然退出后启动备份中的oldEntry；不覆盖设备/语音配置，不关闭Harness。发布回退需核对线上latest仍为本轮36后，将保存的preview-before.json原子恢复latest；previous-before.json可恢复原previous。只更改清单不删除包。已安装36的手机不能通过普通覆盖安装降到35；应发布同签名、更高versionCode的修复包，不卸载或清空数据。

复用项目发布脚本、APK35成品核验脚本及私有备份方式，本轮运维脚本/失败和成功证据保存在ignored输出目录；没有把凭证或APK放入Git。

用户随后明确批准“允许快进后同步APK36”，已使用merge --ff-only接收9c80e49；原项目工作区修改保留，不产生合并提交。
