# 所有电脑 Agent 统一体验与 code9 预览

日期：2026-11-07。用户要求同步当前Codex效果/功能/界面到DeepSeek Harness，并明确确认Claude Code、OpenCode及以后新增电脑Agent也统一。本轮承接已由用户真机确认的code8，不重做AI路由或自动判断电脑任务。

## 实现与边界

Codex/Agent共用ComputerComposer、上传helper、MessageTimeline及图片Provider。说明按原序直接显示，连续工具动态摘要/一次展开、明确终稿独立，字号/主题跟随统一设置。附件沿原上传接口，文字/附件草稿按连接+Agent+会话保存；确认只清匹配项，新编辑保留，未知不重发，上传/存储失败阻止离开。所有列表共用ProjectGroups；未来SessionAdapter显式登记sessionApi:1后复用工作区，仍由原控制能力决定按钮。Claude保持不可引导，未扩大原生权限。

DeepSeek0.2.6对原生tool/call、tool/result及PTC事件按原seq投影，实时/历史同身份；只传可见文本，不传推理/meta/内部error.reason，保留成功turn/end的终稿边界。Claude0.1.2透传原工具一次及原结果，用tool_use_id串联实时/快照，限定result.text，不传私有result/context；只在原成功完成证据和最后正文一致时标终稿。OpenCode按固定官方2.0.16混合content原序拆分，overlay使用text ordinal并保留工具；仅idle outcome=succeeded提升无工具终稿。

共享Agent图片路由只接受path，根目录来自同设备活动SSE的权威原会话快照；断线/关闭/撤销即失效，冲突409。Codex/Agent共用全局4/每owner2限额及原8MiB、realpath/symlink、栅格格式策略。缩略图、大图、原尺寸及重试共用。

浏览器实际暴露纯文本工具输出被旧Codex包络解析误判为空，现已兼容并增加原输出及空包络回归；不只同步外观。官方PTC缺turn字段不伪造；Claude旧历史无原完成证据不猜阶段；未来供应商仍须实现真实适配器，不能仅靠界面宣称所有原生功能均存在。

## 检查证据

| 检查 | 结果 |
| --- | --- |
| 完整根verify最终 | 手机169、后端414、入口8及lint/typecheck/build/插件/消息/更新/发布检查全部通过 |
| 原生正式构建 | code9签名成功，340项/39 suites无失败/错误/跳过 |
| 完整Android lint | 0 Error/Fatal，宿主56/远控1既有Warning |
| 官方隔离 | DeepSeek rc.2运行时/历史/交互通过；Claude2.1.287严格validate及8项plugin test通过，外部模型请求0 |
| 成品 | code8同证书，包名/递增版本正确；最终5个Web文件字节一致，7个显式注册插件及arm64 AOT保留，无fixture |
| 对应源码 | 5921文件/5926归档项全部回读；5052固定来源齐全，0个未审核凭证模式（原13个合成Key精确放行） |

浏览器以独立loopback合成服务验证Codex与DeepSeek/Claude/OpenCode/未来通道；4→40工具增量保持展开，终稿收起详情且说明独立，命令/纯文本输出均可见；图片720px、大图/原尺寸/返回与404重试通过。附件上传/离开恢复/发送、合成语音回填、queue/steer/stop实际点击、Claude steer禁用、上传中阻止返回与失败提示通过。360/390/430宽、深色及150%字号无页面横向溢出；360下输入工具按钮44px。最终页面console error为空；语音为fixture，未录真实麦克风或请求模型，不能代替APK真机安装。

首次完整后端413/414，既有threadList文件监听3秒超时；单独及两次完整复跑通过，未改无关代码。首次原生pub get在默认源等待，取消后使用已有镜像/缓存成功；没有改锁/依赖。Claude本机2.1.220版本门拒绝，另用临时2.1.287完成验证，包从npm镜像取并核对dist SHA512，未安装/升级用户CLI。APK检查最初误以为空的生成plugins JSON为注册源，按实际Activity显式注册/DEX核验通过。上述诊断失败不覆盖，原始材料位于output/audit/2026-11-07/agent-parity。

本轮未改Flutter业务，未重跑Flutter全量、markstream或Android模拟器；沿用前版对应证据。代码/夹具通过不能宣称所有供应商原进程、最低系统或59组全部验收。

## 产物与双源交付

`0.1.7-native-preview` / code9，APK 60,978,859字节，SHA256 `2906505998d00021252aac5ec1dcb44c62ae09fe939ab7c38bb2f8912bd3c4ed`；同code8预览证书支持覆盖。对应源码 21,701,513字节，SHA256 `86b75bd3a10e738fcd65f06650d0d02ae340b047b369096421b9c2ccf879de72`。配套独立网关及DeepSeek0.2.6/Claude0.1.2归档、逐文件SHA与说明位于[0.1.7版本目录](../../../releases/android/kelivo-preview/0.1.7/)。源码与APK不含本机配置、凭证、用户数据或签名私钥。整合AGPL及原MIT/第三方归属保留。

GitHub产品提交`415f41961edaaa9bfd4cea0e08ab5b830017a017`及annotated标签`codex-to-phone-v0.1.7-native-preview`已正常原子推送，远端main和标签展开值匹配；版本目录10份文件完整回下载与本地逐字节一致，5921源码文件的Git blob及模式与归档匹配。独立App更新源latest9/previous8已发布，源码先于APK；APK和源码完整公网回下载一致，Range206、CORS及原四通道保持通过。实际App清单解析函数确认code8识别code9。公开回执见[agent-parity-verification.json](agent-parity-verification.json)。手机从「设置 → 应用更新」升级，Android安装器需用户确认。首次发布核验脚本沿用旧元数据目录导致本地路径错误，修正后完成；APK已全量核验的结果仅在ETag、长度和SHA保持后复用，原失败日志保留。

## 运行与真实验收

只读预检已确认原网关Tunnel connected，仍旧版且未声明sessionApi；DeepSeek桥接当前离线，Claude/OpenCode未配置，本机Claude2.1.220低于Mods最低版本。没有通过本轮自动重启网关、启用插件/配置新Agent或代发模型任务。已备好具体候选归档；在线网关和原插件切换按docs/ops/version-sync.md的独立边界确认后执行。

code9手机安装、原DeepSeek会话工具/图片/输入真实效果仍待用户验收。完整Kelivo59组和原Desktop新建继续独立进行；总Trellis任务in_progress。本轮复用原打包/原子发布与检查流程，统一组件/图片/工具投影契约写入现有Trellis spec，没有新增自动化或重复技能。
