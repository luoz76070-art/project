# DeepSeek待发取消与APK38预览

日期：2026-10-31。状态：插件0.2.5、配套网关与APK38预览已交付，用户已确认升级、原连接和正文正常；运行中引导、排队顺序、取消待发及权限允许一次已核验通过，权限拒绝、恢复原模式与停止仍待完成；2026-11-03继续核验，原任务保持in_progress。

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

用户2026-10-31回复“已升级38，原连接和正文正常”，本项通过。随后只读预检确认指定原测试会话在本地及公网均connected/idle，待答、审批及待发项均为空，canSend=true、queue.available=true；证据为同目录phone38-preflight.log和target-latest.json（08:52:11Z）。该结果只证明升级及只读连接，不代替真实控制。

下一步依次单次允许/拒绝、停止指定任务。操作说明须明确选择引导/排队模式后还要点击发送箭头。用户已明确授权仅将原DeepSeek测试会话临时切为工作区内修改，并在验收后恢复完全权限；当前切换已核验，权限手机操作待验。普通pwd自动执行不能计权限卡验收。

### APK38运行中引导：通过

用户先反馈引导按钮禁用，随后提供17:20:43真机截图：已连接、运行中、草稿仍保留、提示“已提交，等待服务确认”；用户明确“已点击发送箭头，之后按钮变灰”。因此该截图反映提交后的等待期，不是提交前无法发送。

原会话第18轮在北京时间17:19:43开始，17:19:49执行sleep 90、timeoutMs=120000、run_in_background=false。17:21:19工具返回后，同一轮新增一次用户实际追加“将本轮最终回复改为Ds38-BASE-1031-ok，不增加工具调用”；17:21:24同轮成功终稿为Ds38-BASE-1031-ok。采用用户实际输入核验，不能因其未照抄卡片中的STEER标记判失败。用户此前第16轮等待与第17轮独立输入属于不同真实操作，不能合并成重复显示或算作运行中引导成功。

根因范围：官方Agent.steer将消息放入nextStep，当前工具/步骤结束后才产生user/message。桥接在消费前保持submitted并锁定重复控制；手机保留草稿和通用等待提示，造成“未发送”的观感。原始记录与用户截图时机相符。独立官方rc.5生产AgentLoop复现nextStep=1、消息尚未落入正文、submitted、三个控制能力均false；释放当前步骤后原消息确认一次、原任务采用追加，既有14项检查均通过，外部模型请求0。此次没有绕过确认守卫或修改产品；反馈文案优化列为搁置，原APK36入口缺失的具体现场原因仍不因此断言已找出。

证据：phone38-native-events.json、pending-steer-reproduced.log、reproduce-pending-steer.mjs，以及用户上传的20261031-172119-ccd834b0-Screenshot_20261031_172043_com_mobilecodex_app_MainActivity.jpg。08:55开启的10分钟观察在17:17实际操作前已到期，不能用其idle结果否定手机操作；后续09:21:20Z快照记录等待确认向confirmed过渡，09:22补采后已关闭自建观察器。旧观察器未合并公网v1增量messages，空数组不能解释为历史消息消失；后续观察改用手机生产snapshotReducer、64KiB上限及30分钟窗口，目标终稿在两端idle后自动结束。

### APK38排队顺序：通过

用户反馈“待发可见，先 BASE 后 NEXT，各一次”。原桥接在北京时间17:32:45、公网在17:32:46观察到一条待发，当前任务仍running，投递状态submitted，尚未当作执行确认。原会话第19轮于17:34:07.912成功结束并回复DS38-QUEUE-BASE-1031；第20轮17:34:07.913才开始，随后回复DS38-QUEUE-NEXT-1031-OK，无工具调用。两条输入与两条终稿分别只有一次；两端最终idle、队列为空、投递confirmed。

证据：phone38-queue-native-events.json、phone38-queue-acceptance.json和observe-phone38-2026-10-31T09-30-41.174Z.jsonl。观察日志12,144字节，已按手机生产snapshotReducer合并公网v1增量，并在两端完成后自动关闭。助手只读核验，未代发模型消息。该结果确认排队顺序，取消待发仍须独立验收。

### APK38取消待发：通过

用户反馈“取消成功，当前任务正常完成，取消项未执行”。原桥接/公网17:47:08观察到一条待发；17:47:39定向移除后submission为空、能力恢复，原第21轮仍running。17:48:15当前任务正常完成并仅回复一次DS38-CANCEL-BASE-1031，两端最终idle、队列为空。原日志中DS38-CANCEL-SHOULD-NOT-RUN-1031对应用户输入和助手回复均为0，没有把取消算作停止当前任务。

证据：phone38-cancel-native-events.json、phone38-cancel-acceptance.json、observe-phone38-2026-10-31T09-41-10.480Z.jsonl。观察日志7,789字节，两端结束后已自动关闭；助手未代发模型消息、取消或停止操作。

### 权限验收前置

切换前原日志最后权限事件及桌面会话按钮均确认danger-full-access/never（完全权限）。官方rc.5权限预设将workspace-write与ask绑定；bash明确提供sandbox_permissions（workspace-write或danger-full-access）及justification，显式申请更宽单次执行会先走approval再执行命令。普通pwd自动执行不能计入权限卡验收。

用户明确回复“同意仅此会话临时切换，验收后恢复原模式”。本地/公网预检均connected/idle，待答、审批、待发与未决提交为空。北京时间17:59:05通过原桌面菜单切换指定会话，按钮显示“工作区内修改”，原生日志seq1932–1934分别记录permission/preset=workspace-write、sandbox/mode=workspace-write、approval/policy=ask。只操作该会话，原完全权限模式已保存。

两次独立pwd分别核验允许一次、拒绝；完整参数由手机显示，决定由用户作出，拒绝后不重试。允许测试使用sandbox_permissions="danger-full-access"及说明，仅打印当前目录。允许一次现已通过，拒绝及恢复原模式仍待完成。记录在phone38-permission-preflight.json；允许观察为observe-phone38-2026-10-31T09-59-22.677Z.jsonl，30分钟/64KiB上限；实际未发送预设终稿标记，核验两端已结束后定向关闭了该观察器。助手未代发模型消息或决定审批。

### APK38权限允许一次：通过

用户反馈“出现完整参数，允许一次后成功回复，卡片消失”。原第22轮在2026-10-31 18:00:49接收一次实际手机输入；18:00:56只调用一次bash/pwd，明确申请danger-full-access并附说明，随即产生一条approval/asked。18:01:05记录同一审批allowed-once，随后pwd成功返回当前目录；18:01:12本轮正常结束，没有增加工具调用。原桥接与公网都观察到同一审批卡，支持once/reject且详情420字符；最终审批清空、idle、confirmed、队列为空。

实际手机输入只包含允许测试提示词的前半段，未含DS38-PERM-ALLOW-1031-OK标记；终稿说明审批通过并给出当前目录。按真实输入和审批/执行时序验收该功能，不把预设标记未出现判为链路失败，也不声称收到标记终稿。证据为phone38-permission-allow-native-events.json、phone38-permission-allow-acceptance.json及上述5,308字节观察日志。

2026-11-03继续前，桌面及原权限事件仍为workspace-write/ask；最新本地/公网快照均空闲，待答/审批/待发为空，无未决提交。接下来独立验证拒绝并恢复原完全权限，之后测试停止。拒绝未测、恢复未执行，不能提前勾选。

拒绝前新增公网观察在08:02:18Z及08:04:01Z均返回HTTP429；源码限制每个设备最多4条/全局32条事件流，但现场不能确定是哪一级额度占满，未推断手机也已断线。两个失败观察器均已退出，没有遗留本轮观察进程；未重启网关或改变连接限额。改用原桥接有界观察observe-phone38-original-2026-11-03T08-04-47.581Z.jsonl配合手机实际结果验收，明确本次缺少额外公网SSE连续取证。已发拒绝操作卡，等待用户实际决定；助手未代发或代拒绝。

手机只验预览，不称稳定版。通道回退先确认latest仍为38，再恢复本轮preview-before.json和previous-before.json；不删APK，已安装38不能普通覆盖降级，应提供更高versionCode修复。网关回退使用私有备份state.json的原固定入口并绑定当前instance停止；插件回退通过官方CLI恢复oldPluginRoot并重载组件，始终保留原Harness任务及配置。

复用现有原子发布、网关切换/只读复联与Trellis记录流程；补充待发取消契约和发布IdentityFile运行说明，无新自动化。搁置：引导等待文案、内部压缩摘要外显。
