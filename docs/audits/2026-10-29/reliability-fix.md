# 同步与输入可靠性：阶段一、二交付

日期：2026-10-29。用户授权范围为[复审计划](../../plans/2026-10-29-reliability.md)第一、第二项。源码与隔离验证完成；未发布APK/热更新、未重启线上网关、未操作真实模型任务、未暂存/提交/推送。保留既有修改与旧双气泡任务。

## 实际变化

### 旧回包不再覆盖新状态

- [App.tsx](../../../apps/mobile/src/app/App.tsx)的desktop/live fallback poll各有独立取消作用域；SSE恢复及effect清理立即取消，Workspace卸载同样传播取消。
- [sync.ts](../../../apps/mobile/src/features/chat/sync.ts)保存请求对应的运行态版本、turn和cursor/generation。成功与错误在返回时、React updater执行时都检查；草稿编辑不使合法读取失效。
- 即使原生HTTP没有物理停止，迟到结果也不能覆盖新turn、倒退cursor、复活旧状态或误报完成。完成提示和列表刷新由实际生效的运行态触发。
- 普通delta游标单调前进；明确的文件轮换reset或同文件截断reset可合法重建基线。订阅内连续批次不套用旧render版本，避免误丢正常事件。

### 输入独立保存并反馈失败

- [runtime.ts](../../../apps/mobile/src/features/chat/runtime.ts)先保存scope隔离的普通草稿、pendingMessageId/Text和本地未确认消息，再保存可重建正文；25个有草稿线程不再受正文24线程上限影响。
- 正文仍最多24线程×120条，增加2MiB UTF-16 JSON预算并按最近访问优先。关键输入单独1MiB预算，达到上限时明确失败并保留内存输入及此前可恢复副本，不截断文本。
- 配额不足仅回收本scope正文；旧格式迁移时先压缩正文、保留旧输入，避免重试也失败时连旧副本都丢失。新输入键即使为空也有权威性，正文写失败不能复活清空的草稿、待确认身份或本地占位。
- 保存结果为saved/history-reduced/input-failed。App独立展示提示，失败提供“重试保存”，不被运行进度覆盖；恢复后可保存并重开恢复。保持700ms批量与隐藏/pagehide/卸载flush。
- 不更换消息身份版本3，不改服务端提交协议、发送确认、真实同文输入匹配规则；不缓存审批、控制令牌或题目答案。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 修复前正式回归 | 5/5按预期失败：旧turn、旧cursor、取消后回包、25草稿、大正文配额 |
| React批处理追加复现 | 旧结果在updater被拒绝但仍提前报完成；已修正并纳入回归 |
| `corepack pnpm test:mobile` | 105/105通过，含新增21项可靠性测试与原输入替换测试 |
| `corepack pnpm test:messages` | 通过 |
| `corepack pnpm typecheck` | 手机、Relay通过 |
| `corepack pnpm build` | 手机、Relay通过 |
| Relay首次全量 | 368/369；transport重连测试在约2.7秒连接等待超时 |
| transport单独复测 | 14/14通过；未修改该模块或延长断言时限 |
| Relay限制并发复测 | `node --test --test-concurrency=2 --test-timeout=20000 apps/relay/tests/*.test.mjs`：369/369通过 |
| `git diff --check` | 通过 |

首轮失败保留在`output/audit/2026-10-29/reliability/relay-first.log`，复测为`transport-recheck.log`及`relay-recheck.log`，不把复测通过解释为首次没有失败。该连接等待问题不属于本轮产品修改；未推断其根因已解决。

真实Chrome/Chromium156存储验收使用[可复跑脚本](../../../scripts/test-mobile-cache-browser.mjs)，独立loopback origin、合成数据，未读取用户浏览器存储：

- 25个草稿及pending身份全部恢复。
- 6线程×120条×约8KiB正文后，新草稿全部保留；正文JSON为2,089,402字节，低于2MiB预算。
- 浏览器真实抛出QuotaExceededError。填满其他合成存储后，释放本scope正文可保存新输入，其他条目逐项保持。
- 关键输入仍无法写入时返回input-failed，旧输入副本保留；释放合成占用后重试成功，pending身份仍为原值。

实际App浏览器夹具验证：360×800、普通字号及150%字号；存储失败后编辑草稿并刷新线程，提示持续；恢复模拟存储并点击“重试保存”后提示移除；导航重开后新草稿恢复。重试按钮高44px，大字号宽90px，中心点命中正确且未超出viewport。夹具计数只有读取、stream-token及订阅，无消息/引导/排队提交。证据：`browser-cache.json`、`cache-warning-360-150.jpg`及`cache-warning-detail.jpg`，均在上述output目录。

## 验证边界与后续

本轮没有Android原生代码修改或APK交付，因此未重跑Android lint/安装，也未验证真机WebView配额、系统回收、键盘触摸或真实任务续发。草稿仍受本地持久化能力及批量保存窗口约束，不能保证故障设备或强杀前未flush的数据。现有APK35双气泡问题保持未解决边界。

已将同步守卫、缓存迁移与复跑检查写入前端architecture/quality规范；复用现有隔离UI夹具，仅增加缓存失败开关。没有新增全局技能或自动化。

下一轮按[计划](../../plans/2026-10-29-reliability.md)选择后再执行：发布预览版并真机验收，或正常提示词误过滤、短诊断、维护边界整理。
