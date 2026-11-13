# DeepSeek Harness rc.3兼容与手机复联

日期：2026-10-30。[本轮计划](../../plans/2026-10-30-deepseek-rc3-compat.md)已完成：源码、隔离验证、原插件加载、网关切换和手机只读复联验收均通过。

## 修正与范围

旧插件0.2.1的engines.dsh精确rc.2，实际桌面为rc.3，官方加载器拒绝。网关deepSeekInfo也仅接受rc.2，bridge /info固定上报rc.2。因此修正了三个对应边界：插件0.2.2的engines/peer精确允许rc.2或rc.3，入口读取宿主共享LLM包的实际版本并在监听前验证；网关schema同步允许这两个版本。未知版本继续拒绝，审批内部接口指纹保持严格校验。

使用本机rc.3应用实际打包的运行时，与官方rc.2发布包分别验证。现有Session/Query/Controller、AgentLoop、消息及审批接口无需更改。APK36继续使用，本轮没有发布Android或热更新。

## 验证

- rc.2、rc.3各25项官方隔离检查通过：运行时加载/任务循环13、问题审批8、历史4。两版本合计6次本地确定性adapter响应；外部模型0次，未读取用户profile或提交原会话任务。
- DeepSeek隔离回归60/60；完整`corepack pnpm verify`通过，手机121/121、后端380/380、入口6、APK更新5、热更新1、发布4；另含lint、类型、两端/插件构建、消息与CLI发现。本轮未改原生代码，不重复Android构建或安装验收。
- 原进程只读桥接27项通过：rc.3实际能力、14会话首帧、近期/全部、重连、原进程保持、9876唯一原宿主监听、配置/配对/语音/队列文件保持。全部会话Agent turn为空闲，没有待答或待审批；此前遗留的后台命令继续保留。
- 真实手机结果、网关本地/公网链路和控制操作分别记录；隔离queue/steer/审批通过不能代替真机实控结论。

## 手机验收

2026-10-30，用户继续使用APK36，在“切换 Agent → DeepSeek Harness”打开原会话，查看正文后返回列表再打开一次，确认：“列表、正文和重新打开均正常”。这是用户真机确认，非自动化设备测试；本次无需发送任务。

本轮原始目标（核对rc.3接口、修复并加载原桥接、恢复手机原会话读取）全部达成。用户回执单独记录于ignored `phone-acceptance.json`；发送、引导、排队、审批、中断与长期后台不计入此次验收。

## 原插件部署

先在私有0700备份目录保存原desktop profile、插件和配置，核对原进程。通过应用内置官方CLI执行`plugin --profile desktop add --offline --ignore-scripts <固定插件>`，保留`autoInstallPeers:false`和原profile patch。

CLI安装成功后桥接仍未监听；原插件页刷新显示v0.2.2，组件仍关闭。通过官方插件开关仅将dsh-mobile-codex关闭再打开，组件显示运行中，鉴权info正确返回rc.3、interactions/history/messagePhases。原Harness全部5个PID保持，监听归属原host PID89486。没有重启宿主、恢复替代会话或处理真实审批。

插件固定目录：`~/Library/Application Support/Mobile Codex Gateway/deepseek/mobile-deepseek-0.2.2-fe030ce367da`。现有profile的依赖链接和lock由官方CLI更新，patch/配置与凭证保持。

## 网关切换与公网

用户明确允许在另一个Codex业务任务运行时仅切网关，保留电脑任务。切换前重新读取原会话状态，手机提交/未知结果、待发队列和审批均为空；以旧instance管理stop，旧PID约2.167秒自然退出，端口释放后启动固定候选。未停止Codex或Harness任务。

新网关PID75321，instance `3b45b23f-6719-4e99-ae73-cb6c5a268076`；构建 `gateway-c211bb4c-d834-486f-9f0a-79babe72ba19`。DeepSeek本地及公网31项通过：鉴权/401、14会话近期与全部列表、相同会话首帧/重连、历史无重叠、实际构建一致。公网首帧292ms、重连408ms，本次正文24条、向前历史25条。Codex公网首帧及重连12项通过，输入替换关系和队列能力保持；另一个Codex业务任务切换后仍为同一inProgress轮次，未被终止。

## 交付产物

独立候选位于`output/delivery/2026-10-30/deepseek-rc3-preview/`，网关ZIP6文件与插件ZIP9文件均逐文件回读核验。网关bundle SHA256：`1f322d39c80f24a062d165edd555b7d0db7d528715fc45e38b53ae95e4fe3940`。插件包版本0.2.2，完整包SHA见manifest和SHA256SUMS。固定网关候选入口位于`releases/2026-10-30-deepseek-rc3-1f322d39c80f2/mobile-codex/lib/gateway.mjs`。

## 过程中的诊断修正

旧官方runtime检查器漏掉插件已有的messagePhases字段，已同步断言。首次原桥接探针漏传schema并将listSessions范围参数传为对象，修正探针后27项通过，无产品改动；首次失败报告独立保留，不掩作产品故障。插件peer的pnpm link警告以实际宿主共享包加载及info确认排除。

## 证据与恢复

ignored证据根：`output/audit/2026-10-30/deepseek-rc3-compat/`。runtime-identities、old-version-rejection、两版runtime/interactions/history日志、verify.log、candidate-identities、plugin-install.log、bridge-live.json、switch-report.json、gateway-live.json及stream-check.json分别记录来源、失败、验证与真实运行。

私有备份与state位置仅保存在backup-path.txt/state-path.txt。回退插件可用原官方CLI重新指向备份记录的oldPluginRoot，必要时仅重载该插件；原插件在rc.3上仍会版本拒绝，不能把这种恢复称为功能正常。网关按精确instance管理stop并确认自然退出后回到oldEntry，保持配置、设备、语音凭证；不强停Harness或电脑业务任务。

## Git同步与未验范围

源码提交`6c2c700dc679010407cc7dd1d00093e5dacd53a2`及annotated标签`codex-to-phone-v0.2.2-deepseek-rc3-preview`已原子推送现有origin/main，远端main与标签展开值核对一致。随后交付文档单独同步，标签保持指向源码基线。只提交本项目路径，父仓库其他修改保持。

手机列表、正文与重开已获用户确认，本轮完成。真实发送/引导/排队/审批、中断和长期后台不在本轮作为已通过结论；[真实控制验收候选计划](../../plans/2026-10-30-deepseek-control-acceptance.md)待用户决定是否启动。复用既有官方运行时检查、固定包切换及备份流程，补充DeepSeek契约；未创建新的安装系统或自动化。
