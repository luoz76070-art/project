# 阶段三：正常提示词误过滤修复

日期：2026-10-29。状态：源码与隔离验证完成，未发布，Android实机待验。

## 用户可见结果

普通 `You are a code reviewer. Check this module.`、`Knowledge cutoff: explain what this field means.` 不再因开头被隐藏。手机本地消息、实时原生消息、app-server通知/结束回读、rollout历史/增量及缓存重开采用一致边界；会话标题也保留正常角色提示词。

## 根因与修改

- `apps/mobile/src/features/chat/messages.ts`：移除两类自然语言前缀过滤。
- `apps/relay/src/store/codexStore.ts`：历史和首条输入/索引标题移除相同前缀，补齐问答回执专用标记。
- `apps/relay/src/desktop/desktopControl.ts`：params临时输入、canonical userMessage、accepted steering使用的过滤规则修正。
- `apps/relay/src/codex/liveTurnController.ts`：item通知与完成后thread/read修正同一规则，问答回执保持隐藏。
- 沿用role及item type区分system/developer/hook和普通输入，不假设存在未证实的上游来源字段。消息身份、合并器、缓存schema和发送方式未变。

兼容边界：来源不明的旧user记录继续按既有专用包络前缀过滤：environment_context、permissions instructions、app-context、collaboration_mode、personality_spec、skills_instructions、plugins_instructions、AGENTS.md instructions、INSTRUCTIONS、send_user_message_question_reply。若用户正文恰好以这些保留标记起始，仍会触发兼容规则；普通正文/引号/代码块中的提及不会触发。没有上述证据的纯自然语言正文优先保留。问答回执的缓存排除保持。

## 验证证据

共同合成矩阵：`scripts/fixtures/user-prompts.mjs`，8种普通正文（含空白、中英文、角色提示词、知识截止说明、引用/代码块及附件文本）和10种旧上下文包络。

新增8项回归，位于现有手机connection、Relay correctness和desktopNativeControl测试；全部进入既有验证入口，无须单独发现脚本。

| 检查 | 结果 | 本地证据 |
| --- | --- | --- |
| 修复前定向回归 | 8项：7失败、1通过；失败均为正常输入/标题被过滤 | `output/audit/2026-10-29/prompt-visibility/red.log` |
| 修复后相同回归 | 8/8 | 同目录 `green.log` |
| 手机全量 | 108/108 | `mobile.log` |
| Relay全量 | 374/374 | `relay-recheck.log` |
| 消息合并回归 | 通过，含真实同文及HTTP/SSE时序 | `messages.log` |
| 两端typecheck/build | 通过 | `typecheck.log`、`build.log` |
| 390×844真实浏览器 | 历史2条、发送新增1条、完成/在线重开/离线缓存重开仍为3条；上下文不显示 | `browser-checks.json`、`online-reopen.png`、`offline-reopen.png` |
| 差异自审 | git diff --check通过；与本轮before副本比较仅过滤规则改动 | `before/`与当前源文件 |

第一次Relay全量运行与build并行，build的clean-dist删除了正在读取的产物，出现ENOENT/ERR_MODULE_NOT_FOUND（`relay.log`）。这是本轮执行顺序失误；构建结束后顺序重跑全部374项通过，未据此改动产品或放宽断言。后续必须先构建再启动读取dist的测试。项目尚无JS/TS lint脚本；本轮未改Android代码，未运行原生lint。

测试仅使用临时目录、假app-server/IPC、loopback HTTP和合成输入，未读取真实会话、提交真实模型任务或更改在线服务。浏览器只发送到隔离fixture，临时服务和tab已关闭，viewport已恢复。

## 重跑方式

先 `corepack pnpm build`。完成后可分别运行 `corepack pnpm test:mobile`、`corepack pnpm test:messages`、`node --test --test-concurrency=2 --test-timeout=20000 apps/relay/tests/*.test.mjs`、`corepack pnpm typecheck`；Relay测试期间不要重建清理dist。

浏览器：启动 `node scripts/serve-ui-fixture.mjs`，对其打印的loopback地址依次调用 `/fixture/prompt-visibility`、`/fixture/native?active=0` 初始化。UI选择“当前桌面”会话后发送上述英文提示词；`/fixture/prompt-visibility?phase=completed` 推送合成终稿；刷新验证。再用 `/fixture/offline?enabled=1` 阻断该夹具API并刷新，验证缓存显示。所有fixture端点仅存在于该隔离脚本。

## 交付边界与后续

本轮未构建新APK、打包/发布网关或更新通道，未提交/推送。手机和网关都需包含此源码修复才能覆盖所有路径；已被旧网关过滤而未缓存的正文需重新读取相应历史页。浏览器与合成回归不代替Android真机验收，也不证明此前双气泡问题已解决。

沿用现有Trellis任务、spec、测试和交付记录工作流；未为一次过滤修复新增skill或自动化。下一轮仍按[可靠性计划](../../plans/2026-10-29-reliability.md)阶段四补齐短诊断，阶段五维护整理可后排，等待用户选择。
