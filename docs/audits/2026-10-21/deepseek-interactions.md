# DeepSeek 手机卡片与单次权限

日期：2026-10-21。按用户“DeepSeek的卡片和允许权限也需要在手机端实现”完成源码、隔离验收和原进程实际加载。公网已看到当前真实权限卡的完整输入及“允许一次／拒绝”；用户随后通过原题结构化回复确认“能看到完整参数及‘允许一次／拒绝’”，手机权限卡显示验收通过。实际决定仍待验收，没有代答、批准或拒绝真实请求。

## 用户可见行为

手机进入“切换 Agent → DeepSeek Harness”，返回会话列表并重新打开在线会话。原生问题支持单选、多选、自填和计划全文，显式提交给原等待点；权限卡展示工具、工作区、原理由、多语言说明与原始工具输入，只提供本次允许或拒绝。参数不完整、超过限额或带未知约束时禁用允许并说明原因。

桌面和手机处理同一请求，先答的一端生效；取消、过期、旧任务或请求改变后不能继续提交旧卡。未知结果保持锁定，重连不自动重放。超时后已继续执行的原生问题走官方continued回复路径，排队不等于已消费。仅支持选定工作区内原live根Agent，不创建或恢复另一会话，不转嫁子Agent权限，不保存长期授权。

当前APK21已支持通用卡片，计划detail合入现有question字符串，**无需重装手机版**。手机源码能力说明已更新，但本轮没有发布新APK或HTML；已装包可能仍含旧“电脑处理”提示。真实卡片以当前请求能力为准。原生问题在此次只读时为0张，不能宣称真实问题/计划已验收。

## 原接口与实际兼容修复

固定桌面版0.2.1-rc.2实际构建为`332895e0f7c9d4dbfb29729f5eb367fa263ff986`，与早期`687f282`研究提交不同。插件读取原typertGateway.pendingRemoteEvents，手机提交在同步段内核验原对象/Agent/signal/turn/step后调用完整settleRemoteEvent；不注册新answerer，不更改approval policy。

完整工具输入由原tool/call及PTC dispatch-start的callId/name/turn/step索引取得，不能从聊天正文猜测。索引128条/256KiB，单明细192KiB、总交互384KiB；超过4096事件的日志不物化，因此连接前待审批可能缺参。审批只保证完整工具输入，最终进程cwd/环境可能在批准后才计算。

两处真实加载发现的问题已复现并修复：

- Cordis的ctx.get每次返回新traceable服务Proxy，直接函数toString及Proxy身份不稳定。指纹改从原型descriptor取原函数，缓存及宿主身份按原pending Map；官方隔离检查改用真实traceable服务，避免普通对象fixture掩盖问题。
- 官方ApprovalRequestEvent.displayReason是必含en的多语言字符串对象。原字符串判断导致真实权限卡只有拒绝；现完整保留各语言的有界JSON及reason。非法/超限仍禁用允许，补合成和官方服务回归后真实卡恢复once/reject。

问答和权限沿用设备鉴权、stream-token、客户端UUID及网关幂等登记。桥接使用独立密钥、仅loopback，手机不直连9876；问题/答案/控制令牌不持久化。已完成记录和回退文件不包含公开凭证。

## 当前运行与备份

- 原Harness主PID68334、后端PID68372保持；9876监听仍归68372。原任务仍running，未发送、追加、中断或执行真实权限决定。
- 插件包内容为0.1.2，仍装在原目录`~/Library/Application Support/Mobile Codex Gateway/deepseek/mobile-deepseek-0.1.1-995eea83826f/`。目录名为旧版是为复用原官方HMR链接，避免package-moved要求重启，不能据目录名判断内容版本。
- 最新独立固定候选：`~/Library/Application Support/Mobile Codex Gateway/deepseek/mobile-deepseek-0.1.2-c99bfa5255e8/`，7个文件逐字节核对后加载。私有bridge配置未改变。
- 固定网关：`~/Library/Application Support/Mobile Codex Gateway/releases/2026-10-21-deepseek-interactions-24e3f3b5ff1c/mobile-codex/lib/gateway.mjs`；单监听PID14624，instanceId=`999b8b4f-795a-4ed1-a941-a27a38c3c098`。
- 私有备份：`/Users/rorance/workspace/backups/codex-to-phone/20261021T143221Z-deepseek-interactions/`，包含原插件0.1.1、profile patch、配置、状态和操作脚本。配置与设备文件状态hash保持；含凭证的备份不应公开。

插件以官方HMR加载，未升级或重启Harness、启用登录自启动或改系统权限。网关首次通过instance绑定接口正常stop返回202并释放8787，但旧PID8482仍持有到9876的SSE，10秒退出检查报`OLD_PROCESS_EXIT_UNCONFIRMED`，服务短暂离线。原切换脚本在await stop之后才置stopped标志，因此该次未自动回退。随后插件HMR释放原SSE，8482自然退出，启动新固定网关恢复；没有kill进程，也没有中断DeepSeek。失败保存在`gateway-switch.json`，恢复另存`gateway-recovery-start.json`，没有覆盖失败证据。

此网关活动订阅退出清理竞态尚未修改产品代码，列为独立待办；不能称本次无缝切换。HMR后的别名可能变化，手机应返回列表重新打开。实际加载依据新卡片行为和文件核对，不仅依据旧版也可能返回true的info.interactions。

## 验证

- 最终全部后端304/304，其中DeepSeek40/40。覆盖原题/计划/continued、一次允许/拒绝、普通/PTC完整参数、多语言理由、缺失/非法/超限/歧义、旧turn/step、跨Agent、取消/两端先答、unknown跨重连、配对设备及HTTP幂等。
- 手机42/42、消息合并回归、两端typecheck/build、独立插件构建通过。手机本轮仅更新能力说明，通用卡片保持已有实现。
- 官方运行时13项通过：3次自有本地确定性adapter响应，无外部模型；官方原生交互8项通过，使用真实Cordis服务及Approval/UserQuestions/Session/Projection/AgentRegistry，无模型。含原题计划、原审批审计/多语言理由、拒绝、取消、桌面先答、continued及pending无泄漏。
- 自有fixture真实浏览器检查360/390/430px无横向溢出，权限按钮44px；双题含计划全文，多选+自填与单选一次提交，answers长度[2,1]。合成允许/拒绝、未知锁定、缺参仅拒绝正常，console error为空；视口覆盖恢复、页面关闭。没有导出截图文件，不用合成检查替代Android验收。
- 更新后公网手机同源解码器订阅6.881秒，1全量/1增量，23760字节，首帧656ms；重连2.242秒，首帧800ms。两次均还原70条文本、ID无重复、无序列缺口，同一live别名，1张pending权限卡，完整输入702字符、decisions=[once,reject]。原问题0张，真实控制写入0次。
- 收尾本地/公网连接与会话200、无凭证401、Android预检204、Tunnel connected；Codex IPC connected/initialized。单网关/bridge监听、原Harness PID、安装文件及运行bundle hash匹配，配置/设备状态保持。
- 用户手机实际显示：2026-10-21收到原题结构化回复“能看到完整参数及‘允许一次／拒绝’”，权限卡展示通过；该回复仅确认查看，不证明用户点击、宿主收到决定或工具执行完成。证据另存`output/audit/2026-10-21/deepseek-interactions-phone-display.json`。

脱敏证据及测试输出在`output/audit/2026-10-21/deepseek-interactions-*`；独立ZIP、逐文件hash及清单在`output/delivery/2026-10-21/deepseek-interactions-preview/`。操作脚本复用本轮既有备份/HMR流程，没有新增自动化或通用技能。

## 回退与剩余验收

先核对当前私有配置与后续改动，再按原安装目录逐文件恢复备份的0.1.1插件及其原manifest，保留原路径；仅撤销本轮追加的HMR注释，不移除原mobile-codex配置项。经官方HMR核对原Harness仍在线、bridge版本和监听；不要为回退强停运行任务。

网关可回到原`releases/2026-10-21-question-lifecycle-6efac3ab10aa/mobile-codex/lib/gateway.mjs`，正常停止并确认原监听和进程退出后启动，不依据端口已释放就误判退出完成。出现本次活动订阅排空现象时停止后续切换，按私有恢复记录排查，不全局kill。配置、配对设备与APK无需随程序回退。

用户手机已确认当前权限卡展示；实际允许/拒绝提交、原生问题/计划、真实取消/两端先答、普通发送/追加/中断及前后台/切网仍分别验收。当前实际请求由用户自行判断；不为验收自动构造模型任务。长期测试继续暂缓，整体Agent网关任务保持in_progress，源码未暂存/提交。
