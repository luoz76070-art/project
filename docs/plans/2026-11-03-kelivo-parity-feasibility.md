# Kelivo 全功能集成可行性方案

日期：2026-11-03。状态：完整整合的可行性研究及后续执行计划；2026-11-04 已启动现有远控视觉迁移，未启动原生合并。

2026-11-04 需求修订：用户要求统一为 Kelivo 风格，AI 助手与电脑远控各自独立使用，另增可选任务交接。本文固定版本与功能研究继续有效；入口、界面及排期前提如有冲突，以[最新整合方案](2026-11-04-kelivo-fast-integration.md)为准。现有远控的首轮视觉迁移已实施，见[验收记录](../audits/2026-11-04/kelivo-style.md)；完整功能整合未实施。

原始目标：梳理 Kelivo 的完整功能、评估在 codex-to-phone 中一比一实现的可行性、给出分阶段方案与验收标准。

## 1. 结论与推荐

将 Kelivo 的 Android 完整功能纳入 codex-to-phone 有可行技术路线，但原生合并和全量行为尚未验证，不能承诺已经可完整交付。这是增加一个成熟的本机 AI 客户端及 Agent 子系统，工作量远大于接几个模型 API。推荐先验证“同一 APK、两个功能工作区”：保留现有 React/Capacitor 远控工作台，将固定版本 Kelivo 整理成 Flutter 模块，通过原生宿主进入。尽量复用它的界面、数据库、供应商适配、工具和原生实现，以降低一比一功能遗漏。

这是基于源码和官方嵌入机制的工程判断，还没有通过本项目的编译或真机 PoC。Flutter 支持 Android add-to-app，但 Kelivo 本身并非现成的可嵌入 SDK；其 Application、Activity、插件、后台服务、原生库和登录回调都需要适配。[F1][K3][K4]

推荐路线成立的前提：接受合规复用 AGPL 源码；接受同一 App 内保留两套技术栈；首轮以 Android 为目标。若要求继续仅以 MIT 发布整个合并作品，或要求所有功能必须重做成现有 React 界面，应转向独立重实现并重新估算。不能靠目录分开或 MethodChannel 通信就认定没有 AGPL 义务。[L1][L2]

## 2. “一比一”的完成定义

### 2.1 固定基线

| 项目 | 本方案的基线 |
| --- | --- |
| 上游 | Chevey339/kelivo |
| 版本 | v1.3.4，应用版本 1.3.4+84 |
| 发布时间 | 2026-11-02 15:08:16 UTC，即北京时间 2026-11-02 23:08:16 |
| 固定提交 | 4a7da9b6f5d77caccb9f8aaf656232a93ab14708 |
| 对照物 | 该提交源码及对应官方 Android 发布包；源码接线与成品行为分别留证 |
| 本轮已核实 | Release 元数据、README、依赖与原生工程、主要功能源码及现有项目结构 |
| 本轮未核实 | 两个发布 APK 的逐项真机对照、合并构建、账号供应商实测、性能与数据无损往返 |

这里的“一比一”是：同样的入口、设置和前置条件下，得到等价的功能行为、可保存的数据和可恢复的状态；范围包括生产入口可达的功能，而不只是 README 和本次更新日志。版本后续变化通过单独的差异清单处理，不把“永远追平最新”当作本次可验收范围。[K1][K2]

源码审计还发现了宣传清单之外的范围：正式可达的浏览器工具、原生/Web GenUI、手机无障碍控制，以及第四种 Claude 账号登录。搜索配置是 27 个新增选择项加一个解锁服务，ASR 有 11 类，网络 TTS 有 12 类再加系统 TTS；因此不能照 README 的旧数量裁剪范围。功能矩阵共整理了 59 组，其中 6 组是原远控能力回归，各服务和设置仍需继续展开成用例。[K7]

### 2.2 范围边界

1. **Android 全功能属于本次目标。** 多供应商聊天、本地 Agent/Linux、浏览器工具、GenUI、无障碍手机控制、备份导入、后台通知等均纳入；不能把高难功能删掉后称为全量完成。
2. **保留 codex-to-phone 原远控能力。** 原来的 Mac Codex/DeepSeek/OpenCode/Claude 控制、会话身份、审批、草稿、排队、停止、连接恢复和升级路径都是回归范围。
3. **模型输出不做逐字相等验收。** 对照的是请求协议、参数、附件、工具调用、状态、引用与落盘结果；在线模型的随机回答和第三方服务配额不属于客户端可保证结果。
4. **功能对等不自动等于所有页面逐像素相同。** 推荐路线保留 Kelivo 内部界面以提高保真度，但 App 名称、入口、包标识和权限说明需适配。若还要求整个 codex-to-phone 重做成 Kelivo 外观，应单独增加 UI 迁移范围。
5. **平台能力按上游边界验收。** iOS 的健康/提醒/Live Activities/iSH、桌面托盘/全局快捷键等不能直接作为 Android 缺失项；详见功能矩阵的平台表。网页访问版也不会因为 Android 嵌入 Flutter 而自动拥有这些功能。[F1]
6. **缺账号、权限或环境时记为受阻。** 不允许把未测、Mock 成功或隐藏功能开关计为真机通过；允许记录上游自身缺陷，但必须给出同条件对照证据。

逐项范围和验收见 [完整功能矩阵](2026-11-03-kelivo-parity-matrix.md)。它是源码审计形成的工作分解；P0 仍需补全真实界面入口及每个供应商子项，不能以分组行数代替完整用例数。

## 3. 当前项目的实际差距

| 层面 | codex-to-phone 当前情况 | Kelivo 对等所需新增内容 |
| --- | --- | --- |
| 产品核心 | 手机操作 Mac 上已有 Agent，会话真源在宿主 | 手机独立连接模型 API，并运行本机 Agent |
| 前端 | React 19、Capacitor 7、Vite | Flutter 页面、渲染器、状态系统及其原生依赖 |
| 模型 | 原宿主 Agent 的控制适配 | OpenAI/Gemini/Claude 等协议，账号登录、模型发现、负载与代理 |
| 数据 | localStorage 中的有界缓存/草稿，原生连接凭证 | SQLite/Drift、消息版本和分支、本地附件、配置、备份及迁移 |
| 内容渲染 | 简化 Markdown 与工具过程展示 | 完整数学/表格/图示/HTML、原生 GenUI 和隔离 Web 交互 |
| 语音 | 通过 Mac 网关转写和整理 | 多服务 ASR/TTS、系统及离线能力、模型音频输入 |
| 本地执行 | 缺少手机 Linux/终端/文件 Agent 系统 | PRoot、rootfs、PTY、挂载、技能、STDIO MCP |
| Android 系统 | 更新、热更新、录音、剪贴板、诊断等插件 | 无障碍、设备工具、定时任务、前台服务、悬浮窗及浏览器 |

证据入口：本项目的 apps/mobile/package.json、apps/mobile/src/features/chat/MessageContent.tsx、apps/mobile/android/app/src/main/java/com/mobilecodex/app/MainActivity.java、apps/mobile/android/variables.gradle，以及 docs/project-layout.md、相关 Trellis 前后端规范。

目前看起来相似的聊天框、工具消息、语音按钮，不能视为底层能力已经相同。尤其不能把 Kelivo 全部转发给 Mac Relay：这样 Mac 断开时，本机聊天、本地历史、本地 Linux 和手机控制均不能保持对等。

## 4. 三条路线比较

| 路线 | 做法 | 功能保真与代价 | 判断 |
| --- | --- | --- | --- |
| A：React/Capacitor 独立重实现 | 按行为规范重做 UI、协议、数据库、渲染和 Kotlin 插件 | 技术栈统一；需重建整个成熟产品，遗漏、兼容与长期维护风险最高 | 仅在不能复用 AGPL 或必须统一 React 时选择；不应称为低成本移植 |
| B：同 APK 嵌入 Flutter | 原远控工作台保留；Kelivo 整理为模块，增加宿主路由及原生适配 | 最能保留上游功能与细节；需维护双运行时，先验证原生生命周期 | **推荐，PoC 通过后才正式推进** |
| C：Flutter 作为主壳 | 在 Kelivo/Flutter 中迁移现有远控页面和协议交互 | Kelivo 保真高；原远控 UI/状态/缓存/热更新等需要迁移 | B 遇到不可消除的宿主问题时的候选，需另做原远控迁移方案 |

不采用“安装另一个 App 后跳转”作为完成方案；这不能交付同一 App 的完整功能。也不把 Android Flutter 模块视为网页端嵌入方案。[F1]

### 4.1 推荐架构

~~~mermaid
flowchart TD
  APK[同一个 codex-to-phone APK]
  Host[Android 宿主：入口、版本、权限路由]
  Remote[远控工作台 / Capacitor Activity]
  Local[本机 AI / Flutter Activity + Engine]
  Relay[现有 Mac Relay 与 Desktop/Agent]
  Models[供应商 API / 账号服务]
  Device[手机工作区 / Linux / MCP / 浏览器 / 设备工具]
  Cache[原有草稿缓存及连接凭证]
  DB[Kelivo 数据库 / 附件 / 配置]
  APK --> Host
  Host --> Remote
  Host --> Local
  Remote --> Relay
  Remote --> Cache
  Local --> Models
  Local --> Device
  Local --> DB
~~~

这是拟议设计，尚未实现。两套 Activity 共用一个 Android Application；不能让一个类同时继承 BridgeActivity 和 FlutterActivity。需将 Kelivo 原 MainActivity/Application 中的引擎初始化、通道、Intent、服务和生命周期职责整理后接入宿主，Flutter 模块的生成目录不能承载需要长期维护的手写原生代码。[F1][K4]

现宿主 minSdk 为 23、compile/targetSdk 为 35；Kelivo 从 Flutter 工具链取 SDK 值，并固定 NDK 28.2.13676358。版本下限、AGP/Kotlin/JDK、ABI 与原生库打包方式必须通过 PoC 核对，不能机械复制 Gradle 或静默提高最低系统版本。上游不同 CI 文件还存在不同 Flutter 版本配置，应从满足该固定版本依赖的构建链开始，记录实际通过的完整版本组合。[K3][K4]

### 4.2 必须明确的边界

- **身份和执行位置：** 页面显示“远控 Mac”或“本机 AI”；本机登录的 ChatGPT/Codex API 会话不冒充 Mac Desktop 原会话。工具执行在哪台设备、审批作用于哪个会话都可辨认。
- **数据：** 远控缓存与 Kelivo 数据分目录、分版本；应用内逻辑分区不等于操作系统安全隔离，它们仍在同一 APK/UID 下。先保留两边原始数据格式，跨工作区统一历史不在本次范围。
- **凭证：** 连接令牌和供应商密钥不经通用 JS 消息透传；不得把原远控连接密钥混入 Kelivo 备份。Kelivo 当前配置使用 SharedPreferences，不能直接宣称其全部凭证已有 Keystore 保护。
- **权限：** 麦克风、日历、位置、悬浮窗、目录、使用统计、无障碍和闹钟按功能首次使用请求；拒绝/撤回权限有可恢复的结果。保留无障碍的锁屏拒绝、快照校验等行为，不把读节点描述成屏幕截图能力。
- **浏览器：** 保留浏览器工具的受控操作链与独立状态；GenUI 的 HTML 预览继续执行其沙箱和网络限制，不能为嵌入方便把它提升成具有 App Bridge 权限的任意网页。
- **更新：** React Web 热更新继续遵守原契约；Dart AOT、Flutter Engine、JNI、原生插件和 Manifest 变化必须通过完整 APK 更新交付。记录 APK、Web 构建、Flutter 模块、桥接协议及数据库 schema 的兼容关系。
- **包标识：** 保持现有 applicationId 和签名连续性，逐项适配 Provider authority、JNI 类路径、通知渠道及分享/文本入口。OAuth 回调不能照搬可能冲突的 scheme；须验证与供应商登记配置相符及与原版 Kelivo 共存。
- **备份：** 保留 kelivo-backup 格式兼容；文件范围含工作区等，但上游排除了 Linux rootfs。环境重装与归档数据恢复分别验收，不能宣称一个备份可恢复完整 Linux 系统。[K5]

## 5. 先做 PoC：通过才进入全量集成

PoC 是验证路线，交付物仍是 preview，不能当作一比一完成版。建议固定一部用户目标手机，加一部接近最低受支持系统的设备，并保留干净安装与旧版升级两组数据。

| 编号 | 验证内容 | 通过标准 |
| --- | --- | --- |
| POC-01 | 工具链与可重复构建 | 固定上游提交/依赖、Flutter/Dart/JDK/AGP/Kotlin/NDK；产出同 APK 的 debug 与 release 构建，不以“Flutter 新建空页能打开”代替 |
| POC-02 | 两个工作区切换 | 连续切换 30 次、前后台与旋转/重建；聊天流、草稿、导航状态不串、不重复提交，返回键正确 |
| POC-03 | Activity/Engine 原生调用 | 录音、文件选择/保存、浏览器、登录回调、通知唤起均回到正确工作区；无回调丢失或重复消费 |
| POC-04 | 后台与进程恢复 | 两边分别流式生成；切换、锁屏、网络中断、系统回收后行为与各自基线一致；不承诺强制停止后仍运行 |
| POC-05 | 手机执行 | PRoot 环境启动、PTY 命令输出、挂载读写、STDIO MCP；无障碍工具在专用测试 App 中读取/操作并检查锁屏拒绝 |
| POC-06 | 数据和更新 | 原 preview 覆盖升级后连接/草稿保留；Kelivo 测试备份可导入；备份中不混入远控凭证；失败安装/恢复有可执行回退路径 |
| POC-07 | 资源预算 | 同设备测启动、切换、峰值 PSS、APK/安装占用、电量；先记录原版和现有 App 基线，约定预算后判定，不虚构当前性能数值 |

若发现插件必须独占 Application、引擎销毁导致状态无法恢复、或设备资源无法满足预算，先验证能否通过有限原生适配解决。仍失败则暂停 B，带着失败证据比较 C；不得未经范围决策就转为整个 App 重写。

## 6. 分阶段工作包与工期

以下是基于复用上游的初始规划估算，不是已经排定的交付承诺。一个人周按一名具备所需经验的成员工作一周计算；涵盖适配、验证和必要文档，不按源码行数估算。PoC 后重新校准，现阶段应容许约 ±50% 偏差。

| 阶段 | 工作与依赖 | 交付与退出条件 | 初估 |
| --- | --- | --- | --- |
| P0 基线/许可/PoC | 固定发布物、入口截图/录像、功能子项；明确复用许可证路径；完成全部 POC 项 | 可审查的基线包、通过/失败记录及路线决定 | 2–3 人周 |
| P1 原生宿主与模块 | 基于 P0 整理 Flutter 模块及原生代码；Activity/Application、权限、深链、服务、构建和完整 APK 更新 | release 模式两个工作区可达；原远控基础回归通过 | 3–5 人周 |
| P2 本机聊天与数据 | 全部供应商协议/登录/模型设置；助手、上下文、记忆/世界书；数据库、渲染与附件 | 矩阵 A、B、D 的非设备依赖项逐一有证据，迁移与断线恢复通过 | 2–4 人周 |
| P3 Agent 与设备能力 | Linux/PTY/文件/挂载、技能/MCP、浏览器/GenUI、无障碍、日历/位置/定时/语音后台 | 矩阵 C 与相关 D/E 项真机通过；权限拒绝及恢复有记录 | 4–7 人周 |
| P4 管理/兼容/系统 | 搜索、主题字体、翻译/生图、统计、导入导出、WebDAV/S3、快照、分享/悬浮/通知 | 矩阵余项全部实现，备份恢复与第三方导入逐字段对照 | 2–3 人周 |
| P5 全量验收与交付 | 回归两个产品域；旧版覆盖升级、恢复/回退、离线/后台/大数据；清理上游差异清单 | 全量验收报告、可复现构建、许可证/源码交付、候选 preview APK | 3–5 人周 |

合计基础预算 **16–27 人周**；另预留约 25% 原生兼容和回归余量后为 **20–34 人周**。若配置两名开发（Flutter/Android、现有前端/集成）和约半职测试，日历排期先按 **10–16 周**考虑，账号/设备/许可等待另计；单人承担通常要按数月安排。阶段可部分并行，但 P0 和最终真机回归不能省略。

A 路线要独立重建模型协议、数据库、渲染器和原生执行环境，不能套用这份复用工期。C 路线需加上原远控前端/缓存/更新机制的迁移成本，两者均需另外拆解后报价。

成本除人力外，还包括供应商 API/搜索/ASR/TTS 使用、测试账号与设备、可能的第三方商业许可、本地 ASR 模型与 Linux 环境下载/存储。官方 v1.3.4 arm64 APK 资产为 40,824,448 字节；这只是一侧发布物大小，不能直接推算合并 APK 或安装后环境占用。[K1]

## 7. 许可证与第三方条件

Kelivo 为 AGPL-3.0，本项目当前 LICENSE 为 MIT。MIT 代码可以在保留其声明的前提下纳入满足 AGPL 条件的合并作品；这不等于 Kelivo 可以改标为 MIT，也不意味着两套运行时天然构成互不相关的独立作品。[L1][L2]

推荐实施路径是：对分发的合并 APK 按 AGPL 合并作品的保守口径准备合规材料，提供与该版本匹配的相应源码、修改说明、构建/安装所需材料并保留版权和许可；若适用修改版的远程网络交互条款，还需处理相应源码提供义务。分发前按实际组合和交付方式复核，不能把“只公布未修改 Kelivo 子目录”作为预设结论。[L1][L2]

还需检查 dependencies 下修改过的组件、PRoot/Termux JNI 及原生库的 LICENSE/NOTICE；Syncfusion PDF 等另有其许可规则，不能假定原作者的商业/Community 资格自动传给本项目。[K3][K6][L3]

如果业务必须保持合并产品的闭源或仅 MIT 分发，应在开始复用前改变路线：取得覆盖相应权利人的可用授权，或者独立实现行为与协议而不复制/翻译受保护代码和资源。此处列出可行选择，不假定上游一定能提供商业授权。

账号登录、模型可用性、供应商风控、搜索额度及 Android 权限均是外部前置条件。能实现客户端对等，不等于能保证每个账号可登录或服务永久可用；出现限制时必须区分是本实现缺陷还是上游同样受限。

## 8. 验证、交付与停止条件

### 8.1 对照与测试

- **逐项对照：** 每条矩阵功能展开到真实入口和设置子项，保存上游版本、设备/系统、输入夹具、操作步骤、期望、实际及截图/日志；记录“未开始/实现中/隔离通过/真机通过/受阻”。
- **隔离检查：** 所有供应商及搜索/语音适配有协议夹具；工具、消息版本、备份 schema、数据库恢复、权限失败及原生桥回调覆盖关键分支。单元/隔离测试不读取真实 Codex 会话，不提交真实任务，不自动部署。
- **原项目检查：** 修改后使用现有 pnpm verify 与 pnpm verify:android，必要时 pnpm verify:all；命令已在根 package.json 中核对，本次没有执行产品检查。
- **Flutter 检查：** 固定工具链后执行 flutter analyze、flutter test 和真实 release 构建；当前仓库尚无该模块，不能把这些写成已通过。新增宿主接线测试、Android 仪器测试及相应 integration_test 选择集。
- **外部服务检查：** 全部支持的供应商/搜索/语音服务分别登记；Mock 通过不能代替对应真实服务验收。需要付费/授权账号的项目留在受阻状态，待具备条件后完成。
- **真机检查：** 至少目标手机及另一 Android 系统/厂商；网络切换、锁屏、后台回收、权限撤回、长会话/大量附件、浏览器/GenUI 恢复、Linux 环境、覆盖升级和数据恢复都需留证。

### 8.2 全量完成门槛

1. Android 范围每个功能子项都有可达入口与通过证据，关键项不能受阻；所有差异、平台不适用项和上游缺陷均有依据。
2. 原远控工作台的原有能力通过回归，尤其不丢草稿/连接、不重复发送、不串会话或审批、不破坏队列与停止语义。
3. Kelivo 兼容备份的版本、内容范围、覆盖/合并及失败恢复经过往返验证；不把第三方不支持的字段虚称无损导入。
4. 同签名完整 APK 覆盖升级、数据库前进迁移及恢复方案在备份副本上实测；不假定旧 APK 能直接读取新 schema，也不以允许原地降级作为回退前提。
5. 可复现构建、完整版本清单、许可证/NOTICE、对应源码及真机报告齐备。遵守现有版本流程，待真机验收不能称稳定版。

如果这些条件仍有未达项，交付名称只能是阶段预览，不能称“一比一已完成”。

## 9. 本轮成果及下一轮启动点

本轮完成的是源码可行性分析与执行计划：新增本方案及功能矩阵，没有修改产品代码、切换当前 Trellis 任务、暂存、提交、推送或运行真实模型任务。没有运行合并构建或真机验证。

用户决定启动后，下一轮范围先固定为 **P0：发布物功能基线、许可实施路径和同 APK 双引擎 PoC**；依据退出条件判断是否进入 P1。暂不自动启动后续开发，也不将现有 DeepSeek 真机验收任务纳入本次改动。

## 10. 证据索引

访问与核对日期均为 2026-11-03。K 系列按固定 tag 而非变化中的 main 分支引用；URL 供复查。源码目录中的存在只作为初步证据，矩阵另列了正式接线的依据。

~~~text
[K1] 发布基线及官方资产
https://github.com/Chevey339/kelivo/releases/tag/v1.3.4
https://api.github.com/repos/Chevey339/kelivo/releases/latest

[K2] 上游功能说明
https://raw.githubusercontent.com/Chevey339/kelivo/v1.3.4/README_ZH_CN.md

[K3] 依赖、工具链与许可证
https://github.com/Chevey339/kelivo/blob/v1.3.4/pubspec.yaml
https://github.com/Chevey339/kelivo/blob/v1.3.4/pubspec.lock
https://github.com/Chevey339/kelivo/blob/v1.3.4/.github/workflows/build-stable-47.yml
https://github.com/Chevey339/kelivo/blob/v1.3.4/LICENSE

[K4] Android 宿主与能力声明
https://github.com/Chevey339/kelivo/blob/v1.3.4/android/app/src/main/AndroidManifest.xml
https://github.com/Chevey339/kelivo/blob/v1.3.4/android/app/src/main/kotlin/com/psyche/kelivo/MainActivity.kt
https://github.com/Chevey339/kelivo/blob/v1.3.4/android/app/build.gradle.kts

[K5] 备份范围与格式
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/core/services/backup/data_sync.dart

[K6] 原生第三方代码说明
https://github.com/Chevey339/kelivo/blob/v1.3.4/android/app/src/main/jniLibs/NOTICE

[K7] 超出 README 数量的正式功能目录及接线
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/features/provider/widgets/oauth_login_panel.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/features/search/pages/search_service_editor_page.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/features/settings/pages/about_page.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/core/services/asr/asr_service_options.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/core/services/tts/network_tts.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/features/home/services/local_tools_service.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/features/chat/widgets/bottom_tools_sheet.dart
https://github.com/Chevey339/kelivo/blob/v1.3.4/lib/shared/markdown/kelivo_markdown_extensions.dart

[F1] Flutter 官方 add-to-app / Android 限制及集成方法
https://docs.flutter.dev/add-to-app
https://docs.flutter.dev/add-to-app/android/project-setup

[L1] GNU AGPL v3 条文，尤其第 5、6、13 条
https://www.gnu.org/licenses/agpl-3.0.en.html

[L2] GNU FAQ：合并作品/聚合、MIT 兼容及修改版源码
https://www.gnu.org/licenses/gpl-faq.html#MereAggregation
https://www.gnu.org/licenses/gpl-faq.html#GPLInProprietarySystem

[L3] Syncfusion 授权资格说明
https://www.syncfusion.com/products/communitylicense
~~~

本仓复查入口：docs/project-index.md、docs/project-layout.md、LICENSE、package.json、apps/mobile/package.json、apps/mobile/android/variables.gradle、apps/mobile/android/app/build.gradle、.trellis/spec/mobile/frontend/architecture.md、.trellis/spec/relay/backend/agent-gateway-contract.md、.trellis/spec/relay/backend/voice-contract.md。
