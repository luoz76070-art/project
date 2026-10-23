# DeepSeek跨工作区线程与按需历史

日期：2026-10-22。沿用`10-20-agent-gateway`。用户要求历史支持程度与Codex相当，并选择“默认近30天，可查看更早”。本轮实现普通线程的跨工作区列表、历史分页和原线程继续；原生卡片与单次审批沿用既有实现。

## 用户可见结果

- DeepSeek列表默认近30×24小时，以官方最后用户对话/创建时间为准；运行中、正在订阅及有未确认操作的线程保留。点击“查看更早会话”切到全部范围，可再切回近期。
- 列表只传标题、目录和更新时间。手机仅在DeepSeek列表前台每30秒及回前台刷新；桌面新建或旧线程有新对话后，下次刷新加入近期。聊天页面不同时后台刷新列表，返回列表后更新。
- 正文打开时按需读取，每页最多40条/256KiB。手机采用240条显示窗口，可以持续向前翻并“返回最新”，取消DeepSeek旧190条硬停止。
- 查看历史不激活Agent。用户在手机显式发送时，官方原进程恢复同一sessionId；不创建替代CLI或fork线程。原user/message.source.rpcId确认后才标记confirmed，accepted仅代表submitted；未知结果跨重连锁定、不重放。

本轮只改变DeepSeek列表范围；其他Agent沿用各自列表行为。子Agent、多profile聚合、创建/归档会话管理不在本轮范围。

## 成本与边界

30天是手机下发范围，不代表官方数据库只访问近期记录。当前官方`sessionController.list({})`仍读取全部摘要，插件缓存15秒，原创建/可见消息/状态变化后失效，下次请求再读；没有手机列表请求时不扫描。它省去旧会话的手机传输、渲染和正文读取，不进行全部历史后台同步，也没有额外模型调用。

历史用官方`page`；插件不读取`observation.events`，但官方内部仍可能物化所选会话日志，不能承诺底层随机读。普通正文只含用户/助手文本，单条最多32768字符，附件、工具过程和推理不投影；不能声称任意长度正文或附件已与Codex完全等价。

列表50条分页，游标绑定query/range和固定切片；历史游标绑定原会话及固定throughSeq。只有工具过程的历史页可能没有可见正文，但游标仍严格前移，手机可继续加载。

## 隔离与浏览器验证

| 检查 | 结果 |
| --- | --- |
| 全后端 | 318/318 |
| 手机状态/连接 | 43/43 |
| 最终DeepSeek及managed相关回归 | 64/64 |
| 官方历史隔离检查 | 4项通过 |
| 既有官方交互隔离检查 | 8项通过 |
| 两端typecheck、Relay/Mobile/插件build、消息回归 | 通过 |
| 浏览器360/390/430px | 无横向溢出，75线程分页及更早记录可见 |
| 合成1000条历史 | 连续7次翻页至680，240条窗口仍可继续，返回最新恢复40条 |

新增10项后端历史回归涵盖跨目录、冷线程、分页/游标、只读零激活、原ID继续、rpc确认/未知锁、旧token、UTF-8预算、近期缓存/失效及停止取消。修复前失败证据保留。

显式检查器`node scripts/check-deepseek-history.mjs <隔离runtime>`使用已安装官方0.2.1-rc.2构建332895e0f7c9d4dbfb29729f5eb367fa263ff986的模块，在自建临时副本导出内部控制器，使用官方SessionStore/Query/Controller与合成持久化、Agent resolver。72条普通摘要零正文读取、95条prepared历史完整分页零激活、原prompt与requestId去重通过；resolver是替身，不等于用户实际AgentLoop恢复验收。未读取用户profile或请求外部模型。

UI截图位于`output/audit/2026-10-22/deepseek-history-{360,390,430}.jpg`，均为合成内容。初次浏览器懒加载与重建dist并发导致旧chunk404，构建后刷新恢复，未据此修改生产源码。APK核验初次误判Capacitor生成的两个cordova资源，检查器已校正；gradle/config.ts曾版本不一致，已同步22并完整重建，以下为最终产物。

## 实际更新与只读检查

升级前私有备份：

```text
/Users/rorance/workspace/backups/codex-to-phone/2026-10-22-deepseek-history-20261022T015229Z
```

当前固定入口：

```text
/Users/rorance/Library/Application Support/Mobile Codex Gateway/releases/2026-10-22-deepseek-history-28e41294af6d/mobile-codex/lib/gateway.mjs
```

bundle SHA256：`28e41294af6dd5713c0223e97733a9a4fba20348965c58cfffb1c3a6380795fa`。

通过官方插件页仅停用/启用原手机桥接，核对8个发布文件后加载DeepSeek插件0.2.0；原安装链接目录保留旧名称`mobile-deepseek-0.1.1-995eea83826f`，实际内容已更新。独立候选为`mobile-deepseek-0.2.0-9a7c856c1727`。真实info声明`scope=all/history=true/interactions=true`。两份私有配置仅增加`scope: all`，原凭证、设备状态及profile package/patch/lock逐字节保持。

原网关26313正常stop后2074ms自然退出，再启动73249，单监听/固定路径/Tunnel通过。原Harness68334与后端68372保持；原任务在更新前已自然完成，没有因升级中断。未启用登录自启动或修改宿主安全策略。

10:00左右（北京时间）完成95项健康断言：本地/公网鉴权200、无凭证401、Android预检204、Codex原生IPC connected/initialized、原进程/配置保留及逐文件校验通过。实际普通线程11个、3个工作区；8个有缓存标题、3个fallback标题。真实近期和全部各11条，无大于30天的实际普通线程，因此更早过滤以合成测试为证，不把真实全相同范围记作时间筛选验收。

另一个工作区的真实历史首帧本地约7ms、公网约221ms；各继续3页后共8条可见文本，无重复消息，游标持续前移。公网重连约132ms，使用当前手机同源v1 reducer及snapshot身份校验通过。耗时仅代表该样本；未保存正文、原会话ID或控制令牌。真实发送/追加/中断、权限决定和Android行为另行验收。

## APK22独立预览

版本`1.3.1-deepseek-history-preview` / versionCode22，包名`com.mobilecodex.app`，4037143字节，与APK21同签名。4个dist资源逐字节匹配，无旧hash资源；v1/v2签名及双更新源通过。

[下载APK22预览](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.1-deepseek-history-preview-fb3ce9b8fe8a.apk)。覆盖安装并保留数据，不先卸载。**APK21没有本轮范围按钮与240条历史窗口，手机安装22尚待用户确认。**

APK SHA256：`fb3ce9b8fe8a3da59862a7d629e9dc02c065f9262e8e82971e8a98590aa0237f`。

复用原子发布脚本及现有SSH密钥，仅更新`android/preview/latest.json`，原preview21保留为previous；公网完整下载与本地逐字节、SHA/大小/CORS通过，共14项发布断言。正式Android18及hot清单逐字节保持。本轮没有发布新HTML热更新，也未自动安装手机。

## 交付、证据与回退

独立交付`output/delivery/2026-10-22/deepseek-history-preview/`含网关6文件ZIP、DeepSeek8文件ZIP、APK22、manifest、README及SHA256SUMS，两个ZIP逐文件回读通过。全部日志及脱敏运行/发布报告位于`output/audit/2026-10-22/deepseek-history-*`，不含凭证和用户正文。操作脚本另存上述私有备份。

回退须把网关、插件与两份scope配置作为兼容组合处理。先核对当前instance和固定入口，正常停止并等待原PID退出和监听释放，再经官方插件页停用手机桥接，恢复已核验旧插件及scope模式，重新启用后启动匹配网关。不能直接把旧网关与新historyCursor协议混用；配置有后续变更时只调整本轮字段，保留新凭证和设备状态。不重启Harness或中断原任务。备份已备齐，本轮未实际演练回退。

复用并补充`docs/ops/remote-connection-repair.md`，未创建额外skill或自动化。临时fixture与官方提取runtime在检查后清理；保留研究、交付与私有恢复资料。源码未暂存/提交/推送，整体Agent网关任务保持in_progress，长期测试继续暂缓。
