# DeepSeek待发取消与APK38预览

日期：2026-10-31。状态：插件0.2.5、配套网关与APK38预览已交付，手机升级及真实控制仍待用户逐项验收；原任务保持in_progress。

## 现场与范围

用户补充上次sleep 90时手机“已连接，停止按钮可用”。原生及公网观察期间canSteer=true，无追加输入，最后回复BASE；没有那一瞬间手机能力/页面证据，不能按断线归因，也不能宣布入口缺失根因已确认。APK37两条指定Codex旧输入的真机无重复结果继续有效。

本轮另确认原链路没有DeepSeek待发查看/取消能力，这是已启动验收计划中的独立缺口。复用原生inbox.nextTurn，仅投影本桥接当前手机submission精确对应的一项，不创建另一个调度队列。取消前同步核对原Agent、controlToken、submission和nextTurn，调用inbox.remove(messageId)，当前任务及其他桌面待发保持。已消费/外国项/旧token拒绝；设备鉴权和操作UUID幂等沿用已有路由。

排队接纳仍为submitted，原user/message才确认执行。权威待发快照可清理匹配的旧草稿，新编辑保留；未知取消在bridge和Relay双层锁定，跨重连不重试，迟到回包不污染新项。当前继续限制一次未确认手机输入；插件重载不恢复提交映射，更新前须确认未决输入为空。

浏览器复现旧45dvh footer在360×320、聚焦多行草稿时裁掉停止按钮；待发卡展开也挤占输入区域。待发卡移至消息区，模式与停止集中一行，footer上限按剩余视口调整；DeepSeek运行时保留引导入口，暂不可用则禁用。该边界修复不冒充用户原缺入口现场的根因。

## 验证

- 完整verify通过：手机126/126、后端389/389、验证入口6/6及热更新/安装更新/发布脚本。补充迟到取消回包用例后，DeepSeek最终70/70；最终手机126/126、消息、lint、两端typecheck和插件构建通过。
- 新增待发投影/定向取消、外国/已消费项、旧令牌/重连、未知双层锁、迟到HTTP及设备鉴权/重复请求回归；手机匹配草稿与新编辑保护。最初待发投影与草稿用例先失败后通过。
- 官方rc.2/rc.3/rc.5运行时各14项通过，新增生产AgentLoop中的定向remove验证：只移除手机项，原任务及桌面待发项保持，外部模型请求0。本地确定性adapter每版3次，不能代替真机。
- 浏览器验证正常取消、新草稿保留、未知结果重开仍锁定、引导一次写入及语音单独打开。360×320聚焦多行草稿、360×640与150%字号下引导/排队/停止/语音/发送均≥44px，中心和四边命中；没有可用引导能力时保留禁用入口。无ADB设备，Android键盘和真实触摸未代验。
- Android clean assembleDebug及完整lint通过，0 Error/Fatal、8项既有Warning。APK38与37同签名，四个Web文件逐字节匹配最终dist，Capacitor两份空cordova兼容桩核对，无fixture；双更新源正确。

## 部署与发布

先核对DeepSeek 14个会话均空闲、无待答/审批/未决手机输入；网关两条正在运行的Codex订阅无待发及审批，保持电脑任务。原配置、profile、设备和语音文件私有备份后，官方CLI仅链接原desktop profile到固定0.2.5。CLI成功后探针仍没有queue字段，经官方组件开关重载才确认新queue能力。开关写入的默认disabled:false经差异核实后移除，原cordis.patch.yml逐字节恢复；五个原Harness PID保持。

固定网关旧PID84956自然退出2185ms，新PID32223，instance f83d44d8-ed3c-48a7-82d5-2e3eca0ef939。bundle SHA256 90568bd7399fcb5a44b0e44f615606b57f727485075a13a3cd5e7c8fa8b19911。原桥接17项、本地/公网35项、Codex重连12项通过；额外确认目标两端queue.available=true、队列为空、idle可发送。零模型发送、真实审批与任务中断。

APK38为1.3.17-deepseek-queue-preview，4,077,965字节，SHA256 75e683b093fb6367080e517a3b7d0c5e301ce4119dadf2087da407f9d611fb0e。原子发布现有preview，previous保留37；正式18与hot清单保持。公网19/19检查通过，完整下载与已验证成品相同。发布使用既有hermes-8153及历史IdentityFile，没有新增凭证或修改SSH权限。

证据在ignored output/audit/2026-10-31/deepseek-control-acceptance/：queue-before.tap、queue-mobile-before.tap、verify.log、deepseek-final.log、queue-official-rc*-*.log或queue-official-rc*.log、browser-checks.json、android-build.log、android-lint.log、apk-verification.json、switch-report.json、bridge-live.json、gateway-live.json、stream-check.json、target-latest.json及publication-check.json。最初签名检查因当前shell未选择Java失败，选择现有Homebrew Java后完成核验；APK检查明确允许且验证两份Capacitor空兼容桩，未修改成品来通过检查。

## 真机验收与回退

已向用户发APK38升级/原连接/正文确认卡；无回复不视为通过。下一步依次引导、排队顺序与取消、单次允许/拒绝、停止指定任务。原DeepSeek测试会话目前为完全权限，普通pwd自动执行不能计权限卡验收；若需要改变权限模式，须由用户明确选择，不静默调整。

手机只验预览，不称稳定版。通道回退先确认latest仍为38，再恢复本轮preview-before.json和previous-before.json；不删APK，已安装38不能普通覆盖降级，应提供更高versionCode修复。网关回退使用私有备份state.json的原固定入口并绑定当前instance停止；插件回退通过官方CLI恢复oldPluginRoot并重载组件，始终保留原Harness任务及配置。

复用现有原子发布、网关切换/只读复联与Trellis记录流程；补充待发取消契约和发布IdentityFile运行说明，无新自动化。搁置：内部压缩摘要外显。
