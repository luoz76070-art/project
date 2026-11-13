# 语音网关与 APK26 预览发布

日期：2026-10-23（Asia/Shanghai）。用户“那现在继续下一步吧”授权更新固定网关与发布既有预览通道；实现及隔离验证见[语音候选](../2026-10-22/voice-input.md)。

## 发布结果

- APK26 `1.3.5-voice-preview` 已发布到 preview，previous 逐字节保留 APK25 清单。正式 Android18 和 hot `1.2.2-web.1` 清单 SHA 保持。
- [APK26 浏览器覆盖安装备用入口](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.5-voice-preview-fc9f27131aeb.apk)。用户当前 APK25 已绑定 preview，可在“设置 → 版本与更新 → 检查更新 → 下载并安装”升级，保留应用数据。
- 成品 4,061,289 字节，SHA256 `fc9f27131aeba25b3c02ca4bf7f78b5d629e7da701040772ccd5bdbe0f127473`；公网完整下载与本地 APK 逐字节相同，大小/SHA/Content-Length/CORS、版本、preview URL及回退清单共15项通过。包内实际更新源仍为 preview，应用ID/26/版本名及上一轮同签名记录核对通过。
- 新固定网关入口：`~/Library/Application Support/Mobile Codex Gateway/releases/2026-10-23-voice-b9c9d22ea020/mobile-codex/lib/gateway.mjs`，bundle SHA256 `b9c9d22ea020f64e2708700f2b4553eb02f5e0e62f0ae2e2b7da70d6c5697508`。本地/公网语音配置接口200、无凭证401、Android预检、配置不含Key且no-store、两Agent列表、Codex原生IPC与配置/插件/设备状态共84项检查通过。

安装后，在“设置 → 语音与提示词”填写百炼地域/可选工作空间、百炼Key和DeepSeek Key。模型Key不在聊天提供，当前未调用真实供应商。会话“语音输入”录音后预览编辑，采用仅回填草稿，由用户自行发送。

## 网关切换失败与恢复

按原instanceId正常stop，旧PID78411释放8787后仍存活超过20秒，保留4条到DeepSeek bridge9876的连接；没有启动第二实例或强退网关。原失败保存在`switch-report.json`，不能称无缝切换。

通过官方Harness插件管理页仅停用/启用已安装的`dsh-mobile-codex`，旧网关自然退出后启动新固定入口，最终PID95384、instanceId `76c89471-9c71-4973-97bb-7b389fb11055`、Tunnel connected。原Harness PID68334/68372、gateway配置、设备存在状态、profile与插件逐字节保持，未启用自启动、发送/中断任务或处理审批。失败和恢复报告分别保留。

此前关闭顺序修复和一次真实退出通过，未覆盖本次残留；本轮没有修改退出代码，不能宣称该长期残留已根治。后续需独立复现和定位。

私有备份：`/Users/rorance/workspace/backups/codex-to-phone/2026-10-23-voice-20261022T181213Z/`，包括原入口、配置及存在的设备/插件文件；不公开凭证。回退前检查后续配置变化，正常停止当前实例并确认PID和端口均释放，再从原固定入口start，不覆盖用户新Key或设备文件。

最初使用默认SSH连接认证失败；从上一轮APK25发布命令找回既有SSH别名和IdentityFile后，远端清单SHA与公网一致，沿用原子上传脚本成功发布。先前凭证卡无需再答，不需要用户补充密码。

## 同轮消息显示反馈

用户报告2026-10-23 02:06与02:07出现相同输入，第一次回复像计划文档。只读核对电脑原始会话，本次“那现在继续下一步吧”只有一个userMessage；网关投影时间为02:06:50。发现同一轮中缺少item时间的消息统一使用turn开始时间；临时输入与原生/历史回流使用不同ID时，也存在不能合并的分支。但未读取到手机缓存或对应画面，尚未完成这两条气泡的对应复现，不能宣称重复提交或具体根因已经确认。

建议单列优化：发送ID/turn与item身份贯通，原始消息到达时替换占位；保留真实消息时间并避免以回流时间重新插入；区分进度/计划与final，进度默认折叠并可展开；重连不重复追加。保留真正独立发送的相同文本，不能按内容一概去重。“计划文档”来源未确认，本轮没有修改聊天投影或声称该问题已修复。

## 证据与待验

证据：`output/audit/2026-10-23/voice-release/`；交付目录沿用`output/delivery/2026-10-22/voice-preview/`，发布状态另行更新。原语音隔离结果后端332/332、手机51/51、类型/构建/更新与窄屏、lint0错误/8警告保持；本轮复用相同成品，未重复整套构建和单元测试。

另用有界原生HTTP探针验证公网Codex/DeepSeek首帧及重连，共14项通过。Codex首帧1550ms/重连1865ms、120条消息；DeepSeek320ms/358ms、27条消息、connected/idle。时间仅为本轮只读样本，不代表语音时延、长期稳定性或手机真实控制通过。

首次旧fetch探针停在Codex流读取，超过观察窗口后仅终止自建诊断进程95681，保留`stream-health-first.*`；未结束生产网关。新有界探针第一次错误假设DeepSeek顶层sessionId，按实际手机解码器的session.id/agentId校正后14项通过，错误断言记录在`stream-check-first.json`，最终在`stream-check.json`。这两项为检查器限制/错误，产品代码没有因此修改。

真实手机APK26安装、麦克风权限/120秒/后台清理、Key地域/模型可用性、识别和整理保真、时延/费用仍待用户在手机填写Key后验收。旧DeepSeek追加入口测试继续暂停；语音task保持in_progress，不归档。
