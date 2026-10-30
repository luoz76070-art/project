# 输入三路时序与现存缓存补修

2026-10-23（Asia/Shanghai）。APK33 `1.3.12-input-order-preview` 已发布独立预览，preview33/previous32；正式18和hot清单逐字节保持。手机可在“设置 → 版本与更新 → 检查更新 → 下载并安装”覆盖升级。ADB无设备，原截图及手机缓存恢复效果仍待真机确认。

## 证据与前次遗漏

用户18:21截图显示“请把当前改动推送到 GitHub 仓库。”两份，中间夹着 `task_started`，并确认任务结束后返回列表重开仍然重复。只读核对同一原会话：native和rollout各有一次目标输入、同一turn，时间分别为10:21:19.174Z和10:21:19.247Z；rollout的原metadata.turn_id正确存在。保留完整身份的当前双路回放为一份，未取得截图瞬间的手机缓存，不能据此认定已经完整复现该截图的唯一原因。

独立复现到一个确定的漏洞：历史记录 → HTTP确认本地占位 → 暂缺client ID的早期native。HTTP占位先给历史补齐clientMessageId，原合并器把“带client”错误当成“已经关联native”，后来的native因此留下第二份；反向顺序可能正常。这种中间结果也可写进身份版本3缓存，解释了为什么只刷新页面不足以修复该状态。

APK31已补缺client的双路配对及native别名，但测试未覆盖HTTP先绑定历史的中间状态，因此前次覆盖不足。本次先以合成用例复现 `2 !== 1`，再修复，不把合成证明当作手机截图根因确认。完整字段真实样本、按旧字节边界读取的历史页和模拟中间状态分别存证；尾页不含旧目标不等于历史丢失。

## 实际改变

- 历史记录是否已关联native，只由nativeMessageId判断；仅带HTTP client身份的历史仍参加原有同turn、完整正文、等数量的一一对应。
- 对应项双方都有client且明确不同，整组保守保留；真实多次相同输入、不同turn和不完整来源继续保留。仍使用原合并函数保存历史时间、native/source/client身份和附件。
- 现有身份版本3缓存直接经过同一合并及渲染入口修复，保留草稿、待确认输入、cursor和generation；没有再次提升缓存版本或扩大纯文本/时间去重窗口。
- 改动限于手机合并器、回归与合成fixture；未更改发送API、在线网关、DeepSeek插件或真实任务。

## 验证

- `corepack pnpm test:mobile`：70/70；`test:messages`、手机类型检查、最终生产构建通过。新增三路全部6种到达顺序、缓存JSON/重放、附件和身份保留、独立同文第二条及明确client冲突/跨turn回归。
- 使用实际缓存、messagesForRender及groupMessageProcesses入口恢复版本3重复缓存：目标输入一份，执行过程及最终输出仍保留，另一待确认输入和草稿保持。保存的只读目标投影另做8种顺序/重放检查；earlyNative/local是模拟状态，全部为一份。
- 浏览器合成12项通过：单次一份、真实同文两次两份、切到其他会话再进入、结束重载、360/390/430px、150%字号及最终版本33。无横向溢出或console error。合成fixture里的控制状态不代表原生发送能力验证，未发送真实提示词或操作原队列。
- APK更新5/5、热更新回归和发布片段隔离4/4通过。首次误用不存在的 `test-release-isolation.mjs`，随后使用正确入口 `test-release-publication.mjs` 通过；该命令错误不是产品用例失败。
- 完整Android `:app:lintDebug` 0错误/7警告，minSdk23保持；与APK32签名一致，4个Web资源逐字节匹配最终dist，安装/录音权限及插件存在，preview/hot地址正确，无fixture打包。
- 公网19项通过：完整APK下载、SHA、大小、CORS、清单身份、previous32及正式/hot逐字节保持。发布前SSH文件SHA与公网基线一致。

没有Android设备连接，不能将浏览器回归、签名或调起安装能力称为真机验收。升级后应先返回会话列表再打开原18:21会话检查，无需重复发送那条GitHub指令。未改或重启在线网关，未操作模型任务或审批。

## 成品与交付

APK：`dist-apk/mobile-codex-1.3.12-input-order-preview-debug.apk`，4066293字节。

SHA256：`3b1d2e184ef6e45627b55c492d26945ef2559a01c88101bc01e4d876b9437726`

[备用APK下载](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.12-input-order-preview-3b1d2e184ef6.apk)。覆盖安装、保留数据。

证据目录：`output/audit/2026-10-23/input-source-transition/`，包括只读native/rollout、tri-source-before/after、失败回归及通过日志、截图/browser-results、lint/apk-verification、publication-state/publication-check。合成浏览器页和自有fixture进程已清理，临时视口已恢复。

复用既有合并入口、缓存和预览原子发布流程，将HTTP身份不等于native绑定及六种顺序回归契约补进mobile architecture/quality-guidelines；未新建skill或自动化。待真机项继续留在 `10-23-input-mirror-cache`，本轮未暂存、提交、推送或打标签。
