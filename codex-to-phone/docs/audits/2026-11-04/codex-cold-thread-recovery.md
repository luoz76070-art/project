# Codex未加载会话发送恢复

日期：2026-11-04（Asia/Shanghai）。用户明确指定“评估将 Kelivo 全功能集成到 codex-to-phone”，要求修复并避免其他会话复发。手机继续APK38，不修改手机更新清单。

## 根因与修复

原本HTTP/Tunnel/IPC健康，历史可读；但未加载会话没有owner，旧逻辑只重试发现，无法取得控制快照。用户指定Kelivo确为此情况。使用桌面提供的原会话导航接口加载后，原网关本地17ms、公网约1.64秒取得token和canSend=true，未向模型发消息。

核对当前桌面包26.1027.30824，原IPC没有冷加载方法，保留已加载会话的follower协议。新增desktopThreadLoader在鉴权手机SSE找不到owner时打开已核验的原会话URL，随后继续发现owner并等待权威快照。仅macOS，校验UUID和本地索引存在；无prompt、无新建线程、无辅助功能输入。系统open使用-g，但宿主仍可能切换桌面当前显示的会话。

同会话合并加载，60秒限频，待处理/近期记录分别最多128；每次恢复最多打开一次，释放/停止取消未开始工作；新的查看订阅可加入加载，不被旧订阅取消误伤。后台队列、列表、健康检查保持被动。原token/epoch/revision和未知提交锁保留，加载成功本身不解锁发送。健康following补充恢复阶段和稳定错误码，旧APK不新增失败文案。

## 验证

- 新增13项隔离恢复回归，先以旧代码复现冷会话等待超时，再验证修复；涵盖加载、超时、并发、切走/停止、被动订阅、错误响应、HTTP鉴权、未知提交不重放、校验及限频。
- lint、两端typecheck/build、独立插件构建通过；手机126/126、后端403/403、消息、可执行发现、热更新、APK更新及发布检查通过。首次完整检查中新增HTTP测试因测试连接未关闭而超时；补齐测试closeAllConnections后13项约2.4秒通过，后端和后续检查重跑通过。生产逻辑没有为测试超时放宽。
- “墨韵小修改”在验证前owner发现超时，使用真实候选加载器后约11.0秒取得120条消息及canSend=true；一次加载、3次owner发现、模型请求0次。证明修复适用于其他原会话，而非写死Kelivo。
- 用户手机按钮与真实发送尚待确认，不能用服务端canSend替代点击发送的验收。

## 固定网关切换状态

切换前Codex三条已订阅会话没有待确认提交、待发或审批，DeepSeek14条会话均无待发/审批/未确认提交。两个Codex任务正在运行，未停止宿主。配置/设备/队列/语音凭证已私有备份，候选固定包已复制并核对hash。

首次管理stop返回202，旧网关PID32223释放8787端口，但20秒内未自然退出；随后仍持有三个到DeepSeek桥接的读取连接及IPC连接。首轮按项目契约暂停，手机连接暂时不可用；首次失败记录保留，不改写为正常退出。

用户随后明确回复“允许”，授权仅结束残留旧网关并启动已验证候选。2026-11-04 07:25:44（Asia/Shanghai）再次核对PID32223的完整Node路径、旧固定入口、配置参数、空闲端口及候选hash后，对该PID发送SIGKILL。确认退出后启动新版；07:25:46新网关PID60246、instance `058dd52e-6337-4933-98b7-54ad9604ff2a`已监听且Tunnel connected。此为明确授权的强制退出，不是自然退出；没有终止宿主、停止模型任务或提交模型消息。

配置、配对设备、待发队列和语音凭证逐文件hash保持，原宿主PID24068/82091/82110均保留。新版buildId为`gateway-aab0276d-4708-483a-84cc-9e641abf4c3a`；本地/公网鉴权200、无凭证401、同instance/build及IPC initialized通过。两端recent28/all123的ID集合一致，DeepSeek14会话列表均可读。

上线后Kelivo、墨韵小修改、当前主线及另一业务会话本地/公网均取得canSend=true；当前主线仍为inProgress，另一业务会话为completed。Kelivo首个本地9秒观察窗不足，公网后续约3秒取得首帧；另用30秒上限复测，本地15ms、公网约2.35秒取得真实令牌。保留初次超时证据，不将冷加载时延误报为即时可用。未代发任何模型任务，手机填入草稿后的按钮恢复与实际发送仍须分别确认。

候选bundle SHA256：`5f541953c7623e5ef0360927a193e8207023af6dfe6f524ea55dcb147e245764`。
固定候选：`/Users/rorance/Library/Application Support/Mobile Codex Gateway/releases/2026-11-04-cold-thread-5f541953c762/mobile-codex/lib/gateway.mjs`。
私有备份：`/Users/rorance/Library/Application Support/Mobile Codex Gateway/backups/2026-11-04-cold-thread-1793724478634`。

证据目录：`output/audit/2026-11-04/codex-recovery/`。verify.log保留首次失败，verify-resume.log为修正测试后后端及后续通过；owner-before.json、candidate-cold.json、preflight.json、deepseek-preflight.json、deployment.json记录只读对照与切换失败。recovery-deployment.json独立记录授权恢复、强制退出、新进程与保留项；post-deploy-health.json及post-deploy-probe-*.json记录上线复核。四会话首轮探针仍保存于前一日证据目录的desktop-probe-*.json。原始业务正文和凭证不写入公开报告。

本轮复用已有固定网关备份、切换与复核流程，没有新建Skill或自动化；退出残留单独存档，未扩大到网关生命周期重构。下一次切换仍应先管理stop；本次SIGKILL许可只适用于上述已核验旧PID。

## 保留范围

本轮未改30天筛选，尚无证据证明缺失近期真实新对话；时间口径候选保留在前轮计划。DeepSeek拒绝/停止验收及临时权限恢复继续暂停；本轮不代发测试或批准请求。
