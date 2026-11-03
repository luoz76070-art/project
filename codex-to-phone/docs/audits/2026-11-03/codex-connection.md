# Codex列表与发送置灰排查

日期：2026-11-03。范围：用户报告手机只有部分线程、多个线程发送按钮置灰，但连接测试通过。本轮只读检查；没有产品代码变更、打包、部署、重启服务、真实模型发送或Git提交。

## 结论与证据

1. 当前本地/公网基础链路正常。两端`/api/connection`均200且authenticated；`/api/gateway`为同一instance `f83d44d8-ed3c-48a7-82d5-2e3eca0ef939`，native模式、Tunnel connected，运行PID32223。两端`/api/desktop/control/health`均ok、IPC connected/initialized且lastError为空。历史Tunnel曾重连，不能将当前检查扩大成长期稳定性通过，也没有证据要求立即重启网关。
2. 列表两端一致：recent=28条、all=123条，均hasMore=false。桌面工具抽样30个本地会话ID全部存在all列表；15个被recent排除。当前默认近30天符合此前用户选择，手机可用“查看更早会话”切到全部时间。不能把全部时间中存在的记录称为同步丢失；尚未收到用户指明的缺失会话。
3. 桌面元数据与日志时间口径确实不同。例如“深度学习、机器学习出题”在桌面工具及只读SQLite元数据中为2026-10-18，网关日志索引时间为2026-09-18。网关只合并session_index与rollout文件时间，未读取桌面状态库。元数据更新时间可能包含迁移、重命名或项目调整，尚未证明该差异是新对话被漏掉；需要明确活动时间的语义后再修正筛选，不能直接把所有迁移时间当新消息。
4. 已复现“HTTP通但没有发送能力”。已加载的“codex-to-phone主线”和“墨韵主线”在本地/公网均取得native token与canSend=true；前者运行中、后者已完成。未加载的“评估将 Kelivo 全功能集成到 codex-to-phone”和“墨韵小修改”在两端SSE均200，但9秒观察窗只有连接注释，没有任何desktop控制快照。直接IPC对当前主线的owner发现成功，而Kelivo会话owner发现6秒超时；桌面工具也将两个失败样本标为notLoaded。
5. 当前实现只发现已有owner并请求follow，没有让未加载会话成为可控会话的步骤。手机发送守卫要求native token、canSend与无未决提交；因此历史正文可读、健康检查成功时仍可能永久置灰。应完善按需加载或明确不可控原因，而不是去掉守卫或改用新CLI任务。此模式已在两个未加载样本复现，但尚未证明用户所有灰色按钮都属于这一类；用户指定样本后继续区分手机订阅/未知提交等问题。

## 检查边界

- 上一项DeepSeek权限测试的额外公网观察出现过429；本轮8条短时CodexSSE探针均200，没有复现连接额度故障，不能把之前429直接作为当前置灰的根因。
- 每条探针取得发送能力后立即关闭，失败样本最多9秒、单条原始帧上限3MiB；报告仅保存控制布尔值、消息数量和状态，不落盘业务正文或令牌。所有探针已结束。
- Computer Use工具拒绝直接访问Codex界面（安全限制），未尝试其他UI自动化绕过。因此“在电脑打开未加载会话后手机恢复”的界面对照仍未验证。
- 没有提交实际消息，所以canSend=true只能证明控制能力已就绪，不能替代手机点击发送和原会话收到一次的验收。
- 新用户请求优先，DeepSeek拒绝/恢复原权限/停止验收暂停；该测试会话仍保留临时workspace-write/ask，未冒称已恢复。

证据：ignored `output/audit/2026-11-03/codex-connection/` 下的`summary.json`、`thread-lists-before.json`、`desktop-list-reference.json`、`list-comparison.json`、`desktop-metadata-samples.json`、两份`desktop-probe-*.json`及有界只读探针`probe-desktop.mjs`。源码定位：`CodexStore.listThreads`、`DesktopControl.connectFollow`、`desktopSendControl`、`SessionRangeControl`。

## 后续

优先将用户实际灰色会话与上述样本对应；属于未加载会话时按[修复候选计划](../../plans/2026-11-03-codex-connection-recovery.md)验证官方原会话加载能力。当前不为修复猜测添加依赖、改权限或发布APK。
