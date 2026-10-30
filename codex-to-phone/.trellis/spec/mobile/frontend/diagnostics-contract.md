# 手动短诊断契约

## 1. 范围与触发

Codex Workspace 设置中的手动诊断。只读比较 runtime、渲染、原缓存及 DOM，不迁移缓存、不改变消息身份，不自动上传。其他 Agent 工作区尚未接入该设置入口。

## 2. 签名与入口

- `readDiagnosticDom(root: Element | null)`：读取 `article[data-message-role="user"]` 的身份、正文和布局，正文仅用于本地哈希。
- `makeMessageDiagnostics(input)`：生成 `mobile-codex-message-diagnostics-v2`。
- `readDiagnosticEnvironment({signal, platform, webVersionCode, documentHotVersion, readNative, readGateway, timeoutMs?})`：默认4秒截止。
- `makeDiagnosticsExport(report, environment, connection)`：返回 `{summary, detail, summaryBytes, detailBytes}`。
- `saveDiagnosticFile(text)`：返回 `saved|cancelled|downloaded`。Android `DiagnosticExport.save({text})` 需 MainActivity 注册真实插件；浏览器使用 Blob 下载。
- Relay 鉴权 `GET /api/diagnostics`：只返回自身构建与可用的托管 Tunnel 事件。

## 3. 数据契约

摘要 schema=`mc-diag-2`，最多2048 UTF-8字节；详细文件最多65536字节，超限优先缩减明细并记录省略量，不能只按JS字符数判断。每层最近240条、同文组最多8组/总计40条明细、最近渲染与DOM各8条；保留总数和省略计数。

不透明身份和正文只输出SHA256；只投影白名单字段，不展开原消息、原异常、连接对象或凭证。DOM ID哈希与消息ID哈希精确对应；同文不等于同身份。附件-only气泡计数，未知身份不以相同正文猜配。布局/视口几何标记不等于无遮挡或真机合成画面。

版本分别记录：NativeHotUpdate的安装code、编译进Web的code和`web-<uuid>`、原生活动/待确认热更新、当前页面hot meta、网关`gateway-<uuid>`。普通Relay从自身dist/build-info.json读ID，独立bundle使用编译常量；缺失明确unknown，不推断已部署版本。

手机journal以Workspace隔离，最近20条 `{seq, subscription, channel, at, generation, state, reason}`；网关最近20条 `{seq, at, generation, state, reason, closeCode?}`，都仅驻内存且带omitted。原因固定枚举，禁止URL、close reason与错误原文。Tunnel disabled时不伪造连接事件。

网关返回 `{schema:"mobile-codex-gateway-diagnostics-v1",buildId,tunnel:{enabled,omitted,events}}`。普通Bearer/配对设备鉴权沿用现有钩子，不允许匿名诊断，不读取真实会话。

## 4. 校验与错误

| 场景 | 行为 |
| --- | --- |
| 网关404/401或403/超时失败 | 分别unsupported/unauthorized/unavailable；已有本地报告可导出 |
| Native状态不可读 | unavailable，安装版本null |
| 切会话、关设置、切Workspace | 导出前检查作用域/epoch，丢弃迟到结果 |
| 并发点击 | 锁定一次操作，finally释放 |
| Clipboard失败 | 固定提示、可手动重试；不显示原错误 |
| 旧APK无保存插件 | 明确升级提示；允许另行复制摘要，不回退复制大报告 |
| 系统取消/写入失败 | cancelled/固定错误，可重试 |
| schema错误/超过64KiB | JS与Android均在写入前拒绝 |

Android ACTION_CREATE_DOCUMENT使用固定生成文件名，后台写入选择的URI，不接收任意路径，不新增存储权限。系统对话框已经打开后，不声称能撤销用户的后续系统保存动作。

## 5. 正常、兼容、错误示例

- 正常：APK41/Web35/active=new/loaded=old分别报告；一条runtime对应两个DOM节点时 duplicateIds=1且nodes=2。
- 兼容：旧网关404仍可复制短摘要；旧APK明确文件能力不可用。
- 错误：两条同文但独立ID的实际输入不得被标为同一消息双DOM，更不能由诊断删掉任一输入。

## 6. 验证

`scripts/test-mobile-diagnostics.mjs`纳入test:mobile，验证真实生产模块、App入口、边界、脱敏和迟到/失败。`apps/relay/tests/diagnostics.test.mjs`验证构建ID、容量、心跳丢失至新代次恢复；managedGateway测试鉴权和独立bundle产物。构建完成后才运行读dist的测试。

浏览器用 `serve-ui-fixture.mjs` 的diagnosticsFixture/apkFixture、`/fixture/diagnostics`、`/fixture/clipboard`和`/fixture/disconnect`，核对复制字节数、真实文件下载、旧APK、失败/取消/恢复及按钮命中。合成Native bridge不算Android系统保存验收；Android编译/lint与真机保存分开记录。

## 7. 易错点

- 错误：复制全部JSON、只统计文本节点。正确：默认短摘要，详细报告文件化，以article身份关联三层证据。
- 错误：用源码版本或active热更新当运行Web版本。正确：分别读取编译ID、原生状态及当前HTML标记，未知不猜。
- 错误：原样导出连接错误。正确：独立白名单journal，记录有限的原因枚举与代次。
