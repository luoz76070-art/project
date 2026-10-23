# Agent 网关候选交付（2026-10-21）

候选版本1.3.0-agent-gateway-preview/versionCode19。2026-10-21 用户授权后，APK已提供独立预览下载，Mac已切换到原生候选网关；正式Android更新清单仍为1.2.2/versionCode18，热更新未发布，真实安装和原会话控制仍待验收。当前状态见[迁移交接](gateway-migration.md)；以下保留各次构建及复核时的证据。源码保持未提交，任务in_progress。

## 本地产物

目录：`output/delivery/2026-10-21/agent-gateway-preview/`，包含APK、插件ZIP、热更新HTML、README、manifest.json、SHA256SUMS及两个打包校验JSON。文件均在被忽略的构建/输出目录，不提交到仓库。

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| mobile-codex-1.3.0-agent-gateway-preview-debug.apk | 4035304 | 8546a6b81cbc21266484457fb897177ca314560e476439795f5eb6bd63badc16 |
| mobile-codex-1.3.0-agent-gateway-preview-web.1.html | 364350 | 340e4b4029c1457f47a6bc37ebd5c50e0faa98ffad63c1eb64c2bb876a57aa9c |
| mobile-codex-agent-plugins-preview.zip | 327912 | ff2a8704a53dfa98287639d8151c2349a9288862dbb68a5b196cd809719aa36f |

插件ZIP根目录保留mobile-codex、mobile-claude及隐藏的`.agents/plugins/marketplace.json`；运行包不依赖源码工程的node_modules。解压不会自动安装或启动服务，实际迁移按[插件说明](../../../plugins/mobile-codex/README.md)执行。

## APK 核对

经既有`build-debug-apk-mac.sh`具名构建，双更新源检查通过。aapt/apksigner确认：应用ID为com.mobilecodex.app，versionCode从18升为19，v1/v2签名通过、证书SHA-256与18一致，权限未变化，两个实际更新源与基线相同。4个dist文件与APK assets/public逐字节匹配，Dex中保留HotUpdatePlugin与SecureCredentialsPlugin。此证据证明覆盖升级的打包前提，不能替代真机安装后的凭证/连接档案保留验收。

普通APK/Web构建保留懒加载：主JS304.51kB/gzip97.08kB、Agent17.79kB/gzip6.75kB、CSS41.23kB/gzip8.22kB。APK比18增加14396字节（约0.36%）；没有新增原生权限或运行依赖。

首次独立运行apksigner未选中JDK；复用构建脚本所用的Homebrew JDK后验证通过，未修改系统Java设置。JDK/Gradle仍有上游弃用/未来受限API警告，未影响当前构建和签名验证。

## 热更新缺失页面修复

原脚本只内联普通dist入口。实际复现显示HTML残留`import('./AgentWorkspace-…js')`，而原生热更新只安装index.html，因此无法从单文件打开Agent。证据`output/audit/2026-10-21/hot-bundle-before-fix.json`。

新构建通过Vite在临时目录使用inlineDynamicImports、关闭CSS拆分、内联导入资源，再内联唯一JS/CSS；拒绝残留chunk依赖并校验双更新源，结束清临时目录。应用侧构建helper复用已安装Vite，没有新增依赖；根脚本入口和命令保持。正常APK的dist与按需加载保持。回归用合成懒加载页面、CSS、SVG、脚本闭合文本及替换标记，验证页面/资源完整、自包含、SHA/大小和普通dist未被覆盖；macOS临时目录先realpath规范化。

浏览器使用只提供此HTML、拒绝其他静态资源的合成fixture：390px首页→切换Agent→Claude原会话→两题提交通过，1次应答，answers长度[1,1]，回到正在输出状态。无外部JS/CSS请求，warn/error为空，scrollWidth=390。只另请求过favicon并收到预期404；这不涉及应用代码依赖。页面/视口/fixture清理，activeStreams=[]。

HTML仅兼容原生19；不能作为版本18的热更新发布。真实Android WebView安装、5秒markReady与回滚仍待验收，不以浏览器运行代替原生路径。

## 验证与宿主预检

- OpenCode兼容修正后，后端201/201（OpenCode32、Claude31）、手机37/37、消息回归、两端类型/构建、独立插件与APK/HTML重建通过。
- `pnpm test:hot-update`：原生Java路径检查与新增单文件构建回归通过。
- `node --test scripts/test-release-publication.mjs`：4/4，只有临时本地发布片段，无SSH或上传。
- 包、资源及浏览器证据：`output/audit/2026-10-21/agent-gateway-{apk,hot,update-release}-*`与`output/ui-review/2026-10-21/hot-bundle-*`。
- 重新只运行PATH命令的`--version`：Codex0.160.1、Claude2.1.220、OpenCode2.0.16。PATH Codex不能代替Desktop所带CLI/IPC版本；OpenCode版本输出不能证明已存在服务的API兼容。Claude低于Mods宿主下限2.1.287（类型声明生成于2.1.277）；OpenCode现已按固定2.0.16主源完成源码/合成契约修正，真实服务仍待验收。没有启动模型/服务、读真实会话或加载插件。

当前原会话订阅已完成只读修复；下一步优先验收手机问答，再处理插件迁移、Claude宿主兼容条件与[Android公网联测](../../test-and-acceptance-plan.md)。Mac旧App、辅助功能权限与生产Relay保持；长期连接测试暂缓。

## OpenCode 2.0.16 修正后的同源候选

固定官方tag的commit为3a103fe0aff726a4edc7492f03f7b88195d9e4c9，先读/api/info核验版本。发送/回执、中断JSON与空闲no-op、permission.decision、原form字段及选项值、session事件和text独立ordinal已按主源修正；复杂表单显示原因并禁用提交。未知版本不给控制，不猜测路由回退。原完整签名/目录/代次/不重放边界保持。

新增7项隔离测试，合并201/201；浏览器普通双题提交1次、answers计数[1,1]，复杂表单说明可见且按钮禁用，360/430px无横溢、44px按钮、warn/error为空。此次为普通dist合成界面检查；既有单HTML运行证据是前一候选，本次重建另核验无外部脚本/样式/import且包含新说明，不将旧浏览器截图冒充本次HTML实跑。证据为output/audit/2026-10-21/opencode-2-*及output/ui-review/2026-10-21/opencode-2-*。

本次重建发现增量APK为4148204字节；在同JDK下执行gradle :app:clean后重新具名打包，资源不变、最终4035304字节，消除112900字节额外归档空间。复核签名、应用ID/权限/双更新源、全部4个dist资源及原生热更新/Keystore组件；交付JSON与上表hash已更新。复用既有打包和验收流程，清理生成目录的步骤记入docs/online-update.md，没有新增自动部署/监控或修改生产。

真实宿主、原会话取消/两端先答及Android仍待验收；本机Claude版本不足仍是未解决条件，未升级或加载插件。生产18、旧Mac App及权限保持，长期连接测试暂缓，整个任务继续in_progress。

## Codex 提问重连保护

补齐已提交但结果未确认的原题在IPC重连、patch缺口和释放后重新订阅时的状态保留。问答27/27、后端207/207、两端类型检查及独立插件构建通过；只重建受影响插件ZIP并更新上表及manifest/SHA256SUMS，APK/HTML保持原hash。

最新真实只读检查发现owner但没有选定会话快照；安装宿主元数据为26.1013.40934/build20770，捆绑CLI0.163.0-alpha.10.2，不能用PATH CLI版本代替。没有发送任务、答案或审批，真实问答可用性仍未确认。后续先定位当前订阅问题，详见[专项记录](codex-question-reconnect.md)。

## 长会话快照修复后的候选

先前的真实订阅缺失已定位为38,411,290字节快照超过16MiB接收限制。改为64MiB有界接收和一次缓冲分配后，当前真实只读恢复v11快照（约620ms、120条消息、手机投影707429字节），没有真实写入。性能9/9、合并后端210/210、两端类型检查和独立插件构建通过；只重建插件ZIP并更新上表/manifest/hash，APK/HTML保持。详见[长会话接收记录](codex-large-snapshot.md)。真实应答、两端先答、迁移与Android仍待验收。

## 插件安装前复核后的候选

补齐Codex本机执行声明及Claude作者元数据；Claude宿主版本门统一为2.1.x且patch>=287，与固定API声明生成版277区分。技能quick_validate、两端类型检查、Relay/独立插件构建及后端210/210（Claude31）通过。旧Claude2.1.220在隔离配置目录运行官方validator仍失败，不能将构建成功称为安装兼容。只更新插件ZIP，上表及manifest/SHA256SUMS已同步，APK/HTML保持原hash。详见[安装前复核](plugin-preflight.md)。真实安装、原请求应答与Android仍待验收。

## 问答回包核验后的候选

补齐Codex问答method/owner/可选内层method、同步ok与异步原turn核验，坏响应保持uncertain和原题锁定；权威移除优先，不重发答案。问答44/44、后端227/227、两端类型/Relay及独立插件构建通过。修正Claude旧超时测试的单次轮询假设，生产逻辑未改。仅重建插件ZIP并同步上表/manifest/SHA256SUMS，APK/HTML保持原hash。详见[问答回包记录](codex-question-ack.md)。真实原会话应答、两端先答/取消、安装迁移与Android仍待验收。
