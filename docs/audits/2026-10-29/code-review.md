# 2026-10-29 项目代码复审

## 结论与范围

当前工作区存在三类可复现缺陷，以及两项值得安排的工程优化。建议先修复旧回包覆盖新状态、草稿持久化和正常提示词误过滤，再补诊断与整理模块。

审查对象是当前工作区，包括此前未提交的修改，不只检查HEAD。覆盖Codex手机状态、历史与实时同步、Agent入口、缓存、网关隧道与生命周期、Android更新链路；不是对所有生成协议逐行背书。本轮没有修改产品源码、重启线上服务、发布、提交或推送，也没有读取真实会话、调用模型或操作用户权限请求。新增内容为本报告、后续计划和忽略目录中的合成复现材料。

## R1 / High：迟到轮询可覆盖新任务和新游标

位置：[App.tsx](../../../apps/mobile/src/app/App.tsx)，`applyDesktopDelta`（1207行）、`watchDesktopDelta`（1222行）、`pollLiveTurn`（1231行），以及1425/1557行的两组轮询effect。

轮询effect清理只设置`cancelled`并取消下一轮定时器；在途请求仍使用整个Workspace的AbortSignal。状态写入发生在请求函数内部，返回后没有核对轮询代次、当前turn或同一generation下的游标是否已经前进。SSE恢复或切换到新turn时，旧请求仍能写回。

隔离复现直接提取当前App真实函数、使用延迟Promise控制返回次序：

- 新任务已为`new-turn/inProgress`；旧任务轮询最后返回`completed`，结果变成`completed/activeTurnId=null`。
- 同一历史generation游标已到300、状态为`inProgress`；迟到回包游标200、状态`completed`仍被接受，游标倒退。

影响是手机运行状态、停止/引导入口与后续增量读取可能失真；这不是桌面任务实际停止的证据，也没有证明它就是此前真机双气泡的根因。

建议：每次订阅/轮询有独立代次和取消信号；在写入状态之前同时核验代次、thread、turn和generation，同代游标只能前进，明确reset例外。不能只在`await watchDesktopDelta()`之后检查，因为函数内部已经写入。

## R2 / High：聊天缓存配额失败会连带丢失新草稿

位置：[runtime.ts](../../../apps/mobile/src/features/chat/runtime.ts)，`saveThreadRuntimeCache`（197行），以及[App.tsx](../../../apps/mobile/src/app/App.tsx)的700ms批量保存（1362行起）。

历史、草稿和待确认输入被一起写入一个localStorage条目。当前只有24线程×120消息的条数上限，没有总字节预算；存储异常被静默吞掉。24线程上限也直接作用于有草稿的线程。

本轮在独立无头Chrome、临时浏览器profile、合成数据上调用真实缓存函数：

- 6个线程，每个120条约8KiB消息，尝试序列化6,005,447字符。
- 浏览器抛出`QuotaExceededError`，保存函数没有向上反馈错误。
- 重新读取只得到之前保存的旧条目，新草稿未恢复。
- 另一个小数据复现：25个线程均有未发送草稿，保存/读取后只剩24个，第25个被静默淘汰。

建议：草稿/待确认输入与可淘汰的正文缓存分开持久化；正文按总字节预算淘汰，配额失败降级保存关键输入；关键输入触及容量边界时必须有明确反馈。第一步可以保留localStorage，不必同时迁移整个应用到新存储框架。降低同步序列化量是附带收益，本轮没有测量Android卡顿或功耗。

## R3 / Medium：正常角色提示词会被误认为上下文而隐藏

位置：[messages.ts](../../../apps/mobile/src/features/chat/messages.ts)的`isGeneratedContextMessage`（312行），以及[codexStore.ts](../../../apps/relay/src/store/codexStore.ts)的`isDisplayableUserText`（480行）。

两层都按`text.startsWith("You are ")`隐藏user消息，没有区分真实用户输入与自动注入上下文。

使用临时CodexStore与真实前端渲染筛选函数分别复现：两个普通用户输入中，`Please review this module.`正常保留，`You are a code reviewer. Check this module.`同时从历史投影和手机渲染结果消失。此复现没有提交模型任务。

建议：以来源/事件类型等明确证据识别注入上下文，去除过于宽泛的正文前缀判断。修复必须同时覆盖历史和实时显示，避免重开后再次消失。

## R4 / Medium：诊断缺少实际运行版本和连接变化证据

位置：[managedGateway.ts](../../../apps/relay/src/gateway/managedGateway.ts)第44行丢弃全部隧道日志；[messageDiagnostics.ts](../../../apps/mobile/src/features/chat/messageDiagnostics.ts)第100行只记录Web构建中的appVersionCode；[App.tsx](../../../apps/mobile/src/app/App.tsx)第2222行未将原生版本或热更新状态传入诊断。

这不是已复现的新断线缺陷，而是定位能力缺口。已有HotUpdate.getStatus可提供原生版本与active/pending/previous版本，但消息诊断没有汇总它们；网关status仅展示当前隧道状态，无法重建断线/恢复时间线。此前APK35实机重复仍未解决的边界见[双气泡复核](../2026-10-24/input-display-recheck.md)。

建议：增加短小的版本指纹与限长事件记录，包括原生APK版本、实际Web构建标识、活动热更新、网关构建标识、连接代次和最近状态变化；气泡诊断增加可见节点与消息身份的对应。默认摘要控制在约2KB，详细报告单独保存为文件，用户主动导出；不记录正文、Token、API Key，不要求再转发长日志。

## R5 / Low：状态编排与检查入口值得整理

- [App.tsx](../../../apps/mobile/src/app/App.tsx)为2247行，包含状态更新、发送、连接、历史、更新和布局。`scripts/test-mobile-input-transitions.mjs`必须用TypeScript AST从App提取内部函数才能做时序回归。建议先提取有明确输入/输出的状态更新器及订阅管理，保持UI和协议不变；不因文件大而整页重写。
- 根目录和两个应用package.json均没有JS/TS lint脚本，现有`eslint-disable`注释并不代表项目执行了ESLint。建议先提供统一的类型/测试/构建入口，再对异步effect与未使用代码引入可控规则。
- 本轮默认JDK25执行Android lint失败，报`AndroidLintWorkAction > 25.0.2`；项目已有[JDK兼容运行记录](../2026-10-22/android-compat.md)，但辅助init脚本存放在被忽略的output目录。建议将验证命令与所需工具链做成可复现入口，避免换机器丢失这段流程。兼容方式复核结果见下表。

## 验证

| 检查 | 本轮结果 |
| --- | --- |
| `corepack pnpm typecheck` | Relay、Mobile均通过 |
| `corepack pnpm build` / `build:plugin` | 通过；仅本地构建，未部署 |
| `node --test --test-timeout=20000 apps/relay/tests/*.test.mjs` | 369/369通过 |
| `corepack pnpm test:mobile` | 84/84通过 |
| `corepack pnpm test:messages` | 通过 |
| `corepack pnpm test:hot-update` | Node 1/1通过，Java路径检查通过 |
| `corepack pnpm test:apk-update` | Node 5/5通过，Java下载39断言通过 |
| `node --test scripts/test-release-publication.mjs` | 4/4通过 |
| 真实App函数时序、草稿数量、前后端文本过滤复现 | 已观察到上述缺陷；不是修复验收通过 |
| 独立Chrome真实localStorage | 已复现容量错误被吞及新草稿未保存 |
| Android `lintDebug` | 默认JDK25入口失败；按既有JDK17 runner + JDK25 JavaCompile兼容方式复核通过，0 Error/Fatal、5 Warning |
| Android真机、实际合盖恢复、真实Agent控制 | 本轮未执行 |

共463个Node测试通过，另有独立消息回归和Java检查。Android的5项警告为ManifestOrder、DataExtractionRules、UnusedResources两项及IconDipSize；本轮没有修改这些资源或降低检查标准。现有测试通过与新增缺陷复现同时成立，说明需要补齐边界用例。本轮未重新扫描依赖安全公告，也未声称任何新版本已满足真机验收。

证据在`output/audit/2026-10-29/code-review/`，包括各检查日志、`reproduce.mjs`与`reproductions.json`。复现退出0表示成功观察并断言缺陷，不表示产品通过这些边界。原先依赖的临时Puppeteer目录已不存在，浏览器复现改用本机Chrome命令行与独立profile完成，已清理自建浏览器profile与临时HTTP服务。

后续执行范围与验收标准见[可靠性优化计划](../../plans/2026-10-29-reliability.md)。计划尚未启动，等待用户选择。
