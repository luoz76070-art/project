# 前端验证与轻量约束

## 正式验证入口契约

1. 范围：本地源码及隔离测试，核心入口 `corepack pnpm verify`；Android用 `verify:android`；组合用 `verify:all`。详见 `docs/verification.md`。
2. 签名：`runSteps(steps, execute?, log?)`逐步await，`verificationSteps()`列出核心步骤；CLI `--list`只列计划，`--android`追加Android。未知参数失败。
3. 契约：先lint/typecheck/build/build:plugin，后运行读dist的测试；后端并发4。Android通过正式init脚本分开JDK17 runner与JDK21+ compiler，不改系统配置。
4. 错误：任一步非零或启动失败立即停止；缺JDK/SDK/Gradle明确失败；lint XML含Error/Fatal拒绝成功；Warning如实报告。
5. 示例：正常verify:all全部通过；缺Android工具仍可只运行符合本机前置条件的verify；不能在verify:all中静默跳过Android后报全通过。
6. 测试：`test:verification`验证步骤依赖、失败停止、真实子进程退出传播、实际lint规则拒绝、Java角色/报告计数与缺工具提示；浏览器和Android真机另记。
7. 易错：不要调用单项会clean-dist的测试并行破坏构建；不要继续依赖ignored output中的init脚本。先构建一次、后顺序消费，正式脚本入库。

`runtimeSync`以getter读取调用时的runtime/signal，request.expected同时在HTTP返回处和React updater内校验；回归须包含排队状态更新后迟到回包、effect清理、SSE恢复立即取消fallback，以及独立同文输入保持。不能只断言工厂内部实现结构。

短诊断使用`test:mobile`内的`test-mobile-diagnostics.mjs`验证生产模块及真实App导出函数：身份/DOM差异、附件-only、异步快照、版本混用、UTF-8 2KiB/64KiB、脱敏、取消/超时、并发与失败重试。浏览器须检查真实文件下载、旧APK缺插件提示和按钮命中；合成Native bridge不能代替Android系统创建文档，编译/lint与真机保存分开记录。详见[短诊断契约](diagnostics-contract.md)。

同步与缓存修改须运行`test:mobile`中的`test-mobile-reliability.mjs`：直接导入生产runtimeSync工厂，保留实际App四组poll/SSE effect的生命周期接线覆盖，验证迟到turn/cursor/reset/错误、相同cursor的新native状态、React批处理、切换/卸载取消、SSE恢复立即废止轮询，以及批次内多个正常事件不丢。缓存覆盖25草稿、6×120×8KiB正文、待确认身份、迁移失败保留旧输入、清空后旧正文不复活、输入配额反馈/重试、scope隔离和最近访问淘汰。

真实浏览器容量回归：运行`node scripts/test-mobile-cache-browser.mjs`，在120秒内用浏览器打开打印的loopback URL；只用独立origin合成存储，结果落在`output/audit/2026-10-29/reliability/browser-cache.json`。断言浏览器真实QuotaExceededError、正文预算、释放自有正文救回新输入、其他数据保持和恢复空间后可重试。UI夹具`serve-ui-fixture.mjs`的`?cacheFixture=1`注入关键输入写入失败，页面测试按钮可恢复存储；检查提示不被刷新覆盖、重试后消失、重开草稿保持，360px/150%字号重试按钮至少44px且命中。合成通过不能替代Android原生存储、键盘和真实任务验收。

初始输入过渡运行`test:mobile`中的`test-mobile-input-transitions.mjs`：直接导入runtimeSync生产工厂的snapshot/delta更新函数，覆盖临时/正式/历史/HTTP的48种顺序并逐步断言单次数量、完整身份/附件和稳定key；另验removedIds、仅身份索引partial、120条尾窗外、版本3旧缓存/离线/迟到帧、草稿和待确认保持、真实同文多次及身份/正文冲突。`/fixture/input-replacement?phase=provisional|history|formal|long|final|repeat`仅操作合成数据，浏览器检查运行/完成/重开单次为1、真实同文两次为2；不能作为原手机缓存或Android安装已验的依据。

APK32紧凑footer需比较同viewport、同运行/草稿状态的前后高度；空草稿不渲染禁用双按钮，有文本或附件才显示原steer/queue直接动作。检查折叠队列数量、暂停/未知摘要、展开全文/取消、快捷键默认queue及停止保留草稿。`/fixture/native?active=1&queueStatus=waiting|paused|sending|uncertain`提供3条合成待发；测量命中时排除关闭的原生details隐藏子项，不能仅凭getBoundingClientRect非零算可见。原生fixture凭证位于sessionStorage，另开tab没有它，不能将其401视为真实手机连接证据。

过程折叠回归覆盖commentary运行展开、明确final_answer流开始自动收起、手动重开后更新稳定、新任务重新展开、中断无终稿仍展开、跨用户边界与已知turn引导、未知phase保持正文和附件/原文不变；从真实messagesForRender入口断言已知工具保留且未知工具不误入组。fixture的`/fixture/process?phase=working|final|completed|next|interrupted|legacy|steering&agent=deepseek`只操作合成消息。DeepSeek在final流仍commentary，completed才提升；同ID更新必须改变分组，不重复最终正文。浏览器核对44px按钮的aria-expanded/aria-controls、终稿始终在过程区外、复制入口、深色/150%字号、三种窄屏及周边按钮命中；DeepSeek未知阶段旧正文和完整权限卡始终独立。麦克风/引导/排队/停止及允许/拒绝须检查中心与四边命中，点击麦克风只打开语音面板。不得把合成显示或复制反馈当Android原生验收。

引导去重回归覆盖native accepted记录与rollout同turn相差33秒、双向到达、同ID旧缓存补齐、HTTP占位迟到、重复快照/重开、附件、同turn重复同文以及不同turn隔离；sourceItemId不同的用户同文/同时间必须保留。原始历史没有客户端提交ID时不能伪造；来源数量不等不猜缺页对应，正文内部空白不同不匹配。缓存0/1/2迁到身份版本3时保留草稿与待确认本地输入，新缓存继续支持离线。fixture的`/fixture/mirrored-steering?phase=native|history|repeat`只生成合成消息；浏览器核对单次为1、真正两次为2，不作为新版已上线或真机已验的依据。

运行中发送回归须覆盖按钮直接提交steer/queue、箭头与快捷键默认queue、有待发时的新引导不改旧队列、提交锁、仅确认后清空匹配完整草稿/附件、发送期间新编辑、ACK/未知保留与禁重发、先SSE确认后HTTP报错，以及旧回执不清其他提交。fixture可设置native的admissionDelay/replyDelay、ack/confirm-http-error/http-error/reject-refresh及queue=0；它们只操作合成会话。实际Android和原任务是否采纳引导仍须单独验收。

语音运行`corepack pnpm test:voice`和`test:mobile`；`serve-ui-fixture`的`?voiceFixture=1`合成录音，`/fixture/voice`控制denied/failRefine/delay。检查只回填、草稿冲突、取消/切会话迟到、原文编辑废止旧整理稿、失败仍可采用原文、保存后Key清空。不能把fixture当真实麦克风/ASR/意图保真或费用时延验收；APK需完整lint及权限/原生插件核验。见[语音候选](../../../../docs/audits/2026-10-22/voice-input.md)。

`corepack pnpm --filter @mobile-codex/mobile typecheck`、`corepack pnpm --filter @mobile-codex/mobile build`、`corepack pnpm test:messages`。结构迁移后比较原函数体与构建 gzip；不改变视觉要求来掩盖行为回归。

UI 以 Codex 手机版为参考；先收集可核验的版本/日期与真实画面，再逐页对照。复用 React/CSS、图标，避免重型依赖、大面积模糊和持续动画。

视觉验收覆盖 360/390/430 CSS px、浅深主题、键盘、安全区、字体缩放、流式消息、上拉历史与连接恢复。浏览器不能替代 Android 键盘和前后台真机验收。

项目折叠需检查同名目录路径区分、44px按钮、搜索临时展开及刷新/分页/Agent切换后偏好恢复；顶部窄窗需能滚动到分组入口，左侧窄栏不能隐藏全部折叠控件。serve-ui-fixture的/fixture/projects启用合成新旧日期、多目录和同名目录；列表/正文请求计数用于验证前台摘要刷新及隐藏列表停止刷新。单元测试使用临时文件，不读取真实会话；实际网关近期/全部范围只读核对单列记录。

新增状态回归运行 `corepack pnpm test:mobile`；发布片段隔离检查用 `node --test scripts/test-release-publication.mjs`，不得连接 SSH。UI 合成服务 `node scripts/serve-ui-fixture.mjs` 只加载构建资源和假会话；支持 API 503、断流、推送、145 条分页和 150% 字号检查。不得替换为真实会话后自动发送。

标题 flex 子容器须 `min-width: 0`，大字号时顶栏允许增长；省略标题不能覆盖操作按钮。代码块独立横向滚动，Markdown 不执行原始 HTML。新界面源码完成不等于真机验收，记录见 `docs/audits/2026-10-20/delivery.md`。

具名 APK 交付必须经 `scripts/build-debug-apk-mac.sh` 的双更新源校验；个人地址存于被 Git 忽略的 `apps/mobile/.env.production.local`，避免依赖会话临时 export。`mac-local` 才允许双通道都空；单通道遗漏必须失败。交付时检查 APK 内实际地址、资源与最终 dist 一致、版本递增和旧包签名一致；热更新原生版本范围必须匹配 bundle 的 `appVersionCode`。线上发布与隔离测试分别记录，不能把本地构建成功写成手机已可下载。

macOS APK入口使用`:app:clean :app:assembleDebug`，先清app生成输出，防止Gradle增量归档保留旧hash资源造成约110KiB冗余；不清源码、用户数据或签名。清构建后仍须逐文件比对包内dist，不能只凭文件名或大小判定。

单文件热更新不得直接内联普通dist主入口：懒加载chunk会遗留相对import而在原生index.html目录中缺失。`android:hot-bundle`单独构建临时目录，Vite inlineDynamicImports、cssCodeSplit=false及导入资源内联，再生成一个HTML；校验双更新源、拒绝残留chunk依赖、清理临时目录，普通APK/Web dist保持拆分。`test:hot-update`同时跑原生路径与合成懒加载/CSS/SVG/脚本闭合文本/替换标记回归，补只提供HTML的浏览器检查。原生WebView激活、markReady和回滚仍需真机验证。

提问表单独立于审批卡片和普通聊天草稿。题目/答案不写持久缓存；断流清空可操作项、重连等权威状态，提交不重放。手机窄屏检查长题/说明、选项、自由文本、多问题、提交可达性及等待状态。长表单优先定位题头，读历史时保持位置。

共享Agent卡片按实际Agent显示名称，不固定写OpenCode。Claude只提供宿主声明的原请求交互，审批仅本次允许/拒绝；预览以纯文本换行显示，完整JSON不溢出页面。合成检查不得宣称原生宿主面板同时可操作或两端先答已验收。

Desktop原生控制依据选定会话的snapshot.control，不根据前台会话猜能力；断流废止token并禁用控制。发送与中断的待确认提示分别显示，ACK不能改写turnStatus，SSE确认优先于迟到HTTP回包。回车发送也必须遵守禁用条件；控制令牌和可操作能力不持久化。

控制方式未知时等待服务状态，不能把缺失snapshot.control当作legacy。服务声明native时，首次快照到达前也必须禁用发送；构建请求前再次检查当前所选会话及实时token/turn。两种HTTP路径均保留已知409错误码并显示稳定中文说明，不展示任意错误正文、不自动重发。只有明确执行前拒绝且没有回执/待确认记录时，才释放匹配的待发标识供下一次手动发送；缓存旧消息ID与新guard冲突不能猜成未执行。

Desktop审批绑定source/threadId/随机id，和Relay分别路由。提交状态卡片保留且按钮禁用，迟到HTTP只更新原卡片，不回放整个旧turn快照；断流清Desktop卡片、重连等权威状态。未知/复杂策略不补允许按钮，详情默认展开，按钮至少44px。浏览器需检查待确认、刷新恢复、权威移除、断流和窄屏；审批状态和令牌不持久化。

连接能力位于设置中的折叠区，只有用户点击才GET gateway/agents；不自动probe。旧服务404显示兼容提示，401/网络错误不能说成旧版本。切换Endpoint/凭证时清结果并取消/丢弃迟到回包；不缓存能力、令牌或权限。360/390/430px检查文案和44px按钮，服务接入状态不能当作Desktop原会话控制已验证。

App内APK更新须运行`corepack pnpm test:apk-update`，覆盖合成下载故障、缓存重验、包身份与签名，以及bridge迟到状态。浏览器使用`serve-ui-fixture`的`?apkFixture=1`合成Capacitor，严禁当作系统授权/安装成功。APK24起安装权限/插件必须检查，原生与Web版本递增，预览构建实际绑定preview源。详见[APK更新契约](apk-update-contract.md)。

原生交付使用正式 `corepack pnpm verify:android`：执行Java编译与完整lintDebug，JDK17 runner配JDK21+编译器。脚本在 `scripts/verify-android.mjs` 与 `scripts/android/lint-jdk.gradle`，工具链覆盖及SDK发现见 `docs/verification.md`。缺工具/非零退出/Error或Fatal明确失败，不能用assembleDebug代替、不能关闭规则或依赖output里的旧init脚本。

2026-10-22基线为0 Error/Fatal、5 Warning；警告与未验真机分支如实记录。完整报告及人工反馈分开保留，不把成品核验脚本的deviceInstallationTested改成手机已验；用户确认只覆盖其明确操作的路径，实际授权拒绝/取消后继续等需独立证据。

第三方语音配置须覆盖默认/持久化迁移、HTTPS地址归一化、地址变更Key绑定/清除、模型名与官方扩展兼容、错误不透传。消息回归覆盖相同sourceItemId在native turn时间和rollout落盘时间相差17秒、缓存补齐、增量终稿及不同原始ID同文同时间。首次旧缓存刷新必须单测草稿和待确认消息保持；不得仅换缓存key而丢失草稿。合成表单检查保存失败/成功、Key清空、重开保留、窄屏及大字号；不能将此作为第三方真实API验收。

输入区改动须实际点击最新消息、语音、上传、发送、停止及发送方式选择，不能只看矩形。窄屏/150%字号/多行草稿/待发列表下，以elementFromPoint检查中心和四边中点内缩5px命中，避免把圆角透明角误报为遮挡；最新按钮与footer控件矩形不相交。`serve-ui-fixture`提供合成native queue/cancel/上传及计数，断言排队不触发steer、引导才调用原发送、取消不停止任务。`test:mobile`覆盖匹配pending清理且保留新草稿/生命周期及近期列表保留待发线程；真实Android键盘/触摸与原任务续发另验。


输入去重另覆盖无clientMessageId的早期/旧投影，中间插入7条不同工具记录，实时与历史时间只差75ms及相差33秒；双向到达、JSON缓存往返、已绑定项收到缺client的native重放均只显示1次。已有native别名不能匹配新的独立native ID，增加第二条历史后仍为2；部分来源数量不等保留，原始ID不同/跨turn/正文内部空白不同不误删。fixture的`/fixture/mirrored-steering?phase=native|history|repeat&client=0`检查缺身份路径，每个控制请求必须HTTP200，不能只因服务端已部分改变状态而忽略404。真实完整字段样本原先通过，必须记录实机缓存/版本未取得的证据边界，不能用附近合成失败直接认定截图根因。

APK33消息回归覆盖历史、HTTP确认占位、早期无client native的全部6种到达顺序，并检查附件与三个身份保留、重放、真实第二次输入和明确client冲突保护。缓存回归直接构造版本3中已保存的双份记录，保留cursor/generation/草稿/另一待确认输入，通过真实messagesForRender与过程分组验证只显示一份；不能只测试一次性载入完整双路数据。fixture新增receipt=1及started=1，配合client=0与phase=repeat验证已带HTTP身份的历史以及任务开始记录；第二条真实输入须有独立client身份。

真实升级后仍失败而当前投影回放通过时，先取得手机原缓存/实际显示差异，不再用附近合成漏洞代替实机根因。手动消息诊断覆盖旧身份版本的原缓存、不修改输入/存储、原文/附件/凭证过滤、独立同文、DOM数量差异及有界截断；报告只含SHA256身份/正文和白名单元数据。浏览器Clipboard替身可测传入报告与失败重试，但必须另核对APK包含原生类且MainActivity注册；JS registerPlugin代理不代表已有Android实现。实际Android复制及原重复恢复仍需真机反馈。

临时输入替换须检查完整接入链：`${turnId}-input`、HTTP确认、历史及正式native身份到达顺序，snapshot removedIds在App最终runtime中的效果，已吸收临时native别名的历史记录，以及缓存恢复与重连。仅snapshot reducer单测通过或最终完整字段合并通过不能代表该链通过。2026-10-23专项隔离测试已有48种序列/28种保留重复及真实组件双气泡证据（input-transition-test-plan.md）；这是尚待修复的缺口，修复须增加入口回归且不误删独立同文输入，不能把合成复现当作手机原图早期状态已取得。

提示词显示回归共享`scripts/fixtures/user-prompts.mjs`合成矩阵，在`test-mobile-connection.mjs`调用真实渲染/缓存入口，覆盖local/native/history、重开、真实同文不同source/turn、附件文本、英文角色/知识截止说明/中文及引用代码块；明确system/developer/hook和专用上下文包络保持隐藏。`serve-ui-fixture`的`/fixture/prompt-visibility`支持实际发送与completed场景，配合offline检查缓存重开。仅合成验收不能代替真机双气泡根因。
