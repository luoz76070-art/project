# 阶段四：短诊断、版本和显示身份定位

日期：2026-10-29。状态：源码、隔离测试与浏览器验收完成；未发布、未部署、未做 Git 写入。Android 系统文件保存仍待真机验收，既有双气泡问题仍未宣布解决。

## 用户可见结果

Codex 会话的设置中保留“会话显示诊断”，提供两个独立入口：

- **复制诊断摘要**：硬上限 2048 UTF-8 字节，避免把大段 JSON 粘贴到聊天应用。
- **保存详细报告**：硬上限 65536 字节；Android 调用系统创建文档，浏览器下载 JSON 文件。保存失败、取消和旧 APK 缺少插件均有明确提示，可再次手动尝试，不回退复制大报告。

仅主动导出。报告包含 APK 安装版本、实际 Web 构建 ID、活动/待确认/当前页面已加载的热更新版本、网关构建 ID、缓存 schema、消息身份指纹及最近连接事件；不含正文、草稿、附件路径、endpoint、密钥和原始会话/消息身份。

## 实施与边界

`messageDiagnostics.ts` 升为 v2，读取用户气泡 article 的身份属性，SHA256 后与 runtime/rendered 对应。可区分两条独立消息和同一消息两个 DOM 节点，附件气泡也计入；`laidOut`、`inViewport` 为布局与几何证据，不表示已验证无遮挡或 Android 实际合成画面。保留每层最近240条、最多8个同文组/40条明细/8条最近渲染记录，省略量明确记录。

`diagnosticExport.ts` 实施大小限制及白名单版本投影，未知版本显式标记。手动版本读取最长4秒；原生读取失败、旧网关404或鉴权失败不阻止本地报告。App 捕获连接/会话作用域，切会话、关闭设置或切连接后丢弃尚未提交导出的迟到结果；锁防止并发点击。

手机每个 Workspace 保存最近20条内存事件；订阅编号、连接代次与递增序号用于还原重连。托管网关也只保留最近20条 Tunnel 事件。鉴权 `GET /api/diagnostics` 不读取 Codex 会话；事件原因固定枚举，不收集 URL、错误原文或 WebSocket close reason。未启用托管 Tunnel 时返回 enabled=false。

Web 构建由 Vite 注入独立 ID；Relay 普通构建生成 `dist/build-info.json`，独立插件 bundle 注入自身 ID。两者都读取正在运行的产物标识，不能拿工作区源码版本代替部署版本。Android 新增 `DiagnosticExportPlugin` 并注册，系统保存不增加权限或第三方依赖。

此次只在气泡增加诊断数据属性，未调整消息合并器、渲染 key 或历史修复逻辑。其他 Agent 工作区尚未加入同一诊断设置入口。

## 验证证据

原始日志和合成证据：`output/audit/2026-10-29/compact-diagnostics/`（ignored，不纳入源码）。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 手机全量 `corepack pnpm test:mobile` | 121/121 | `mobile.log` |
| 后端合并隔离回归（先完成 Relay/插件构建） | 377/377 | `relay.log` |
| `corepack pnpm typecheck` / `build` / `build:plugin` | 均通过 | `typecheck-first.log`、`build.log`、`plugin.log` |
| 消息回归 / 热更新检查 / APK更新检查 | 通过 / 1/1 / 5/5 | `messages.log`、`hot-update.log`、`apk-update.log` |
| Android Java 编译与 lintDebug | BUILD SUCCESSFUL；0 Error/Fatal、8 Warning | `android.log`、`apps/mobile/android/app/build/reports/lint-results-debug.xml` |
| `git diff --check` | 通过 | 最终自审 |

新手机诊断回归13项调用实际模块和 App 导出处理函数，覆盖 DOM 身份差异/附件、异步快照、版本混用、UTF-8上限、脱敏、容量、省略、取消、超时、失败重试、并发锁和旧 APK。后端增加 journal/构建身份、真实隔离 WebSocket 心跳丢失与代次恢复、鉴权路由；独立 bundle 生命周期回归亦验证构建 ID。

浏览器使用自有 loopback 合成服务与360×800视口，无真实用户会话或模型调用：

1. 摘要实际1351字节；APK41/Web35/活动新热更新/页面旧热更新明确分开，DOM与消息指纹匹配。
2. 合成原生保存2909字节；复制失败、保存取消、保存失败、手动恢复均见到对应提示，恢复保存3307字节。
3. 主动断开合成 SSE 后，1239字节摘要记录 generation1 `stream-error` → generation2 `retry` → `open`；旧网关为 unsupported/unknown。
4. 缺少原生保存插件的页面明确提示升级，未复制详细 JSON。
5. 真正浏览器下载2118字节 JSON，重新读取并验证 schema/大小；无有效鉴权时 gateway=unauthorized，本地报告仍可用。
6. 两个按钮分别145×44px，中心命中各自按钮，无重叠。截图 `diagnostic-settings.png`。视口已恢复、临时标签页和自有服务已关闭。

对应文件：`browser-summary.json`、`browser-full.json`、`browser-recovery-summary.json`、`browser-recovered-file.json`、`browser-downloaded.json`、`browser-checks.json`。合成 Native bridge 仅验 JS 调用与提示，不等于 Android 系统选择器已通过。

## 后续决策

阶段四目标完成。下一项是[可靠性计划阶段五](../../plans/2026-10-29-reliability.md)：整理可直接测试的状态模块与正式验证入口。也可先选择预览发布及 Android 文件保存验收；须升级 APK 才能使用新增原生保存能力，完整网关诊断需配套网关版本。此次不自动启动任一后续项。
