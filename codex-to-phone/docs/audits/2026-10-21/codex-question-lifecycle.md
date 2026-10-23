# 异步选择卡生命周期修复与复测

日期：2026-10-21

## 原因与行为

用户反馈第二张测试卡未在手机显示。原生只读检查发现题目仍在已completed的轮次，Relay仅投影inProgress题目，导致输出正常结束就移除未答卡。

`desktopQuestions.ts`现在保留最新正常completed轮次中的未答异步题；较新轮次、取消/失败、已回答或原题移除使旧题失效。同步工具题的活动轮次约束保持。原题签名不因正常完成改变，重订阅保留未知提交锁。

`DesktopControl.respondUserInput`将异步回答交给`DesktopNativeControl`，运行中steer v1，空闲时start v2继续同一conversation，保留原题ID和完整上下文。两条路径与普通消息共用待确认保护，只发送一次，无失败切换。共享回包检查补齐内层method、steer原turnId及start非空turn.id，权威移除仍优先。

## 验证与运行更新

- 修复前问答新增场景失败13项、原生ACK新增场景失败2项；回归先复现再修复。
- 最终后端287/287、问答/原生控制82/82、手机42/42和消息回归通过；两端类型检查、构建与插件构建通过。新HTTP/SSE用例覆盖completed卡和同会话回复；测试仅使用合成状态及临时socket/目录。
- 候选18文件与构建逐字节一致，相对前一个DeepSeek配置接线候选仅gateway bundle变化；原候选保留。候选清单位于`output/delivery/2026-10-21/question-lifecycle-preview/manifest.json`。
- 按原会话已有授权，先私有备份旧版本、配置及实际存在的设备文件，再正常停止旧实例，等待端口释放和进程退出后启动新固定目录。本地/公网鉴权200、未鉴权401、Android预检204、native Tunnel connected和Desktop IPC通过；单监听者、配置及设备文件状态一致。详情`output/audit/2026-10-21/question-lifecycle-delivery.json`。
- 手机APK未改，未安装宿主插件或启用LaunchAgent。更新包含前轮已验证的DeepSeek配置接线修复，但不代表实际DeepSeek宿主验收通过。

## 手机复测

接续会话为`01a15dc8-0d94-77b1-94a5-a2bcb7378d48`。重新发出测试卡并结束助手回复后，用户返回原题结构化答复“回复结束后卡片仍可见”。本次卡片保留和原题回复回到同一会话通过；只读待答复核另存`output/audit/2026-10-21/question-lifecycle-phone-acceptance.json`。

上一轮25秒只读探测恰逢用户主动中断，观察到当前轮次interrupted且无卡片；该结果符合取消失效规则，不作为完成后保留验收。后台/切网、其他Agent原会话、登录/唤醒仍待分项实测；长期连接测试继续暂缓。

复测提交后公网v1只读订阅返回200，核对同一固定网关、当前会话及有效交互能力；待答卡总数0，本张测试卡已移除。使用手机同一快照解码器，客户端已关闭；探测未提交答案或模型任务。
