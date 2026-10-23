# 执行过程自动折叠

日期：2026-10-23（Asia/Shanghai）。用户要求运行时显示过程，正式回复出现后收起过程，最终结果留在正文。

## 本轮完整实现与发布（APK30）

用户要求“完整实现”，本轮补齐Codex工具过程、原始任务归属、DeepSeek实时/历史阶段及实际交付。`1.3.9-process-collapse-preview` / versionCode30已于2026-10-23 15:44（北京时间）发布既有preview，previous保留29，正式Android18与hot清单逐字节SHA保持。手机通过“设置 → 版本与更新 → 检查更新 → 下载并安装”覆盖更新，保留原连接。备用[APK30下载](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.9-process-collapse-preview-7697eab2f469.apk)。本轮结果替代下文初版的“仅本地、DeepSeek无phase”限制，下文作为历史阶段证据保留。

- Codex：明确commentary及已知工具记录在运行时展开，明确final_answer开始输出后收起过程，最终正文独立显示；native助手/工具和rollout助手保留原turnId，可跨引导输入正确关联。手机原messagesForRender曾过滤全部工具，本轮改为保留过程工具，使展开后确实能看到已收到的工具记录。
- DeepSeek：插件0.2.1增加共享`messages.mjs`，普通可见助手文本先标commentary；只有原生turn/end.reason.kind=completed且最后一步为未中断、无tool-call的可见助手消息，才将同一turn的该消息提升final_answer。stream/end、idle、取消、错误、max-tokens及blocked均不足以折叠。临时流沿stream.turn关联，durable替换原临时消息；连续官方历史页处理完成边界后再裁剪可见文本，查看历史不激活Agent。普通推理和工具参数仍不额外跨进程。
- 两端共用MessageTimeline：完成默认收起，点击可重开并保留后续增量中的手动选择；新任务展开，重开已完成会话默认收起。用户输入、未知阶段消息、提问及权限卡独立可见，不删除原文或改变发送行为。旧插件缺phase时保守显示原文。

本地检查：全量后端367/367、手机68/68、消息回归、APK更新5/5、两端typecheck、Relay/Mobile生产构建、独立插件构建通过；Android完整lint使用JDK17 runner及JDK25 JavaCompile fork，0错误/5警告。首次直接JDK25 lint因旧Kotlin分析器无法解析25.0.2失败，保留失败日志，未关闭规则或提高minSdk23。APK30与29同签名，4个包内Web资源逐字节等于最终dist，实际更新源为preview，不含fixture。

真实浏览器以合成数据19/19通过：两Agent完成/运行/中断/旧记录、工具可见、终稿增量保持手动选择、重开/新任务，以及360/390/430px深色150%字号无横向溢出；44px折叠入口和可见周边控件中心/四边内缩5px命中正确。DeepSeek权限卡保持完整参数及允许/拒绝，麦克风只打开语音面板，独立引导/排队/停止按钮点击区域无重叠。页面无warn/error。截图和结果均为合成数据，不能替代Android真机验收。

配套运行交付：原Harness内手机桥接插件已升级0.2.1；文件变更未自动完成HMR，保留初次探测失败证据，通过官方UI仅重载该组件后，真实鉴权/info.messagePhases=true。原profile/package及cordis patch最终字节保持，原Harness PID保持。网关旧PID42623在2165ms自然退出，新固定程序PID77170、instanceId=99750ea7-4d14-42da-ac08-bef38ed0b072运行且Tunnel connected；本地/公网85项健康和17项只读首帧/重连检查通过。未停止原Agent任务、代发模型输入、处理真实权限或取消用户队列；配置、设备、语音Key及插件文件核验保持预期。

公网完整下载19项核验通过：APK字节等于本地核验包，大小4,065,787，SHA256 `7697eab2f469ae20051ef2c8ec4f555b027c941c9b72e5438ed986af3bfd877e`；latest30、previous为发布前29原清单，CORS/Content-Length及正式/hot保持通过。证据位于`output/audit/2026-10-23/process-collapse-complete/`，离线交付入口`output/delivery/2026-10-23/process-collapse-preview/`。无ADB设备，APK30安装及真实任务显示仍待用户确认；原语音供应商故障和旧追加定位不由此次显示优化代替验收。综合语音task保持in_progress，无Git提交。

## 初版本地实现记录（本轮之前）

## 展示行为

手机将连续的明确`assistant/commentary`消息放入“执行过程”区域，默认展开；同段后续的明确`final_answer`开始输出时自动收起为一行，最终正文始终在区域之外。点击可重新展开、查看和复制过程。阶段切换仅自动收起一次，后续流式更新保持手动选择；新任务默认展开。重开已完成会话默认收起。

只改变展示，不改写消息、时间、附件、提交身份或发送路径。用户输入、提问及权限卡片不进入折叠区。没有明确最终回复的中断/失败/断流不会因空闲状态而收起最后过程。缺少阶段标记的旧记录保持可见；不把最后一条助手消息猜成结果。同turn归属明确时可跨引导输入匹配终稿；缺turn时只在同用户输入区段内匹配，跨输入边界归属不足则保留展开。

Codex现有投影已有phase，因此本轮不需要修改网关协议。Agent复用同一展示组件，但当前DeepSeek接口没有phase，仍完整显示原正文；本轮没有声称已实现DeepSeek过程/终稿自动识别。

参考基线为项目2026-10-20采集的官方手机图`output/ui-reference/2026-10-20/official-mobile-approve.jpg`，包含“Worked for…”单行入口和独立最终回复。本轮工具不允许直接读取Codex桌面应用，采用既有官方画面和实际合成浏览器检查，不声称像素级复刻。未取得可靠耗时，因此显示记录数。

## 实现及验证

- `chat/processGroups.ts`是O(n)纯展示模型；`components.tsx`共用MessageTimeline和可访问的44px折叠按钮，原MessageBubble及调用方复制/内联状态回调保持。
- 手机回归66/66，含新增5项分组测试：运行/终稿转换、真实用户边界、已知turn与引导归属、旧记录/工具独立、原文附件和增量稳定。`test:messages`、手机typecheck及生产build通过；fixture语法检查通过。无新增依赖。
- 实际合成浏览器18/18通过：运行展开、终稿流开始即收起、最终正文/用户输入可见、手动重新展开/收起、后续终稿更新保持展开、新轮展开、重开收起、中断保留、旧记录保留、DeepSeek原正文及权限卡独立。360/390/430px、浅深主题和150%字号检查无横向溢出，折叠入口及顶栏/输入区控件中心和四边内缩5px命中正确，按钮高度至少44px。
- 浏览器点击过程复制按钮获得“已复制”反馈；自动化剪贴板读回未得到相同内容，因此不计Android原生剪贴板回读验收。复制仍调用原有原文回调。
- 浏览器未捕获warn/error。证据在`output/audit/2026-10-23/process-collapse/`，含browser-results.json、ui-counters.json和working/completed/dark-360-150截图，均为合成数据。

## 交付边界

本轮仅手机源码、本地构建及合成验收，尚未发布APK或热更新，未切换在线网关。Android真机触摸、键盘、前后台和实际任务显示仍待新版验收。未读取真实会话、代发模型请求、处理真实权限或取消队列，未暂存/提交/推送/建分支/PR。综合任务保持in_progress。
