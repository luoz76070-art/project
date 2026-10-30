# 临时轮次身份提升与APK37预览

日期：2026-10-30。状态：预览已发布，原手机记录待用户覆盖升级确认；DeepSeek剩余控制验收继续保留。

## 根因与现场对应

APK36详细报告在17:22:15捕获了两组重复：测试输入及此前的恢复反馈。每组均有一个native-input与一个history，显示身份不同，正文和时间分别相同/相近；手机runtime、rendered、DOM均各2条。摘要、截图和详细文件均保留于用户上传目录，不提交报告正文。

逐个SHA256身份对应后，两个native-input实际为`turn-48-input`与`turn-45-input`。它们的client及nativeMessageId已经指向正式原生消息，id和turnId却仍使用未分配服务端轮次时的序号。history使用真实轮次，导致按turn分组的一一关联失效。旧代码mergeSameMessage合并同client记录时保留等长正文的旧记录，同时附加新native别名/替换关系，形成这个混合状态。

用已捕获原生/历史投影重建临时→正式→history顺序，旧生产代码输出的两组id/client/source/native/turn哈希、时间和正文哈希逐字段等于手机报告；修正后各一条，重连回放仍各一条。该检查是单列的真实只读证据回放，不计隔离单元测试，也不当作Android安装后验收。先前完整双源回放没有包含临时turn，因此会通过；此前替换回归只覆盖真实turn下的临时input，未覆盖轮次本身从turn-N提升。

## 最小修复

手机合并器增加对索引临时输入的身份提升：仅当userMessage的id恰为turn-N-input，且已有明确replacesMessageId与匹配的正式nativeMessageId时，同步更新id/turnId。规则应用于合并结果、按id建立索引前以及既有缓存/渲染合并入口。无明确关系或不符合临时形态的记录保持原值，不按相同正文删除消息。

既有版本3缓存可直接修复，保留草稿、待确认、附件、游标和历史分页；同文但client/source不同的第二次真实输入保持两条。网关现有字段已足够，本轮只更新手机，不重启网关或原电脑任务。

## 检查与交付

- 新增3项输入回归：真实App状态工厂中的6种正式/历史/HTTP回执顺序，污染缓存的离线恢复/完成/重连/迟到临时快照，以及身份边界与真实第二次输入。前两项先以2≠1失败，修正后通过，原9项过渡回归保持通过。
- 手机125/125、消息回归、lint、两端typecheck、两端及插件构建通过。APK更新5/5、热更新1/1、发布脚本4/4通过；本轮未改后端生产逻辑，不重复执行先前已通过的384项后端回归。
- 实际浏览器390×844，8项检查覆盖正式与历史、旧缓存形态、完成、reload、迟到临时输入、首次载入旧身份及真正第二次同文输入；前者1条、后者2条。草稿保持，控制台无错误/警告。仅使用自有fixture，零真实发送/审批/中断。
- Android clean assembleDebug、Java编译和完整lint通过，0 Error/Fatal、8项既有Warning。与APK36同签名，4个Web文件逐字节匹配最终dist，无fixture；原生插件/安装与录音权限、preview和hot更新源均核对。
- APK37 `1.3.16-turn-identity-preview`，4,077,327字节，SHA256 `c9fadb57c05bb5c649f61acd6c7c049d5be1c792f9ba32228d12293866cd3c1d`。17:39:59原子发布既有preview，previous逐字节保留36；正式18和hot清单保持。公网19/19项核验通过，完整下载与本地成品逐字节一致。

发布复用既有原子上传/成品与公网检查脚本。默认SSH认证失败，改用历史已配置的发布别名与IdentityFile后核对四份远端/公网清单一致，再执行发布；没有修改SSH权限或索要密码。

证据：ignored `output/audit/2026-10-30/duplicate-recurrence/`中的phone-replay-result.json、indexed-turn-before.tap、mobile-after.tap、browser-checks.json、android-build.log、android-lint.log、apk-verification.json、publication-check.json。原报告只有身份/正文指纹，replacesMessageId未单列；回放重建结果的所有已报告身份均匹配，修正依据仍为产品中已经保存的明确替换关系。

浏览器合成画面（非Android真机）：

![单条输入、折叠过程与保留草稿](/Users/rorance/workspace/project/codex-to-phone/output/audit/2026-10-30/duplicate-recurrence/single-bubble-390.jpg)

## 真机验收与回退

已请用户在App内覆盖升级37，直接查看原测试输入与原恢复反馈，无需重发、清缓存或粘贴长报告。安装后结果待确认，不能宣称所有手机时序已通过。五项DeepSeek控制验收仍只完成发送；运行中引导、排队及取消、权限、停止继续留在当前任务。

通道回退前须核对latest仍为37，再原子恢复本轮preview-before.json及previous-before.json，不删除已上传APK。已安装37不能普通覆盖降到36，应交付更高versionCode修复包，不卸载清数据。

搁置：截图中内部压缩摘要外显属于另一项显示问题，本轮未改。
