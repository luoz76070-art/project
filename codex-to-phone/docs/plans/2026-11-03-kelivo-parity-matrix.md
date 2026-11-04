# Kelivo v1.3.4 功能对等矩阵

日期：2026-11-03。关联：[可行性方案及实施阶段](2026-11-03-kelivo-parity-feasibility.md)。

2026-11-04 需求修订：全功能目标继续保留，合并界面统一为 Kelivo 风格，AI 助手与电脑远控是独立入口，交接为可选功能；功能、视觉及独立使用需分别验收。详见[最新整合方案](2026-11-04-kelivo-fast-integration.md)，本表不代表新增界面或功能已经实现。

基线提交：4a7da9b6f5d77caccb9f8aaf656232a93ab14708，版本 1.3.4+84。下表是待实现与验收的范围，**不是已完成集成的清单**。本轮只做源码检查；所有新增功能的集成/真机状态均为未开始。

“新增”表示当前 codex-to-phone 没有对应子系统；“部分相似”表示有相似界面或用途，但实现和数据契约不等价；“平台项”表示按上游平台条件验收。推荐路线下主要复用 Flutter 实现，同时适配 Android 原生宿主；不能把复用源文件视为验收完成。

## A. 供应商、模型与网络

| ID | 对等范围 | 当前差距/实施 | 必须取得的验收证据 |
| --- | --- | --- | --- |
| A01 | OpenAI Chat Completions/Responses、Gemini/Vertex、Claude 与自定义 OpenAI 兼容地址 | 新增手机供应商层；不复用成 Mac 远控协议 | 每类协议的流式/非流式、取消、错误、工具轮次、模型发现与多模态请求均正确 |
| A02 | ChatGPT/Codex、Grok、Kimi Code、Claude 账号登录，模型同步与额度/状态显示 | 新增；源码登录面板枚举了四种账号，README 只写了前三种 | 逐账号检查登录、回调、刷新、退出、重开恢复及失败路径；供应商限制另列，不能仅测试登录页 |
| A03 | 模型能力覆盖：文字/图片/视频标识、工具、推理预算、搜索/代码执行/生图等供应商原生选项 | 新增；按具体模型支持能力映射 | 保存/重开不丢设置；请求参数与上游对照；不支持的模型不伪造成功 |
| A04 | 供应商自定义请求头/请求体，模型参数与上下文配置 | 新增 | 覆盖优先级、传入值及错误提示与上游一致；敏感头不进入通用诊断日志 |
| A05 | 多 Key：轮询、优先级、最少使用、随机，异常 Key 标记/切换 | 新增 | 四策略分别有确定性夹具；Key 失败、恢复、计数及配置持久化正确 |
| A06 | HTTP/HTTPS/SOCKS5 代理、按供应商配置、缓存及指数退避重试 | 新增手机网络层 | 代理开关/鉴权/失败、流式取消、缓存选项及重试边界对照；不重复产生工具副作用 |
| A07 | 余额查询、供应商排序/分组/启停、配置文本/二维码分享导入 | 新增 | 完整配置导出再导入；模型/分组映射正确；带密钥分享行为与原版一致且明确可见 |
| A08 | 供应商预置模板与特殊内置服务，包括源码中的 KelivoIN 等配置 | 新增；涉及上游运营服务时需逐项确认 | 模板入口及协议兼容；运营方授权/额度/可替代后端有据；不能把别人的公共服务当作本项目保证资源 |

证据：README_ZH_CN.md；lib/core/providers/settings_provider.dart；lib/core/models/api_keys.dart:172；lib/core/models/provider_oauth.dart:3；lib/features/provider/widgets/oauth_login_panel.dart:396；lib/core/services/auth/；lib/core/services/api/；lib/core/services/network/。

## B. 助手、聊天、上下文和记忆

| ID | 对等范围 | 当前差距/实施 | 必须取得的验收证据 |
| --- | --- | --- | --- |
| B01 | 助手独立模型、系统提示词模板、预设消息、采样、上下文长度 | 新增完整助手配置 | 每字段保存/复用/覆盖关系正确；最终发送上下文可核对 |
| B02 | 头像/背景、标签、快捷短语、消息正则、独立工具/MCP/技能/工作区配置 | 新增 | 配置只作用于目标助手/会话；导入导出和重新打开保持 |
| B03 | 创建/重命名/删除/置顶、标签组织、全局搜索、助手间移动会话 | 原工作台有部分相似操作；本机聊天另建数据体系 | 搜索正文/定位、移动后关联、删除边界与持久化正确 |
| B04 | 流式输出、停止、重新生成、编辑、多个回复版本 | 原远控有流和停止；手机直连需独立实现 | 分片持久化、取消、失败恢复、版本切换和后续上下文选择与上游一致 |
| B05 | 会话分支、临时聊天、上下文压缩及压缩后开启新会话 | 新增 | 分支引用/附件/消息版本正确；临时聊天保留边界及压缩内容注入可复查 |
| B06 | 会话级模型/系统提示词覆盖、建议问题、工具描述自定义 | 新增 | 默认与覆盖的优先级正确；建议/工具描述进入正确会话，不污染其他聊天 |
| B07 | 长期记忆：自动抽取/去重/合并、四类记忆、全局/助手作用域 | 新增 | 记忆从候选到入库/注入的过程可复查；冲突、重复和隔离夹具通过 |
| B08 | 用户画像、记忆搜索/编辑/归档及整理过程查看 | 新增 | 修改/归档影响后续上下文；重启和备份恢复后相同 |
| B09 | 世界书关键词/正则触发、扫描/激活及注入配置 | 新增 | 命中/未命中、作用范围、注入顺序与预算用夹具逐项对照 |
| B10 | 指令卡片及分组、选择和注入 | 新增 | 启用范围、排序及内容保留；请求上下文能映射到所选卡片 |
| B11 | 本地消息、附件、完整上下文与工具过程；长对话 minimap | 原远控有历史投影和工具展示；不等价于本地真源 | 进程结束/重开不丢已确认数据；工具轮次和长对话定位正确 |

证据：lib/features/chat/、lib/features/assistant/、lib/features/home/；lib/core/database/；lib/core/providers/memory_provider_v2.dart、world_book_provider.dart、instruction_injection_provider.dart；lib/core/services/memory/、world_book_activation.dart、instruction_injection_store.dart。

## C. 本地 Agent、MCP、浏览器与手机控制

| ID | 对等范围 | 当前差距/实施 | 必须取得的验收证据 |
| --- | --- | --- | --- |
| C01 | shell/read_file/view_image/write_file/edit_file/list_dir/glob/grep 八种工作区工具 | 新增手机执行层 | 真正执行/读写测试目录；文本/图片、路径、失败及工具结果格式逐项正确 |
| C02 | 工具审批、文件 diff、命令流输出、会话完全访问模式 | 原远控有宿主审批；新增本机审批边界 | 拒绝不执行；允许只作用正确调用/会话；diff 和输出与实际文件/进程一致 |
| C03 | Android PRoot Ubuntu/Debian/Alpine，自定义 rootfs | 新增 Kotlin/JNI/进程环境 | 下载/解压/启动/删除/重装、网络及命令在真实环境内运行；不存在环境时引导可恢复 |
| C04 | 应用内 PTY 终端、多会话、文件浏览/编辑/预览、手机外部挂载目录（最多 10 个） | 新增 | 交互终端、长输出、返回恢复、挂载读写/只读/撤权；边界与上游一致 |
| C05 | 共享环境变量及输出中的敏感值遮蔽 | 新增 | 环境作用域与更新生效；stdout/stderr/错误日志中的遮蔽按上游行为核对 |
| C06 | SKILL.md：文本、md/zip、GitHub 导入，助手/会话选择及注入 | 新增 | 安装结构、资源文件、启停范围、技能内容注入及备份恢复正确 |
| C07 | MCP Streamable HTTP/SSE/STDIO、OAuth、JSON 导入、逐工具启用与审批、内置 fetch | 新增本机 MCP；不冒充宿主已有工具 | 每种传输完成发现和调用；取消/断线/鉴权/审批可恢复；手机 STDIO 在 Linux 环境执行 |
| C08 | 模型向用户提问、接收答案并继续工具轮次 | 原远控有类似交互；新增本机执行关联 | 多问题、取消、重开及迟到答案对应正确工具调用 |
| C09 | 时间、剪贴板、计算器、TTS 等本地工具 | 部分有剪贴板；新增模型工具入口 | 工具发现、开关、参数、原生调用和返回值完整，不仅是 UI 按钮 |
| C10 | Android 日历、定位、应用使用时长等设备工具 | 新增权限及系统接口 | 权限允许/拒绝/撤回、系统无数据/无定位结果均与上游对照 |
| C11 | 定时任务：任务设置、执行、通知和启动恢复；iOS 另有准备式实现 | Android 部分新增；跨平台差异见 F | 一次性/重复等实际支持模式逐一测试；权限/重启/时区/重复执行边界留证，不承诺系统强停后仍运行 |
| C12 | 内置浏览器页面/多标签、书签与管理；模型导航、DOM/快照、截图、点击/输入/选择/滚动/等待/页面 JS | 新增受控浏览器，正式入口已接线 | UI 操作及模型工具都可用；会话绑定、登录/页面状态、后台恢复、失败与审批按原版核对 |
| C13 | Android 无障碍 phone_control：读取节点、点击/长按、替换文本、滚动/滑动、启动 App、系统导航 | 新增无障碍服务；不能用 Mac Relay 替代 | 专用测试 App 实测；未授权/锁屏拒绝、过期或消费后的快照正确处理；重要操作确认行为分别核查 |

特别说明：phone_control 的 read_screen 返回无障碍节点，不能等同截图视觉控制。源码中的手势操作要求 Android 7+；工具描述规定 30 秒快照和动作消费。工具提示词中的“先确认”不等于已证明原生层强制拦截。

正式入口证据：

- 浏览器入口：lib/features/chat/widgets/bottom_tools_sheet.dart:147；工具接线：lib/features/home/services/tool_handler_service.dart:586；动作实现：lib/core/services/browser/browser_tools_service.dart:28。
- 手机控制开关：lib/features/home/services/local_tool_toggle.dart:46；原生调用：android/app/src/main/kotlin/com/psyche/kelivo/DeviceLocalToolsHandler.kt:74；保护逻辑：PhoneControlService.kt:189、453；工具声明：lib/features/home/services/local_tools_service.dart:604。
- 执行环境：lib/core/services/workspace/、lib/core/services/sandbox/；android/app/src/main/kotlin/com/psyche/kelivo/workspace/；MCP：lib/core/services/mcp/；技能：lib/core/services/skills/；任务：lib/core/services/scheduled_tasks_service.dart。

## D. 搜索、语音、多模态和交互渲染

| ID | 对等范围 | 当前差距/实施 | 必须取得的验收证据 |
| --- | --- | --- | --- |
| D01 | 联网搜索、服务切换、结果引用、多 Key 轮换及服务特有参数 | 新增独立搜索子系统；按源码选项而非 README 数字裁剪 | 下列每个服务的配置/协议/引用/错误有用例，真实服务逐项登记，不能用同一兼容端点替代全部 |
| D02 | 系统 TTS 和全部网络 TTS，分段播放、暂停/继续/重播及供应商音色/格式参数 | 新增完整手机播放层 | 音色/语速/模型等支持项保存；流和非流播放、取消、错误、前后台状态与上游一致 |
| D03 | 系统 ASR、本地 Sherpa-ONNX、全部云 ASR，输入框转写 | 现有经 Mac 转写不等价；新增独立录音识别链 | 断开 Mac 后仍可用相应方式；本地模型安装/离线、云参数、权限/切页/取消及录音资源释放通过 |
| D04 | 图片/PDF/Word/文本代码/支持模型的音频输入，OCR、图片压缩 | 原远控有附件；新增模型侧解析与参数 | 同文件对照提取/上传/重用/预览/错误；OCR、压缩与音频不能仅测试文件选择 |
| D05 | 模型生图、图片展示/保存及原生生图参数 | 新增 | 请求格式、图片结果、持久化与导出逐供应商核查 |
| D06 | 翻译页面与消息翻译 | 新增 | 目标语言、模型选择、流式/失败、复制/保存等实际入口完整 |
| D07 | Markdown、高亮、LaTeX、表格、Mermaid、HTML 预览与图示 PNG 导出 | 当前仅有限 Markdown；新增完整渲染 | 固定样例与原版对照；流式未闭合代码、公式、表格/图示和导出均通过 |
| D08 | 原生 GenUI：kelivo-ui 声明式组件、表格/图表/表单、交互事件、状态、搜索及导出 | 新增运行时；普通 HTML 预览无法替代 | 点击/输入/校验/提交结果、落盘/重开、定位/导出、预算限制和错误回退逐项通过 |
| D09 | Web GenUI：kelivo-web 交互式 HTML、预览、状态与导出 | 新增隔离 WebView；Android 属于支持平台 | 保持脚本沙箱/CSP/拒绝平台权限；不获得 App 凭证或宿主桥；交互和恢复等价 |

### D 的服务子清单

搜索新增选择器中有 27 个类型：Bing、DuckDuckGo、Tavily、Exa、Exa MCP、智谱、SearXNG、Linkup、Brave、秘塔、Jina、Ollama、DeepSeek、Perplexity、博查、豆包、Kagi、Serper、Querit、Grok、StepFun、Firecrawl、TinyFish、AnySearch、Parallel、Kimi、You.com。另有“关于”页解锁的 Kelivo 搜索。README 的“24 种”不能作为实现上限。

网络 TTS 共 12 类：OpenAI、Gemini、Azure、MiniMax、Qwen、Qwen Audio、Groq、xAI、ElevenLabs、MiMo、StepFun、Fish Audio；另加系统 TTS。细分模式、克隆音色等设置按相应服务页面逐项展开，不用“能读出一句话”代表全部通过。

ASR 选项共 11 类：Sherpa-ONNX、System、OpenAI Realtime、Groq、Mistral、ElevenLabs、DashScope、Qwen Audio、Volcengine、MiMo、StepFun；平台限制和本地模型可用性按设备另记。

上述数量是固定源码的选项清点，尚未代表发布二进制中的逐项成功；上游内置搜索服务的运营接口/使用资格需另行确认。源码中存在的服务能力也不构成免费额度承诺。

证据：lib/features/search/pages/search_service_editor_page.dart:2889；lib/core/services/search/search_service.dart:56；lib/core/providers/settings_provider.dart:5671；lib/features/settings/pages/about_page.dart:89；lib/core/services/tts/network_tts.dart:9；lib/features/settings/pages/tts_services_page.dart:2232；lib/core/services/asr/asr_service_options.dart:3；lib/features/settings/widgets/asr_services_section.dart。

GenUI 正式接线：lib/shared/markdown/kelivo_markdown_extensions.dart:43，lib/features/chat/widgets/chat_message_widget.dart:2850。HTML 平台分支：lib/features/intelligent_ui/host/ui_web_controller.dart:11；隔离规则：ui_web_document.dart:93、ui_web_controller.dart:74。预算：lib/features/intelligent_ui/catalog/ui_budgets.dart:3（源码 256 KiB、原生/Web 块分别最多 3、组件 256、输入 64）。

## E. 数据、管理、外观及系统入口

| ID | 对等范围 | 当前差距/实施 | 必须取得的验收证据 |
| --- | --- | --- | --- |
| E01 | SQLite/Drift 本地库、消息/附件/配置及迁移/启动恢复 | 新增完整本地真源，与远控缓存分区 | 崩溃/中断/版本迁移恢复；大数据集、重开及关联完整；不清理原有远控数据 |
| E02 | Markdown/文本/图片导出、复制与分享 | 有部分复制/附件；新增 Kelivo 导出 | 分支/版本/富内容/图片的导出结果可打开，文件保存权限及失败可恢复 |
| E03 | WebDAV、S3、本地备份；覆盖/合并恢复；上游已有加密配置 | 新增；复用格式仍需验证 | 各后端上传/下载/错误；明文/加密按实际格式验证；错密码/损坏/不兼容不破坏原数据 |
| E04 | 自动快照、周/月保留、手动恢复及恢复前副本 | 新增 | 保留策略、空间不足、恢复失败及恢复前副本均留证 |
| E05 | Kelivo 备份兼容，Cherry Studio/Chatbox 导入 | 新增 | 备份格式版本与 DB schema 分别检查；字段/附件/版本/去重映射有对照表，损失字段明确，不默认无损 |
| E06 | 请求日志、完整上下文日志、日志保留及存储占用管理 | 当前仅远控诊断；新增本机请求与存储管理 | 开关/大小/清理按原版；供应商密钥和远控连接凭证不出现在通用导出中 |
| E07 | 热力图、消息/token/缓存、模型/助手统计 | 新增 | 同一夹具统计可复算；重生成/删除/备份恢复边界与原版一致 |
| E08 | 主题明暗/动态取色、壁纸/渐变、气泡、主题导入分享 | 新增完整外观设置 | 每项重开保留、导入导出、长文本/键盘/深色/窄屏实际检查 |
| E09 | 本地导入/下载字体，简中/繁中/英文 | 新增 | 字体下载/失败/回退、重开恢复；语言切换和功能页覆盖完整 |
| E10 | 后台生成、完成通知、Android 实时进度通知及悬浮窗 | 新增/原生服务接线 | 页面切换、锁屏/回收、通知点击回正确会话；权限拒绝/撤回及多任务并发通过 |
| E11 | Android 系统分享、文本选择处理、文件入口及登录深链 | 原有部分 Intent；新增并适配所有权 | 冷启动/已打开/两个工作区后台均准确路由；与原版 Kelivo 共存不劫持回调 |
| E12 | 同 APK 升级、上游依赖版本与诊断、应用设置/关于页的既有可达入口 | 保留当前 APK 更新流程并纳入 Flutter 版本 | 不覆盖安装成原版 Kelivo；现有签名/包名连续；模块需完整 APK 的更新不能伪装成 Web 热更新 |

证据：lib/core/database/、lib/core/services/backup/、lib/features/backup/、lib/core/providers/local_snapshot_provider.dart、lib/features/settings/、android/app/src/main/AndroidManifest.xml。

备份实现：lib/core/services/backup/data_sync.dart:262 为 kelivo-backup 格式 3；:287 的归档范围含 skills/workspaces/sessions 并排除 Linux rootfs。Cherry Studio/Chatbox 导入入口：lib/features/backup/pages/backup_page.dart:1357。浏览器登录态、GenUI 交互状态和加密细节的完整往返尚未核实，必须在 E03/E05 真机/数据验收中补证。

## F. 平台差异：不把其他端专属能力伪装成 Android 已实现

| 能力 | 上游支持/限制 | 本次 Android 方案的处理 |
| --- | --- | --- |
| Linux/Shell | Android PRoot；iOS iSH Alpine；桌面本机 Shell | Android 全部保留；另外两端运行时不当作 Android 缺失 |
| 定时任务 | README 表格只列 Android/桌面；固定源码实际也为 iOS 接线了 PreparedScheduledTasks 和通知路径 | Android 完整纳入；iOS 的准备/通知/执行限制须另做成品对照，不能根据旧 README 断言不支持 |
| 设备工具 | Android 日历/定位/使用时长；iOS 另有天气/提醒/健康等 | Android 对等；iOS Health 等需未来 iOS 工程与系统接口 |
| 手机控制 | Android 无障碍服务 | 必须实现；Android 权限前置不能移交 Mac 代替 |
| 浏览器模型工具 | Android/iOS/macOS/Windows；Linux/Web 不提供 | Android 全部纳入；不据此宣称网页访问版也支持 |
| Web GenUI HTML 预览 | Android/iOS/macOS；Windows 暂缓、Linux 源码/导出路径 | Android 纳入；原生 GenUI 与 Web GenUI 分别验收 |
| 桌面系统交互 | 多栏、快捷键、托盘、拖附件、窗口恢复等桌面专属交互 | 本次不创建新的桌面 Flutter 客户端；原 Mac Relay 继续保留 |
| Live Activities/iOS 分享等 | iOS 专属系统集成 | 不在 Android 中假实现；若用户要求全平台，再增加对应客户端计划 |

平台来源：固定 README；lib/core/services/scheduled_tasks_service.dart:52、70；lib/features/settings/pages/settings_page.dart:291；lib/features/home/services/local_tools_service.dart:74、409；lib/core/services/browser/browser_service.dart:132；lib/features/intelligent_ui/host/ui_web_controller.dart:11。业务上要求“所有平台的功能都放在 Android”时，应按结果设计等价交互；其中依赖另一平台私有系统能力的部分不能承诺原样一比一。

## G. 原远控功能的强制回归

| ID | 保留范围 | 验收重点及当前代码证据 |
| --- | --- | --- |
| G01 | 连接档案、鉴权、Broker/Tunnel 及网络恢复 | 切 Flutter 再返回后正确恢复订阅；apps/mobile/src/features/connection/subscription.ts:90，apps/relay/src/server/createRelayServer.ts:65 |
| G02 | 消息身份、发送确认、审批/提问、排队/引导/停止 | 不串 thread/turn/agent，不重放待确认提交；apps/mobile/src/app/types.ts:12、92 |
| G03 | 草稿、历史缓存、附件、项目及会话组织 | 升级/后台/进程恢复保留；apps/mobile/src/features/chat/runtime.ts:248、299 |
| G04 | 录音与语音整理、剪贴板、文件保存、诊断 | 当前原生录音 pause/stop 取消语义保持可解释；VoiceRecorderPlugin.java:151、MainActivity.java:8 |
| G05 | APK 更新、Web 热更新、原生安全凭证 | Web 更新不越权更新 Flutter；HotUpdatePlugin.java:79、SecureCredentialsPlugin.java:21 |
| G06 | 原 Agent 宿主控制和协议位置 | DeepSeek 私有 bridge 仍在 Mac；手机 localhost 不代替 Mac localhost；apps/relay/src/agents/deepSeekProtocol.ts:4 |

## H. 后续验收记录格式

P0 将各分组展开为设置/服务/操作级用例，记录至少：

~~~yaml
id: C13.read_screen.locked
baseline:
  tag: v1.3.4
  commit: 4a7da9b6f5d77caccb9f8aaf656232a93ab14708
  apk_sha256: 待获取并校验官方发布资产
device: 待登记型号与 Android 版本
preconditions: 无障碍已启用，测试设备已锁屏
steps: 调用读取无障碍节点工具
expected: 拒绝执行，错误与固定上游同条件对照
status: 未开始
evidence: 待保存操作录像及脱敏日志
~~~

所有未开始、仅源码存在、隔离测试通过、缺账号受阻的用例，都不能计作最终真机通过。具体完成门槛、预估工期与启动顺序以关联方案为准。
