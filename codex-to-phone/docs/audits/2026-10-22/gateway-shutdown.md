# 网关退出与重启稳定性

日期：2026-10-22（Asia/Shanghai；证据JSON使用UTC时间）。用户要求继续下一项优化，沿用当前Agent网关任务与已授权的固定包更新范围，处理前次DeepSeek接入时发现的网关停止残留。

## 结果

固定运行网关已更新。新版在真实DeepSeek活动只读订阅下，管理stop返回202后约138ms确认进程自然退出和端口释放，随后同端口启动新实例、Tunnel重新连接。最终本地/公网鉴权、会话列表、Android预检、Codex原生IPC及34项健康检查通过。手机APK21无需重装。

本轮切换旧版时再次遇到残留，导致手机暂时离线；通过官方Harness插件页仅停用再启用已有手机桥接插件后，旧网关自然退出并恢复连接。没有强退生产进程或退出Harness，原主进程68334、后端68372及任务保持运行。失败与恢复分别保存，不能称无缝切换。

## 缺陷与修改

`createRelayServer`原来在`preClose`销毁下游SSE、单独停止Claude，把统一`AgentGateway.stop()`放在`onClose`。Agent路由先等待`adapter.watchSession()`再`reply.send(stream)`；若订阅仍在等上游info响应头或首帧，销毁尚未交给HTTP的下游流不能解除路由等待，HTTP排空又阻止`onClose`执行。

本轮仅将统一AgentGateway停止提前到`preClose`，与下游流关闭一起取消初始化和活动订阅，复用各适配器现有AbortController。存储/Desktop/live资源继续在`onClose`释放，去掉Claude重复停止。没有新增协议、依赖、全局fetch池操作或强制退出。

隔离复现确认这一关闭顺序缺陷；旧版线上残留只观测到持有的DeepSeek连接，没有取得当时路由调用栈，不能断言其所有竞态都与合成样本完全相同。新版的独立daemon及一次线上活动订阅通过证明本次范围内的修复，不等同于长期稳定性验收。

## 验证

- 修复前默认DeepSeek适配器与合成HTTP：info响应头等待、首帧等待2例在1200ms截止失败，活动流通过；修复后3/3通过。
- 新增独立bundle daemon回归：复制到隔离目录，首帧等待期间正常管理stop，3000ms内自然退出0/无信号、上游连接释放、宿主仍监听，同端口可再启动。失败清理仅限测试创建的child。
- 网关与macOS托管30/30、全部后端308/308。覆盖并发stop复用同一Promise、三种订阅阶段及原有鉴权/配对/控制边界。测试使用临时目录、随机端口和合成宿主，不连接用户真实会话或模型。
- 两端`typecheck`、Relay构建及独立插件构建通过；没有独立lint脚本。本轮无UI/手机源码改动，未重复构建APK或把桌面插件操作计为手机验收。
- 实际新固定包：活动只读SSE收到首帧后正常stop，PID26223自然退出、端口释放，记录138ms；从同一新入口再启动最终PID26313，instanceId=`39fd409d-8825-4f16-a2b0-c35fde631eec`，Tunnel connected。
- 最终34项检查：本地/公网连接、网关和DeepSeek会话200，无凭证401，Android Origin预检204，Codex IPC connected/initialized；8787与9876各唯一监听、原Harness PID、固定包6文件和原DeepSeek插件7文件核对通过。网关配置/设备状态/profile patch逐字节保持。
- 最终原会话只读快照connected、running，问题0/权限0。没有发送、追加、中断、回答问题或实际权限决定；本轮也没有修改宿主已有访问模式。

运行时检查脚本先后修正了可选`publicEndpoint`缺失时的目标来源和IPC字段的嵌套断言；两次探测失败原件保留在私有备份，最终检查通过。这些是检查器字段假设修正，没有改变运行配置或产品代码。

测试输出和脱敏运行记录位于`output/audit/2026-10-22/gateway-shutdown-*`。核心生产改动在`apps/relay/src/server/createRelayServer.ts`，新增4项回归在`apps/relay/tests/managedGateway.test.mjs`。

## 固定包、失败与恢复证据

当前入口：`~/Library/Application Support/Mobile Codex Gateway/releases/2026-10-22-gateway-shutdown-be256f04bd73/mobile-codex/lib/gateway.mjs`。

bundle SHA256：`be256f04bd736897a34a299602da1d8d1671249ec9ee77be5955ddc478b6e20f`。

独立交付：`output/delivery/2026-10-22/gateway-shutdown-preview/mobile-codex-0.2.0-gateway-shutdown-preview.zip`，325660字节，6个文件，ZIP内容与固定包逐字节相同；同目录保留manifest、SHA256SUMS和说明。ZIP SHA256：`5b36dca46328e8ff99ba85250de2f264a190c345160b8ea50429fbad751c2dea`。只包含mobile-codex包，不更新DeepSeek协议插件或APK。

私有备份：`/Users/rorance/workspace/backups/codex-to-phone/2026-10-22-gateway-shutdown-20261021T162746Z/`。内含原配置、profile patch、hash/入口/实例信息和本轮操作脚本，含凭证部分不公开。

1. `switch-report.json`：旧PID14624接受stop并释放8787，但40秒仍存活、持有到9876的连接，记录`PROCESS_EXIT_UNCONFIRMED`；原始失败没有覆盖。
2. `recovery-report.json`：官方界面仅停用/启用`dsh-mobile-codex`，旧网关自然退出；bridge仍归68372，新固定网关启动、Tunnel connected。
3. `verification-report.json`：新PID26223真实只读订阅下138ms自然退出，再启动最终PID26313；配置/设备/profile与原Harness进程保持。
4. `health-report.json`：最终34项通过。安装插件内容仍为0.1.2；UI切换时元数据显示从旧缓存0.1.1刷新为0.1.2，没有修改插件源码或profile patch。

桥接重载可能使原live会话别名变化，手机如仍停留旧别名可返回会话列表重新进入。新版停止实测未重载桥接。

## 维护与剩余边界

复用并补充`docs/ops/remote-connection-repair.md`：固定包更新必须分别确认stop接纳、原进程自然退出和端口释放，再启动并验证新实例；旧版残留恢复只重载已授权的手机桥接，失败/恢复分别记录。无需额外创建技能或定时自动化。

回退前核对配置的后续改动，正常停止当前instance并确认PID和端口都已释放，再启动原`releases/2026-10-21-deepseek-interactions-24e3f3b5ff1c/mobile-codex/lib/gateway.mjs`；不覆盖凭证/设备文件，不与新程序并行启动。旧版本仍有本次关闭缺陷，不能把旧包回退当成根因修复。

未启用登录自启动、执行真实模型控制或权限决定，未暂存/提交/推送。长期连接继续暂缓；用户已确认手机权限卡完整显示，实际提交、原生问题/计划、取消/两端先答及普通发送/追加/中断仍分别待验。Agent网关整体任务保持`in_progress`。
